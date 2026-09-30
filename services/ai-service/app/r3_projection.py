"""Read-only R3 projection. Never writes facts or changes the R1 scoring path."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math

from fastapi import APIRouter, HTTPException
from pydantic import Field, StrictInt

from app.r1 import Manifest

VERSION = 'r3_projection_v1'
GROUPS = {'medications': 'ADHERENCE', 'glucose': 'BG', 'bloodPressure': 'BP',
          'symptoms': 'SYMPTOM', 'meals': 'MEAL'}
router = APIRouter(prefix='/ai/r3')


class ProjectionManifest(Manifest):
    patientId: StrictInt = Field(gt=0)
    inputRevision: StrictInt = Field(ge=0)
    records: list[dict] = Field(max_length=2000)


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode('utf-8')).hexdigest()


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError('time must be an offset timestamp')
    time = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if time.utcoffset() is None:
        raise ValueError('time must include an offset')
    return time.astimezone(timezone.utc)


def text(value, field):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(field + ' must be nonempty text')


def number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError('measurement must be finite numeric data')


def validate_payload(kind, payload):
    if not isinstance(payload, dict):
        raise ValueError('fact must be an object')
    timestamp(payload.get('occurredAt'))
    if kind == 'BG':
        number(payload.get('value'))
        if payload.get('unit') != 'mmol/L':
            raise ValueError('glucose unit must be mmol/L')
    elif kind == 'BP':
        for key in ('systolic', 'diastolic'):
            number(payload.get(key))
        if payload.get('unit') != 'mmHg':
            raise ValueError('pressure unit must be mmHg')
    elif kind == 'ADHERENCE':
        if type(payload.get('medicationId')) is not int or payload['medicationId'] <= 0:
            raise ValueError('medicationId must be a positive integer')
        if payload.get('executionType') not in ('TAKEN', 'MAKEUP', 'MISSED', 'UNKNOWN'):
            raise ValueError('unsupported executionType')
    elif kind == 'SYMPTOM':
        text(payload.get('code'), 'symptom code')
        number(payload.get('severity'))
    elif kind == 'MEAL':
        text(payload.get('mealType'), 'mealType')
        text(payload.get('intakeLevel'), 'intakeLevel')


def project(manifest: ProjectionManifest):
    """Deterministic derived DTO; the caller retains ownership of all input objects."""
    source = deepcopy(manifest.model_dump(mode='json'))
    reference = manifest.referenceTime.astimezone(timezone.utc)
    start = reference - timedelta(days=14)
    records = {}
    revisions = {}
    for record in source['records']:
        for key in ('recordId', 'revisionId'):
            text(record.get(key), key)
        if 'patientId' in record and (type(record['patientId']) is not int or record['patientId'] != manifest.patientId):
            raise ValueError('record patient does not match manifest')
        timestamp(record.get('occurredAt'))
        raw = record.get('rawText', '')
        if not isinstance(raw, str) or len(raw) > 20000:
            raise ValueError('rawText must be text of at most 20000 characters')
        record['rawText'] = raw
        if not isinstance(record.get('confirmedFacts'), dict):
            raise ValueError('confirmedFacts must be an object')
        key = record['recordId']
        if key in records and canonical(records[key]) != canonical(record):
            raise ValueError('conflicting frozen record or revision')
        if record['revisionId'] in revisions and revisions[record['revisionId']] != key:
            raise ValueError('revision belongs to multiple records')
        records[key] = record
        revisions[record['revisionId']] = key
    source['records'] = [records[key] for key in sorted(records)]
    source['referenceTime'] = reference.isoformat()
    input_hash = digest(source)
    events, anchors = [], []

    def append(record, kind, path, payload, original_time, span=None):
        confirmed = kind != 'TEXT_NOTE'
        identity = [VERSION, manifest.patientId, record['recordId'], record['revisionId'], path]
        event_id = 'me_' + digest(identity)
        anchor_id = 'ta_' + digest(identity)
        time = timestamp(original_time) if confirmed else None
        eligibility = ('FUTURE' if time > reference else 'OUTSIDE_WINDOW' if time < start else 'IN_WINDOW') if confirmed else 'UNCONFIRMED'
        anchors.append(dict(anchorId=anchor_id, precision='POINT' if confirmed else 'UNKNOWN',
                            start=time.isoformat() if time else None, end=time.isoformat() if time else None,
                            originalTime=original_time, documentedAt=record['occurredAt'],
                            basis='CONFIRMED_FACT' if confirmed else 'DOCUMENT_TIME_ONLY'))
        events.append(dict(eventId=event_id, kind=kind,
                           confirmationStatus='CONFIRMED' if confirmed else 'PENDING',
                           payload=deepcopy(payload), anchorId=anchor_id, eligibility=eligibility,
                           evidence=dict(sourceId=record['recordId'], revisionId=record['revisionId'],
                                         factId=record['revisionId'] + ':' + path, fieldPath=path, span=span)))

    for record in source['records']:
        facts = record['confirmedFacts']
        for group, kind in GROUPS.items():
            values = facts.get(group, [])
            if not isinstance(values, list) or len(values) > 1000:
                raise ValueError('fact group must be an array of at most 1000 items')
            for index, payload in enumerate(values):
                validate_payload(kind, payload)
                append(record, kind, f'confirmedFacts.{group}[{index}]', payload, payload['occurredAt'])
        absence = facts.get('explicitNoSymptoms')
        if absence is not None and type(absence) is not bool:
            raise ValueError('explicitNoSymptoms must be boolean or null')
        if absence is True:
            append(record, 'NO_SYMPTOMS', 'confirmedFacts.explicitNoSymptoms',
                   {'explicitNoSymptoms': True}, record['occurredAt'])
        if record['rawText']:
            append(record, 'TEXT_NOTE', 'rawText', {'text': record['rawText']}, None,
                   [0, len(record['rawText'])])
    return dict(projectionVersion=VERSION,
                projectionId='projection_' + digest([VERSION, input_hash]),
                patientId=manifest.patientId, inputRevision=manifest.inputRevision,
                referenceTime=reference.isoformat(), inputHash=input_hash,
                events=sorted(events, key=lambda x: x['eventId']),
                anchors=sorted(anchors, key=lambda x: x['anchorId']))


@router.post('/project')
def project_route(manifest: ProjectionManifest):
    try:
        return project(manifest)
    except (ValueError, TypeError, KeyError, OverflowError):
        # Do not echo health facts or submitted raw text in error responses/logs.
        raise HTTPException(status_code=422, detail='R3_PROJECTION_INPUT_INVALID') from None
