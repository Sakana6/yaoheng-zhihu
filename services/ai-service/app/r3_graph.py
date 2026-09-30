"""Versioned, reconstructable DD-TEG explanation; never replaces R1 risk scores."""
from datetime import timedelta
from itertools import groupby
import networkx as nx
from fastapi import APIRouter, HTTPException
from app.r1 import KNOWLEDGE, SYMPTOMS
from app.r3_projection import ProjectionManifest, project, digest, timestamp
from app.r3_ranking import rank

VERSION = 'r3_graph_v1'
CHAIN_VERSION = 'r3_chain_v1'
router = APIRouter(prefix='/ai/r3')
QUESTIONS = {'BG': ('glucose','BLOOD_GLUCOSE'), 'BP': ('bloodPressure','BLOOD_PRESSURE'),
             'SYMPTOM': ('symptoms','SYMPTOMS'), 'MEAL': ('meals','MEALS')}


def graph(manifest: ProjectionManifest):
    projection = project(manifest)
    # Bound derived work explicitly rather than silently returning a partial graph.
    if len(projection['events']) > 2000:
        raise ValueError('R3 graph input exceeds local limit')
    g = nx.MultiDiGraph()
    anchors = {a['anchorId']: a for a in projection['anchors']}
    for event in projection['events']:
        g.add_node(event['eventId'], nodeType='EVENT', **event)
    eligible = [e for e in projection['events'] if e['confirmationStatus']=='CONFIRMED' and e['eligibility']=='IN_WINDOW']
    def edge(left, right, relation, refs):
        key = 'edge_' + digest([VERSION,left,right,relation])
        g.add_edge(left, right, key=key, edgeId=key, relation=relation,
                   ruleVersion=VERSION, evidence=refs)
    ordered = sorted(eligible, key=lambda e:(anchors[e['anchorId']]['start'],e['eventId']))
    previous = []
    for _, group in groupby(ordered, key=lambda e:anchors[e['anchorId']]['start']):
        current = list(group)
        # A representative per equal-time group avoids quadratic pair expansion.
        for other in current[1:]:
            refs=[current[0]['evidence'],other['evidence']]
            edge(current[0]['eventId'],other['eventId'],'OVERLAP',refs)
        if previous:
            left,right=previous[0],current[0];refs=[left['evidence'],right['evidence']]
            edge(left['eventId'],right['eventId'],'BEFORE',refs)
            edge(right['eventId'],left['eventId'],'AFTER',refs)
        previous=current
    classes=set();medication_context=[]
    for medication in manifest.medications:
        name=medication.get('genericName','')
        if not isinstance(name,str):raise ValueError('invalid medication name')
        info=KNOWLEDGE.get(name) or KNOWLEDGE.get(name.upper())
        if info:
            classes.update(info['classes'])
            medication_context.append(dict(snapshot=medication,classes=info['classes'],dictionaryHash=digest(KNOWLEDGE)))
    chains=[];missing=[]
    reference=manifest.referenceTime
    records={r['recordId']:r for r in manifest.records}
    for record_id in sorted(records):
        record=records[record_id];center=timestamp(record['occurredAt'])
        if not reference-timedelta(days=14)<=center<=reference:continue
        left,right=center-timedelta(hours=2),min(center+timedelta(hours=2),reference)
        window_id='window_'+digest([VERSION,manifest.patientId,record_id,record['revisionId']])
        g.add_node(window_id,nodeType='WINDOW',start=left.isoformat(),end=right.isoformat())
        events=[e for e in eligible if left<=timestamp(anchors[e['anchorId']]['start'])<=right]
        for e in events:edge(e['eventId'],window_id,'WITHIN',[e['evidence']])
        for kind,drug_class,required in [('G','GLUCOSE_LOWERING',['MEAL','BG','SYMPTOM']),('B','BP_LOWERING',['BP','SYMPTOM'])]:
            identity=[CHAIN_VERSION,manifest.patientId,record_id,record['revisionId'],kind]
            chain_id='chain_'+digest(identity)
            typed=lambda typ:[e for e in events if e['kind']==typ and not (typ=='MEAL' and e['payload']['intakeLevel']=='UNKNOWN')]
            needed=[t for t in required if not typed(t) and not (t=='SYMPTOM' and typed('NO_SYMPTOMS'))]
            applicable=drug_class in classes
            refs=[e['evidence'] for e in events if e['kind'] in required+['NO_SYMPTOMS']]
            symptoms={SYMPTOMS.get(e['payload']['code'],e['payload']['code'].upper()) for e in typed('SYMPTOM')}
            if kind=='G':
                hit=any(e['payload']['value']<=3.9 for e in typed('BG')) and any(e['payload']['intakeLevel']=='INSUFFICIENT' for e in typed('MEAL')) and bool(symptoms & {'DIZZINESS','SWEATING','TREMOR'})
            else:
                hit=any(e['payload']['systolic']<90 or e['payload']['diastolic']<60 for e in typed('BP')) and bool(symptoms & {'DIZZINESS','WEAKNESS','UNSTEADY_STANDING'})
            status='NOT_APPLICABLE' if not applicable else 'INSUFFICIENT' if needed else 'MATCHED' if hit else 'NOT_MATCHED'
            gaps=[]
            if applicable:
                for typ in needed:
                    field,code=QUESTIONS[typ];missing_id='missing_'+digest(identity+[field])
                    node=dict(nodeId=missing_id,nodeType='MISSING',recordId=record_id,revisionId=record['revisionId'],
                              field=field,questionCode=code,chainId=chain_id,windowId=window_id)
                    missing.append(node);g.add_node(missing_id,**node);gaps.append(missing_id)
            g.add_node(chain_id,nodeType='CHAIN',chainType=kind,status=status)
            for gap in gaps:edge(chain_id,gap,'HAS_MISSING',refs)
            for e in events:
                if e['evidence'] in refs:edge(e['eventId'],chain_id,'SUPPORTS',[e['evidence']])
            chains.append(dict(chainId=chain_id,chainType=kind,status=status,windowId=window_id,
                               evidence=refs,missingNodeIds=gaps,missingFields=[QUESTIONS[t][0] for t in needed] if applicable else [],referenceTime=center.isoformat(),referenceEpoch=center.timestamp(),
                               medicationContext=[m for m in medication_context if drug_class in m['classes']],
                               compatibleJE=['JE001','JE005'] if kind=='G' else ['JE002'],causalClaim=False))
    gs=[c for c in chains if c['chainType']=='G' and c['status']=='MATCHED' and timestamp(c['referenceTime'])>=reference-timedelta(days=7)]
    bs=[c for c in chains if c['chainType']=='B' and c['status']=='MATCHED' and timestamp(c['referenceTime'])>=reference-timedelta(days=7)]
    # One composite per G chain, selecting the closest B; avoids duplicate all-pairs composites.
    for g_chain in gs:
        if not bs:break
        b_chain=min(bs,key=lambda c:(abs(c['referenceEpoch']-g_chain['referenceEpoch']),c['chainId']))
        ids=[g_chain['chainId'],b_chain['chainId']];cid='chain_'+digest([CHAIN_VERSION,'C',ids])
        refs={e['factId']:e for c in [g_chain,b_chain] for e in c['evidence']}
        recent=max(g_chain['referenceEpoch'],b_chain['referenceEpoch'])
        chains.append(dict(chainId=cid,chainType='C',status='MATCHED',parentChainIds=ids,
                           evidence=sorted(refs.values(),key=lambda e:e['factId']),missingNodeIds=[],missingFields=[],compatibleJE=[],
                           referenceTime=max(g_chain['referenceTime'],b_chain['referenceTime']),referenceEpoch=recent,causalClaim=False))
        chains[-1]['medicationContext']=medication_context
        g.add_node(cid,nodeType='CHAIN',chainType='C',status='MATCHED')
        for parent in ids:edge(parent,cid,'CO_OCCURS',list(refs.values()))
    ranking=rank(chains,classes)
    nodes=[dict(id=node,**attrs) for node,attrs in sorted(g.nodes(data=True))]
    edges=sorted([dict(source=a,target=b,**attrs) for a,b,attrs in g.edges(data=True)],key=lambda e:e['edgeId'])
    return dict(**projection,graphVersion=VERSION,chainVersion=CHAIN_VERSION,
                graphId='graph_'+digest([VERSION,CHAIN_VERSION,projection['inputHash']]),
                nodes=nodes,edges=edges,chains=chains,missingNodes=sorted(missing,key=lambda n:n['nodeId']),ranking=ranking)


@router.post('/graph')
def graph_route(manifest: ProjectionManifest):
    try:return graph(manifest)
    except (ValueError,TypeError,KeyError,OverflowError):
        raise HTTPException(422,'R3_GRAPH_INPUT_INVALID') from None
