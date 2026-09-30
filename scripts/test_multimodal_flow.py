"""M6 assertions run against the real M5 harness, using TX1 and no automatic facts."""
import copy, json, uuid
from datetime import datetime, timezone, timedelta
from local_database import ROOT

def run_multimodal(request,sql,database,caregiver,doctor,other,storage):
    base='/patients/1/capture-tasks';key=lambda:uuid.uuid4().hex
    def call(path,body=None,token=caregiver,status=200,k=None):return request(base+path,'POST' if body is not None else 'GET',body,token,k or (key() if body is not None else None),status)
    def audio(name='voice-negative',token=caregiver,status=200):return request(base+'/voice','POST',(ROOT/('packages/contracts/capture/fixtures/'+name+'.wav')).read_bytes(),token,key(),status,'audio/wav')
    before=int(sql(database,'select input_revision from patient where id=1'))
    audio(token=doctor,status=403);audio(token=other,status=403)
    voice=audio();assert voice['status']=='CANDIDATE_READY' and '没有吃药' in voice['result']['text']
    assert audio()['taskId']==voice['taskId']
    assert sql(database,'select input_revision from patient where id=1')==str(before)
    assert not (storage/'files/1'/(voice['sha256']+'.bin')).exists()
    request(base+'/'+voice['taskId']+'/content',token=caregiver,status=410)
    now=datetime.now(timezone.utc).isoformat()
    facts=dict(medications=[],symptoms=[],explicitNoSymptoms=None,glucose=[],bloodPressure=[],meals=[])
    body=dict(rawText='人工更正：不是患者本人，暂不记录服药事实',source='MANUAL',occurredAt=now,confirmedFacts=facts,textFactsReviewed=True,captureTaskId=voice['taskId'],captureVersion=voice['version'])
    path='/patients/1/feedback-records'
    request(path,'POST',dict(body,textFactsReviewed=False),caregiver,key(),422)
    request(path,'POST',dict(body,captureVersion=99),caregiver,key(),409)
    assert call('/'+voice['taskId'])['status']=='CANDIDATE_READY'
    saved=request(path,'POST',body,caregiver,key());assert saved['captureSource']=='VOICE'
    assert saved['confirmedFacts']['medications']==[]
    assert saved['analysisTask']['status']=='PENDING'
    doctor_record=request('/patients/1/records/'+saved['recordId'],token=doctor);assert doctor_record['captureTaskId']==voice['taskId']
    assert call('/'+voice['taskId'],token=doctor)['rawText']==voice['result']['text']
    request(path,'POST',body,caregiver,key(),409)
    revised=request('/patients/1/records/'+saved['recordId']+'/revisions','POST',{k:v for k,v in dict(body,expectedVersion=1,changeReason='补充说明',rawText='人工二次核对').items() if k not in ('captureTaskId','captureVersion')},caregiver,key())
    assert revised['version']==2 and revised['captureSource']=='VOICE' and revised['captureTaskId']==voice['taskId']
    rejected=audio('voice-other');rejected=call('/'+rejected['taskId']+'/reject',dict(expectedVersion=rejected['version']))
    assert rejected['status']=='REJECTED'
    assert audio('voice-other')['status']=='CANDIDATE_READY'
    print('PASS M6 voice: deny/other-person text, explicit review, immutable transcript, TX1, revision, doctor evidence, no audio persistence')
    device=call('/devices/local-replay');assert device['state']=='DISCONNECTED'
    device=call('/devices/local-replay',dict(operation='connect',expectedVersion=0,sourceVersion='bad'))
    assert device['state']=='ERROR'
    device=call('/devices/local-replay',dict(operation='connect',expectedVersion=device['version'],sourceVersion='replay-v1'))
    assert device['state']=='CONNECTED'
    packet=dict(deviceId='local-replay',eventId='bg-'+key(),observedAt=now,metric='GLUCOSE',value=108,unit='mg/dL',sourceVersion='replay-v1')
    before=sql(database,'select input_revision from patient where id=1');candidate=call('/device-events',packet)
    assert candidate['status']=='CANDIDATE_READY' and candidate['result']['proposedFacts']['glucose'][0]['value']==6
    assert sql(database,'select input_revision from patient where id=1')==before
    assert call('/device-events',packet)['taskId']==candidate['taskId']
    call('/device-events',dict(packet,value=126),status=409)
    call('/device-events',dict(packet,eventId=key()),token=doctor,status=403)
    for change in [dict(unit='unknown'),dict(metric='LID_OPEN',unit='event',value=1),dict(observedAt=(datetime.now(timezone.utc)+timedelta(days=1)).isoformat()),dict(sourceVersion='v99')]:
        invalid=call('/device-events',dict(packet,eventId=key(),**change));assert invalid['status']=='REJECTED' and invalid['failureCode']
        request(path,'POST',dict(body,captureTaskId=invalid['taskId'],captureVersion=invalid['version']),caregiver,key(),409)
    device_body=dict(body,rawText='人工确认设备测量',captureTaskId=candidate['taskId'],captureVersion=candidate['version'],confirmedFacts=candidate['result']['proposedFacts'])
    owned_medication=request('/patients/1/medications',token=caregiver)['medications'][0]['id']
    illegal=copy.deepcopy(device_body);illegal['confirmedFacts']['medications']=[dict(medicationId=owned_medication,executionType='TAKEN',occurredAt=now)]
    request(path,'POST',illegal,caregiver,key(),422)
    for extra in [dict(occurrenceId='unrelated-reminder',source='REMINDER'),dict(followUpId='unrelated-followup')]:
        refused=request(path,'POST',dict(device_body,**extra),caregiver,key(),422)
        assert refused['message']=='DEVICE_STANDALONE_MEASUREMENT_REQUIRED'
    assert call('/'+candidate['taskId'])['status']=='CANDIDATE_READY'
    device_record=request(path,'POST',device_body,caregiver,key());assert device_record['captureSource']=='DEVICE'
    assert device_record['confirmedFacts']['medications']==[] and device_record['confirmedFacts']['glucose'][0]['value']==6
    assert device_record['analysisTask']['status']=='PENDING'
    assert call('/'+candidate['taskId'])['confirmation']['recordId']==device_record['recordId']
    assert json.loads(sql(database,"select manifest from analysis_task where id='"+device_record['analysisTask']['taskId']+"'"))['records']
    revision={k:copy.deepcopy(v) for k,v in device_body.items() if k not in ('captureTaskId','captureVersion')}
    revision.update(expectedVersion=1,changeReason='人工校正测量')
    revision_path='/patients/1/records/'+device_record['recordId']+'/revisions'
    before_revision=sql(database,'select input_revision from patient where id=1')
    invalid_revision=copy.deepcopy(revision);invalid_revision['confirmedFacts']['medications']=illegal['confirmedFacts']['medications']
    refused=request(revision_path,'POST',invalid_revision,caregiver,key(),422)
    assert refused['message']=='DEVICE_MEASUREMENTS_ONLY'
    assert sql(database,'select input_revision from patient where id=1')==before_revision
    assert request('/patients/1/records/'+device_record['recordId'],token=doctor)['version']==1
    revision['confirmedFacts']['glucose'][0]['value']=6.2
    corrected=request(revision_path,'POST',revision,caregiver,key())
    assert corrected['version']==2 and corrected['captureSource']=='DEVICE'
    assert corrected['captureTaskId']==candidate['taskId'] and corrected['confirmedFacts']['glucose'][0]['value']==6.2
    assert call('/'+candidate['taskId'])['result']['proposedFacts']['glucose'][0]['value']==6
    print('PASS device revisions preserve measurement-only boundary, original evidence and atomic rejection')
    call('/devices/local-replay',dict(operation='disconnect',expectedVersion=device['version']))
    call('/device-events',dict(packet,eventId=key()),status=409)
    request(path,'POST',dict(body,captureTaskId=candidate['taskId'],captureVersion=candidate['version'],captureSource='MANUAL'),caregiver,key(),422)
    print('PASS M6 device: connection states, protocol/unit/time checks, event dedupe, immutable source, measurement-only confirmation and TX1 queue')
    longest='d'*64
    call('/devices/'+longest,dict(operation='connect',expectedVersion=0,sourceVersion='replay-v1'))
    long_event=call('/device-events',dict(packet,deviceId=longest,eventId='e'*64))
    assert long_event['status']=='CANDIDATE_READY'
    print('PASS maximum-length device/event identifiers fit idempotency storage')
