"""B04/B05 acceptance, called within the isolated R1 HTTP fixture."""
import copy
import json
from pathlib import Path
import concurrent.futures
from datetime import datetime, timedelta, timezone
import uuid

def run_care(request, sql, db, first, second, doctor):
    key=lambda:uuid.uuid4().hex
    p='/patients/1'
    today=datetime.now(timezone(timedelta(hours=8))).date().isoformat()
    now=datetime.now(timezone.utc).isoformat()
    def call(path,method='GET',body=None,expected=200,token=first,k=None):
        result=request(p+path,method,body,token,k or (key() if method!='GET' else None),expected)
        if method=='GET' and expected==200 and 'items' in result:
            cursor=result.get('nextCursor')
            while cursor:
                page=request(p+path+('&' if '?' in path else '?')+'cursor='+cursor,token=token)
                result['items'].extend(page['items']);cursor=page.get('nextCursor')
            result['nextCursor']=None
        return result
    def drug(token,patient):
        return request(f'/patients/{patient}/medications','POST',dict(genericName='合成提醒药-'+key()[:8],dose='1片',frequency='QD',administrationTime='早晨',startDate=today),token,key())
    a,b,other=drug(first,1),drug(first,1),drug(second,2)
    before=sql(db,'select count(*) from reminder_item where plan_id is not null')
    call('/reminders/today');call('/reminders/today')
    assert sql(db,'select count(*) from reminder_item where plan_id is not null')==before
    body=dict(title='合成多药提醒',frequency='DAILY',timezone='Asia/Shanghai',localTime='23:59',startDate=today,endDate=None,medicationIds=[a['id'],b['id']],reminderType='MEDICATION')
    call('/reminder-plans','POST',dict(body,medicationIds=[other['id']]),422)
    call('/reminder-plans','POST',body,403,doctor)
    k=key();created=call('/reminder-plans','POST',body,k=k)
    assert call('/reminder-plans','POST',body,k=k)==created
    assert next(p for p in call('/reminder-plans')['items'] if p['planId']==created['plan']['planId'])['managedByDoctor'] is False
    plan=created['plan'];pid=plan['planId'];assert len(created['occurrenceIds'])==7
    items=lambda:[x for x in call('/reminders/upcoming')['items'] if x['planId']==pid]
    initial=items();assert len(initial)==7 and len(initial[0]['medications'])==2
    # Another patient at the same instant must not collide.
    same=request('/patients/2/reminder-plans','POST',dict(body,medicationIds=[other['id']]),second,key())
    assert len(same['occurrenceIds'])==7
    occurrence=initial[0];oid=occurrence['occurrenceId']
    call('/reminders/ack','POST',{'reminderId':oid},409)
    call('/reminder-plans/'+pid,'PATCH',{'expectedVersion':99,'localTime':'23:58'},409)
    # Feedback validation and atomic save while no AI process exists.
    facts=dict(medications=[dict(medicationId=a['id'],executionType='TAKEN',occurredAt=now),dict(medicationId=b['id'],executionType='MISSED',occurredAt=now)],symptoms=[],explicitNoSymptoms=True,glucose=[dict(value=5.6,unit='mmol/L',occurredAt=now)],bloodPressure=[dict(systolic=120,diastolic=80,unit='mmHg',occurredAt=now)],meals=[dict(mealType='DINNER',intakeLevel='NORMAL',occurredAt=now)])
    feedback=dict(rawText='合成反馈：分别确认两种药的执行情况',source='REMINDER',occurredAt=now,occurrenceId=oid,followUpId=None,expectedVersion=1,confirmedFacts=facts,textFactsReviewed=True)
    invalid=copy.deepcopy(feedback);invalid['confirmedFacts']['glucose'][0]['unit']='mg/dL'
    call('/feedback-records','POST',invalid,422)
    call('/feedback-records','POST',dict(feedback,textFactsReviewed=False),422)
    invalid=copy.deepcopy(feedback);invalid['confirmedFacts']['symptoms']=[dict(code='DIZZY',severity=2,occurredAt=now)]
    call('/feedback-records','POST',invalid,422)
    invalid=copy.deepcopy(feedback);invalid['confirmedFacts']['medications'][0]['medicationId']=other['id']
    call('/feedback-records','POST',invalid,422)
    counts=lambda:sql(db,'select (select count(*) from raw_record),(select count(*) from raw_record_revision),(select count(*) from analysis_task),(select input_revision from patient where id=1),(select count(*) from adherence_event)')
    before=counts()
    sql(db,"create trigger fail_feedback_task before insert on analysis_task for each row signal sqlstate '45000' set message_text='synthetic rollback';")
    try:call('/feedback-records','POST',feedback,503)
    finally:sql(db,'drop trigger fail_feedback_task')
    assert counts()==before and next(x for x in items() if x['occurrenceId']==oid)['executionStatus']=='PENDING'
    k=key()
    with concurrent.futures.ThreadPoolExecutor() as pool:
        repeated=list(pool.map(lambda _:call('/feedback-records','POST',feedback,k=k),range(4)))
    saved=repeated[0];assert all(x==saved for x in repeated)
    assert call('/feedback-records','POST',feedback,k=k)==saved
    assert saved['reminder']['executionStatus']=='DONE' and saved['analysisTask']['status']=='PENDING'
    call('/feedback-records','POST',feedback,409)
    call('/reminders/ack','POST',{'reminderId':oid})
    record=saved['recordId'];rid=saved['revisionId']
    assert call('/feedback-records/'+record,token=doctor)['revisionId']==rid
    request('/patients/2/feedback-records/'+record,token=second,expected=404)
    request('/patients/2/analysis-tasks/'+saved['analysisTask']['taskId'],token=second,expected=404)
    update=copy.deepcopy(feedback);update.update(expectedVersion=1,changeReason='合成补录核对');update['confirmedFacts']['medications'][1]['executionType']='MAKEUP'
    revised=call('/feedback-records/'+record+'/revisions','POST',update)
    assert revised['version']==2 and len(revised['revisions'])==2 and revised['analysisTask']['taskId']!=saved['analysisTask']['taskId']
    assert sql(db,f"select count(*) from adherence_event where source_revision_id='{rid}' and is_valid=false")=='2'
    call('/feedback-records/'+record+'/revisions','POST',update,409)
    changed=call('/reminder-plans/'+pid,'PATCH',{'expectedVersion':1,'localTime':'23:58'})
    assert changed['plan']['version']==2
    assert next(x for x in items() if x['occurrenceId']==oid)['executionStatus']=='DONE'
    assert all(x['executionStatus']=='CANCELLED' for x in items() if x['planVersion']==1 and x['occurrenceId']!=oid)
    cancelled=next(x for x in items() if x['executionStatus']=='CANCELLED')
    call('/feedback-records','POST',dict(feedback,occurrenceId=cancelled['occurrenceId'],expectedVersion=cancelled['version']),409)
    call('/medications/'+str(a['id']),'PATCH',{'expectedVersion':1,'dose':'2片'})
    current=[x for x in items() if x['executionStatus']=='PENDING']
    assert current and current[0]['medications'][0]['dose']=='2片'
    assert next(x for x in items() if x['occurrenceId']==oid)['medications'][0]['dose']=='1片'
    skip=current[0];before=sql(db,'select count(*) from adherence_event')
    k=key();skipped=call('/reminders/'+skip['occurrenceId']+'/skip','POST',{'expectedVersion':skip['version'],'reason':'合成跳过'},k=k)
    assert skipped['executionStatus']=='SKIPPED' and sql(db,'select count(*) from adherence_event')==before
    assert call('/reminders/'+skip['occurrenceId']+'/skip','POST',{'expectedVersion':skip['version'],'reason':'合成跳过'},k=k)==skipped
    call('/medications/'+str(a['id']),'PATCH',{'expectedVersion':2,'status':'STOPPED'})
    call('/medications/'+str(b['id']),'PATCH',{'expectedVersion':1,'status':'STOPPED'})
    assert next(x for x in call('/reminder-plans')['items'] if x['planId']==pid)['status']=='PAUSED'
    assert not [x for x in items() if x['executionStatus']=='PENDING']
    print('PASS B04 seven-day plans, patient isolation, idempotency, read-only GET, version conflict, immutable snapshots, drug cascade and skip')
    empty=dict(medications=[],symptoms=[],explicitNoSymptoms=None,glucose=[],bloodPressure=[],meals=[])
    manual=dict(source='MANUAL',rawText='合成原文：血糖可能偏低，未测量',occurredAt=now,occurrenceId=None,followUpId=None,confirmedFacts=empty)
    raw=call('/feedback-records','POST',manual)
    assert not raw['confirmedFacts']['glucose'] and raw['confirmedFacts']['explicitNoSymptoms'] is None
    inquiry=call('/inquiry-sessions/start','POST',dict(recordId=raw['recordId'],revisionId=raw['revisionId']))
    q=call('/inquiry-sessions/'+inquiry['sessionId']+'/next-question')['question']
    revision=dict(manual,expectedVersion=1,changeReason='追问后实测',confirmedFacts=dict(empty,glucose=[dict(value=5.8,unit='mmol/L',occurredAt=now)]),textFactsReviewed=True)
    answer=call('/inquiry-sessions/'+inquiry['sessionId']+'/answer','POST',dict(questionCode=q['questionCode'],answerText='实际测得5.8',revision=revision))
    assert answer['version']==2 and answer['analysisTask']['status']=='PENDING'
    assert call('/inquiry-sessions/'+inquiry['sessionId']+'/next-question')['isFinished']
    complete=call('/inquiry-sessions/start','POST',dict(recordId=revised['recordId'],revisionId=revised['revisionId']))
    assert complete['sessionStatus']=='COMPLETED'
    assert call('/inquiry-sessions/'+complete['sessionId']+'/next-question')['isFinished']
    assert any(x['recordId']==raw['recordId'] for x in call('/daily-events?date='+today)['items'])
    legacy=call('/bg-records','POST',dict(measuredAt=now,glucoseValue=6.0,unit='mmol/L'))
    assert legacy['analysisTask']['status']=='PENDING'
    call('/feedback-records','POST',dict(manual,occurredAt='2026-09-29T10:00:00'),422)
    print('PASS B05 TX1 fault rollback, raw-only preservation, multi-drug feedback, retries, revisions/invalidation, inquiry, legacy adapter, read isolation and offline AI queue')
    samples={'ReminderPlanSaveResult':created,'ReminderItem':occurrence,'FeedbackRecord':saved,'FeedbackRequest':feedback,'AnalysisTask':saved['analysisTask']}
    (Path(__file__).resolve().parents[1]/'.runtime-logs/care-contract-samples.json').write_text(json.dumps(samples),encoding='utf-8')
    once=call('/reminder-plans','POST',dict(body,frequency='ONCE',medicationIds=[],reminderType='BG'))
    assert len(once['occurrenceIds'])==1
    racing=dict(manual,source='REMINDER',occurrenceId=once['occurrenceIds'][0],expectedVersion=1)
    with concurrent.futures.ThreadPoolExecutor() as pool:
        outcomes=list(pool.map(lambda _:call('/feedback-records','POST',racing,expected=(200,409)),range(2)))
    assert sum('version' in item for item in outcomes)==1
    assert outcomes[0]['recordId']==outcomes[1]['recordId']
    before_count=sql(db,f"select count(*) from reminder_item where plan_id='{once['plan']['planId']}'")
    call('/reminder-plans/'+once['plan']['planId'],'PATCH',dict(expectedVersion=1,title='完成后的计划修订'))
    assert sql(db,f"select count(*) from reminder_item where plan_id='{once['plan']['planId']}'")==before_count
    page=request(p+'/reminder-plans?limit=1',token=first)
    assert len(page['items'])==1 and page['nextCursor']
    request(p+'/daily-events?limit=0',token=first,expected=400)
    print('PASS ONCE, paginated lists, distinct-key feedback race, completed slot preservation and completed inquiry')
