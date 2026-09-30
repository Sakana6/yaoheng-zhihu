from copy import deepcopy
import pytest
from app.r1 import Manifest, analyze, ReportRequest, report

def case():
    time='2026-09-29T08:00:00+08:00'
    return dict(patientId=1,inputRevision=1,referenceTime='2026-09-29T09:00:00+08:00',medications=[dict(id=1,version=1,genericName='二甲双胍')],reminders=[],records=[dict(recordId='record_1',revisionId='rev_1',occurredAt=time,rawText='',confirmedFacts=dict(medications=[],symptoms=[dict(code='DIZZINESS',severity=2,occurredAt=time)],glucose=[dict(value=3.5,unit='mmol/L',occurredAt=time)],bloodPressure=[],meals=[dict(mealType='BREAKFAST',intakeLevel='INSUFFICIENT',occurredAt=time)],explicitNoSymptoms=None))])

def result(data):return analyze(Manifest(**data))
def evaluation(out,rule):return next(x for x in out['evaluations'] if x['ruleId']==rule)

@pytest.mark.parametrize('value',[.5,1,2,3,3.8,3.9,4,5,6,7,8,9,10,12,20])
def test_glucose_threshold(value):
    data=case();data['records'][0]['confirmedFacts']['glucose'][0]['value']=value
    out=result(data);assert (evaluation(out,'JE001')['status']=='MATCHED')==(value<=3.9)
    assert result(data)==out

@pytest.mark.parametrize('execution',['TAKEN','MAKEUP','MISSED','UNKNOWN'])
def test_night_execution(execution):
    data=case();f=data['records'][0]['confirmedFacts'];f['medications']=[dict(medicationId=1,executionType=execution,occurredAt='2026-09-28T22:00:00+08:00')]
    out=result(data);assert (evaluation(out,'JE004')['status']=='MATCHED')==(execution in ['TAKEN','MAKEUP'])

@pytest.mark.parametrize('raw,context',[('没有头晕','NEGATED'),('父亲头晕','OTHER_PERSON'),('以前头晕','HISTORICAL'),('早上头晕','UNCONFIRMED')])
def test_candidates_never_become_facts(raw,context):
    data=case();data['records'][0]['rawText']=raw;data['records'][0]['confirmedFacts']=dict(medications=[],symptoms=[],glucose=[],bloodPressure=[],meals=[],explicitNoSymptoms=None)
    out=result(data);assert out['risk'] is None and not out['timeline'];assert out['candidates'][0]['context']==context

@pytest.mark.parametrize('field',['symptoms','glucose','meals'])
def test_missing_not_zero(field):
    data=case();data['records'][0]['confirmedFacts'][field]=[];out=result(data)
    assert evaluation(out,'JE001')['status']=='INSUFFICIENT' and out['risk'] is None

@pytest.mark.parametrize('name',['合成未知药','UNKNOWNFORMIN','未分类药'])
def test_unknown_drug(name):
    data=case();data['medications'][0]['genericName']=name;out=result(data)
    assert evaluation(out,'JE001')['status']=='INSUFFICIENT' and out['risk'] is None

def test_response_zero_distinct_from_unknown():
    data=case();assert result(data)['profile']['responseRate'] is None
    data['reminders']=[dict(plannedAt='2026-09-29T08:00:00+08:00',executionStatus='SKIPPED')]
    out=result(data);assert out['profile']['responseRate']==0 and out['risk']['jointEventScore']==93
    data['reminders'][0]['executionStatus']='CANCELLED';assert result(data)['profile']['responseRate'] is None

def test_14_day_filter_and_fact_dedup():
    data=case();data['records'].append(deepcopy(data['records'][0]));assert result(data)['profile']['lowBgCount14d']==1
    data['records'][0]['confirmedFacts']['glucose'][0]['occurredAt']='2026-09-01T08:00:00+08:00';data['records']=data['records'][:1];assert result(data)['profile']['lowBgCount14d']==0

