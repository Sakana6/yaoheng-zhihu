"""B08 real HTTP assertions invoked inside the isolated cross-service integration lifecycle."""
import concurrent.futures
import json
import time
import uuid
from datetime import datetime,timedelta,timezone
from test_r1_integration import request
from local_database import sql,ROOT

def verify(db,call,doctor,first,second,wait,feedback_body):
    snap=call('/analysis/latest')['snapshot']
    review_body=dict(analysisRunId=snap['runId'],snapshotId=snap['snapshotId'],expectedSnapshotId=snap['snapshotId'],status='NEEDS_MORE_DATA',comment='合成复核：补充实际记录',reason='缺少血压与症状确认')
    call('/reviews','POST',review_body,expected=403)
    call('/reviews','POST',dict(review_body,expectedSnapshotId='stale'),token=doctor,expected=409)
    call('/reviews','POST',dict(review_body,dose='2 pills'),token=doctor,expected=422)
    key=uuid.uuid4().hex
    review=call('/reviews','POST',review_body,token=doctor,k=key)
    assert call('/reviews','POST',review_body,token=doctor,k=key)==review
    assert call('/analysis/latest')['snapshot']==snap
    due=(datetime.now(timezone.utc)+timedelta(days=2)).replace(microsecond=0).isoformat()
    body=dict(sourceReviewId=review['reviewId'],analysisRunId=snap['runId'],snapshotId=snap['snapshotId'],requiredFields=['BLOOD_PRESSURE','SYMPTOM'],dueAt=due,instruction='合成随访：记录实际血压并确认症状')
    # TX3 rollback must remove plan, follow-up, instance, audit and idempotency together.
    before={t:sql(db,f'select count(*) from {t}') for t in ['follow_up','reminder_plan','reminder_item','audit_log','idempotency_record']}
    sql(db,"create trigger fail_follow_instance before insert on reminder_item for each row signal sqlstate '45000' set message_text='synthetic TX3 fault'")
    failed_key=uuid.uuid4().hex
    try:call('/follow-ups','POST',body,token=doctor,k=failed_key,expected=503)
    finally:sql(db,'drop trigger fail_follow_instance')
    assert before=={t:sql(db,f'select count(*) from {t}') for t in before}
    f=call('/follow-ups','POST',body,token=doctor,k=failed_key)
    assert call('/follow-ups','POST',body,token=doctor,k=failed_key)['followUpId']==f['followUpId']
    fid=f['followUpId'];assert f['reminder']['followUpId']==fid
    listed_plans=call('/reminder-plans')['items']
    assert next(p for p in listed_plans if p['planId']==f['planId'])['managedByDoctor'] is True
    request('/patients/2/follow-ups/'+fid,token=second,expected=404)
    call('/follow-ups','POST',body,expected=403)
    call('/reminder-plans/'+f['planId'],'PATCH',dict(expectedVersion=1,title='bypass'),expected=403)
    call('/reminders/'+f['occurrenceId']+'/skip','POST',dict(expectedVersion=1,reason='bypass'),expected=409)
    def reply(f):
        facts=dict(medications=[],glucose=[],bloodPressure=[dict(systolic=118,diastolic=76,unit='mmHg',occurredAt=datetime.now(timezone.utc).isoformat())],symptoms=[],meals=[],explicitNoSymptoms=True)
        return dict(feedback_body,rawText='合成随访回复：118/76，明确无症状',source='REMINDER',confirmedFacts=facts,followUpId=f['followUpId'],occurrenceId=f['occurrenceId'],expectedVersion=f['reminder']['version'],expectedFollowUpVersion=f['version'])
    stale_reply=reply(f)
    new_due=(datetime.now(timezone.utc)+timedelta(days=3)).replace(microsecond=0).isoformat()
    f=call('/follow-ups/'+fid,'PATCH',dict(expectedVersion=f['version'],dueAt=new_due,instruction='合成改期'),token=doctor,k=uuid.uuid4().hex)
    assert f['version']==2 and f['occurrenceId']!=stale_reply['occurrenceId']
    call('/feedback-records','POST',stale_reply,expected=409)
    call('/follow-ups/'+fid,'PATCH',dict(expectedVersion=1,status='CANCELLED'),token=doctor,k=uuid.uuid4().hex,expected=409)
    body_reply=reply(f)
    call('/feedback-records','POST',dict(body_reply,followUpId=None),expected=422)
    call('/feedback-records','POST',dict(body_reply,confirmedFacts=dict(body_reply['confirmedFacts'],bloodPressure=[])),expected=422)
    call('/feedback-records','POST',body_reply,token=doctor,expected=403)
    # TX1 failure after reminder/follow-up changes cannot mark either completed.
    sql(db,"create trigger fail_follow_reply before insert on analysis_task for each row signal sqlstate '45000' set message_text='synthetic reply fault'")
    try:call('/feedback-records','POST',body_reply,expected=503)
    finally:sql(db,'drop trigger fail_follow_reply')
    pending=call('/follow-ups/'+fid);assert pending['status']=='PENDING' and pending['reminder']['executionStatus']=='PENDING'
    shared_key=uuid.uuid4().hex
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        result=list(pool.map(lambda _:call('/feedback-records','POST',body_reply,k=shared_key),range(2)))
    assert result[0]['recordId']==result[1]['recordId']
    record=result[0];completed=call('/follow-ups/'+fid)
    assert completed['status']=='COMPLETED' and completed['completedRecordId']==record['recordId'] and completed['reminder']['executionStatus']=='DONE'
    call('/feedback-records','POST',body_reply,expected=409)
    call('/follow-ups/'+fid,'PATCH',dict(expectedVersion=completed['version'],status='PENDING'),token=doctor,k=uuid.uuid4().hex,expected=409)
    task=record['analysisTask']['taskId'];wait(lambda:call('/analysis-tasks/'+task),lambda t:t['status']=='SUCCESS','follow-up reanalysis')
    new=call('/analysis/latest')['snapshot'];assert new['inputRevision']>snap['inputRevision'] and new['snapshotId']!=snap['snapshotId']
    assert any(e['sourceId']==record['recordId'] for e in new['evidence'])
    assert call('/analysis/runs/'+snap['runId'])==snap
    call('/reviews','POST',dict(review_body,expectedSnapshotId=new['snapshotId']),token=doctor,expected=409)
    historical=call('/reviews','POST',dict(review_body,expectedSnapshotId=new['snapshotId'],allowHistorical=True),token=doctor);assert historical['historical']
    # A second question is a new task, never reopening a completed one.
    f2=call('/follow-ups','POST',body,token=doctor);cancel_reply=reply(f2)
    cancelled=call('/follow-ups/'+f2['followUpId'],'PATCH',dict(expectedVersion=1,status='CANCELLED'),token=doctor,k=uuid.uuid4().hex)
    assert cancelled['reminder']['executionStatus']=='CANCELLED'
    call('/feedback-records','POST',cancel_reply,expected=409)
    assert sql(db,f"select count(*) from raw_record where follow_up_id='{fid}'")=='1'
    # Small local read load, same real authorized snapshot. Not a production capacity claim.
    start=time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        snapshots=list(pool.map(lambda _:call('/analysis/latest',token=doctor)['snapshot']['snapshotId'],range(40)))
    assert set(snapshots)=={new['snapshotId']}
    print(f'PASS B08 review/follow-up/TX3/TX1/cancellation/history/authorization; 40 reads at concurrency 8 in {time.monotonic()-start:.2f}s')
    (ROOT/'.runtime-logs/followup-contract-samples.json').write_text(json.dumps(dict(Review=review,FollowUp=completed,FollowUpRequest=body,ReviewRequest=review_body)),encoding='utf-8')
