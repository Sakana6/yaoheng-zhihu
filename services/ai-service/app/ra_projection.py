"""Frozen M12 evidence projection. No scoring, model calls or latest-state reads."""
from copy import deepcopy
from datetime import timezone,timedelta
from fastapi import APIRouter,HTTPException,Request
from app.r3_projection import digest,canonical,timestamp,validate_payload,GROUPS

VERSION='ra_projection_v1'
router=APIRouter(prefix='/ai/ra')

def project(packet):
    if set(packet)!={'manifest','context','contextHash'}:raise ValueError('PACKET_FIELDS')
    m,c=packet['manifest'],packet['context']
    if c.get('contextVersion')!='ra_context_v1' or c.get('projectionVersion')!=VERSION:raise ValueError('VERSION_UNSUPPORTED')
    if digest(c)!=packet['contextHash'] or digest(m)!=c['baseManifestHash']:raise ValueError('HASH_MISMATCH')
    if m['patientId']!=c['patientId'] or m['inputRevision']!=c['inputRevision'] or m['referenceTime']!=c['referenceTime']:raise ValueError('CONTEXT_MISMATCH')
    timestamp(c['referenceTime'])
    histories=c['medicationHistory'];events=[];background=[];seen={}
    for h in histories:
        snap=h['snapshot']
        background.append(dict(id='rm_'+digest([VERSION,c['patientId'],h]),exposureBasis='MEDICATION_CONTEXT',actualIntakeVerified=False,**deepcopy(h)))
    for record in m['records']:
        if record['recordId'] in seen and canonical(seen[record['recordId']])!=canonical(record):raise ValueError('DUPLICATE_RECORD_CONFLICT')
        if record['recordId'] in seen:continue
        seen[record['recordId']]=record
        for group,kind in GROUPS.items():
            fact_seen={}
            for index,f in enumerate(record['confirmedFacts'].get(group,[])):
                validate_payload(kind,f)
                identity=digest([VERSION,c['patientId'],record['revisionId'],group,f]);at=timestamp(f['occurredAt'])
                conflict_key=canonical([f['occurredAt'],f.get('medicationId') if group=='medications' else f.get('code') if group=='symptoms' else None])
                if conflict_key in fact_seen and fact_seen[conflict_key]!=canonical(f):raise ValueError('DUPLICATE_FACT_CONFLICT')
                fact_seen[conflict_key]=canonical(f)
                e=dict(eventId='rf_'+identity,kind=kind,payload=deepcopy(f),confirmationStatus='CONFIRMED',revisionId=record['revisionId'],sourceId=record['recordId'],fieldPath=f'confirmedFacts.{group}[{index}]',factId='rf_'+identity,actualTime=f['occurredAt'])
                if kind=='ADHERENCE':
                    e['exposureBasis']='REPORTED_INTAKE' if f['executionType'] in ('TAKEN','MAKEUP') else 'NO_REPORTED_INTAKE'
                    matches=[]
                    for h in histories:
                        snap=h['snapshot'];day=at.astimezone(timezone(timedelta(hours=8))).date().isoformat()
                        if h['medicationId']==f['medicationId'] and timestamp(h['validFrom'])<=at and (not h['validTo'] or at<timestamp(h['validTo'])) and snap.get('startDate','9999')<=day and (not snap.get('endDate') or day<=snap['endDate']) and snap.get('status')=='ACTIVE':matches.append(h)
                    e['medicationContext']=deepcopy(matches[0]) if len(matches)==1 else None
                    e['contextStatus']='RESOLVED' if len(matches)==1 else 'UNKNOWN_CONTEXT'
                events.append(e)
        if record['confirmedFacts'].get('explicitNoSymptoms') is True:
            if record['confirmedFacts'].get('symptoms'):raise ValueError('SYMPTOM_CONFLICT')
            identity=digest([VERSION,c['patientId'],record['revisionId'],'NO_SYMPTOMS'])
            events.append(dict(eventId='rf_'+identity,factId='rf_'+identity,kind='NO_SYMPTOMS',payload={'explicitNoSymptoms':True},confirmationStatus='CONFIRMED',revisionId=record['revisionId'],sourceId=record['recordId'],fieldPath='confirmedFacts.explicitNoSymptoms',actualTime=record['occurredAt']))
    # Candidates and reminders remain separate evidence, never upgraded to confirmed intake.
    by_id={}
    for e in events:
        # Exact duplicate facts retain one deterministic field path.
        if e['eventId'] not in by_id or e['fieldPath']<by_id[e['eventId']]['fieldPath']:by_id[e['eventId']]=e
    return dict(projectionVersion=VERSION,projectionId='rap_'+digest([VERSION,packet['contextHash']]),patientId=c['patientId'],inputRevision=c['inputRevision'],contextHash=packet['contextHash'],baseManifestHash=c['baseManifestHash'],referenceTime=c['referenceTime'],events=sorted(by_id.values(),key=lambda e:e['eventId']),medicationBackground=sorted(background,key=lambda e:e['id']),occurrences=deepcopy(c['occurrences']),recordLinks=deepcopy(c.get('recordLinks',[])),candidateSources=deepcopy(c['candidateSources']),causalClaim=False)

@router.post('/project')
async def route(request:Request):
    if request.client is None or request.client.host not in ('127.0.0.1','::1','testclient') or request.headers.get('origin'):raise HTTPException(403,'INTERNAL_ONLY')
    data=bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data)>8000000:raise HTTPException(413,'CONTEXT_TOO_LARGE')
    try:return project(__import__('json').loads(data))
    except (ValueError,TypeError,KeyError,OverflowError):raise HTTPException(422,'RA_PROJECTION_INVALID') from None
