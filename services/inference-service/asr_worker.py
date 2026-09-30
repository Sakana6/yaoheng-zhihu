"""One isolated recognition task. Decoder and ONNX runtime die on service timeout."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sys

import av
import numpy as np
import sherpa_onnx


def transcribe(data):
    if not 16 <= len(data) <= 2*1024*1024:
        raise ValueError('INVALID_AUDIO')
    if not (data[:4] in (b'RIFF', b'OggS') or data[:4] == b'\x1a\x45\xdf\xa3'):
        raise ValueError('INVALID_AUDIO')
    # Only an in-memory file, never an input URL/playlist/protocol.
    chunks = []
    count = 0
    with av.open(io.BytesIO(data)) as media:
        if media.format.name not in ('wav', 'ogg', 'matroska,webm'):
            raise ValueError('INVALID_AUDIO')
        resampler = av.AudioResampler(format='flt', layout='mono', rate=16000)
        for frame in media.decode(audio=0):
            for converted in resampler.resample(frame):
                arr = converted.to_ndarray().reshape(-1)
                count += len(arr)
                if count > 60*16000:
                    raise ValueError('AUDIO_DURATION_EXCEEDED')
                chunks.append(arr)
        for converted in resampler.resample(None):
            arr = converted.to_ndarray().reshape(-1)
            count += len(arr)
            if count > 60*16000: raise ValueError('AUDIO_DURATION_EXCEEDED')
            chunks.append(arr)
    if count < 1600:
        raise ValueError('AUDIO_TOO_SHORT')
    samples = np.concatenate(chunks)
    if not np.isfinite(samples).all(): raise ValueError('INVALID_AUDIO')
    model = Path(os.environ.get('LOCAL_ASR_MODEL_DIR', ''))
    if not (model/'model.int8.onnx').is_file() or not (model/'tokens.txt').is_file():
        raise ValueError('ASR_MODEL_MISSING')
    model_hash = hashlib.sha256((model/'model.int8.onnx').read_bytes()).hexdigest()
    expected = os.environ.get('LOCAL_ASR_MODEL_SHA256', '')
    if expected and expected != model_hash: raise ValueError('ASR_MODEL_HASH_MISMATCH')
    text = ''
    if float(np.sqrt(np.mean(samples*samples))) > .0001:
        recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=str(model/'model.int8.onnx'), tokens=str(model/'tokens.txt'),
            num_threads=2, use_itn=True, language='zh', provider='cpu')
        stream = recognizer.create_stream(); stream.accept_waveform(16000, samples)
        recognizer.decode_stream(stream)
        text = re.sub(r'<\|[^|]*\|>', '', stream.result.text).strip()
    if len(text)>2000: raise ValueError('ASR_OUTPUT_TOO_LONG')
    return dict(text=text, engine='LOCAL_SENSEVOICE', engineVersion='sensevoice-onnx-2025-09-09',
                requiresConfirmation=True, inputHash=hashlib.sha256(data).hexdigest(),
                modelHash=model_hash, tokensHash=hashlib.sha256((model/'tokens.txt').read_bytes()).hexdigest(),
                durationSeconds=round(count/16000,3), generationMode='LOCAL_ASR')


if __name__=='__main__':
    try:
        body=json.loads(sys.stdin.buffer.read(2800000))
        result=transcribe(base64.b64decode(body['audioBase64'],validate=True))
        print(json.dumps(result,ensure_ascii=True))
    except Exception as exc:
        allowed={'INVALID_AUDIO','AUDIO_DURATION_EXCEEDED','AUDIO_TOO_SHORT','ASR_MODEL_MISSING','ASR_MODEL_HASH_MISMATCH','ASR_OUTPUT_TOO_LONG'}
        print(json.dumps({'error':str(exc) if str(exc) in allowed else 'ASR_DECODE_FAILED'}))
        raise SystemExit(1)