def test_absent_bp_not_low():
    data=case();data['medications']=[dict(genericName='缬沙坦')];assert evaluation(result(data),'JE002')['status']=='INSUFFICIENT'

def test_html_escapes_evidence():
    data=case();data['medications'][0]['genericName']='<script>alert(1)</script>';snapshot=dict(result(data),runId='run_1',snapshotId='snapshot_1')
    for kind in ['FAMILY','DOCTOR']:
        out=report(ReportRequest(snapshot=snapshot,reportType=kind));assert '<script>' not in out['html'] and '&lt;script&gt;' in out['html'];assert 'snapshot_1' in out['html']

def test_http_real_orchestrator(client):
    response=client.post('/ai/r1/analyze',json=case());assert response.status_code==200
    data=response.json();assert data['algorithmVersion']=='rules_r1_1';assert data['evidence'][0]['revisionId']=='rev_1'
    invalid=case();invalid['referenceTime']='2026-09-29T09:00:00';assert client.post('/ai/r1/analyze',json=invalid).status_code==422

def test_text_numbers_not_confirmed():
    data=case();data['records'][0]['rawText']='昨天血糖3.5，父亲血压80/50，我漏服了'
    data['records'][0]['confirmedFacts']=dict(medications=[],symptoms=[],glucose=[],bloodPressure=[],meals=[],explicitNoSymptoms=None)
    out=result(data);assert len(out['candidates'])==3 and not out['timeline'] and out['risk'] is None

def test_two_episodes_not_merged_by_rule():
    data=case();old=deepcopy(data['records'][0]);old.update(recordId='record_2',revisionId='rev_2',occurredAt='2026-09-28T08:00:00+08:00')
    for group in ['symptoms','glucose','meals']:
        for fact in old['confirmedFacts'][group]:fact['occurredAt']=old['occurredAt']
    data['records'].append(old);out=result(data)
    assert len([x for x in out['jointEvents'] if x['eventType']=='JE001'])==2
    assert evaluation(out,'JE005')['status']=='MATCHED'

def test_future_measurement_not_used():
    data=case();data['records'][0]['confirmedFacts']['glucose'][0]['occurredAt']='2026-09-30T08:00:00+08:00'
    assert not any(x['type']=='BG' for x in result(data)['timeline'])

def test_symptoms_before_night_execution_not_exposure():
    data=case();f=data['records'][0]['confirmedFacts'];f['medications']=[dict(medicationId=1,executionType='TAKEN',occurredAt='2026-09-28T22:00:00+08:00')]
    f['symptoms'][0]['occurredAt']='2026-09-28T21:00:00+08:00';assert evaluation(result(data),'JE004')['status']!='MATCHED'

def test_invalid_measurement_is_422(client):
    data=case();del data['records'][0]['confirmedFacts']['glucose'][0]['value']
    assert client.post('/ai/r1/analyze',json=data).status_code==422

def test_night_window_does_not_join_distant_glucose_and_meal():
    data=case();data['records'][0]['confirmedFacts']['meals'][0]['occurredAt']='2026-09-28T21:00:00+08:00'
    assert evaluation(result(data),'JE001')['status']!='MATCHED'

def test_no_symptoms_does_not_duplicate_positive_episode():
    data=case();record=deepcopy(data['records'][0]);record.update(recordId='record_2',revisionId='rev_2',occurredAt='2026-09-29T06:30:00+08:00')
    record['confirmedFacts']=dict(medications=[],symptoms=[],glucose=[],bloodPressure=[],meals=[],explicitNoSymptoms=True)
    data['records'].append(record)
    events=[x for x in result(data)['jointEvents'] if x['eventType']=='JE001']
    assert len(events)==1 and all(e['fieldPath']!='confirmedFacts.explicitNoSymptoms' for e in events[0]['evidence'])
