"""Versioned local R1 rules. Only confirmed, referenced facts enter detection.

The legacy four-interface pipeline remains available for golden-case comparison.
This orchestrator never calls an external model or online knowledge source.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import hashlib
import json
import re
from html import escape
from typing import Literal
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, AwareDatetime, Field
from app.modules.risk_scoring import TEMPLATE_SCORES, RiskScoringModule

router = APIRouter(prefix='/ai/r1')
VERSION = 'rules_r1_1'
ZONE = timezone(timedelta(hours=8))
KNOWLEDGE = json.loads((Path(__file__).parent.parent/'data/knowledge/drug_aliases.json').read_text(encoding='utf-8'))
LABELS = {'JE001':'进食不足与低糖症状线索','JE002':'低压与不适线索','JE003':'多药执行异常与指标波动','JE004':'夜间服药与次晨不适','JE005':'反复低糖与当前症状'}
SYMPTOMS = {'头晕':'DIZZINESS','出汗':'SWEATING','手抖':'TREMOR','乏力':'WEAKNESS','站立不稳':'UNSTEADY_STANDING'}

class Manifest(BaseModel):
    patientId: int
    inputRevision: int
    referenceTime: AwareDatetime
    medications: list[dict]
    records: list[dict]
    reminders: list[dict]

def dt(value):
    parsed=datetime.fromisoformat(value.replace('Z','+00:00'))
    if parsed.utcoffset() is None: raise ValueError('offset time required')
    return parsed

def reference(record, field, time):
    return dict(sourceId=record['recordId'],revisionId=record['revisionId'],fieldPath=field,occurredAt=time,factId=record['revisionId']+':'+field)

def analyze(m:Manifest):
    ref=m.referenceTime; start=ref-timedelta(days=14)
    timeline=[]; candidates=[]
    groups={'medications':'ADHERENCE','glucose':'BG','bloodPressure':'BP','symptoms':'SYMPTOM','meals':'MEAL'}
    for record in m.records:
        facts=record['confirmedFacts']
        for group,kind in groups.items():
            for index,payload in enumerate(facts.get(group,[])):
                time=payload['occurredAt']
                if not start<=dt(time)<=ref: continue
                if kind=='BG' and (not isinstance(payload.get('value'),(int,float)) or payload.get('unit')!='mmol/L'):raise ValueError('invalid glucose')
                if kind=='BP' and (not all(isinstance(payload.get(k),(int,float)) for k in ('systolic','diastolic')) or payload.get('unit')!='mmHg'):raise ValueError('invalid pressure')
                timeline.append(dict(type=kind,time=time,payload=payload,evidence=reference(record,f'confirmedFacts.{group}[{index}]',time)))
        if facts.get('explicitNoSymptoms') is True and start<=dt(record['occurredAt'])<=ref:
            timeline.append(dict(type='NO_SYMPTOMS',time=record['occurredAt'],payload={},evidence=reference(record,'confirmedFacts.explicitNoSymptoms',record['occurredAt'])))
        # Conservative candidates retain context and uncertainty, never become measurements.
        for match in re.finditer('|'.join(SYMPTOMS),record.get('rawText','')):
            text=record['rawText']; prefix=text[max(0,match.start()-10):match.start()]
            qualifier='NEGATED' if re.search('没有|无|不',prefix) else 'OTHER_PERSON' if re.search('父亲|母亲|别人|家人',prefix) else 'HISTORICAL' if re.search('以前|去年|曾经',prefix) else 'UNCONFIRMED'
            candidates.append(dict(code=SYMPTOMS[match.group()],context=qualifier,timeHint=text,confirmationStatus='PENDING',evidence=reference(record,'rawText',record['occurredAt']),span=[match.start(),match.end()]))
        for match in re.finditer(r'血糖\s*([0-9]+(?:\.[0-9]+)?)|血压\s*([0-9]+)\s*[/／]\s*([0-9]+)|漏服|补服|没吃饭|进食不足',record.get('rawText','')):
            text=record['rawText'];prefix=text[max(0,match.start()-10):match.start()]
            qualifier='OTHER_PERSON' if re.search('父亲|母亲|别人|家人',prefix) else 'HISTORICAL' if re.search('以前|去年|曾经',prefix) else 'UNCONFIRMED'
            candidates.append(dict(code='TEXT_MEASUREMENT_OR_BEHAVIOR',text=match.group(),context=qualifier,timeHint=text,confirmationStatus='PENDING',evidence=reference(record,'rawText',record['occurredAt']),span=[match.start(),match.end()]))
    timeline=sorted({x['evidence']['factId']:x for x in timeline}.values(),key=lambda x:dt(x['time']))
    meds=[];unknown=False
    for med in m.medications:
        info=KNOWLEDGE.get(med['genericName'].upper()) or KNOWLEDGE.get(med['genericName'])
        meds.append(dict(med,classes=info['classes'] if info else []));unknown|=info is None
    classes={c for med in meds for c in med['classes']}
    lowbg=[x for x in timeline if x['type']=='BG' and x['payload']['value']<=3.9]
    lowbp=[x for x in timeline if x['type']=='BP' and (x['payload']['systolic']<90 or x['payload']['diastolic']<60)]
    due=[x for x in m.reminders if start<=dt(x['plannedAt'])<=ref and x['executionStatus']!='CANCELLED']
    profile=dict(lowBgCount14d=len(lowbg),lowBpCount14d=len(lowbp),missedMedCount14d=sum(x['type']=='ADHERENCE' and x['payload']['executionType']=='MISSED' for x in timeline),responseRate=sum(x['executionStatus']=='DONE' for x in due)/len(due) if due else None)
    windows=[]
    for x in timeline:
        time=dt(x['time'])
        if x['type']=='ADHERENCE' and x['payload']['executionType'] in ('TAKEN','MAKEUP'):windows.append((time-timedelta(hours=2),time+timedelta(hours=2),'MEDICATION'))
        if x['type']=='MEAL':windows.append((time-timedelta(hours=1),time+timedelta(hours=2),'MEAL'))
    for i in range(15):
        day=(ref.astimezone(ZONE)-timedelta(days=i)).replace(hour=10,minute=0,second=0,microsecond=0)
        windows.append((day-timedelta(hours=14),day,'NIGHT'))
    # A current four-hour observation window permits confirmed measures without a medication anchor.
    windows.append((ref-timedelta(hours=2),ref+timedelta(hours=2),'GENERAL'))
    events={};evaluations=[];all_missing=set()
    for rule in LABELS:
        required_class='GLUCOSE_LOWERING' if rule in ('JE001','JE005') else 'BP_LOWERING' if rule=='JE002' else None
        applicable=required_class is None or required_class in classes
        missing=set();sufficient=False;matched=[];support=[]
        if not applicable: missing={'medicationClass'} if unknown or not meds else set()
        else:
            for left,right,label in windows:
                if rule!='JE004' and label=='NIGHT':continue
                xs=[x for x in timeline if left<=dt(x['time'])<=right]
                typed=lambda t:[x for x in xs if x['type']==t]
                bg=typed('BG');bp=typed('BP');meal=typed('MEAL');ad=typed('ADHERENCE');sym=typed('SYMPTOM');none=typed('NO_SYMPTOMS')
                codes={SYMPTOMS.get(x['payload']['code'],x['payload']['code'].upper()) for x in sym}
                low_sym=bool(codes&{'DIZZINESS','SWEATING','TREMOR'});bp_sym=bool(codes&{'DIZZINESS','WEAKNESS','UNSTEADY_STANDING'})
                needs=[];hit=False;used=[]
                if rule=='JE001':
                    needs=[name for name,ok in [('meal',bool(meal)),('glucose',bool(bg)),('symptoms',bool(sym or none))] if not ok];hit=bool(meal and bg and any(x['payload']['intakeLevel']=='INSUFFICIENT' for x in meal) and any(x['payload']['value']<=3.9 for x in bg) and low_sym);used=meal+bg+sym+none
                elif rule=='JE002':
                    needs=[name for name,ok in [('bloodPressure',bool(bp)),('symptoms',bool(sym or none))] if not ok];hit=bool(bp and any(x['payload']['systolic']<90 or x['payload']['diastolic']<60 for x in bp) and bp_sym);used=bp+sym+none
                elif rule=='JE003':
                    if len(meds)<2: continue
                    needs=[name for name,ok in [('adherence',any(x['payload']['executionType']!='UNKNOWN' for x in ad)),('twoGlucoseMeasurements',len(bg)>=2)] if not ok];hit=bool(len(bg)>=2 and any(x['payload']['executionType'] in ('MISSED','MAKEUP') for x in ad) and max(x['payload']['value'] for x in bg)-min(x['payload']['value'] for x in bg)>=2);used=ad+bg
                elif rule=='JE004':
                    if label!='NIGHT':continue
                    taken=[x for x in ad if x['payload']['executionType'] in ('TAKEN','MAKEUP') and dt(x['time']).astimezone(ZONE).hour>=20]
                    morning=[x for x in sym if dt(x['time']).astimezone(ZONE).hour<10 and any(dt(a['time'])<dt(x['time']) for a in taken)]
                    morning_codes={SYMPTOMS.get(x['payload']['code'],x['payload']['code'].upper()) for x in morning}
                    needs=[name for name,ok in [('confirmedNightExecution',any(x['payload']['executionType']!='UNKNOWN' for x in ad)),('morningSymptoms',bool(sym or none))] if not ok];hit=bool(taken and morning_codes&{'DIZZINESS','SWEATING','TREMOR','WEAKNESS','UNSTEADY_STANDING'});used=ad+sym+none
                else:
                    if label!='GENERAL':continue
                    needs=[name for name,ok in [('glucoseHistory',any(x['type']=='BG' for x in timeline)),('symptoms',bool(sym or none))] if not ok];hit=len(lowbg)>=2 and low_sym;used=lowbg+sym+none
                if not needs:sufficient=True;support.extend(used)
                else:missing.update(needs)
                if hit:
                    # Explicit absence supports non-match evaluation, not a positive symptom event.
                    used=[x for x in used if x['type']!='NO_SYMPTOMS']
                    evidence=list({x['evidence']['factId']:x['evidence'] for x in used}.values());fingerprint=hashlib.sha256((VERSION+rule+','.join(sorted(x['factId'] for x in evidence))).encode()).hexdigest()[:24]
                    event=dict(eventId='je_'+fingerprint,eventType=rule,label=LABELS[rule],evidence=evidence,window=dict(start=left.isoformat(),end=right.isoformat(),policy=label))
                    events[fingerprint]=event;matched.append(event)
        if rule=='JE003' and len(meds)<2:status='INSUFFICIENT' if unknown else 'NOT_APPLICABLE';missing={'medicationClass'} if unknown else set()
        elif not applicable:status='INSUFFICIENT' if missing else 'NOT_APPLICABLE'
        else:status='MATCHED' if matched else 'NOT_MATCHED' if sufficient else 'INSUFFICIENT'
        if status!='INSUFFICIENT':missing=set()
        all_missing.update(missing)
        evidence=[e for x in matched for e in x['evidence']] if matched else [x['evidence'] for x in support]
        evaluations.append(dict(ruleId=rule,status=status,missingFields=sorted(missing),evidence=list({x['factId']:x for x in evidence}.values())))
    for rule in ['JE006','JE007','JE008','JE009','JE010']:evaluations.append(dict(ruleId=rule,status='NOT_APPLICABLE',missingFields=[],evidence=[],reason='R1_NOT_IMPLEMENTED'))
    risk=None
    if events or (not all_missing and any(x['status']=='NOT_MATCHED' for x in evaluations)):
        scores={k:max([TEMPLATE_SCORES[x['eventType']][k] for x in events.values()] or [0]) for k in ['deintensificationScore','interactionScore','behaviorScore','jointEventScore']}
        if events:
            scores['deintensificationScore']=min(100,scores['deintensificationScore']+(5 if len(lowbg)>=3 else 0)+(4 if len(lowbp)>=3 else 0))
            scores['behaviorScore']=min(100,scores['behaviorScore']+(8 if profile['missedMedCount14d']>=4 else 0))
            if profile['responseRate'] is not None and profile['responseRate']<.5 and scores['jointEventScore']>60:scores['jointEventScore']=min(100,scores['jointEventScore']+5)
        risk=dict(scores,reviewPriority=RiskScoringModule().map_review_priority(scores))
    return dict(algorithmVersion=VERSION,knowledgeVersion='local_drugs_v1',windowPolicyVersion='fixed_windows_r1_1',inputRevision=m.inputRevision,referenceTime=ref.isoformat(),risk=risk,dataStatus='PARTIAL' if events and all_missing else 'INSUFFICIENT' if risk is None else 'SUFFICIENT',jointEvents=list(events.values()),evaluations=evaluations,missingFields=sorted(all_missing),timeline=timeline,evidence=[x['evidence'] for x in timeline],profile=profile,medications=meds,candidates=candidates)

@router.post('/analyze')
def analyze_route(manifest:Manifest):
    try:return analyze(manifest)
    except (ValueError,KeyError,TypeError) as error:raise HTTPException(status_code=422,detail='INVALID_CONFIRMED_INPUT') from error

class ReportRequest(BaseModel):
    snapshot:dict
    reportType:Literal['FAMILY','DOCTOR']

def report(req:ReportRequest):
    snapshot=req.snapshot
    title='家属照护记录' if req.reportType=='FAMILY' else '医生复查证据摘要'
    packet={k:snapshot[k] for k in ['runId','snapshotId','inputRevision','algorithmVersion','referenceTime','risk','dataStatus','medications','timeline','jointEvents','evaluations','missingFields','profile']}
    # Values are copied verbatim from the frozen evidence packet. No generative medical text.
    guidance='请核对记录中的药品、实际测量和缺失项，复查时出示本报告。' if req.reportType=='FAMILY' else '请复核以下规则覆盖范围、原始事实引用、输入水位和历史药历版本。'
    packet_json=json.dumps(packet,ensure_ascii=False,indent=2)
    body=f'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>{title}</title><body><h1>{title}</h1><p>本地合成规则辅助记录，不是诊断或处方。请携带记录与医生核对，不自行调整药物。</p><p>{guidance}</p><p>数据状态：{escape(snapshot["dataStatus"])}</p><h2>快照及证据</h2><pre style="white-space:pre-wrap;overflow-wrap:anywhere">{escape(packet_json)}</pre></body></html>'
    return dict(html=body,packetJson=packet_json,templateVersion='html_r1_1',snapshotId=snapshot['snapshotId'],reportType=req.reportType,evidenceHash=hashlib.sha256(json.dumps(packet,sort_keys=True,ensure_ascii=False).encode()).hexdigest())

@router.post('/report')
def report_route(req:ReportRequest):return report(req)
