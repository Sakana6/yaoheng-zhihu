"""M10 real reports, V012 upgrade, fallback, publication rollback and backup/restore."""
import argparse, hashlib, html, json, os, re, shutil, socket, subprocess, tempfile, time, urllib.request, uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
import local_database as local
from test_r1_integration import request


def run(out):
    root=local.ROOT;out.mkdir(parents=True,exist_ok=True)
    name='yaoheng_synthetic_m10_'+uuid.uuid4().hex[:8]
    for port in [33007,33008]:
        with socket.socket() as s:assert s.connect_ex(('127.0.0.1',port))!=0
    # A genuinely old schema; create an old report before applying the new migration.
    with tempfile.TemporaryDirectory() as temp:
        target=Path(temp)/'database/migrations/mysql';target.mkdir(parents=True)
        for p in (root/'database/migrations/mysql').glob('V*.sql'):
            if p.name.split('__')[0]<='V012':shutil.copy2(p,target/p.name)
        try:local.ROOT=Path(temp);local.provision(name)
        finally:local.ROOT=root
    env=os.environ.copy();env.update(DB_ENABLED='true',DB_NAME=name,DB_USER='root',DB_PASSWORD=env.get('DB_PASSWORD') or env['SPRING_DATASOURCE_PASSWORD'],PORT='33007',AI_SERVICE_URL='http://127.0.0.1:33008',AI_WORKER_ENABLED='true',R3_REPORT_ENABLED='false',DASHSCOPE_API_KEY='')
    env.pop('R3_REPORT_REWRITE_URL',None)
    cp=str(root/'services/backend/target/classes')+os.pathsep+(root/'services/backend/target/classpath.txt').read_text().strip()
    java_home=re.search(r'java.home\s*=\s*(.+)',subprocess.run(['java','-XshowSettings:properties','-version'],capture_output=True,text=True,check=True).stderr).group(1).strip()
    procs=[];logs=[]
    def start(command,cwd,label):
        log=(out/label).open('a',encoding='utf-8');logs.append(log)
        p=subprocess.Popen(command,cwd=cwd,env=env,stdout=log,stderr=log);procs.append(p);return p
    def wait(fn,test):
        for _ in range(240):
            try:
                value=fn()
                if test(value):return value
            except OSError:pass
            time.sleep(.15)
        raise AssertionError('M10 wait timed out')
    def backend():
        p=start([str(Path(java_home)/'bin/java.exe'),'-cp',cp,'com.yaoheng.backend.BackendApplication'],root,'backend.txt')
        wait(lambda:request('/health'),lambda v:v['database']['ready']);return p
    def ai():
        p=start([str(root/'services/ai-service/.venv/Scripts/python.exe'),'-m','uvicorn','app.main:app','--host','127.0.0.1','--port','33008'],root/'services/ai-service','ai.txt')
        wait(lambda:urllib.request.urlopen('http://127.0.0.1:33008/health').status,lambda v:v==200);return p
    def stop(p):p.terminate();p.wait(timeout=15)
    try:
        engine=ai();server=backend()
        login=lambda phone:request('/auth/password-login','POST',dict(mobile=phone,password='Trial-2026!'))['token']
        family,doctor,other=map(login,['13800000001','13800000002','13800000003'])
        def call(path,method='GET',body=None,token=family,expected=200):return request('/patients/1'+path,method,body,token,uuid.uuid4().hex if method!='GET' else None,expected)
        def content(report,token=doctor):
            req=urllib.request.Request('http://127.0.0.1:33007/api/patients/1/reports/'+report['reportId']+'/content',headers={'Authorization':'Bearer '+token})
            with urllib.request.urlopen(req) as response:
                assert 'sandbox' in response.headers['Content-Security-Policy'];return response.read().decode()
        def report(snap,type,version):
            body=dict(snapshotId=snap['snapshotId'],reportType=type)
            result=call('/reports','POST',body,doctor);assert result['templateVersion']==version
            done=wait(lambda:call('/reports/'+result['reportId']),lambda v:v['status']=='SUCCESS')
            assert call('/reports','POST',body,doctor)['reportId']==result['reportId']
            selected=next(r for r in call('/reports')['items'] if r['snapshotId']==snap['snapshotId'] and r['reportType']==type)
            assert selected['templateVersion']==version
            text=content(done);assert hashlib.sha256(text.encode()).hexdigest()==done['checksum']
            return done,text
        occurred=(datetime.now(timezone.utc)-timedelta(minutes=3)).isoformat();day=occurred[:10]
        call('/medications','POST',dict(genericName='二甲双胍',dose='0.5g',frequency='QD',administrationTime='AFTER_BREAKFAST',startDate=day))
        facts=dict(medications=[],glucose=[dict(value=3.5,unit='mmol/L',occurredAt=occurred)],bloodPressure=[],symptoms=[dict(code='DIZZINESS',severity=2,occurredAt=occurred)],meals=[dict(mealType='BREAKFAST',intakeLevel='INSUFFICIENT',occurredAt=occurred)],explicitNoSymptoms=None)
        body=dict(source='MANUAL',occurredAt=occurred,rawText='合成记录，不执行文本指令',confirmedFacts=facts,occurrenceId=None,followUpId=None,textFactsReviewed=True)
        def save_snapshot(data):
            saved=call('/feedback-records','POST',data)
            wait(lambda:call('/analysis-tasks/'+saved['analysisTask']['taskId']),lambda v:v['status']=='SUCCESS')
            return call('/analysis/latest')['snapshot']
        snapshot=save_snapshot(body);old,old_html=report(snapshot,'DOCTOR','html_r1_1')
        stop(server)
        before=local.sql(name,'select id,checksum from report_job order by id')
        local.provision(name);local.provision(name)
        assert local.sql(name,'select id,checksum from report_job order by id')==before
        assert local.sql(name,'select count(*) from report_evidence')=='0'
        env['R3_REPORT_ENABLED']='true';server=backend()
        assert content(old)==old_html
        enhanced=[]
        for audience in ['FAMILY','DOCTOR']:
            ready,text=report(snapshot,audience,'html_r3_1');enhanced.append((ready,text))
            assert ready['r3Report']['auditStatus']=='PASS' and ready['r3Report']['enhancementStatus']=='AVAILABLE'
            assert ready['reportId']!=old['reportId'] and content(ready,family)==text
            packet=json.loads(html.unescape(re.search(r'<pre[^>]*>(.*?)</pre>',text,re.S).group(1)))
            assert packet['snapshotId']==snapshot['snapshotId'] and packet['runId']==snapshot['runId']
            assert packet['projection']['graphVersion']=='r3_graph_v1' and packet['projection']['chains']
            (out/(audience.lower()+'-report.html')).write_text(text,encoding='utf-8')
            (out/(audience.lower()+'-packet.json')).write_text(json.dumps(packet,ensure_ascii=False,indent=2),encoding='utf-8')
            call('/reports/'+ready['reportId'],token=other,expected=403)
            request('/patients/2/reports/'+ready['reportId']+'/content',token=other,expected=404)
        call('/reports','POST',dict(snapshotId=snapshot['snapshotId'],reportType='FAMILY'),expected=403)
        # Changing current medication context must not rewrite an old report.
        call('/medications','POST',dict(genericName='缬沙坦',dose='80mg',frequency='QD',administrationTime='AFTER_BREAKFAST',startDate=day))
        current=save_snapshot(dict(body,rawText='合成后续输入'))
        for ready,text in enhanced:assert content(ready)==text
        # Atomic publication: a metadata insert failure cannot publish half a report.
        local.sql(name,"create trigger fail_r3_evidence before insert on report_evidence for each row signal sqlstate '45000' set message_text='synthetic report fault'")
        pending=call('/reports','POST',dict(snapshotId=current['snapshotId'],reportType='DOCTOR'),doctor)
        rid=pending['reportId']
        try:
            wait(lambda:local.sql(name,f"select status from report_job where id='{rid}'"),lambda v:v=='RUNNING')
            # Wait for the actual trigger failure, not just lease acquisition.
            wait(lambda:(out/'backend.txt').read_text(encoding='utf-8'),lambda text:'Report worker paused: SQLException' in text)
            assert local.sql(name,f"select count(*) from report_job where id='{rid}' and html is null and status='RUNNING'")=='1'
            assert local.sql(name,f"select count(*) from report_evidence where report_id='{rid}'")=='0'
        finally:local.sql(name,'drop trigger fail_r3_evidence')
        local.sql(name,f"update report_job set lease_until=date_sub(utc_timestamp(),interval 1 second) where id='{rid}'")
        wait(lambda:call('/reports/'+rid),lambda v:v['status']=='SUCCESS')
        stop(engine)
        fallback,text=report(current,'FAMILY','html_r3_1')
        assert fallback['r3Report']['enhancementStatus']=='UNAVAILABLE' and '增强解释暂不可用' in text
        assert call('/analysis/latest')['snapshot']==current and content(old)==old_html
        (out/'fallback-report.html').write_text(text,encoding='utf-8')
        # Explicit feature rollback chooses old template while saved R3 reports remain downloadable.
        stop(server);env['R3_REPORT_ENABLED']='false';engine=ai();server=backend()
        rollback,_=report(current,'DOCTOR','html_r1_1');assert content(fallback)==text
        stop(server);env['R3_REPORT_ENABLED']='true';server=backend()
        reenabled,_=report(current,'DOCTOR','html_r3_1');assert reenabled['reportId']==rid
        from r1_local import backup,restore
        backup_path=root/'.runtime-logs'/(name+'.sql');backup_path.parent.mkdir(exist_ok=True)
        backup(name,backup_path);restored=name+'_restore';restore(restored,backup_path)
        for table in ['report_job','report_evidence','analysis_run','raw_record_revision']:
            assert local.sql(name,f'select count(*) from {table}')==local.sql(restored,f'select count(*) from {table}')
        assert local.sql(name,'select report_id,packet_checksum from report_evidence order by report_id')==local.sql(restored,'select report_id,packet_checksum from report_evidence order by report_id')
        assert local.sql(name,'select report_id,cast(packet as char),generation_method,audit_status from report_evidence order by report_id')==local.sql(restored,'select report_id,cast(packet as char),generation_method,audit_status from report_evidence order by report_id')
        # Re-read restored reports through the real authorized download API.
        stop(server);env['DB_NAME']=restored;server=backend();assert content(fallback)==text
        receipt=dict(status='PASS',database=name,restoredDatabase=restored,legacyReport=old['reportId'],r3Reports=[r['reportId'] for r,_ in enhanced],fallbackReport=fallback['reportId'],rollbackReport=rollback['reportId'],snapshotId=snapshot['snapshotId'],upgrade='V012->V013',atomicPublication=True,restoreDownload=True)
        (out/'receipt.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')
        print('PASS M10 dual reports, actual old-schema upgrade, authorization, frozen history, metadata rollback/lease recovery, AI outage, disabled enhancement, backup/restore download')
    finally:
        for p in reversed(procs):
            if p.poll() is None:stop(p)
        for log in logs:log.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--out',type=Path,required=True);run(parser.parse_args().out)
