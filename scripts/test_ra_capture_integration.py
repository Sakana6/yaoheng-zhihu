"""M11 real Java/MySQL/ASR integration; OCR fake-boundary and explicit LIVE modes are distinct."""
import argparse
import base64
import concurrent.futures
import getpass
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from local_database import ROOT, provision, sql


def freeport():
    with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]


def run(args):
    if args.password_prompt:os.environ['SPRING_DATASOURCE_PASSWORD']=getpass.getpass('Local DB password (hidden): ')
    if args.live and args.key_prompt:os.environ['DEEPSEEK_API_KEY']=getpass.getpass('DeepSeek key (hidden): ')
    if args.live and not os.getenv('DEEPSEEK_API_KEY'):raise SystemExit('LIVE skipped: no key (not passed)')
    args.out.mkdir(parents=True,exist_ok=True)
    db='yaoheng_synthetic_ra_'+uuid.uuid4().hex[:10];provision(db)
    ports=[freeport() for _ in range(3)];back_port,ai_port,asr_port=ports
    env=os.environ.copy();env.update(DB_ENABLED='true',DB_NAME=db,DB_USER='root',DB_PASSWORD=os.environ.get('DB_PASSWORD') or os.environ['SPRING_DATASOURCE_PASSWORD'],
        PORT=str(back_port),AI_SERVICE_URL=f'http://127.0.0.1:{ai_port}',LOCAL_ASR_URL=f'http://127.0.0.1:{asr_port}',
        AI_WORKER_ENABLED='false',CAPTURE_OCR_MODE='deepseek',CAPTURE_VOICE_MODE='local',CAPTURE_STORAGE_ROOT=str((args.out/'capture-files').resolve()),
        RA_LLM_ENABLED='true',RA_LLM_BUDGET_PATH=str(ROOT/'.local-evidence/ra-live-budget.sqlite3'),LOCAL_ASR_MODEL_DIR=str(args.model.resolve()))
    processes=[];logs=[];fake=None;results=[]
    def start(cmd,environment,cwd,name):
        log=(args.out/(name+'.txt')).open('w',encoding='utf-8');logs.append(log)
        p=subprocess.Popen(cmd,cwd=cwd,env=environment,stdout=log,stderr=log);processes.append(p);return p
    def wait(url):
        for _ in range(150):
            try:
                with urllib.request.urlopen(url,timeout=2) as r:
                    if r.status==200:return
            except OSError:time.sleep(.1)
        raise RuntimeError('service startup timed out')
    class Fake(BaseHTTPRequestHandler):
        calls=0;delay=0;fail=False
        def log_message(self,*a):pass
        def do_POST(self):
            body=json.loads(self.rfile.read(int(self.headers['Content-Length'])));type(self).calls+=1
            time.sleep(type(self).delay)
            data=base64.b64decode(body['imageBase64'])
            result=dict(text='二甲双胍',engine='DEEPSEEK',engineVersion='TEST_BOUNDARY_NOT_LIVE',requiresConfirmation=True,inputHash=hashlib.sha256(data).hexdigest())
            payload=json.dumps(result).encode();self.send_response(503 if type(self).fail else 200);self.end_headers();self.wfile.write(payload)
    def request(path,method='GET',body=None,token=None,key=None,status=200,mime='application/json',name=None):
        headers={'Content-Type':mime}
        if token:headers['Authorization']='Bearer '+token
        if key:headers['Idempotency-Key']=key
        if name:headers['X-File-Name']=urllib.parse.quote(name)
        data=body if isinstance(body,bytes) else json.dumps(body).encode() if body is not None else None
        req=urllib.request.Request(f'http://127.0.0.1:{back_port}/api'+path,data=data,headers=headers,method=method)
        try:r=urllib.request.urlopen(req,timeout=70)
        except urllib.error.HTTPError as e:r=e
        with r:
            payload=json.loads(r.read());assert r.status==status,(path,r.status,payload)
            return payload.get('data',payload)
    try:
        ai_env=env.copy();ai_env.pop('DB_PASSWORD',None);ai_env.pop('SPRING_DATASOURCE_PASSWORD',None)
        if args.live:
            start([str(ROOT/'services/ai-service/.venv/Scripts/python.exe'),'-m','uvicorn','app.main:app','--host','127.0.0.1','--port',str(ai_port)],ai_env,ROOT/'services/ai-service','ai')
            wait(f'http://127.0.0.1:{ai_port}/health')
        else:
            fake=ThreadingHTTPServer(('127.0.0.1',ai_port),Fake);threading.Thread(target=fake.serve_forever,daemon=True).start()
        asr_env=ai_env.copy();asr_env.pop('DEEPSEEK_API_KEY',None)
        start([str(ROOT/'services/inference-service/.venv/Scripts/python.exe'),'-m','uvicorn','server:app','--host','127.0.0.1','--port',str(asr_port)],asr_env,ROOT/'services/inference-service','asr')
        wait(f'http://127.0.0.1:{asr_port}/health')
        home=re.search(r'java.home\s*=\s*(.+)',subprocess.run(['java','-XshowSettings:properties','-version'],capture_output=True,text=True,check=True).stderr).group(1).strip()
        cp=str(ROOT/'services/backend/target/classes')+os.pathsep+(ROOT/'services/backend/target/classpath.txt').read_text().strip()
        java_env=env.copy();java_env.pop('DEEPSEEK_API_KEY',None)
        start([str(Path(home)/'bin/java.exe'),'-cp',cp,'com.yaoheng.backend.BackendApplication'],java_env,ROOT,'backend')
        wait(f'http://127.0.0.1:{back_port}/api/health')
        tokens=[request('/auth/password-login','POST',dict(mobile=n,password='Trial-2026!'))['token'] for n in ['13800000001','13800000002','13800000003']]
        caregiver,doctor,other=tokens;base='/patients/1/capture-tasks'
        data=(args.fixtures/'metformin.png').read_bytes()
        def upload(content):return request(base,'POST',content,caregiver,uuid.uuid4().hex,mime='image/png',name='synthetic.png')
        def action(t,a,key=None,status=200):return request(base+'/'+t['taskId']+'/'+a,'POST',dict(expectedVersion=t['version']),caregiver,key or uuid.uuid4().hex,status)
        t=upload(data);before=sql(db,'select input_revision from patient where id=1')
        request(base+'/'+t['taskId']+'/process','POST',dict(expectedVersion=t['version']),other,uuid.uuid4().hex,403)
        key=uuid.uuid4().hex
        if not args.live:
            Fake.delay=.5
            with concurrent.futures.ThreadPoolExecutor() as pool:
                attempted=list(pool.map(lambda _:action(t,'process',key),range(4)))
            assert Fake.calls==1,Fake.calls
        else:action(t,'process',key)
        ready=request(base+'/'+t['taskId'],token=caregiver)
        assert ready['status']=='CANDIDATE_READY',ready
        assert ready['result']['engine']=='DEEPSEEK'
        assert any(x['genericName']=='二甲双胍' for x in ready['result']['candidates'])
        assert sql(db,'select input_revision from patient where id=1')==before
        calls=Fake.calls
        action(t,'process',key)
        if not args.live:assert Fake.calls==calls
        med=dict(genericName='二甲双胍',brandName='合成',dose='0.5g',frequency='QD',administrationTime='AFTER_BREAKFAST',startDate='2026-09-30',captureTaskId=t['taskId'],captureVersion=ready['version'])
        saved=request('/patients/1/medications','POST',med,caregiver,uuid.uuid4().hex)
        request('/patients/1/medications','POST',med,caregiver,uuid.uuid4().hex,409)
        assert request(base+'/'+t['taskId'],token=caregiver)['status']=='CONFIRMED'
        results.append('image candidates require explicit atomic medication confirmation; duplicate process does not repeat inference')
        if not args.live:
            extra=(args.fixtures/'valsartan.png').read_bytes();t=upload(extra);Fake.delay=1
            with concurrent.futures.ThreadPoolExecutor() as pool:
                work=pool.submit(action,t,'process')
                for _ in range(50):
                    current=request(base+'/'+t['taskId'],token=caregiver)
                    if current['status']=='RUNNING':break
                    time.sleep(.02)
                cancelled=action(current,'cancel');work.result()
            assert request(base+'/'+t['taskId'],token=caregiver)['status']=='CANCELLED'
            Fake.delay=0;Fake.fail=True
            failed=action(cancelled,'process');assert failed['status']=='FAILED'
            manual=dict(med,captureTaskId=failed['taskId'],captureVersion=failed['version'])
            request('/patients/1/medications','POST',manual,caregiver,uuid.uuid4().hex)
            results.append('cancellation rejects late OCR output; unavailable engine allows original manual save')
        audio=(args.audio/'negative.wav').read_bytes()
        before=sql(db,'select input_revision from patient where id=1')
        voice=request(base+'/voice','POST',audio,caregiver,uuid.uuid4().hex,mime='audio/wav')
        assert voice['status']=='CANDIDATE_READY' and voice['result']['engine']=='LOCAL_SENSEVOICE'
        assert '没有' in voice['result']['text'];assert sql(db,'select input_revision from patient where id=1')==before
        # User may edit the transcript; no automatically extracted confirmed facts.
        facts=dict(medications=[],symptoms=[],glucose=[],bloodPressure=[],meals=[],explicitNoSymptoms=True)
        body=dict(rawText=voice['result']['text'],source='MANUAL',occurredAt='2026-09-30T08:00:00+08:00',confirmedFacts=facts,textFactsReviewed=True,captureTaskId=voice['taskId'],captureVersion=voice['version'])
        request('/patients/1/feedback-records','POST',body,caregiver,uuid.uuid4().hex)
        assert request(base+'/'+voice['taskId'],token=caregiver)['status']=='CONFIRMED'
        results.append('real local ASR negative sentence remains preview until original feedback confirmation')
        (args.out/'results.json').write_text(json.dumps(dict(mode='LIVE' if args.live else 'FAKE_OCR_REAL_ASR',database=db,passed=results),indent=2),encoding='utf-8')
        print('PASS M11 integration '+('LIVE' if args.live else 'FAKE_OCR_REAL_ASR'))
    finally:
        for process in reversed(processes):
            if process.poll() is None:process.terminate();process.wait(timeout=15)
        if fake:fake.shutdown();fake.server_close()
        for log in logs:log.close()
        stopped=[]
        for port in ports:
            with socket.socket() as s:stopped.append(dict(port=port,closed=s.connect_ex(('127.0.0.1',port))!=0))
        (args.out/'service-stop.json').write_text(json.dumps(stopped,indent=2),encoding='utf-8')
        os.environ.pop('DEEPSEEK_API_KEY',None)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);p.add_argument('--model',type=Path,required=True)
    p.add_argument('--fixtures',type=Path,required=True);p.add_argument('--audio',type=Path,required=True)
    p.add_argument('--live',action='store_true');p.add_argument('--password-prompt',action='store_true');p.add_argument('--key-prompt',action='store_true')
    run(p.parse_args())
