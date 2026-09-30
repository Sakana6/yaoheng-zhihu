import json,asyncio
from pathlib import Path
import pytest
from app.ra_candidates import Input,generate,finish
from app.ra_semantics import extract,validate_model
from app.ra_temporal import resolve
from app.providers.deepseek import DeepSeek

CASES=json.loads((Path(__file__).parent/'fixtures/ra_semantics_v1.json').read_text(encoding='utf-8'))
def body(raw):return Input(requestId='test-request',rawText=raw,referenceTime='2026-09-30T12:00:00+08:00')
@pytest.mark.parametrize('case',CASES,ids=lambda c:c['id'])
def test_safety(case):
    out=finish(body(case['rawText']),extract(case['rawText']),'RULE_FALLBACK',{})
    if case['expectNoEligible']:assert not any(c['eligibleForPrefill'] for c in out['candidates'])
    if case['expectKind']:assert any(c['kind']==case['expectKind'] for c in out['candidates'])
    for c in out['candidates']:
        a,b=c['span'];assert case['rawText'][a:b]==c['quote'];assert c['requiresConfirmation']

def test_model_rejects_invented_or_repeated():
    row=extract('我血糖6.2')[0];row={k:v for k,v in row.items() if k not in ('span','conflict')};row['payload']['value']=3.0
    with pytest.raises(ValueError):validate_model('我血糖6.2',dict(candidates=[row],contextTags=[]))
    row=extract('我头晕')[0];row={k:v for k,v in row.items() if k not in ('span','conflict')}
    with pytest.raises(ValueError):validate_model('我头晕，我头晕',dict(candidates=[row],contextTags=[]))

def test_fallback_not_model_success():
    out=asyncio.run(generate(body('我没有头晕'),DeepSeek(env={})))
    assert out['generationMode']=='RULE_FALLBACK' and out['fallbackReason']=='DISABLED'
    assert not out['candidates'][0]['eligibleForPrefill']

@pytest.mark.parametrize('reference,hint,start,precision',[
('2026-01-01T01:00:00+08:00','昨天','2025-12-30T16:00:00+00:00','INTERVAL'),
('2026-03-01T01:00:00+08:00','昨天','2026-02-27T16:00:00+00:00','INTERVAL'),
('2025-12-31T17:00:00Z','今天','2025-12-31T16:00:00+00:00','INTERVAL'),
('2026-09-30T12:00:00+08:00','饭后不久',None,'UNKNOWN'),
('2026-09-30T12:00:00+08:00','2026-09-29T08:00:00+08:00','2026-09-29T00:00:00+00:00','POINT'),
('2026-09-30T12:00:00+08:00','最近一周','2026-09-23T04:00:00+00:00','INTERVAL')])
def test_temporal(reference,hint,start,precision):
    a=resolve(hint,reference);assert a['start']==start and a['precision']==precision
    assert a==resolve(hint,reference)

def test_future_and_invalid_range():
    assert resolve('明天','2026-09-30T12:00:00+08:00')['future']
    assert resolve('2026-10-01至2026-09-29','2026-09-30T12:00:00+08:00')['precision']=='UNKNOWN'


def test_time_relations_do_not_invent_simultaneity():
    from app.ra_temporal import relation
    ref='2026-09-30T12:00:00+08:00'
    a=resolve('2026-09-29T08:00:00+08:00',ref);b=resolve('2026-09-29T08:00:01+08:00',ref)
    assert relation(a,b)=='BEFORE' and relation(b,a)=='AFTER'
    assert relation(a,a)=='POSSIBLE_OVERLAP'
    assert relation(a,resolve('饭后',ref))=='UNKNOWN'
    assert relation(resolve('昨天',ref),resolve('今天',ref))=='POSSIBLE_OVERLAP'

def test_context_tags_have_exact_spans():
    from app.ra_semantics import context_tags
    raw='🙂如果妈妈头晕，后来又手抖吗？'
    tags=context_tags(raw)
    assert {'OTHER_SUBJECT','CONDITIONAL','SEQUENCE','REPEATED','QUESTION'}<={t['kind'] for t in tags}
    for t in tags:assert raw[t['span'][0]:t['span'][1]]==t['quote']
