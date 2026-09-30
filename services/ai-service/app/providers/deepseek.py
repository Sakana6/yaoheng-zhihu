"""Bounded, opt-in DeepSeek transport. No patient facts, prompts or keys are logged."""
import asyncio
import hashlib
import json
import os
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from openai import AsyncOpenAI, APIConnectionError, APIStatusError, APITimeoutError


class ProviderError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


class Budget:
    """Local operational counters only, NOT a replacement for MySQL clinical storage."""
    def __init__(self, path):
        self.path = Path(path)

    def reserve(self, task, daily_limit, task_limit):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        day = datetime.now(timezone(timedelta(hours=8))).date().isoformat()
        try:
            with sqlite3.connect(self.path, timeout=1) as db:
                db.execute('CREATE TABLE IF NOT EXISTS calls(day TEXT, task TEXT, count INTEGER, PRIMARY KEY(day,task))')
                db.execute('BEGIN IMMEDIATE')
                total = db.execute('SELECT coalesce(sum(count),0) FROM calls WHERE day=?', (day,)).fetchone()[0]
                used = db.execute('SELECT coalesce(sum(count),0) FROM calls WHERE task=?', (task,)).fetchone()[0]
                if total >= daily_limit:
                    raise ProviderError('DAILY_LIMIT')
                if used >= task_limit:
                    raise ProviderError('TASK_LIMIT')
                db.execute('INSERT INTO calls VALUES(?,?,1) ON CONFLICT(day,task) DO UPDATE SET count=count+1', (day, task))
        except sqlite3.Error:
            raise ProviderError('BUDGET_UNAVAILABLE') from None


def integer(env, name, default, low, high):
    try:
        value = int(env.get(name, default))
        if not low <= value <= high:
            raise ValueError()
        return value
    except (TypeError, ValueError):
        raise ProviderError('CONFIGURATION_INVALID') from None


def unique_object(pairs):
    obj = {}
    for key, value in pairs:
        if key in obj:
            raise ValueError('duplicate field')
        obj[key] = value
    return obj


