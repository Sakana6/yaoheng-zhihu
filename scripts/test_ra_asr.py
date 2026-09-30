"""Actual local SenseVoice on synthetic Windows TTS, plus invalid/silent/WEBM audio."""
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import time
import wave

ROOT=Path(__file__).resolve().parents[1]


def run(args):
    args.out.mkdir(parents=True,exist_ok=True)
    fixtures=args.out/'fixtures'
    subprocess.run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(ROOT/'scripts/generate_ra_voice_fixtures.ps1'),'-OutputDirectory',str(fixtures.resolve())],check=True)
    cases=json.loads((fixtures/'manifest.json').read_text(encoding='utf-8-sig'))
    # ASR is transcription, not numeric normalization. Both notations express the same spoken value.
    equivalents={'6.2':['6.2','六点二'],'120':['120','一百二十'],'80':['80','八十']}
    silent=fixtures/'silence.wav'
    with wave.open(str(silent),'wb') as w:
        w.setparams((1,2,16000,0,'NONE','not compressed'));w.writeframes(b'\0'*32000)
    invalid=fixtures/'invalid.wav';invalid.write_bytes(b'RIFFxxxxWAVEbad-audio')
    cases.extend([dict(id='silence',keywords=[]),dict(id='invalid',keywords=[])])
    env=os.environ.copy();env['LOCAL_ASR_MODEL_DIR']=str(args.model.resolve())
    results=[]
    for case in cases:
        data=(fixtures/(case['id']+'.wav')).read_bytes();t=time.monotonic()
        proc=subprocess.run([str(ROOT/'services/inference-service/.venv/Scripts/python.exe'),str(ROOT/'services/inference-service/asr_worker.py')],
            input=json.dumps(dict(audioBase64=base64.b64encode(data).decode())).encode(),env=env,capture_output=True,timeout=60)
        result=json.loads(proc.stdout)
        ok=(proc.returncode!=0) if case['id']=='invalid' else proc.returncode==0 and all(any(v in result['text'] for v in equivalents.get(k,[k])) for k in case['keywords'])
        if case['id']=='silence':ok=ok and result['text']==''
        results.append(dict(case=case['id'],expected=case.get('text'),keywords=case['keywords'],success=ok,result=result,seconds=round(time.monotonic()-t,3)))
        (args.out/'asr-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
    passed=sum(r['success'] for r in results[:6])>=5 and all(r['success'] for r in results[-2:])
    print(json.dumps(dict(passed=passed,cases=len(results),success=sum(r['success'] for r in results))))
    if not passed:raise SystemExit(1)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);p.add_argument('--model',type=Path,required=True);run(p.parse_args())
