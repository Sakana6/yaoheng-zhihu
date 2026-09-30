import io
import wave

import pytest

from asr_worker import transcribe


def wav(seconds=1,rate=16000):
    b=io.BytesIO()
    with wave.open(b,'wb') as w:
        w.setparams((1,2,rate,0,'NONE','not compressed'));w.writeframes(b'\0'*(seconds*rate*2))
    return b.getvalue()


@pytest.mark.parametrize('data',[b'not audio',b'RIFF1234WAVEbad data',b'\x1a\x45\xdf\xa3'+b'bad'*10])
def test_bad_audio(data):
    with pytest.raises(Exception):transcribe(data)


def test_duration_limit():
    # 8kHz file remains below ingress byte limit, but exceeds 60s after resampling.
    with pytest.raises(ValueError,match='AUDIO_DURATION_EXCEEDED'):transcribe(wav(61,8000))


def test_model_missing(monkeypatch,tmp_path):
    monkeypatch.setenv('LOCAL_ASR_MODEL_DIR',str(tmp_path))
    with pytest.raises(ValueError,match='ASR_MODEL_MISSING'):transcribe(wav())
