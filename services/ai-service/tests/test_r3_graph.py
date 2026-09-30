from copy import deepcopy
import pytest
from app.r3_projection import ProjectionManifest
from app.r3_graph import graph
from app.r3_ranking import ahp


def case():
    t='2026-09-30T08:00:00+08:00'
    return dict(patientId=1,inputRevision=2,referenceTime='2026-09-30T09:00:00+08:00',
                medications=[dict(genericName='二甲双胍'),dict(genericName='缬沙坦')],reminders=[],
                records=[dict(recordId='record_1',revisionId='revision_1',rawText='父亲以前头晕，未确认血糖',occurredAt=t,
                              confirmedFacts=dict(glucose=[],bloodPressure=[],symptoms=[dict(code='DIZZINESS',severity=2,occurredAt=t)],meals=[]))])


def build(data):return graph(ProjectionManifest(**data))


def test_missing_nodes_never_invent_measurements(client):
    data=case(); out=build(data)
    assert {g['field'] for g in out['missingNodes']}=={'glucose','bloodPressure','meals'}
    assert not any(e['kind'] in ['BG','BP'] for e in out['events'])
    assert all(c['status']=='INSUFFICIENT' for c in out['chains'])
    for chain in out['chains']:
        assert chain['medicationContext']
        assert all(m['snapshot'] in data['medications'] and len(m['dictionaryHash'])==64 for m in chain['medicationContext'])
    assert client.post('/ai/r3/graph',json=data).json()==out
    pending={e['eventId'] for e in out['events'] if e['confirmationStatus']=='PENDING'}
    assert not any(e['source'] in pending or e['target'] in pending for e in out['edges'])


def test_confirmed_answer_resolves_only_new_projection():
    data=case(); old=build(data); before=deepcopy(old)
    t=data['records'][0]['occurredAt'];facts=data['records'][0]['confirmedFacts']
    facts['glucose']=[dict(value=3.5,unit='mmol/L',occurredAt=t)]
    facts['meals']=[dict(mealType='BREAKFAST',intakeLevel='INSUFFICIENT',occurredAt=t)]
    facts['bloodPressure']=[dict(systolic=80,diastolic=50,unit='mmHg',occurredAt=t)]
    data['records'][0]['revisionId']='revision_2';data['inputRevision']=3
    new=build(data)
    assert not new['missingNodes'] and {c['chainType'] for c in new['chains']}=={'G','B','C'}
    assert all(c['status']=='MATCHED' and c['causalClaim'] is False for c in new['chains'])
    assert next(c for c in new['chains'] if c['chainType']=='C')['compatibleJE']==[]
    assert old==before and old['graphId']!=new['graphId']


def test_unknown_drug_has_no_knowledge_or_forced_class(client):
    data=case();data['medications']=[dict(genericName='未知合成药')]
    out=build(data)
    assert all(c['status']=='NOT_APPLICABLE' and not c['citations'] for c in out['chains'])
    assert not out['missingNodes']
    data['medications'][0]['genericName']=123
    assert client.post('/ai/r3/graph',json=data).status_code==422


def test_order_determinism_and_references():
    data=case();second=deepcopy(data['records'][0]);second.update(recordId='record_2',revisionId='revision_2',occurredAt='2026-09-29T08:00:00+08:00')
    second['confirmedFacts']['symptoms'][0]['occurredAt']=second['occurredAt'];data['records'].append(second)
    a=build(data);data['records'].reverse();assert build(data)==a
    ids={n['id'] for n in a['nodes']};refs={e['evidence']['factId'] for e in a['events'] if e['confirmationStatus']=='CONFIRMED'}
    for edge in a['edges']:
        assert edge['source'] in ids and edge['target'] in ids
        assert all(e['factId'] in refs for e in edge['evidence'])
    assert {'BEFORE','AFTER','WITHIN','HAS_MISSING'}<={e['relation'] for e in a['edges']}


def test_same_time_only_overlap_and_future_not_support():
    data=case();f=data['records'][0]['confirmedFacts'];t=data['records'][0]['occurredAt']
    f['glucose']=[dict(value=3.5,unit='mmol/L',occurredAt=t),dict(value=3.0,unit='mmol/L',occurredAt='2026-10-01T08:00:00+08:00')]
    out=build(data)
    assert 'OVERLAP' in {e['relation'] for e in out['edges']}
    assert 'BEFORE' not in {e['relation'] for e in out['edges']}
    future=next(e for e in out['events'] if e['eligibility']=='FUTURE')['eventId']
    assert not any(e['source']==future or e['target']==future for e in out['edges'])


def test_empty_and_patient_scoping():
    data=case();a=build(data);data['patientId']=2;b=build(data)
    assert not {n['id'] for n in a['nodes']}&{n['id'] for n in b['nodes']}
    data['records']=[];assert build(data)['nodes']==[] and build(data)['chains']==[]


def test_outside_window_does_not_close_missing():
    data=case();data['records'][0]['confirmedFacts']['glucose']=[dict(value=3.5,unit='mmol/L',occurredAt='2026-09-29T08:00:00+08:00')]
    assert any(g['field']=='glucose' for g in build(data)['missingNodes'])


def test_explicit_absence_not_missing_or_positive():
    data=case();f=data['records'][0]['confirmedFacts'];f['symptoms']=[];f['explicitNoSymptoms']=True
    assert not any(g['field']=='symptoms' for g in build(data)['missingNodes'])


def test_unknown_meal_retains_gap_and_normal_values_do_not_match():
    data=case();f=data['records'][0]['confirmedFacts'];t=data['records'][0]['occurredAt']
    f['meals']=[dict(mealType='BREAKFAST',intakeLevel='UNKNOWN',occurredAt=t)]
    assert any(g['field']=='meals' for g in build(data)['missingNodes'])
    f['meals'][0]['intakeLevel']='NORMAL';f['glucose']=[dict(value=6,unit='mmol/L',occurredAt=t)]
    f['bloodPressure']=[dict(systolic=120,diastolic=80,unit='mmHg',occurredAt=t)]
    assert all(c['status']=='NOT_MATCHED' for c in build(data)['chains'])


def test_ahp_simulated_and_rejects_inconsistency():
    result=ahp([[1,2,6],[.5,1,3],[1/6,1/3,1]])
    assert result['weights']==[.6,.3,.1] and result['consistencyRatio']==0
    assert result['usedForClinicalPriority'] is False
    for matrix in [[[1,9,1/9],[1/9,1,9],[9,1/9,1]],[[1,0,1],[1,1,1],[1,1,1]],[[1,2,3],[2,1,3],[3,3,1]]]:
        with pytest.raises(ValueError):ahp(matrix)
