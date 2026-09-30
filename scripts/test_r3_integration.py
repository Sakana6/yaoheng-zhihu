"""M9 real local HTTP/MySQL inquiry lifecycle using a disposable synthetic database."""
import json, os, re, socket, subprocess, time, uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from local_database import ROOT, provision, sql
from test_r1_integration import request


def run(output=None):
    db='yaoheng_synthetic_r3_'+uuid.uuid4().hex[:10]
    out=output or ROOT/'docs/handoff/evidence/R3-M9-2026-09-30';out.mkdir(parents=True,exist_ok=True)
    for port in [33007,33008]:
        with socket.socket() as s:assert s.connect_ex(('127.0.0.1',port))!=0
    provision(db);provision(db)
    assert sql(db,"select count(*) from schema_migration where version='V012'")=='1'
    env=os.environ.copy();env.update(DB_ENABLED='true',DB_NAME=db,DB_USER='root',DB_PASSWORD=env.get('DB_PASSWORD') or env['SPRING_DATASOURCE_PASSWORD'],PORT='33007',AI_SERVICE_URL='http://127.0.0.1:33008',AI_WORKER_ENABLED='true',DASHSCOPE_API_KEY='')
    home=re.search(r'java.home\s*=\s*(.+)',subprocess.run(['java','-XshowSettings:properties','-version'],capture_output=True,text=True,check=True).stderr).group(1).strip()
    cp=str(ROOT/'services/backend/target/classes')+os.pathsep+(ROOT/'services/backend/target/classpath.txt').read_text().strip()
    processes=[];logs=[]
    def start(command,cwd,name):
        log=(out/name).open('w',encoding='utf-8');logs.append(log)
        p=subprocess.Popen(command,cwd=cwd,env=env,stdout=log,stderr=log);processes.append(p);return p
    def wait(fn,predicate):
        for _ in range(180):
            try:
                value=fn()
                if predicate(value):return value
            except OSError:pass
            time.sleep(.1)
        raise AssertionError('Timed out waiting for R3 fixture')
    try:
        ai=start([str(ROOT/'services/ai-service/.venv/Scripts/python.exe'),'-m','uvicorn','app.main:app','--host','127.0.0.1','--port','33008'],ROOT/'services/ai-service','ai.txt')
        start([str(Path(home)/'bin/java.exe'),'-cp',cp,'com.yaoheng.backend.BackendApplication'],ROOT,'backend.txt')
        wait(lambda:request('/health'),lambda x:x['database']['ready'])
        login=lambda phone:request('/auth/password-login','POST',dict(mobile=phone,password='Trial-2026!'))['token']
        family=login('13800000001');doctor=login('13800000002');other=login('13800000003')
        def call(path,method='GET',body=None,token=family,key=None,expected=200):
            return request('/patients/1'+path,method,body,token,key or ('r3_'+uuid.uuid4().hex) if method!='GET' else None,expected)
        now=(datetime.now(timezone.utc)-timedelta(minutes=2)).isoformat();day=now[:10]
        call('/medications','POST',dict(genericName='二甲双胍',dose='0.5g',frequency='QD',administrationTime='AFTER_BREAKFAST',startDate=day))
        facts=dict(medications=[],glucose=[],bloodPressure=[],symptoms=[dict(code='DIZZINESS',severity=2,occurredAt=now)],meals=[dict(mealType='BREAKFAST',intakeLevel='INSUFFICIENT',occurredAt=now)],explicitNoSymptoms=None)
        body=dict(source='MANUAL',occurredAt=now,rawText='M9合成缺血糖记录',confirmedFacts=facts,occurrenceId=None,followUpId=None,textFactsReviewed=True)
        record=call('/feedback-records','POST',body)
        def snapshot(rec):
            wait(lambda:call('/analysis-tasks/'+rec['analysisTask']['taskId']),lambda x:x['status']=='SUCCESS')
            return call('/analysis/latest')['snapshot']
        snap=snapshot(record);url='/analyses/'+snap['runId']+'/projection'
        projection=call(url);assert projection==call(url,token=doctor)
        manifest=json.loads(sql(db,"select cast(manifest as char) from analysis_task where id='"+record['analysisTask']['taskId']+"'"))
        fixture=out/'boundary-fixture.json';fixture.write_text(json.dumps(dict(manifest=manifest,projection=projection),ensure_ascii=False,indent=2),encoding='utf-8')
        subprocess.run([str(Path(home)/'bin/java.exe'),'-cp',cp+os.pathsep+str(ROOT/'services/backend/target/test-classes'),'com.yaoheng.backend.R3BoundaryTest',str(fixture)],check=True)
        gap=next(g for g in projection['missingNodes'] if g['field']=='glucose')
        (out/'projection-before.json').write_text(json.dumps(projection,ensure_ascii=False,indent=2),encoding='utf-8')
        request('/patients/2/analyses/'+snap['runId']+'/projection',token=other,expected=404)
        call(url,token=other,expected=403)
        request('/patients/1'+url,expected=401)
        context=dict(runId=snap['runId'],projectionId=projection['projectionId'],missingNodeId=gap['nodeId'])
        start_body=dict(recordId=record['recordId'],revisionId=record['revisionId'],r3Context=context)
        call('/inquiry-sessions/start','POST',start_body,token=doctor,expected=403)
        call('/inquiry-sessions/start','POST',dict(start_body,r3Context=dict(context,missingNodeId='missing_fake')),expected=422)
        key='r3_start_'+uuid.uuid4().hex;session=call('/inquiry-sessions/start','POST',start_body,key=key)
        assert call('/inquiry-sessions/start','POST',start_body,key=key)==session
        assert sql(db,"select count(*) from r3_inquiry_context")=='1'
        question=call('/inquiry-sessions/'+session['sessionId']+'/next-question');assert question['questionCode']=='BLOOD_GLUCOSE'
        assert question['r3Context']['missingNodeId']==gap['nodeId'] and question['r3Context']['runId']==snap['runId']
        # An answer saying unknown persists but must not erase the missing measurement.
        revision=dict(body,expectedVersion=record['version'],changeReason='M9合成回答：仍未知')
        answer=dict(questionCode='BLOOD_GLUCOSE',answerText='暂时没有测量',revision=revision)
        answer_key='r3_answer_'+uuid.uuid4().hex
        unknown=call('/inquiry-sessions/'+session['sessionId']+'/answer','POST',answer,key=answer_key)
        assert call('/inquiry-sessions/'+session['sessionId']+'/answer','POST',answer,key=answer_key)==unknown
        next_snap=snapshot(unknown);next_proj=call('/analyses/'+next_snap['runId']+'/projection')
        assert any(g['field']=='glucose' for g in next_proj['missingNodes'])
        assert call(url)==projection
        call('/inquiry-sessions/start','POST',start_body,expected=409)
        gap2=next(g for g in next_proj['missingNodes'] if g['field']=='glucose')
        session2=call('/inquiry-sessions/start','POST',dict(recordId=unknown['recordId'],revisionId=unknown['revisionId'],r3Context=dict(runId=next_snap['runId'],projectionId=next_proj['projectionId'],missingNodeId=gap2['nodeId'])))
        revised=json.loads(json.dumps(revision));revised['expectedVersion']=unknown['version'];revised['changeReason']='M9合成实际测量';revised['confirmedFacts']['glucose']=[dict(value=3.5,unit='mmol/L',occurredAt=now)]
        done=call('/inquiry-sessions/'+session2['sessionId']+'/answer','POST',dict(questionCode='BLOOD_GLUCOSE',answerText='合成测量3.5',revision=revised))
        final_snap=snapshot(done);final_proj=call('/analyses/'+final_snap['runId']+'/projection')
        assert not any(g['field']=='glucose' for g in final_proj['missingNodes'])
        assert any(c['chainType']=='G' and c['status']=='MATCHED' for c in final_proj['chains'])
        assert call(url)==projection and call('/analysis/latest')['snapshot']==final_snap
        (out/'projection-after.json').write_text(json.dumps(final_proj,ensure_ascii=False,indent=2),encoding='utf-8')
        assert call('/inquiry-sessions/'+session2['sessionId']+'/next-question')['isFinished']
        # Exercise every additional M9 question through HTTP, persistence and a new graph.
        call('/medications','POST',dict(genericName='缬沙坦',dose='80mg',frequency='QD',administrationTime='AFTER_BREAKFAST',startDate=day))
        branches=[]
        for offset,(field,code) in enumerate([('bloodPressure','BLOOD_PRESSURE'),('symptoms','SYMPTOMS'),('meals','MEALS')],1):
            occurred=(datetime.now(timezone.utc)-timedelta(days=offset*2)).isoformat()
            complete=dict(medications=[],glucose=[dict(value=3.5,unit='mmol/L',occurredAt=occurred)],
                          bloodPressure=[dict(systolic=80,diastolic=50,unit='mmHg',occurredAt=occurred)],
                          symptoms=[dict(code='DIZZINESS',severity=2,occurredAt=occurred)],
                          meals=[dict(mealType='BREAKFAST',intakeLevel='INSUFFICIENT',occurredAt=occurred)],explicitNoSymptoms=None)
            incomplete=json.loads(json.dumps(complete));incomplete[field]=[]
            branch_body=dict(body,occurredAt=occurred,rawText='M9合成分支核验',confirmedFacts=incomplete)
            created=call('/feedback-records','POST',branch_body);branch_snap=snapshot(created)
            branch_url='/analyses/'+branch_snap['runId']+'/projection';before=call(branch_url)
            missing=next(g for g in before['missingNodes'] if g['recordId']==created['recordId'] and g['field']==field)
            started=call('/inquiry-sessions/start','POST',dict(recordId=created['recordId'],revisionId=created['revisionId'],
                         r3Context=dict(runId=branch_snap['runId'],projectionId=before['projectionId'],missingNodeId=missing['nodeId'])))
            endpoint='/inquiry-sessions/'+started['sessionId']
            assert call(endpoint+'/next-question')['questionCode']==code
            if field=='symptoms':complete['symptoms']=[];complete['explicitNoSymptoms']=True
            changed=dict(branch_body,confirmedFacts=complete,expectedVersion=created['version'],changeReason='M9分支确认')
            done=call(endpoint+'/answer','POST',dict(questionCode=code,answerText='合成确认资料',revision=changed))
            final_snap=snapshot(done);after=call('/analyses/'+final_snap['runId']+'/projection')
            assert not any(g['recordId']==done['recordId'] and g['field']==field for g in after['missingNodes'])
            assert call(branch_url)==before and call(endpoint+'/next-question')['isFinished']
            branches.append(dict(field=field,questionCode=code,status='PASS'))
        (out/'inquiry-branches.json').write_text(json.dumps(branches,indent=2),encoding='utf-8')
        # AI outage only breaks the additive projection, never saved feedback/R1 snapshot.
        ai.terminate();ai.wait(timeout=15)
        time.sleep(.3)
        call('/analyses/'+final_snap['runId']+'/projection',expected=503)
        assert call('/analysis/latest')['snapshot']==final_snap and call('/feedback-records/'+done['recordId'])['revisionId']==done['revisionId']
        (out/'integration-receipt.json').write_text(json.dumps(dict(database=db,runId=final_snap['runId'],snapshotId=final_snap['snapshotId'],recordId=done['recordId'],status='PASS',uiChanged=False),indent=2),encoding='utf-8')
        print('PASS V012 repeated migration, frozen graph, caregiver/doctor reads, cross-patient rejection, source validation, idempotent inquiry and answers, unknown remains missing, confirmed revision resolves new graph, old graph unchanged, AI outage isolation')
    finally:
        for p in reversed(processes):
            if p.poll() is None:p.terminate()
        for p in processes:p.wait(timeout=15)
        for log in logs:log.close()


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--out',type=Path)
    run(parser.parse_args().out)
