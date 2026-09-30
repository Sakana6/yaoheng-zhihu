"""B06/B07 real Java/Python/MySQL smoke with offline/restart/publication checks."""
import os,sys,subprocess,socket,re,time,json,uuid,urllib.request,hashlib,html
from pathlib import Path
from datetime import datetime,timedelta,timezone
from local_database import ROOT,provision,sql
from test_r1_integration import request

DB='yaoheng_synthetic_analysis_'+uuid.uuid4().hex[:10]
def run():
    for port in [33007,33008]:
        with socket.socket() as probe:assert probe.connect_ex(('127.0.0.1',port))!=0,f'occupied {port}'
    provision(DB)
    env=os.environ.copy();env.update(DB_ENABLED='true',DB_NAME=DB,DB_USER='root',DB_PASSWORD=env.get('DB_PASSWORD') or env['SPRING_DATASOURCE_PASSWORD'],PORT='33007',AI_WORKER_ENABLED='true',AI_SERVICE_URL='http://127.0.0.1:33008')
    home=re.search(r'java.home\s*=\s*(.+)',subprocess.run(['java','-XshowSettings:properties','-version'],capture_output=True,text=True,check=True).stderr).group(1).strip()
    cp=str(ROOT/'services/backend/target/classes')+os.pathsep+(ROOT/'services/backend/target/classpath.txt').read_text().strip()
    cmd=[str(Path(home)/'bin/java.exe'),'-cp',cp,'com.yaoheng.backend.BackendApplication']
    logs=ROOT/'.runtime-logs';logs.mkdir(exist_ok=True)
    procs=[]
    def start_java():
        log=(logs/'analysis-java.log').open('a',encoding='utf-8');p=subprocess.Popen(cmd,env=env,stdout=log,stderr=log);procs.append(p)
        for _ in range(100):
            if p.poll() is not None:raise AssertionError('Java exited; inspect analysis-java.log')
            try:
                if request('/health')['database']['ready']:return p
            except OSError:pass
            time.sleep(.1)
        raise AssertionError('Java startup')
    def start_ai():
        log=(logs/'analysis-python.log').open('a',encoding='utf-8');p=subprocess.Popen([str(ROOT/'services/ai-service/.venv/Scripts/python.exe'),'-m','uvicorn','app.main:app','--host','127.0.0.1','--port','33008'],cwd=ROOT/'services/ai-service',stdout=log,stderr=log,env=env);procs.append(p)
        for _ in range(100):
            if p.poll() is not None:raise AssertionError('Python exited; inspect analysis-python.log')
            try:
                if urllib.request.urlopen('http://127.0.0.1:33008/health').status==200:return p
            except OSError:pass
            time.sleep(.1)
        raise AssertionError('Python startup')
    def wait(get,predicate,label):
        for _ in range(180):
            value=get()
            if predicate(value):return value
            time.sleep(.2)
        raise AssertionError((label,value))
    key=lambda:uuid.uuid4().hex
    try:
        java=start_java()
        def login(account):return request('/auth/password-login','POST',dict(mobile=account,password='Trial-2026!'))['token']
        first,doctor,second=map(login,['13800000001','13800000002','13800000003'])
        # Authorization list is live rather than a fixed seed-patient array.
        sql(DB,"insert into patient(id,name,gender,birthday,living_status,digital_ability_level,created_by) values(901,'Synthetic new patient','FEMALE','1950-01-01','WITH_FAMILY','LOW',1); insert into patient_doctor_relation values(901,2,current_timestamp)")
        assert any(p['id']==901 for p in request('/patients',token=doctor)['items'])
        assert request('/patients/901/analysis/latest',token=doctor)['snapshot'] is None
        request('/patients/901/analysis/latest',token=first,expected=403)
        def call(suffix,method='GET',body=None,token=first,expected=200,k=None):return request('/patients/1'+suffix,method,body,token,k or (key() if method=='POST' else None),expected)
        now=datetime.now(timezone.utc);timestamp=(now-timedelta(minutes=2)).isoformat();day=now.astimezone(timezone(timedelta(hours=8))).date().isoformat()
        call('/medications','POST',dict(genericName='二甲双胍',dose='0.5g',frequency='QD',administrationTime='早晨',startDate=day))
        facts=dict(medications=[],symptoms=[dict(code='DIZZINESS',severity=2,occurredAt=timestamp)],explicitNoSymptoms=None,glucose=[dict(value=3.5,unit='mmol/L',occurredAt=timestamp)],bloodPressure=[],meals=[dict(mealType='BREAKFAST',intakeLevel='INSUFFICIENT',occurredAt=timestamp)])
        body=dict(source='MANUAL',occurredAt=timestamp,rawText='合成低糖资料',confirmedFacts=facts,occurrenceId=None,followUpId=None,textFactsReviewed=True)
        record=call('/feedback-records','POST',body);task=record['analysisTask']['taskId']
        gettask=lambda:call('/analysis-tasks/'+task)
        wait(gettask,lambda t:t['attempt']>=1,'offline attempt')
        frozen=sql(DB,f"select cast(manifest as char) from analysis_task where id='{task}'")
        assert call('/feedback-records/'+record['recordId'])['rawText']==body['rawText']
        assert call('/analysis/latest')['snapshot'] is None
        # Recover the persistent PENDING task; the frozen input must not change.
        ai=start_ai();sql(DB,f"update analysis_task set next_attempt_at=utc_timestamp() where id='{task}'")
        wait(gettask,lambda t:t['status']=='SUCCESS','analysis success')
        snapshot=call('/analysis/latest')['snapshot'];assert snapshot['risk']['deintensificationScore']==82
        assert snapshot['jointEvents'][0]['eventType']=='JE001' and snapshot['inputRevision']==record['inputRevision']
        assert sql(DB,f"select cast(manifest as char) from analysis_task where id='{task}'")==frozen
        assert call('/analysis/latest',token=doctor)['snapshot']['snapshotId']==snapshot['snapshotId']
        request('/patients/2/analyses/'+snapshot['runId'],token=second,expected=404)
        # Report is linked to this immutable snapshot and delivered as authenticated HTML.
        reports=[]
        for report_type in ['FAMILY','DOCTOR']:
            request_body=dict(snapshotId=snapshot['snapshotId'],reportType=report_type)
            call('/reports','POST',request_body,expected=403)
            report=call('/reports','POST',request_body,token=doctor);reports.append(report)
            assert call('/reports','POST',request_body,token=doctor)['reportId']==report['reportId']
            ready=wait(lambda:call('/reports/'+report['reportId'],token=doctor),lambda r:r['status']=='SUCCESS','report')
            req=urllib.request.Request('http://127.0.0.1:33007/api/patients/1/reports/'+report['reportId']+'/content',headers={'Authorization':'Bearer '+doctor})
            with urllib.request.urlopen(req) as response:
                content=response.read();assert 'text/html' in response.headers['Content-Type'];assert "sandbox" in response.headers['Content-Security-Policy']
            assert hashlib.sha256(content).hexdigest()==ready['checksum'] and snapshot['snapshotId'].encode() in content
            (logs/f'report-{report_type}.html').write_bytes(content)
            if report_type=='DOCTOR':
                report_output=dict(html=content.decode(),packetJson=html.unescape(re.search(r'<pre[^>]*>(.*?)</pre>',content.decode(),re.S).group(1)))
            request('/patients/2/reports/'+report['reportId']+'/content',token=second,expected=404)
        print('PASS real Python analysis, offline durable retry, frozen manifest, shared snapshot, two authenticated HTML reports and authorization')
        fixture=logs/'ai-boundary-fixture.json';fixture.write_text(json.dumps(dict(output=snapshot,manifest=json.loads(frozen),report=report_output)),encoding='utf-8')
        test_classes=ROOT/'services/backend/target/test-classes';test_classes.mkdir(exist_ok=True)
        subprocess.run([str(Path(home)/'bin/javac.exe'),'-encoding','UTF-8','-cp',cp,'-d',str(test_classes),str(ROOT/'services/backend/src/test/java/com/yaoheng/backend/AiBoundaryTest.java')],check=True)
        subprocess.run([str(Path(home)/'bin/java.exe'),'-cp',cp+os.pathsep+str(test_classes),'com.yaoheng.backend.AiBoundaryTest',str(fixture)],check=True)
        # Queue two revisions with worker stopped. Only newest input can publish latest pointer.
        java.terminate();java.wait(timeout=15);env['AI_WORKER_ENABLED']='false';java=start_java()
        old=call('/feedback-records','POST',dict(body,rawText='合成旧输入'))
        new=call('/feedback-records','POST',dict(body,rawText='合成新输入'))
        old_task=old['analysisTask']['taskId'];new_task=new['analysisTask']['taskId']
        sql(DB,f"update analysis_task set next_attempt_at=date_add(utc_timestamp(),interval 1 hour) where id='{old_task}'")
        java.terminate();java.wait(timeout=15);env['AI_WORKER_ENABLED']='true';java=start_java()
        wait(lambda:call('/analysis-tasks/'+new_task),lambda t:t['status']=='SUCCESS','new first')
        new_snapshot=call('/analysis/latest')['snapshot']['snapshotId']
        sql(DB,f"update analysis_task set next_attempt_at=utc_timestamp() where id='{old_task}'")
        wait(lambda:call('/analysis-tasks/'+old_task),lambda t:t['status']=='SUCCESS','old later')
        assert call('/analysis/latest')['snapshot']['snapshotId']==new_snapshot
        assert sql(DB,f"select count(*) from analysis_run where task_id='{old_task}'")=='1'
        print('PASS delayed older input becomes history without overwriting new snapshot')
        # TX2 SQL failure leaves no half-published snapshot; retry retains same input.
        sql(DB,"create trigger fail_analysis_publish before insert on analysis_run for each row signal sqlstate '45000' set message_text='synthetic TX2 fault'")
        broken=call('/feedback-records','POST',dict(body,rawText='合成事务发布回滚'));broken_task=broken['analysisTask']['taskId']
        try:wait(lambda:call('/analysis-tasks/'+broken_task),lambda t:t['errorCode']=='PUBLICATION_DATABASE_ERROR','TX2 failure')
        finally:sql(DB,'drop trigger fail_analysis_publish')
        assert sql(DB,f"select count(*) from analysis_run where task_id='{broken_task}'")=='0'
        assert call('/analysis/latest')['snapshot']['snapshotId']==new_snapshot
        sql(DB,f"update analysis_task set next_attempt_at=utc_timestamp() where id='{broken_task}'")
        wait(lambda:call('/analysis-tasks/'+broken_task),lambda t:t['status']=='SUCCESS','TX2 recovery')
        # Expired worker token recovers after restart, maintaining the frozen manifest.
        java.terminate();java.wait(timeout=15);env['AI_WORKER_ENABLED']='false';java=start_java()
        abandoned=call('/feedback-records','POST',dict(body,rawText='合成租约恢复'));tid=abandoned['analysisTask']['taskId']
        sql(DB,f"update analysis_task set status='RUNNING',attempt=1,lease_token='expired',lease_until=date_sub(utc_timestamp(),interval 1 second) where id='{tid}'; insert into analysis_attempt(task_id,attempt,lease_token,status) values('{tid}',1,'expired','RUNNING')")
        java.terminate();java.wait(timeout=15);env['AI_WORKER_ENABLED']='true';java=start_java()
        wait(lambda:call('/analysis-tasks/'+tid),lambda t:t['status']=='SUCCESS','expired recovery')
        assert sql(DB,f"select status from analysis_attempt where task_id='{tid}' and attempt=1")=='EXPIRED'
        assert call('/analysis-tasks/'+tid)['attempt']==2
        print('PASS TX2 fault rollback and recovered lease after restart')
        # Exhaust automatic network retries, then explicitly retry without losing attempt history.
        ai.terminate();ai.wait(timeout=15)
        exhausted=call('/feedback-records','POST',dict(body,rawText='合成三次失败'));eid=exhausted['analysisTask']['taskId']
        for attempt in range(1,4):
            failed=wait(lambda:call('/analysis-tasks/'+eid),lambda t:t['attempt']==attempt and t['status'] in ('PENDING','FAILED'),'automatic retry')
            if attempt<3:
                assert failed['status']=='PENDING'
                sql(DB,f"update analysis_task set next_attempt_at=utc_timestamp() where id='{eid}'")
        assert failed['status']=='FAILED'
        assert sql(DB,f"select count(*) from analysis_attempt where task_id='{eid}'")=='3'
        previous_manifest=sql(DB,f"select cast(manifest as char) from analysis_task where id='{eid}'")
        ai=start_ai();call('/analysis-tasks/'+eid+'/retry','POST',{})
        wait(lambda:call('/analysis-tasks/'+eid),lambda t:t['status']=='SUCCESS','manual retry')
        assert call('/analysis-tasks/'+eid)['attempt']==4
        assert sql(DB,f"select cast(manifest as char) from analysis_task where id='{eid}'")==previous_manifest
        print('PASS automatic retry limit and manual retry preserve all attempts and frozen input')
        # Report failure stays isolated; GET and download never start or retry a job.
        ai.terminate();ai.wait(timeout=15)
        current=call('/analysis/latest')['snapshot']
        report_body=dict(snapshotId=current['snapshotId'],reportType='DOCTOR')
        failed_report=call('/reports','POST',report_body,token=doctor);rid=failed_report['reportId']
        wait(lambda:call('/reports/'+rid,token=doctor),lambda r:r['status']=='FAILED','report offline')
        call('/reports/'+rid+'/content',token=doctor,expected=409)
        before=sql(DB,f"select concat(status,':',attempt) from report_job where id='{rid}'")
        call('/reports',token=doctor);call('/reports/'+rid,token=doctor)
        assert sql(DB,f"select concat(status,':',attempt) from report_job where id='{rid}'")==before
        ai=start_ai();assert call('/reports','POST',report_body,token=doctor)['reportId']==rid
        wait(lambda:call('/reports/'+rid,token=doctor),lambda r:r['status']=='SUCCESS','report explicit retry')
        sql(DB,f"update report_job set checksum=repeat('0',64) where id='{rid}'")
        call('/reports/'+rid+'/content',token=doctor,expected=503)
        print('PASS failed report download blocked, pure GET, explicit retry and checksum rejection')
        from test_followup_flow import verify
        verify(DB,call,doctor,first,second,wait,body)
        # Actual backup/restore of the complete R1 loop, including immutable reports and reviews.
        from r1_local import backup,restore
        backup_file=logs/(DB+'.sql');restore_db=DB+'_restore'
        backup(DB,backup_file);restore(restore_db,backup_file)
        for table in ['raw_record','raw_record_revision','doctor_review','follow_up','reminder_item','analysis_task','analysis_run','analysis_latest','report_job','audit_log']:
            assert sql(DB,f'select count(*) from {table}')==sql(restore_db,f'select count(*) from {table}')
        assert sql(DB,'select id,checksum from report_job order by id')==sql(restore_db,'select id,checksum from report_job order by id')
        assert sql(DB,'select id,status,completed_record_id from follow_up order by id')==sql(restore_db,'select id,status,completed_record_id from follow_up order by id')
        try:restore(restore_db,backup_file);raise AssertionError('existing restore target accepted')
        except ValueError:pass
        print('PASS complete R1 backup/restore and existing-target overwrite rejection')
        (logs/'analysis-contract-samples.json').write_text(json.dumps(dict(AnalysisSnapshot=call('/analysis/latest')['snapshot'],LatestAnalysis=call('/analysis/latest'))),encoding='utf-8')
    finally:
        for process in reversed(procs):
            if process.poll() is None:process.terminate();process.wait(timeout=15)
        for port in [33007,33008]:
            with socket.socket() as probe:assert probe.connect_ex(('127.0.0.1',port))!=0,'owned process leaked'
    print('PASS B06/B07 integration; owned Java/Python stopped')
if __name__=='__main__':
    # Serialize runs before provisioning/startup: port probes alone have a check/start race.
    lock=ROOT/'.runtime-logs/analysis-test.lock';lock.parent.mkdir(exist_ok=True)
    descriptor=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY)
    try:run()
    finally:os.close(descriptor);lock.unlink()
