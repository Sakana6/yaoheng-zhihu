import asyncio
import base64
import io
import json
from types import SimpleNamespace as NS

import httpx
import pytest
from openai import APIStatusError
from PIL import Image

from app.providers.deepseek import Budget, DeepSeek, ProviderError
from app.ra_capture import ImageInput, prepare, recognize


def response(value=None, finish='stop'):
    return NS(choices=[NS(finish_reason=finish, message=NS(content=json.dumps(value or {'text': '二甲双胍'})))],
              model='synthetic-provider', usage=NS(prompt_tokens=10, completion_tokens=4, total_tokens=14))


class Client:
    def __init__(self, outcomes):
        self.chat = NS(completions=self)
        self.outcomes = iter(outcomes)
        self.calls = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        item = next(self.outcomes)
        if isinstance(item, Exception):
            raise item
        if callable(item):
            return await item()
        return item


def engine(tmp_path, outcomes, **overrides):
    env = dict(RA_LLM_ENABLED='true', DEEPSEEK_API_KEY='synthetic-test-only',
               RA_LLM_BUDGET_PATH=str(tmp_path/'budget.db'), **overrides)
    return DeepSeek(env, Client(outcomes))


def test_success_and_durable_budget(tmp_path):
    p = engine(tmp_path, [response(), response()])
    for _ in range(2):
        result, meta = asyncio.run(p.complete('task1', 'Return json', 'synthetic'))
        assert result == {'text': '二甲双胍'} and meta['usage']['total_tokens'] == 14
    recreated = engine(tmp_path, [response()])
    with pytest.raises(ProviderError, match='TASK_LIMIT'):
        asyncio.run(recreated.complete('task1', 'json', 'test'))
    assert not recreated.client.calls
    assert p.client.calls[0]['extra_body'] == {'thinking': {'type': 'disabled'}}
    assert 'tools' not in p.client.calls[0]


@pytest.mark.parametrize('setting,code', [({'RA_LLM_ENABLED': 'false'}, 'DISABLED'), ({'DEEPSEEK_API_KEY': ''}, 'KEY_MISSING')])
def test_missing_disabled(tmp_path, setting, code):
    env = dict(RA_LLM_ENABLED='true', DEEPSEEK_API_KEY='synthetic', RA_LLM_BUDGET_PATH=str(tmp_path/'b'))
    env.update(setting)
    p = DeepSeek(env, Client([]))
    with pytest.raises(ProviderError, match=code):
        asyncio.run(p.complete('t', 'json', 'x'))
    assert not (tmp_path/'b').exists()


@pytest.mark.parametrize('status,retry', [(400, False), (401, False), (402, False), (403, False), (429, True), (503, True)])
def test_http_policy(tmp_path, status, retry):
    err = APIStatusError('secret upstream text', response=httpx.Response(status, request=httpx.Request('POST', 'https://api.deepseek.com'), headers={'retry-after': '0'}), body=None)
    p = engine(tmp_path, [err, response()])
    if retry:
        asyncio.run(p.complete('t', 'json', 'x'))
    else:
        with pytest.raises(ProviderError) as exc:
            asyncio.run(p.complete('t', 'json', 'x'))
        assert 'secret' not in str(exc.value)
    assert len(p.client.calls) == (2 if retry else 1)


def test_auth_latch_and_daily_limit(tmp_path):
    p = engine(tmp_path, [response(), response()], RA_LLM_DAILY_REQUEST_LIMIT='1')
    asyncio.run(p.complete('a', 'json', 'x'))
    with pytest.raises(ProviderError, match='DAILY_LIMIT'):
        asyncio.run(p.complete('b', 'json', 'x'))


def test_total_deadline(tmp_path):
    async def slow():
        await asyncio.sleep(3)
        return response()
    p = engine(tmp_path, [slow], RA_LLM_TIMEOUT_SECONDS='1')
    with pytest.raises(ProviderError, match='TIMEOUT'):
        asyncio.run(p.complete('a', 'json', 'x'))
    assert p.pending == 0


def test_circuit_and_queue(tmp_path):
    p = engine(tmp_path, [])
    for _ in range(3): p._failed()
    with pytest.raises(ProviderError, match='CIRCUIT_OPEN'):
        asyncio.run(p.complete('a', 'json', 'x'))
    p.open_until = 0
    p.pending = 12
    with pytest.raises(ProviderError, match='BUSY'):
        asyncio.run(p.complete('a', 'json', 'x'))


@pytest.mark.parametrize('env', [{'DEEPSEEK_BASE_URL': 'https://example.org'}, {'RA_LLM_MAX_RETRIES': '9'}, {'RA_LLM_TIMEOUT_SECONDS': 'inf'}])
def test_config_rejected(env):
    with pytest.raises(ProviderError, match='CONFIGURATION_INVALID'): DeepSeek(env)


def picture():
    out = io.BytesIO(); Image.new('RGB', (20, 20), 'white').save(out, 'PNG')
    return base64.b64encode(out.getvalue()).decode()


def test_image_candidate_shape(tmp_path):
    p = engine(tmp_path, [response()])
    result = asyncio.run(recognize(ImageInput(requestId='task_1234', imageBase64=picture()), p))
    assert result['requiresConfirmation'] is True and result['boxes'] == []
    assert result['engine'] == 'DEEPSEEK' and len(result['inputHash']) == 64
    assert 'patientId' not in json.dumps(p.client.calls)


@pytest.mark.parametrize('out', [{'text': 'x', 'dose': '1'}, {'text': 1}, {'text': 'x'*2001}])
def test_ocr_untrusted_schema(tmp_path, out):
    p = engine(tmp_path, [response(out)])
    with pytest.raises(ProviderError, match='OUTPUT_SCHEMA_INVALID'):
        asyncio.run(recognize(ImageInput(requestId='task_1234', imageBase64=picture()), p))


def test_bad_image_no_call(tmp_path):
    p = engine(tmp_path, [])
    with pytest.raises(ProviderError, match='INVALID_IMAGE'):
        asyncio.run(recognize(ImageInput(requestId='task_1234', imageBase64='bm90LWltYWdl'), p))
    assert not p.client.calls


def test_truncated(tmp_path):
    p = engine(tmp_path, [response(finish='length')])
    with pytest.raises(ProviderError, match='OUTPUT_INCOMPLETE'):
        asyncio.run(p.complete('t', 'json', 'x'))
