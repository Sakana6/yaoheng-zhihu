"""Actual disabled-engine fallback; manual R1 writes remain usable."""
import argparse,json,os,re,socket,subprocess,time,urllib.request,urllib.error,uuid
from pathlib import Path
from local_database import ROOT
from r1_local import synthetic

def run(database):
    synthetic(database)
    with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
    env=os.environ.copy();env.update(DB_ENABLED='true',DB_NAME=database,DB_USER=env.get('DB_USER',env.get('SPRING_DATASOURCE_USERNAME','root')),DB_PASSWORD=env.get('DB_PASSWORD') or env['SPRING_DATASOURCE_PASSWORD'],PORT=str(port),AI_WORKER_ENABLED='false',CAPTURE_OCR_MODE='disabled',CAPTURE_VOICE_MODE='disabled')
    cp=str(ROOT/'services/backend/target/classes')+os.pathsep+(ROOT/'services/backend/target/classpath.txt').read_text().strip()
    home=re.search(r'java.home\s*=\s*(.+)',subprocess.run(['java','-XshowSettings:properties','-version'],capture_output=True,text=True,check=True).stderr).group(1).strip()
    token=None
    def call(path,body=None,mime='application/json',extra=None):
        headers={'Content-Type':mime}
        if token:headers['Authorization']='Bearer '+token
        if body is not None:headers['Idempotency-Key']=uuid.uuid4().hex
        headers.update(extra or {})
        req=urllib.request.Request('http://127.0.0.1:'+str(port)+'/api'+path,data=body if isinstance(body,bytes) else json.dumps(body).encode() if body is not None else None,headers=headers)
        with urllib.request.urlopen(req,timeout=20) as r:
            payload=json.loads(r.read());return payload.get('data',payload)
    logdir=ROOT/'.runtime-logs';logdir.mkdir(exist_ok=True)
    with (logdir/'disabled-capture.txt').open('w',encoding='utf-8') as log:
        proc=subprocess.Popen([str(Path(home)/'bin/java.exe'),'-cp',cp,'com.yaoheng.backend.BackendApplication'],cwd=ROOT,env=env,stdout=log,stderr=log)
        try:
            for _ in range(100):
                try:call('/health');break
                except OSError:
                    if proc.poll() is not None:raise RuntimeError('backend exited')
                    time.sleep(.1)
            else:raise RuntimeError('backend timeout')
            token=call('/auth/password-login',dict(mobile='13800000001',password='Trial-2026!'))['token']
            base='/patients/1';tasks=base+'/capture-tasks'
            before=call(base+'/medications')['medications']
            image=call(tasks,(ROOT/'packages/contracts/capture/fixtures/metformin.png').read_bytes(),'image/png',{'X-File-Name':'metformin.png'})
            failed=call(tasks+'/'+image['taskId']+'/process',dict(expectedVersion=image['version']))
            assert failed['status']=='FAILED' and failed['failureCode']=='OCR_ENGINE_UNAVAILABLE'
            assert len(call(base+'/medications')['medications'])==len(before)
            med=call(base+'/medications',dict(genericName='人工确认药品',brandName='',dose='1片',frequency='QD',administrationTime='AFTER_BREAKFAST',startDate='2026-09-30',captureTaskId=failed['taskId'],captureVersion=failed['version']))
            assert call(tasks+'/'+image['taskId'])['medicationId']==med['id']
            voice=call(tasks+'/voice',(ROOT/'packages/contracts/capture/fixtures/voice-negative.wav').read_bytes(),'audio/wav')
            assert voice['status']=='FAILED' and voice['failureCode']=='VOICE_ENGINE_UNAVAILABLE'
            facts=dict(medications=[],symptoms=[],explicitNoSymptoms=None,glucose=[],bloodPressure=[],meals=[])
            from datetime import datetime,timezone
            saved=call(base+'/feedback-records',dict(rawText='合成手工回退，未确认服药',source='MANUAL',occurredAt=datetime.now(timezone.utc).isoformat(),confirmedFacts=facts,textFactsReviewed=True))
            assert saved['confirmedFacts']['medications']==[] and saved.get('captureSource') not in ['VOICE','DEVICE']
            print('PASS disabled OCR and voice report failure; original manual medication and feedback writes succeed without TAKEN')
        finally:
            proc.terminate();proc.wait(timeout=15)
    with socket.socket() as s:assert s.connect_ex(('127.0.0.1',port))!=0
    print('PASS owned disabled-mode backend stopped')
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--database',required=True);run(parser.parse_args().database)
