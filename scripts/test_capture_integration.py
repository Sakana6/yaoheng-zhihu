"""Real local HTTP/MySQL acceptance for M5; only synthetic databases and files."""
import concurrent.futures, hashlib, io, json, os, re, socket, subprocess, time, urllib.request, urllib.error, uuid
from pathlib import Path
from PIL import Image
from local_database import ROOT, provision, sql
from capture_storage import backup, restore, cleanup

def run():
    suffix=uuid.uuid4().hex[:10];database='yaoheng_synthetic_capture_'+suffix
    storage=ROOT/'.runtime-logs'/('capture-'+suffix);storage.mkdir(parents=True)
    provision(database);provision(database)
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    env=os.environ.copy();env.update(DB_ENABLED='true',DB_NAME=database,DB_USER=env.get('SPRING_DATASOURCE_USERNAME','root'),DB_PASSWORD=env.get('DB_PASSWORD') or env['SPRING_DATASOURCE_PASSWORD'],PORT=str(port),AI_WORKER_ENABLED='false',CAPTURE_STORAGE_ROOT=str(storage/'files'),CAPTURE_OCR_MODE='replay',CAPTURE_VOICE_MODE='replay')
    home=re.search(r'java.home\s*=\s*(.+)',subprocess.run(['java','-XshowSettings:properties','-version'],capture_output=True,text=True,check=True).stderr).group(1).strip()
    cp=str(ROOT/'services/backend/target/classes')+os.pathsep+(ROOT/'services/backend/target/classpath.txt').read_text().strip()
    def request(path,method='GET',body=None,token=None,key=None,status=200,mime='application/json',name=None,binary=False):
        headers={'Content-Type':mime}
        if token:headers['Authorization']='Bearer '+token
        if key:headers['Idempotency-Key']=key
        if name:headers['X-File-Name']=urllib.parse.quote(name)
        data=body if isinstance(body,bytes) else json.dumps(body).encode() if body is not None else None
        req=urllib.request.Request('http://127.0.0.1:'+str(port)+'/api'+path,data=data,headers=headers,method=method)
        try:response=urllib.request.urlopen(req,timeout=25)
        except urllib.error.HTTPError as e:response=e
        with response:
            payload=response.read();assert response.status==status,(path,response.status,payload[:400])
            if binary:return payload
            envelope=json.loads(payload)
            return envelope if response.status>=400 else envelope.get('data',envelope)
    log=(storage/'backend.txt').open('w',encoding='utf-8')
    process=subprocess.Popen([str(Path(home)/'bin/java.exe'),'-cp',cp,'com.yaoheng.backend.BackendApplication'],env=env,stdout=log,stderr=log)
    try:
        for _ in range(100):
            if process.poll() is not None:raise RuntimeError('backend exited')
            try:
                if request('/health')['database']['ready']:break
            except OSError:time.sleep(.1)
        else:raise RuntimeError('startup timeout')
        tokens=[request('/auth/password-login','POST',dict(mobile=n,password='Trial-2026!'))['token'] for n in ['13800000001','13800000002','13800000003']]
        caregiver,doctor,other=tokens;base='/patients/1/capture-tasks'
        image=(ROOT/'packages/contracts/capture/fixtures/metformin.png').read_bytes()
        def upload(content=image,key=None,token=caregiver,name='label.png',status=200,mime='image/png'):
            return request(base,'POST',content,token,key or uuid.uuid4().hex,status,mime,name)
        upload(token=None,status=401);upload(token=doctor,status=403);upload(token=other,status=403)
        upload(name='../bad.png',status=422);upload(mime='image/jpeg',name='a.jpg',status=415)
        upload(content=b'not a png',status=415);upload(content=image[:20],status=422)
        upload(content=b'x'*(5*1024*1024+1),status=413)
        assert sql(database,'select count(*) from capture_task')=='0'
        start=sql(database,'select input_revision from patient where id=1')
        key=uuid.uuid4().hex
        with concurrent.futures.ThreadPoolExecutor() as pool:repeated=list(pool.map(lambda _:upload(key=key),range(4)))
        task=repeated[0];assert all(t==task for t in repeated)
        assert upload()['taskId']==task['taskId']
        assert sql(database,'select input_revision from patient where id=1')==start
        target=base+'/'+task['taskId']
        assert request(target+'/content',token=caregiver,binary=True)==image
        assert request(target+'/content',token=doctor,binary=True)==image
        request(target+'/content',token=other,status=403)
        request('/patients/3/capture-tasks/'+task['taskId'],token=caregiver,status=404)
        def action(task,action,key=None,status=200):return request(base+'/'+task['taskId']+'/'+action,'POST',{'expectedVersion':task['version']},caregiver,key or uuid.uuid4().hex,status)
        processing_key=uuid.uuid4().hex;ready=action(task,'process',processing_key)
        assert ready['status']=='CANDIDATE_READY' and ready['result']['engine']=='SYNTHETIC_REPLAY'
        assert any(x['genericName']=='二甲双胍' for x in ready['result']['candidates'])
        assert action(task,'process',processing_key)==ready
        assert ready['result']['ocr']['boxes']
        assert sql(database,'select input_revision from patient where id=1')==start
        medication=dict(genericName='二甲双胍',brandName='格华止',dose='0.5g',frequency='QD',administrationTime='AFTER_BREAKFAST',startDate='2026-09-30',captureTaskId=ready['taskId'],captureVersion=ready['version'])
        count=sql(database,'select count(*) from patient_medication where patient_id=1')
        request('/patients/1/medications','POST',dict(medication,dose=''),caregiver,uuid.uuid4().hex,422)
        assert request(target,token=caregiver)['status']=='CANDIDATE_READY'
        assert sql(database,'select count(*) from patient_medication where patient_id=1')==count
        confirm_key=uuid.uuid4().hex
        with concurrent.futures.ThreadPoolExecutor() as pool:
            saved=list(pool.map(lambda _:request('/patients/1/medications','POST',medication,caregiver,confirm_key),range(4)))
        assert all(v==saved[0] for v in saved)
        done=request(target,token=caregiver);assert done['status']=='CONFIRMED' and done['medicationId']==saved[0]['id']
        request('/patients/1/medications','POST',medication,caregiver,uuid.uuid4().hex,409)
        assert upload()['status']=='CONFIRMED'
        assert int(sql(database,'select input_revision from patient where id=1'))==int(start)+1
        print('PASS authorized bounded image upload, content hash dedupe, OCR evidence and atomic confirmation')
        for raw,expected in [('  代文  ', '缬沙坦'),('二甲双瓜','二甲双胍'),('完全未知XYZ',None)]:
            t=request(base+'/text','POST',{'rawText':raw},caregiver,uuid.uuid4().hex)
            assert bool(t['result']['candidates'])==(expected is not None)
            if expected:assert t['result']['candidates'][0]['genericName']==expected
            rejected=action(t,'reject');assert rejected['status']=='REJECTED'
            retried=action(rejected,'process');assert retried['status']=='CANDIDATE_READY'
            assert retried['result']['engine']==t['result']['engine']=='LOCAL_RULES'
            assert retried['result']['engineVersion']==t['result']['engineVersion']=='name-rules-1'
            assert retried['result']['dictionaryVersion']==t['result']['dictionaryVersion']
        altered=io.BytesIO();Image.new('RGB',(8,8),'blue').save(altered,format='PNG')
        failed=action(upload(altered.getvalue()),'process');assert failed['status']=='FAILED' and failed['failureCode']=='OCR_REPLAY_NO_MATCH'
        retry=action(failed,'process');assert retry['status']=='FAILED'
        manual=dict(medication,genericName='手工未知药',captureTaskId=retry['taskId'],captureVersion=retry['version'])
        fallback=request('/patients/1/medications','POST',manual,caregiver,uuid.uuid4().hex);assert fallback['standardizationStatus']=='UNSTANDARDIZED'
        extra=(ROOT/'packages/contracts/capture/fixtures/valsartan.png').read_bytes();cancelled=action(upload(extra),'cancel')
        assert cancelled['status']=='CANCELLED';assert action(cancelled,'process')['status']=='CANDIDATE_READY'
        print('PASS exact, fuzzy, unknown, rejection, cancellation, retry and manual fallback')
        purged=action(done,'purge');assert purged['fileDeleted']
        request(target+'/content',token=doctor,status=410)
        assert not (storage/'files/1'/ (hashlib.sha256(image).hexdigest()+'.bin')).exists()
        assert request(target,token=caregiver)['medicationId']==saved[0]['id']
        print('PASS evidence purge retains confirmed medication and audit')
        from test_multimodal_flow import run_multimodal
        run_multimodal(request,sql,database,caregiver,doctor,other,storage)
    finally:process.terminate();process.wait(timeout=15);log.close()
    backup(database,storage/'files',storage/'backup.zip')
    restored='yaoheng_synthetic_capture_restore_'+suffix
    restore(restored,storage/'restored',storage/'backup.zip')
    assert sql(database,'select count(*) from capture_task')==sql(restored,'select count(*) from capture_task')
    orphan=storage/'files/1'/('a'*64+'.bin');orphan.write_bytes(b'orphan');os.utime(orphan,(time.time()-90000,)*2)
    cleanup(database,storage/'files');assert not orphan.exists()
    print('PASS M5 real HTTP integration; own service stopped; database='+database)
if __name__=='__main__':run()
