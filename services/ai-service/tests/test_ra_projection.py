from copy import deepcopy
import pytest
from app.ra_projection import project
from app.r3_projection import digest

def packet():
    facts={'medications':[{'medicationId':1,'executionType':'MAKEUP','occurredAt':'2026-09-30T02:00:00Z'}],'glucose':[],'bloodPressure':[],'symptoms':[],'meals':[],'explicitNoSymptoms':None}
    m=dict(patientId=1,inputRevision=1,referenceTime='2026-09-30T04:00:00Z',medications=[],records=[dict(recordId='r',revisionId='v',occurredAt='2026-09-30T03:00:00Z',rawText='',confirmedFacts=facts)],reminders=[])
    c=dict(contextVersion='ra_context_v1',projectionVersion='ra_projection_v1',patientId=1,inputRevision=1,referenceTime=m['referenceTime'],baseManifestHash=digest(m),medicationHistory=[dict(medicationId=1,version=1,validFrom='2026-01-01T00:00:00Z',validTo=None,snapshot=dict(status='ACTIVE',startDate='2026-01-01',endDate=None))],occurrences=[dict(executionStatus='DONE',plannedAt='2026-09-30T00:00:00Z')],candidateSources=[])
    return dict(manifest=m,context=c,contextHash=digest(c))
def rehash(p):p['context']['baseManifestHash']=digest(p['manifest']);p['contextHash']=digest(p['context']);return p

def test_makeup_actual_time_and_reminder_not_intake():
    p=packet();out=project(p);e=out['events'][0]
    assert e['actualTime']=='2026-09-30T02:00:00Z' and e['exposureBasis']=='REPORTED_INTAKE'
    assert e['contextStatus']=='RESOLVED' and len(out['events'])==1
    assert not out['medicationBackground'][0]['actualIntakeVerified']
@pytest.mark.parametrize('status',['TAKEN','MAKEUP','MISSED','UNKNOWN'])
def test_execution_basis(status):
    p=packet();p['manifest']['records'][0]['confirmedFacts']['medications'][0]['executionType']=status
    out=project(rehash(p));assert (out['events'][0]['exposureBasis']=='REPORTED_INTAKE')==(status in ('TAKEN','MAKEUP'))
def test_reordered_facts_stable_id_and_conflicting_duplicate_rejected():
    p=packet();f=p['manifest']['records'][0]['confirmedFacts'];f['glucose']=[dict(value=6.2,unit='mmol/L',occurredAt='2026-09-30T01:00:00Z'),dict(value=5.2,unit='mmol/L',occurredAt='2026-09-30T02:00:00Z')]
    ids=[e['eventId'] for e in project(rehash(p))['events']];f['glucose'].reverse()
    assert ids==[e['eventId'] for e in project(rehash(p))['events']]
    f['glucose'][0]['occurredAt']=f['glucose'][1]['occurredAt']
    with pytest.raises(ValueError,match='CONFLICT'):project(rehash(p))
def test_tamper_and_unknown_version():
    p=packet();p['context']['patientId']=2
    with pytest.raises(ValueError):project(p)
    p=packet();p['context']['contextVersion']='future'
    with pytest.raises(ValueError,match='VERSION'):project(rehash(p))
def test_stopped_and_ambiguous_history():
    p=packet();p['context']['medicationHistory'][0]['snapshot']['status']='STOPPED'
    assert project(rehash(p))['events'][0]['contextStatus']=='UNKNOWN_CONTEXT'
    p=packet();p['context']['medicationHistory'].append(deepcopy(p['context']['medicationHistory'][0]))
    assert project(rehash(p))['events'][0]['contextStatus']=='UNKNOWN_CONTEXT'
