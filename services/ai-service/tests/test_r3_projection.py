from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys

import pytest
from app.r3_projection import ProjectionManifest, project
from app.r1 import Manifest, analyze


def fixture():
    time = '2026-09-30T08:00:00+08:00'
    return dict(patientId=1, inputRevision=2, referenceTime='2026-09-30T09:00:00+08:00',
                medications=[], reminders=[], records=[dict(recordId='record_synthetic_1',
                revisionId='revision_synthetic_1', occurredAt=time, rawText='以前父亲头晕，我没有头晕。血糖3.5待确认🙂',
                confirmedFacts=dict(medications=[dict(medicationId=1001, executionType='UNKNOWN', occurredAt=time)],
                glucose=[dict(value=3.5, unit='mmol/L', occurredAt=time)],
                bloodPressure=[dict(systolic=120, diastolic=80, unit='mmHg', occurredAt=time)],
                symptoms=[dict(code='DIZZINESS', severity=2, occurredAt=time)],
                meals=[dict(mealType='BREAKFAST', intakeLevel='INSUFFICIENT', occurredAt=time)],
                explicitNoSymptoms=None))])


def output(data):
    return project(ProjectionManifest(**data))


def test_sources_types_and_immutable_input():
    data = fixture(); before = deepcopy(data); result = output(data)
    assert data == before and output(data) == result
    assert {x['kind'] for x in result['events']} == {'ADHERENCE','BG','BP','SYMPTOM','MEAL','TEXT_NOTE'}
    for event in result['events']:
        ref = event['evidence']; assert ref['sourceId'] == data['records'][0]['recordId']
        assert ref['factId'] == ref['revisionId'] + ':' + ref['fieldPath']
        assert any(a['anchorId'] == event['anchorId'] for a in result['anchors'])
        if event['kind'] != 'TEXT_NOTE':
            group = ref['fieldPath'].split('.')[1].split('[')[0]
            assert event['payload'] == data['records'][0]['confirmedFacts'][group][0]
            assert ref['span'] is None
    assert next(e for e in result['events'] if e['kind']=='ADHERENCE')['payload']['executionType']=='UNKNOWN'


def test_unconfirmed_text_never_creates_measurement_or_occurrence():
    data=fixture(); data['records'][0]['confirmedFacts']={}
    result=output(data); assert len(result['events'])==1
    event=result['events'][0]; anchor=result['anchors'][0]
    assert event['kind']=='TEXT_NOTE' and event['confirmationStatus']=='PENDING'
    assert event['evidence']['span']==[0,len(data['records'][0]['rawText'])]
    assert anchor['precision']=='UNKNOWN' and anchor['start'] is None and anchor['end'] is None
    assert anchor['documentedAt']==data['records'][0]['occurredAt']


@pytest.mark.parametrize('time,eligibility',[
    ('2026-09-16T09:00:00+08:00','IN_WINDOW'),
    ('2026-09-16T08:59:59+08:00','OUTSIDE_WINDOW'),
    ('2026-09-30T09:00:00+08:00','IN_WINDOW'),
    ('2026-09-30T09:00:01+08:00','FUTURE'),
    ('2026-09-29T16:30:00Z','IN_WINDOW')])
def test_time_window(time,eligibility):
    data=fixture(); data['records'][0]['confirmedFacts']['glucose'][0]['occurredAt']=time
    result=output(data); bg=next(x for x in result['events'] if x['kind']=='BG')
    assert bg['eligibility']==eligibility
    anchor=next(x for x in result['anchors'] if x['anchorId']==bg['anchorId'])
    assert anchor['precision']=='POINT' and anchor['start']==anchor['end'] and anchor['originalTime']==time


def test_absence_is_not_positive_symptom():
    data=fixture(); data['records'][0]['confirmedFacts']={'explicitNoSymptoms':True}
    result=output(data)
    assert {x['kind'] for x in result['events']}=={'NO_SYMPTOMS','TEXT_NOTE'}


def test_empty_has_no_invented_nodes():
    data=fixture(); data['records']=[]
    assert output(data)['events']==[] and output(data)['anchors']==[]


