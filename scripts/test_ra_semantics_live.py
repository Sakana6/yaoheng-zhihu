"""M12 explicit LIVE semantic evaluation, frozen provider output and offline replay."""
import argparse,asyncio,getpass,json,os,sys,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'services/ai-service'))
from app.ra_candidates import Input,generate
from app.providers.deepseek import DeepSeek
from app.r3_projection import digest

class Recorder:
    def __init__(self,engine):self.engine=engine;self.raw=None;self.meta=None
    async def complete(self,*args):
        self.raw,self.meta=await self.engine.complete(*args);return self.raw,self.meta

async def run(args):
    if args.key_prompt:os.environ['DEEPSEEK_API_KEY']=getpass.getpass('DeepSeek key (hidden): ')
    if not os.getenv('DEEPSEEK_API_KEY'):raise SystemExit('LIVE blocked: no key')
    args.out.mkdir(parents=True,exist_ok=True)
    engine=DeepSeek(env=dict(os.environ,RA_LLM_ENABLED='true',RA_LLM_BUDGET_PATH=str(ROOT/'.local-evidence/ra-live-budget.sqlite3')))
    fixtures=json.loads((ROOT/'services/ai-service/tests/fixtures/ra_semantics_v1.json').read_text(encoding='utf-8'));results=[]
    try:
        for case in fixtures:
            body=Input(requestId='m12-'+uuid.uuid4().hex,rawText=case['rawText'],referenceTime='2026-09-30T12:00:00+08:00');record=Recorder(engine);t=time.monotonic()
            output=await generate(body,record)
            safe=not case['expectNoEligible'] or not any(c['eligibleForPrefill'] for c in output['candidates'])
            found=not case['expectKind'] or any(c['kind']==case['expectKind'] for c in output['candidates'])
            results.append(dict(case=case,input=body.model_dump(),providerOutput=record.raw,providerMeta=record.meta,output=output,passed=safe and found,seconds=round(time.monotonic()-t,3)))
            (args.out/'live-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
        summary=dict(cases=len(results),safetyPassed=all(r['passed'] for r in results),liveResponses=sum(r['providerOutput'] is not None for r in results),modelValidated=sum(r['output']['generationMode']=='DEEPSEEK' for r in results),fixtureHash=digest(fixtures))
        (args.out/'summary.json').write_text(json.dumps(summary,indent=2),encoding='utf-8');print(json.dumps(summary))
        if not summary['safetyPassed'] or summary['liveResponses']!=len(fixtures) or not summary['modelValidated']:raise SystemExit(1)
    finally:await engine.close();os.environ.pop('DEEPSEEK_API_KEY',None)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);p.add_argument('--key-prompt',action='store_true');asyncio.run(run(p.parse_args()))
