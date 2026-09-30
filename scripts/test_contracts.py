import copy
import json
from pathlib import Path
import re
from datetime import datetime
import yaml
from jsonschema import Draft7Validator, FormatChecker

root=Path(__file__).resolve().parents[1]
spec=yaml.safe_load((root/'packages/contracts/openapi/openapi.yaml').read_text(encoding='utf-8'))
assert spec['openapi']=='3.0.3'
required=['/auth/password-login','/auth/logout','/capabilities','/patients','/patients/{patientId}/medications',
 '/patients/{patientId}/reminder-plans','/patients/{patientId}/feedback-records','/patients/{patientId}/analysis/latest',
 '/patients/{patientId}/reviews','/patients/{patientId}/follow-ups','/patients/{patientId}/reports/{reportId}/content']
assert all(path in spec['paths'] for path in required)
def walk(node):
    if isinstance(node,dict):
        if '$ref' in node:
            target=spec
            for part in node['$ref'].split('/')[1:]: target=target[part]
        for value in node.values():walk(value)
    elif isinstance(node,list):
        for item in node:walk(item)
walk(spec)
schemas=spec['components']['schemas']
assert schemas['AsyncStatus']['enum']==['PENDING','RUNNING','SUCCESS','FAILED']
assert schemas['ReviewPriority']['enum']==['OBSERVE','RETEST_SOON','CLINIC_REVIEW','HIGH_PRIORITY']
def convert(node):
    if isinstance(node,list):return [convert(x) for x in node]
    if not isinstance(node,dict):return node
    converted={k:convert(v) for k,v in node.items() if k!='nullable'}
    if node.get('nullable'):return {'anyOf':[{'type':'null'},converted]}
    return converted
contract=convert(spec)
formats=FormatChecker()
@formats.checks('date-time', raises=(ValueError,TypeError))
def offset_datetime(value):
    return isinstance(value,str) and 'T' in value and datetime.fromisoformat(value.replace('Z','+00:00')).utcoffset() is not None
def validate(name,value,valid=True):
    schema={'$ref':'#/components/schemas/'+name,'components':contract['components']}
    errors=list(Draft7Validator(schema,format_checker=formats).iter_errors(value))
    assert (not errors)==valid,(name,[e.message for e in errors])
med={'genericName':'合成未知药','dose':'1片','frequency':'每日一次','administrationTime':'早餐后','startDate':'2026-09-29'}
validate('ManualMedicationCreateRequest',med)
validate('ManualMedicationCreateRequest',{**med,'endDate':None})
validate('ManualMedicationCreateRequest',{**med,'startDate':'2026-02-30'},False)
validate('ManualMedicationCreateRequest',{k:v for k,v in med.items() if k!='dose'},False)
validate('MedicationPatchRequest',{'dose':'2片'},False)
validate('MedicationPatchRequest',{'expectedVersion':1,'dose':'2片'})
validate('MedicationPatchRequest',{'expectedVersion':4294967297,'dose':'2片'},False)
validate('LatestAnalysis',{'snapshot':None,'pendingTask':None,'inputRevision':0})
validate('LatestAnalysis',{'snapshot':None},False)
validate('AnalysisSnapshot',{'runId':'run_1','snapshotId':'snapshot_1','inputRevision':1,'algorithmVersion':'rules_r1_1','risk':None,'jointEvents':[],'evidence':[],'evaluations':[],'missingFields':['bloodGlucose']})
for file in (root/'database/migrations/mysql').glob('V*.sql'):
    text=file.read_text(encoding='utf-8').lower()
    assert not re.search(r'\b(bigserial|timestamptz|jsonb)\b|::json|on conflict|create index if not exists',text),file
print('PASS OpenAPI references, frozen paths/enums, valid/invalid medication samples, null analysis and MySQL dialect')
capture_spec=yaml.safe_load((root/'packages/contracts/openapi/capture.openapi.yaml').read_text(encoding='utf-8'))
def capture_refs(node):
    if isinstance(node,dict):
        if '$ref' in node:
            target=capture_spec
            for part in node['$ref'].split('/')[1:]:target=target[part]
        for value in node.values():capture_refs(value)
    elif isinstance(node,list):
        for value in node:capture_refs(value)
capture_refs(capture_spec)
assert len(capture_spec['paths'])==8
assert capture_spec['components']['schemas']['CaptureTask']['properties']['status']['enum']==['PENDING','RUNNING','CANDIDATE_READY','FAILED','CANCELLED','REJECTED','CONFIRMED']
print('PASS R2 capture routes, references and isolated task state machine')
facts=dict(medications=[],symptoms=[],explicitNoSymptoms=None,glucose=[],bloodPressure=[],meals=[])
feedback=dict(rawText='合成原文',source='MANUAL',occurredAt='2026-09-29T08:00:00+08:00',occurrenceId=None,followUpId=None,confirmedFacts=facts)
validate('FeedbackRequest',feedback)
validate('FeedbackRevisionRequest',dict(feedback,expectedVersion=1,changeReason='补录'))
validate('FeedbackRequest',dict(feedback,occurredAt='2026-09-29T08:00:00'),False)
validate('ConfirmedFacts',dict(facts,glucose=[dict(value=6,unit='mg/dL',occurredAt=feedback['occurredAt'])]),False)
validate('ReminderPlanRequest',dict(title='合成提醒',frequency='DAILY',timezone='Asia/Shanghai',localTime='08:30',startDate='2026-09-29',medicationIds=[1]))
validate('ReminderPlanRequest',dict(title='合成提醒',frequency='DAILY',timezone='UTC',localTime='25:00',startDate='2026-09-29',medicationIds=[1]),False)
samples=root/'.runtime-logs/care-contract-samples.json'
if samples.exists():
    for name,value in json.loads(samples.read_text(encoding='utf-8')).items():validate(name,value)
    print('PASS B04/B05 actual HTTP response fixtures against OpenAPI')
print('PASS B04/B05 request contracts: unknown symptoms, revisions, offset time, glucose units and schedule')
analysis_samples=root/'.runtime-logs/analysis-contract-samples.json'
if analysis_samples.exists():
    for name,value in json.loads(analysis_samples.read_text(encoding='utf-8')).items():validate(name,value)
    print('PASS B06/B07 actual analysis snapshots against OpenAPI')
    ai_spec=convert(yaml.safe_load((root/'packages/contracts/ai/r1-io.yaml').read_text(encoding='utf-8')))
    ai_schema=ai_spec['components']['schemas']['Analysis']
    analysis=json.loads(analysis_samples.read_text(encoding='utf-8'))['AnalysisSnapshot']
    validator=Draft7Validator(ai_schema,format_checker=formats)
    validator.validate(analysis)
    assert not validator.is_valid(dict(analysis,profile={})), 'required profile fields must be enforced'
    assert not validator.is_valid(dict(analysis,profile=dict(analysis['profile'],responseRate=1.5)))
    validator.validate(dict(analysis,profile=dict(analysis['profile'],responseRate=None)))
    print('PASS R1 AI contract: actual snapshot, required profile, bounded/null response rate')
followup_samples=root/'.runtime-logs/followup-contract-samples.json'
if followup_samples.exists():
    for name,value in json.loads(followup_samples.read_text(encoding='utf-8')).items():validate(name,value)
    print('PASS B08 actual review, follow-up and request contracts')
