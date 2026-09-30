"""M12 real HTTP/MySQL transaction boundaries, isolated synthetic database."""
import argparse,concurrent.futures,getpass,hashlib,json,os,re,socket,subprocess,time,uuid,urllib.request,urllib.error
from pathlib import Path
from local_database import ROOT,provision,sql

def port():
    with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]

def run(args):
    os.environ['SPRING_DATASOURCE_PASSWORD']=getpass.getpass('Local DB password (hidden): ')
    out=args.out;out.mkdir(parents=True,exist_ok=True);db='yaoheng_synthetic_ra_m12_'+uuid.uuid4().hex[:8]
    # Genuine V013 upgrade without editing old migration files.
    upgrade=db+'_upgrade';sql(None,f'create database {upgrade} character set utf8mb4')
    for migration in sorted((ROOT/'database/migrations/mysql').glob('V*.sql')):
        version=migration.name.split('__')[0]
        if version>'V013':continue
        content=migration.read_text(encoding='utf-8');sql(upgrade,content)
        sql(upgrade,'create table if not exists migration_checksum(version varchar(64) primary key,sha256 char(64) not null)')
        sql(upgrade,f"insert into schema_migration(version) values('{version}'); insert into migration_checksum values('{version}','{hashlib.sha256(content.encode()).hexdigest()}')")
    previous=sql(upgrade,'select count(*) from patient_medication')
    provision(upgrade);provision(upgrade)
    assert sql(upgrade,'select count(*) from patient_medication')==previous
    assert sql(upgrade,"select count(*) from schema_migration where version in ('V014','V015')")=='2'
    provision(db);provision(db)
    bp,ap=port(),port();logs=[];processes=[];results=[]
    home=re.search(r'java.home\s*=\s*(.+)',subprocess.run(['java','-XshowSettings:properties','-version'],capture_output=True,text=True,check=True).stderr).group(1).strip()
    java=str(Path(home)/'bin/java.exe')
    env=dict(os.environ,DB_ENABLED='true',DB_NAME=db,DB_USER='root',DB_PASSWORD=os.environ['SPRING_DATASOURCE_PASSWORD'],PORT=str(bp),AI_SERVICE_URL=f'http://127.0.0.1:{ap}',RA_ENABLED='true',RA_LLM_ENABLED='false',AI_WORKER_ENABLED='true')
    env.pop('DEEPSEEK_API_KEY',None)
    def start(cmd,cwd,name,child):
        f=(out/(name+'.txt')).open('w',encoding='utf-8');logs.append(f);p=subprocess.Popen(cmd,cwd=cwd,env=child,stdout=f,stderr=f);processes.append(p);return p
    def request(path,method='GET',body=None,token=None,key=None,status=200):
        headers={'Content-Type':'application/json'}
        if token:headers['Authorization']='Bearer '+token
        if method!='GET':headers['Idempotency-Key']=key or uuid.uuid4().hex
        req=urllib.request.Request(f'http://127.0.0.1:{bp}/api'+path,data=json.dumps(body).encode() if body is not None else None,headers=headers,method=method)
        try:r=urllib.request.urlopen(req,timeout=40)
        except urllib.error.HTTPError as e:r=e
        with r:
            data=json.load(r);assert r.status==status,(path,r.status,data)
            return data.get('data',data)
    def wait(fn,check):
        for _ in range(160):
            try:
                v=fn()
                if check(v):return v
            except OSError:pass
            time.sleep(.1)
        raise AssertionError('service deadline')
    try:
        aenv={k:v for k,v in env.items() if k not in ('DB_PASSWORD','SPRING_DATASOURCE_PASSWORD')}
        start([str(ROOT/'services/ai-service/.venv/Scripts/python.exe'),'-m','uvicorn','app.main:app','--host','127.0.0.1','--port',str(ap)],ROOT/'services/ai-service','ai',aenv)
        cp=str(ROOT/'services/backend/target/classes')+os.pathsep+(ROOT/'services/backend/target/classpath.txt').read_text().strip()
        backend=start([java,'-cp',cp,'com.yaoheng.backend.BackendApplication'],ROOT,'backend',env)
        wait(lambda:json.load(urllib.request.urlopen(f'http://127.0.0.1:{ap}/health',timeout=2)),lambda x:bool(x))
        wait(lambda:request('/health'),lambda x:x['database']['ready'])
        family,doctor,other=[request('/auth/password-login','POST',dict(mobile=m,password='Trial-2026!'))['token'] for m in ['13800000001','13800000002','13800000003']]
        def call(path,method='GET',body=None,key=None,status=200,token=family):return request('/patients/1'+path,method,body,token,key,status)
        raw='我没有头晕，家人昨天手抖；我血糖6.2'
        body=dict(rawText=raw,referenceTime='2026-09-30T12:00:00+08:00',timezone='Asia/Shanghai',inputRevision=0,recordId=None,recordRevision=None)
        call('/ra/candidates','POST',body,status=403,token=other)
        key=uuid.uuid4().hex
        with concurrent.futures.ThreadPoolExecutor() as pool:rows=list(pool.map(lambda _:call('/ra/candidates','POST',body,key),range(3)))
        art=wait(lambda:call('/ra/candidates/'+rows[0]['artifactId']),lambda x:x['state']=='READY')
        assert all(r['artifactId']==art['artifactId'] for r in rows)
        assert art['result']['generationMode']=='RULE_FALLBACK'
        assert sql(db,'select count(*) from raw_record')=='0'
        assert call('/ra/candidates','POST',body,key)==art
        call('/ra/candidates','POST',dict(body,rawText='别的输入'),key,status=409)
        call('/ra/candidates/'+art['artifactId'],token=other,status=403)
        discard_body=dict(body,rawText='我头晕');discard_key=uuid.uuid4().hex
        disposable=call('/ra/candidates','POST',discard_body,discard_key)
        discarded=call('/ra/candidates/'+disposable['artifactId']+'/discard','POST',dict(inputHash=disposable['inputHash']))
        assert discarded['state']=='DISCARDED' and 'result' not in discarded
        assert call('/ra/candidates','POST',discard_body,discard_key)['state']=='DISCARDED'
        results.append('candidate concurrent idempotency, input conflict, authorization, preview writes no facts')
        facts=dict(medications=[],glucose=[dict(value=6.2,unit='mmol/L',occurredAt='2026-09-30T08:00:00+08:00')],bloodPressure=[],symptoms=[],meals=[],explicitNoSymptoms=None)
        feedback=dict(rawText=raw,source='MANUAL',occurredAt='2026-09-30T08:00:00+08:00',confirmedFacts=facts,textFactsReviewed=True,raArtifactId=art['artifactId'],raArtifactHash=art['artifactHash'])
        call('/feedback-records','POST',dict(feedback,raArtifactHash='0'*64),status=422)
        call('/feedback-records','POST',dict(feedback,rawText='edited'),status=409)
        # Inject storage failure in a synthetic database; TX1 must fully roll back.
        sql(db,"create trigger ra_fail before insert on ra_analysis_context for each row signal sqlstate '45000' set message_text='synthetic context failure'")
        call('/feedback-records','POST',feedback,status=503)
        assert sql(db,'select count(*) from raw_record')=='0' and sql(db,'select input_revision from patient where id=1')=='0'
        sql(db,'drop trigger ra_fail')
        savekey=uuid.uuid4().hex;saved=call('/feedback-records','POST',feedback,savekey)
        assert call('/feedback-records','POST',feedback,savekey)==saved
        call('/ra/candidates/'+art['artifactId']+'/discard','POST',dict(inputHash=art['inputHash']),status=409)
        task=saved['analysisTask']['taskId'];packet=call('/ra/contexts/'+task)
        assert packet['context']['candidateSources'][0]['artifactId']==art['artifactId']
        projection=call('/ra/contexts/'+task+'/projection')
        assert any(e['kind']=='BG' for e in projection['events'])
        call('/ra/contexts/'+task,token=other,status=403)
        (out/'frozen-packet.json').write_text(json.dumps(packet,ensure_ascii=False,indent=2),encoding='utf-8')
        (out/'projection.json').write_text(json.dumps(projection,ensure_ascii=False,indent=2),encoding='utf-8')
        call('/feedback-records','POST',feedback,status=409)
        results.append('TX1 candidate binding/hash/source checks, storage failure rollback, idempotent confirmation, real frozen projection')
        med=call('/medications','POST',dict(genericName='二甲双胍',dose='0.5g',frequency='QD',administrationTime='AFTER_BREAKFAST',startDate='2026-01-01'))
        med2=call('/medications/'+str(med['id']),'PATCH',dict(expectedVersion=med['version'],status='STOPPED'))
        assert packet==call('/ra/contexts/'+task)
        second=call('/feedback-records','POST',dict(rawText='合成漏服，不等于实际服药',source='MANUAL',occurredAt='2026-09-30T09:00:00+08:00',textFactsReviewed=True,confirmedFacts=dict(facts,glucose=[],medications=[dict(medicationId=med['id'],executionType='MISSED',occurredAt='2026-09-30T09:00:00+08:00')])))
        secondp=call('/ra/contexts/'+second['analysisTask']['taskId']+'/projection')
        assert len([h for h in secondp['medicationBackground'] if h['medicationId']==med['id']])==2
        assert any(e.get('exposureBasis')=='NO_REPORTED_INTAKE' for e in secondp['events'])
        # Tampered persisted context is rejected, never recomputed from latest.
        sql(db,"update ra_analysis_context set context_hash=repeat('0',64) where task_id='"+task+"'")
        call('/ra/contexts/'+task,status=503)
        sql(db,"update ra_analysis_context set context_hash='"+packet['contextHash']+"' where task_id='"+task+"'")
        baseinput=int(sql(db,'select input_revision from patient where id=1'))
        def change_med():return call('/medications/'+str(med['id']),'PATCH',dict(expectedVersion=med2['version'],status='ACTIVE',dose='0.25g'))
        def concurrent_save():return call('/feedback-records','POST',dict(rawText='并发合成记录',source='MANUAL',occurredAt='2026-09-30T10:00:00+08:00',confirmedFacts=dict(facts,glucose=[]),textFactsReviewed=True))
        with concurrent.futures.ThreadPoolExecutor() as pool:
            a=pool.submit(change_med);b=pool.submit(concurrent_save);a.result();race=b.result()
        racepacket=call('/ra/contexts/'+race['analysisTask']['taskId']);rc=racepacket['context']
        versions=[h['version'] for h in rc['medicationHistory'] if h['medicationId']==med['id']]
        assert max(versions)==(2 if rc['inputRevision']==baseinput+1 else 3)
        assert rc['inputRevision']==racepacket['manifest']['inputRevision']
        results.append('V013 upgrade preserves existing medication rows; repeated migrations; concurrent medication and feedback use one patient transaction view')
        results.append('historical medication revisions retained; stopped medication never erases old context; MISSED not intake; tamper rejected')
        # Disabled path still accepts original payload, no new context, existing contexts remain readable.
        backend.terminate();backend.wait(15);env['RA_ENABLED']='false'
        for _ in range(50):
            with socket.socket() as s:
                if s.connect_ex(('127.0.0.1',bp))!=0:break
            time.sleep(.1)
        backend=start([java,'-cp',cp,'com.yaoheng.backend.BackendApplication'],ROOT,'backend-disabled',env)
        wait(lambda:json.load(urllib.request.urlopen(f'http://127.0.0.1:{ap}/health',timeout=2)),lambda x:bool(x))
        wait(lambda:request('/health'),lambda x:x['database']['ready'])
        old=call('/feedback-records','POST',dict(rawText='原路径手填',source='MANUAL',occurredAt='2026-09-30T10:00:00+08:00',confirmedFacts=dict(facts,glucose=[]),textFactsReviewed=True))
        call('/ra/contexts/'+old['analysisTask']['taskId'],status=404)
        assert call('/ra/contexts/'+task)==packet
        results.append('RA disabled original save succeeds, no historical backfill, old context remains readable')
        (out/'results.json').write_text(json.dumps(dict(database=db,passed=results),ensure_ascii=False,indent=2),encoding='utf-8');print('PASS M12 integration '+str(len(results))+' groups')
    finally:
        for p in reversed(processes):
            if p.poll() is None:
                subprocess.run(['taskkill','/PID',str(p.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);p.wait(15)
        for f in logs:f.close()
        closed=[]
        for n in [bp,ap]:
            with socket.socket() as s:closed.append(dict(port=n,closed=s.connect_ex(('127.0.0.1',n))!=0))
        (out/'service-stop.json').write_text(json.dumps(closed,indent=2),encoding='utf-8')
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);run(p.parse_args())
