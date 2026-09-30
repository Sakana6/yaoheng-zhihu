"""Run the extracted distribution without development tools; use only synthetic data."""
import argparse
import base64
from datetime import datetime,timezone
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import time
import urllib.request
import uuid


def verify(root,out,audio=None):
    out.mkdir(parents=True,exist_ok=True)
    executable=root/'runtime/python-ai/python.exe'
    ready=root/'data/ready.json';stop=root/'data/STOP'
    if ready.exists():raise RuntimeError('Already running; use a fresh extracted directory')
    results=[];record=None;ports=[]
    env={k:v for k,v in os.environ.items() if k.upper() in ('SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMDATA')}
    env.update(PATH=str(Path(os.environ['SYSTEMROOT'])/'System32'),PYTHONUTF8='1',PYTHONNOUSERSITE='1')
    for round_ in range(2):
        with (out/f'launch-{round_}.txt').open('w',encoding='utf-8') as log:
            process=subprocess.Popen([str(executable),str(root/'scripts/portable/launcher.py'),'--no-browser'],env=env,stdout=log,stderr=log,cwd=root)
            def wait(fn,predicate=lambda v:bool(v),seconds=150):
                end=time.monotonic()+seconds
                while time.monotonic()<end:
                    if process.poll() is not None:raise AssertionError('Launcher exited; inspect verification log')
                    try:
                        value=fn()
                        if predicate(value):return value
                    except (OSError,ValueError):pass
                    time.sleep(.4)
                raise AssertionError('Deadline exceeded')
            try:
                info=wait(lambda:json.loads(ready.read_text()))
                ports=list(info['ports'].values())+[int(u.rsplit(':',1)[1]) for u in info['urls'].values()]
                base=info['urls']['mobile'];doctor_base=info['urls']['doctor']
                def request(path,method='GET',body=None,token=None,origin=None):
                    headers={'Content-Type':'application/json','Idempotency-Key':uuid.uuid4().hex}
                    if token:headers['Authorization']='Bearer '+token
                    req=urllib.request.Request((origin or base)+'/api'+path,data=json.dumps(body).encode() if body is not None else None,headers=headers,method=method)
                    with urllib.request.urlopen(req,timeout=100) as response:data=json.load(response)
                    return data.get('data',data)
                for url in info['urls'].values():
                    with urllib.request.urlopen(url) as r:assert b'<div id="app">' in r.read()
                family=request('/auth/password-login','POST',dict(mobile='13800000001',password='Trial-2026!'))['token']
                doctor=request('/auth/password-login','POST',dict(mobile='13800000002',password='Trial-2026!'),origin=doctor_base)['token']
                def call(path,method='GET',body=None,token=family,origin=None):return request('/patients/1'+path,method,body,token,origin)
                if round_==1:
                    assert call('/feedback-records/'+record['recordId'])['recordId']==record['recordId']
                    assert call('/analysis/latest',token=doctor,origin=doctor_base)['snapshot']['snapshotId']==snapshot['snapshotId']
                    results.append('restart: migrations reused; confirmed record and doctor snapshot persisted')
                    continue
                results.append('startup: bundled runtimes only; both prebuilt pages and authorized logins')
                # A second launcher must fail without disturbing the existing one.
                duplicate=subprocess.run([str(executable),str(root/'scripts/portable/launcher.py'),'--no-browser','--smoke'],env=env,cwd=root,capture_output=True,timeout=20)
                assert duplicate.returncode!=0 and b'already running' in duplicate.stderr
                assert request('/health')['database']['ready']
                results.append('duplicate launcher refuses same data directory; first launch stays healthy')
                now=datetime.now(timezone.utc).isoformat();day=now[:10]
                med=call('/medications','POST',dict(genericName='二甲双胍',dose='0.5g',frequency='QD',administrationTime='AFTER_BREAKFAST',startDate=day))
                assert med['id']
                candidate=call('/ra/candidates','POST',dict(rawText='我没有头晕，家人昨天手抖；我血糖6.2',referenceTime=now,timezone='Asia/Shanghai',inputRevision=1,recordId=None,recordRevision=None))
                candidate=wait(lambda:call('/ra/candidates/'+candidate['artifactId']),lambda v:v['state']=='READY')
                assert candidate['result']['generationMode']=='RULE_FALLBACK'
                facts=dict(medications=[],symptoms=[],explicitNoSymptoms=None,glucose=[dict(value=6.2,unit='mmol/L',occurredAt=now)],bloodPressure=[],meals=[])
                record=call('/feedback-records','POST',dict(source='MANUAL',occurredAt=now,rawText='我没有头晕，家人昨天手抖；我血糖6.2',confirmedFacts=facts,textFactsReviewed=True,raArtifactId=candidate['artifactId'],raArtifactHash=candidate['artifactHash']))
                task=record['analysisTask']['taskId']
                wait(lambda:call('/analysis-tasks/'+task),lambda v:v['status']=='SUCCESS')
                snapshot=call('/analysis/latest')['snapshot']
                assert call('/analysis/latest',token=doctor,origin=doctor_base)['snapshot']['snapshotId']==snapshot['snapshotId']
                projection=call('/ra/contexts/'+task+'/projection');assert any(e['kind']=='BG' for e in projection['events'])
                results.append('medication -> offline semantic candidate -> reviewed fact -> original analysis -> frozen context -> doctor read')
                for kind in ('FAMILY','DOCTOR'):
                    report=call('/reports','POST',dict(snapshotId=snapshot['snapshotId'],reportType=kind),doctor,doctor_base)
                    report=wait(lambda:call('/reports/'+report['reportId'],token=doctor,origin=doctor_base),lambda v:v['status']=='SUCCESS')
                    req=urllib.request.Request(doctor_base+'/api/patients/1/reports/'+report['reportId']+'/content',headers={'Authorization':'Bearer '+doctor})
                    with urllib.request.urlopen(req) as response:content=response.read()
                    assert hashlib.sha256(content).hexdigest()==report['checksum']
                    (out/(kind+'.html')).write_bytes(content)
                results.append('family and doctor reports generated, downloaded and checksummed through production proxy')
                if audio:
                    req=urllib.request.Request(f"http://127.0.0.1:{info['ports']['asr']}/asr/transcribe",data=json.dumps(dict(requestId=uuid.uuid4().hex,audioBase64=base64.b64encode(audio.read_bytes()).decode())).encode(),headers={'Content-Type':'application/json'})
                    with urllib.request.urlopen(req,timeout=90) as response:asr=json.load(response)
                    assert asr['generationMode']=='LOCAL_ASR' and asr['text']
                    (out/'asr.json').write_text(json.dumps(asr,ensure_ascii=False,indent=2),encoding='utf-8')
                    results.append('bundled local ASR decoded synthetic audio without installed Python or downloads')
            finally:
                if process.poll() is None:
                    stop.write_text('stop',encoding='utf-8')
                    try:process.wait(timeout=40)
                    except subprocess.TimeoutExpired:process.kill();process.wait();raise
                for port in ports:
                    if port:
                        with socket.socket() as sock:assert sock.connect_ex(('127.0.0.1',port))!=0,('owned port remained open',port)
            assert process.returncode==0
    results.append('all owned ports closed after each shutdown')
    (out/'results.json').write_text(json.dumps(dict(passed=True,checks=results),ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(dict(passed=True,checks=results),ensure_ascii=False,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',required=True,type=Path);p.add_argument('--out',required=True,type=Path);p.add_argument('--audio',type=Path);a=p.parse_args();verify(a.root.resolve(),a.out.resolve(),a.audio)