class DeepSeek:
    def __init__(self, env=None, client=None):
        env = os.environ if env is None else env
        self.enabled = env.get('RA_LLM_ENABLED', 'false').lower() == 'true'
        self.key = env.get('DEEPSEEK_API_KEY', '')
        if env.get('RA_LLM_PROVIDER', 'deepseek') != 'deepseek' or env.get('DEEPSEEK_BASE_URL', 'https://api.deepseek.com').rstrip('/') != 'https://api.deepseek.com':
            raise ProviderError('CONFIGURATION_INVALID')
        self.model = env.get('DEEPSEEK_MODEL', 'deepseek-flash')
        self.timeout = integer(env, 'RA_LLM_TIMEOUT_SECONDS', 30, 1, 30)
        self.retries = integer(env, 'RA_LLM_MAX_RETRIES', 1, 0, 1)
        self.tokens = integer(env, 'RA_LLM_MAX_OUTPUT_TOKENS', 2048, 64, 2048)
        self.daily = integer(env, 'RA_LLM_DAILY_REQUEST_LIMIT', 100, 1, 100)
        self.task_limit = integer(env, 'RA_LLM_MAX_CALLS_PER_TASK', 2, 1, 2)
        self.concurrency = integer(env, 'RA_LLM_MAX_CONCURRENCY', 2, 1, 2)
        self.sem = asyncio.Semaphore(self.concurrency)
        self.pending = 0
        self.failures = 0
        self.open_until = 0.0
        self.probing = False
        self.auth_failed = False
        self.client = client
        self.budget = Budget(env.get('RA_LLM_BUDGET_PATH', '.local-evidence/ra-provider-budget.sqlite3'))

    async def complete(self, task, system, content):
        if not self.enabled:
            raise ProviderError('DISABLED')
        if not self.key:
            raise ProviderError('KEY_MISSING')
        if self.auth_failed:
            raise ProviderError('AUTH_UNAVAILABLE')
        if self.pending >= self.concurrency + 10:
            raise ProviderError('BUSY')
        if self.open_until > time.monotonic() or (self.open_until and self.probing):
            raise ProviderError('CIRCUIT_OPEN')
        probe = bool(self.open_until)
        if probe:
            self.probing = True
        self.pending += 1
        try:
            # Covers semaphore wait, HTTP body, Retry-After and all attempts.
            return await asyncio.wait_for(self._run(task, system, content), self.timeout)
        except asyncio.TimeoutError:
            self._failed()
            raise ProviderError('TIMEOUT') from None
        finally:
            self.pending -= 1
            if probe:
                self.probing = False

    def _failed(self):
        self.failures += 1
        if self.failures >= 3:
            self.open_until = time.monotonic() + 60

    async def _run(self, task, system, content):
        async with self.sem:
            if self.open_until > time.monotonic():
                raise ProviderError('CIRCUIT_OPEN')
            if self.auth_failed:
                raise ProviderError('AUTH_UNAVAILABLE')
            if self.client is None:
                self.client = AsyncOpenAI(api_key=self.key, base_url='https://api.deepseek.com', max_retries=0,
                    http_client=httpx.AsyncClient(follow_redirects=False, trust_env=False, timeout=self.timeout))
            for attempt in range(self.retries + 1):
                self.budget.reserve(hashlib.sha256(task.encode()).hexdigest(), self.daily, self.task_limit)
                try:
                    response = await self.client.chat.completions.create(model=self.model,
                        messages=[{'role': 'system', 'content': system}, {'role': 'user', 'content': content}],
                        extra_body={'thinking': {'type': 'disabled'}}, stream=False,
                        response_format={'type': 'json_object'}, max_tokens=self.tokens, timeout=self.timeout)
                    choice = response.choices[0]
                    if choice.finish_reason != 'stop' or not choice.message.content:
                        raise ProviderError('OUTPUT_INCOMPLETE')
                    raw = choice.message.content
                    if len(raw) > 20000:
                        raise ProviderError('OUTPUT_INVALID')
                    try:
                        parsed = json.loads(raw, object_pairs_hook=unique_object,
                            parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
                    except (ValueError, TypeError):
                        raise ProviderError('OUTPUT_INVALID') from None
                    if not isinstance(parsed, dict):
                        raise ProviderError('OUTPUT_INVALID')
                    self.failures = 0
                    self.open_until = 0
                    usage = response.usage
                    return parsed, {'model': response.model, 'provider': 'DEEPSEEK',
                        'usage': {k: int(getattr(usage, k, 0) or 0) for k in ('prompt_tokens', 'completion_tokens', 'total_tokens')}}
                except APIStatusError as exc:
                    code = exc.status_code
                    if code in (401, 402, 403):
                        self.auth_failed = True
                        raise ProviderError('BALANCE_UNAVAILABLE' if code == 402 else 'AUTH_REJECTED_' + str(code)) from None
                    if code != 429 and code < 500:
                        raise ProviderError('REQUEST_REJECTED') from None
                    self._failed()
                    if attempt == self.retries:
                        raise ProviderError('RATE_LIMIT' if code == 429 else 'UNAVAILABLE') from None
                    try:
                        delay = max(0.0, float(exc.response.headers.get('retry-after', '0.5')))
                    except ValueError:
                        delay = 1.0
                    await asyncio.sleep(delay)
                except (APIConnectionError, APITimeoutError):
                    self._failed()
                    if attempt == self.retries:
                        raise ProviderError('UNAVAILABLE') from None
                    await asyncio.sleep(.5)
                except (AttributeError, IndexError, TypeError, ValueError):
                    raise ProviderError('OUTPUT_INVALID') from None

    async def close(self):
        if self.client is not None:
            await self.client.close()
