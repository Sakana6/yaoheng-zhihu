"""Real HTTP/MySQL acceptance: uses only dedicated synthetic databases, stops own Java process."""
import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import socket
import re
import time
import urllib.request
import urllib.error
import uuid
from local_database import ROOT, BIN, provision, sql

DB = 'yaoheng_synthetic_r1_test'
BASE = 'http://127.0.0.1:33007/api'

def request(path, method='GET', body=None, token=None, key=None, expected=200):
    headers = {'Content-Type': 'application/json'}
    if token: headers['Authorization'] = 'Bearer ' + token
    if key: headers['Idempotency-Key'] = key
    req = urllib.request.Request(BASE+path, data=json.dumps(body).encode() if body is not None else None, method=method, headers=headers)
    try:
        response = urllib.request.urlopen(req, timeout=10)
    except urllib.error.HTTPError as e:
        response = e
    with response:
        data = json.loads(response.read())
        assert response.status in (expected if isinstance(expected,tuple) else (expected,)), (path, response.status, data)
        return data.get('data', data)

def run():
    provision(DB)
    provision(DB)
    # Upgrade fixture: global legacy reminder key survives migration with patient-scoped uniqueness.
    sql(DB, "delete from reminder_item where reminder_key='legacy-preserve'; insert into reminder_item(patient_id,reminder_key,reminder_type,planned_at,title) values(1,'legacy-preserve','MEDICATION',utc_timestamp(),'legacy');")
    sql(DB, 'alter table reminder_item drop index uq_reminder_patient_key; alter table reminder_item add unique key reminder_key(reminder_key);')
    sql(DB, (ROOT/'database/migrations/mysql/V004__legacy_reminder_and_history.sql').read_text(encoding='utf-8'))
    sql(DB, "insert into reminder_item(patient_id,reminder_key,reminder_type,planned_at,title) values(2,'legacy-preserve','MEDICATION',utc_timestamp(),'second patient');")
    assert sql(DB,"select count(*) from reminder_item where reminder_key='legacy-preserve'") == '2'
    print('PASS repeated migration and legacy multi-patient reminder upgrade')
    env = os.environ.copy()
    env.update(AI_WORKER_ENABLED='false',DB_ENABLED='true', DB_HOST='127.0.0.1', DB_PORT='3306', DB_NAME=DB, DB_USER='root', PORT='33007')
    env['DB_PASSWORD'] = env.get('DB_PASSWORD') or env['SPRING_DATASOURCE_PASSWORD']
    classpath_file=ROOT/'services/backend/target/classpath.txt'
    if not classpath_file.exists():
        mvn='mvn.cmd' if os.name=='nt' else 'mvn'
        subprocess.run([mvn,'-q','-f',str(ROOT/'services/backend/pom.xml'),'dependency:build-classpath',f'-Dmdep.outputFile={classpath_file}'],check=True)
    cp = str(ROOT/'services/backend/target/classes') + os.pathsep + classpath_file.read_text().strip()
    # Windows Oracle javapath may spawn a detached child; invoke the actual JDK binary.
    settings=subprocess.run(['java','-XshowSettings:properties','-version'],capture_output=True,text=True,check=True)
    java_home=re.search(r'java.home\s*=\s*(.+)',settings.stderr).group(1).strip()
    java=str(Path(java_home)/'bin'/('java.exe' if os.name=='nt' else 'java'))
    with socket.socket() as probe:
        if probe.connect_ex(('127.0.0.1',33007))==0:
            raise RuntimeError('Test port 33007 is occupied; refusing to test an unrelated server')
    logs=ROOT/'.runtime-logs';logs.mkdir(exist_ok=True)
    with (logs/'b03-integration.log').open('w',encoding='utf-8') as log:
        process=subprocess.Popen([java,'-cp',cp,'com.yaoheng.backend.BackendApplication'],env=env,stdout=log,stderr=log)
        try:
            for _ in range(80):
                if process.poll() is not None: raise RuntimeError('backend exited; see .runtime-logs/b03-integration.log')
                try:
                    health=request('/health')
                    assert health['database']['ready'],health
                    break
                except OSError: time.sleep(.15)
            else: raise RuntimeError('backend startup timeout')
            request('/patients/current',expected=401)
            request('/auth/login','POST',{'mobile':'13800000001','verifyCode':'anything'},expected=403)
            request('/auth/password-login','POST',{'mobile':'13800000001','password':'wrong'},expected=401)
            def login(account): return request('/auth/password-login','POST',{'mobile':account,'password':'Trial-2026!'})['token']
            first,second,doctor=map(login,['13800000001','13800000003','13800000002'])
            assert first!=second
            assert request('/patients',token=first)['items'][0]['id']==1
            assert request('/patients',token=second)['items'][0]['id']==2
            with concurrent.futures.ThreadPoolExecutor() as pool:
                result=list(pool.map(lambda pair:request('/patients/current',token=pair[0])['patientId'],[(first,1),(second,2)]*12))
            assert result==[1,2]*12
            for path in ['/medications','/profile','/reports/1/download','/medication-uploads/1','/analysis/latest']:
                request('/patients/2'+path,token=first,expected=403)
                request('/patients/2'+path,token=doctor,expected=403)
            request('/patients/1/medications','POST',{},doctor,expected=403)
            print('PASS login, invalid credentials, concurrent contexts, resource ownership and doctor read-only')
            body={'genericName':'合成未知药品-'+uuid.uuid4().hex[:8],'brandName':'合成品牌','dose':'1片','frequency':'QD','administrationTime':'早餐后','startDate':'2026-09-28','status':'ACTIVE'}
            path='/patients/1/medications';key=uuid.uuid4().hex
            request(path,'POST',body,first,expected=400)
            for invalid in [dict(body,dose=''),dict(body,startDate='2026-02-30'),dict(body,endDate='2020-01-01'),dict(body,status='BOGUS'),dict(body,endDate={}),dict(body,endDate=[])]:
                request(path,'POST',invalid,first,uuid.uuid4().hex,422)
            with concurrent.futures.ThreadPoolExecutor() as pool:
                repeated=list(pool.map(lambda _:request(path,'POST',body,first,key),range(4)))
            saved=repeated[0];assert all(x==saved for x in repeated)
            assert request(path,'POST',dict(reversed(list(body.items()))),first,key)==saved
            assert saved['standardizationStatus']=='UNSTANDARDIZED'
            request(path,'POST',dict(body,dose='2片'),first,key,409)
            medpath=path+'/'+str(saved['id'])
            # Reject integer overflow instead of truncating it to the current version.
            request(medpath,'PATCH',{'expectedVersion':4294967297,'dose':'9片'},first,expected=400)
            request(medpath,'PATCH',{'dose':'2片'},first,expected=400)
            changed=request(medpath,'PATCH',{'expectedVersion':1,'dose':'2片','genericName':body['genericName']+'修订'},first)
            assert changed['version']==2 and changed['dose']=='2片'
            request(medpath,'PATCH',{'expectedVersion':1,'dose':'3片'},first,expected=409)
            assert any(x['id']==saved['id'] and x['version']==2 for x in request(path,token=doctor)['medications'])
            request(medpath,'PATCH',{'expectedVersion':2,'status':'STOPPED'},first)
            assert all(x['id']!=saved['id'] for x in request(path,token=first)['medications'])
            assert any(x['id']==saved['id'] for x in request(path+'?history=true',token=first)['medications'])
            assert sql(DB,f"select count(*) from medication_revision where medication_id={saved['id']}")=='3'
            print('PASS medication validation, concurrent idempotency, revisions, conflicts, archive and cross-client read')
            before=sql(DB,'select count(*) from patient_medication')
            revision=sql(DB,'select input_revision from patient where id=1')
            sql(DB,"create trigger fail_medication_audit before insert on audit_log for each row signal sqlstate '45000' set message_text='synthetic failure';")
            try: request(path,'POST',dict(body,genericName='回滚测试药品'),first,uuid.uuid4().hex,503)
            finally: sql(DB,'drop trigger fail_medication_audit;')
            assert sql(DB,'select count(*) from patient_medication')==before
            assert sql(DB,'select input_revision from patient where id=1')==revision
            assert sql(DB,"select count(*) from medication_master where generic_name='回滚测试药品'")=='0'
            from test_care_integration import run_care
            run_care(request,sql,DB,first,second,doctor)
            from test_ui03_history import run_ui03
            run_ui03(request, sql, DB, first)
            count=sql(DB,'select count(*) from reminder_item')
            # Restart executes the same expansion worker used hourly, without a GET side effect.
            process.terminate();process.wait(timeout=15)
            expanded=(logs/'b03-integration.log').read_text(encoding='utf-8').count('REMINDER_EXPANSION_COMPLETE')
            process=subprocess.Popen([java,'-cp',cp,'com.yaoheng.backend.BackendApplication'],env=env,stdout=log,stderr=log)
            for _ in range(100):
                if (logs/'b03-integration.log').read_text(encoding='utf-8').count('REMINDER_EXPANSION_COMPLETE')>expanded:break
                time.sleep(.1)
            else:raise AssertionError('Restart expansion did not finish')
            assert sql(DB,'select count(*) from reminder_item')==count
            assert request('/patients/1/daily-events',token=first)['items']
            print('PASS backend restart: expansion deduplicated, persistent session/feedback/task survive')
            request('/auth/logout','POST',{},first)
            request(path,token=first,expected=401)
            sql(DB,"update auth_session set expires_at=date_sub(utc_timestamp(),interval 1 hour) where user_id=3;")
            request('/patients/current',token=second,expected=401)
            print('PASS SQL failure rollback, revoked and expired sessions')
        finally:
            process.terminate()
            process.wait(timeout=15)
            with socket.socket() as probe:
                assert probe.connect_ex(('127.0.0.1',33007))!=0,'test server did not stop'
    # Restore into another dedicated database; never drop source or unrelated databases.
    restore='yaoheng_synthetic_r1_restore'
    env['MYSQL_PWD']=env['DB_PASSWORD']
    dump=subprocess.run([str(BIN/'mysqldump.exe'),'-h','127.0.0.1','-u','root','--set-gtid-purged=OFF','--single-transaction',DB],capture_output=True,env=env,check=True)
    sql(None,f'create database if not exists {restore} character set utf8mb4;')
    sql(restore,dump.stdout.decode('utf-8'))
    assert sql(DB,'select count(*) from medication_revision')==sql(restore,'select count(*) from medication_revision')
    assert sql(DB,'select count(*) from schema_migration')==sql(restore,'select count(*) from schema_migration')
    print('PASS synthetic database backup/restore; Java test process stopped')

if __name__=='__main__': run()