def test_record_order_and_exact_duplicate_are_stable():
    data=fixture(); second=deepcopy(data['records'][0]); second.update(recordId='record_2',revisionId='revision_2')
    data['records'].append(second); result=output(data)
    data['records'].reverse(); assert output(data)==result
    data['records'].append(deepcopy(second)); assert output(data)==result


def test_revision_change_leaves_other_sources_unchanged():
    data=fixture(); other=deepcopy(data['records'][0]); other.update(recordId='record_2',revisionId='revision_2')
    data['records'].append(other); old=output(data)
    data['records'][0]['revisionId']='revision_new'; data['records'][0]['rawText']='修订后的合成记录'
    new=output(data)
    selected=lambda out:[e for e in out['events'] if e['evidence']['sourceId']=='record_2']
    assert selected(old)==selected(new) and old['projectionId']!=new['projectionId']
    assert not set(e['eventId'] for e in old['events'] if e['evidence']['sourceId']!='record_2') & set(e['eventId'] for e in new['events'])


@pytest.mark.parametrize('mutation',[
    lambda d:d.update(patientId=True),
    lambda d:d.update(inputRevision=-1),
    lambda d:d.update(referenceTime='2026-09-30T09:00:00'),
    lambda d:d['records'][0].update(patientId=2),
    lambda d:d['records'][0].update(recordId=''),
    lambda d:d['records'][0].update(occurredAt='2026-09-30T09:00:00'),
    lambda d:d['records'][0].update(confirmedFacts=[]),
    lambda d:d['records'][0]['confirmedFacts'].update(glucose='bad'),
    lambda d:d['records'][0]['confirmedFacts'].update(explicitNoSymptoms=1),
    lambda d:d['records'][0]['confirmedFacts']['glucose'][0].update(value=True),
    lambda d:d['records'][0]['confirmedFacts']['glucose'][0].update(unit='mg/dL'),
    lambda d:d['records'][0]['confirmedFacts']['glucose'][0].update(occurredAt='yesterday'),
    lambda d:d['records'][0]['confirmedFacts']['medications'][0].update(executionType='OPENED'),
    lambda d:d['records'].append(dict(deepcopy(d['records'][0]),revisionId='different')),
    lambda d:d['records'].append(dict(deepcopy(d['records'][0]),recordId='different')),
])
def test_http_rejects_invalid_frozen_inputs(client,mutation):
    data=fixture(); mutation(data)
    assert client.post('/ai/r3/project',json=data).status_code==422


@pytest.mark.parametrize('value',[float('nan'),float('inf'),float('-inf')])
def test_non_finite_rejected(value):
    data=fixture(); data['records'][0]['confirmedFacts']['glucose'][0]['value']=value
    with pytest.raises(ValueError):output(data)


def test_patient_namespaces_and_reference_revision_hash():
    data=fixture(); old=output(data); data['patientId']=2; new=output(data)
    assert not set(e['eventId'] for e in old['events']) & set(e['eventId'] for e in new['events'])
    data=fixture(); data['inputRevision']+=1; assert output(data)['inputHash']!=old['inputHash']


def test_http_and_cli_match_without_changing_r1(client,tmp_path):
    data=fixture(); old=analyze(Manifest(**data))
    response=client.post('/ai/r3/project',json=data); assert response.status_code==200
    assert response.json()==output(data)
    assert client.post('/ai/r1/analyze',json=data).json()==old
    source=tmp_path/'manifest.json'; target=tmp_path/'projection.json'
    source.write_text(json.dumps(data),encoding='utf-8')
    script=Path(__file__).resolve().parents[1]/'scripts/replay_r3.py'
    run=subprocess.run([sys.executable,str(script),str(source),'--out',str(target)],capture_output=True,text=True)
    assert run.returncode==0,run.stderr
    assert json.loads(target.read_text(encoding='utf-8'))==response.json()
    repeat=subprocess.run([sys.executable,str(script),str(source),'--out',str(target)],capture_output=True)
    assert repeat.returncode!=0 and json.loads(target.read_text(encoding='utf-8'))==response.json()
