import asyncio
from app.ra_candidates import Input,generate
from app.ra_semantics import validate_model,extract
import pytest

def test_input_limit_and_identity_never_call_provider():
    class Never:
        async def complete(self,*args):raise AssertionError('must not call remote')
    for raw,reason,allowed in [('字'*4001,'INPUT_LIMIT',True),('我叫合成姓名，头晕','IDENTITY_TEXT_MANUAL',True),('合成姓名头晕','IDENTITY_TEXT_MANUAL',False)]:
        out=asyncio.run(generate(Input(requestId='limits-test',rawText=raw,referenceTime='2026-09-30T00:00:00Z',allowRemote=allowed),Never()))
        assert out['fallbackReason']==reason

def test_bool_is_not_numeric_candidate():
    rows=extract('我血糖1.0');row={k:v for k,v in rows[0].items() if k not in ('span','conflict')};row['payload']['value']=True
    with pytest.raises(ValueError):validate_model('我血糖1.0',dict(candidates=[row],contextTags=[]))
