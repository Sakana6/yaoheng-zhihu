"""Loopback-only, bounded ASR subprocesses. Audio is not persisted or sent off-device."""
import asyncio
import json
import os
from pathlib import Path
import sys

from fastapi import FastAPI, HTTPException, Request

app=FastAPI(title='Local synthetic ASR')
busy=False


@app.get('/health')
def health():
    root=Path(os.environ.get('LOCAL_ASR_MODEL_DIR',''))
    return {'status':'ok','modelReady':(root/'model.int8.onnx').is_file() and (root/'tokens.txt').is_file()}


@app.post('/asr/transcribe')
async def recognize(request:Request):
    global busy
    if request.client is None or request.client.host not in ('127.0.0.1','::1','testclient') or request.headers.get('origin'):
        raise HTTPException(403,'INTERNAL_ONLY')
    if busy: raise HTTPException(503,'ASR_BUSY')
    busy=True
    process=None
    try:
        data=bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data)>2800000: raise HTTPException(413,'AUDIO_TOO_LARGE')
        try:
            body=json.loads(data)
            if set(body)!={'requestId','audioBase64'} or not isinstance(body['audioBase64'],str):raise ValueError()
        except (ValueError,TypeError):raise HTTPException(422,'INVALID_AUDIO_INPUT') from None
        env={k:v for k,v in os.environ.items() if k not in ('DEEPSEEK_API_KEY','DB_PASSWORD','SPRING_DATASOURCE_PASSWORD')}
        process=await asyncio.create_subprocess_exec(sys.executable,str(Path(__file__).with_name('asr_worker.py')),
            stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL,env=env)
        try:stdout,_=await asyncio.wait_for(process.communicate(bytes(data)),60)
        except asyncio.TimeoutError:raise HTTPException(503,'ASR_TIMEOUT') from None
        if len(stdout)>64000:raise HTTPException(503,'ASR_INVALID_OUTPUT')
        result=json.loads(stdout)
        if process.returncode:raise HTTPException(422,result.get('error','ASR_FAILED'))
        return result
    finally:
        if process is not None and process.returncode is None:
            process.kill();await process.wait()
        busy=False
