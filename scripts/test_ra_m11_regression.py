"""Serial compatibility gates. Password is process-only; no remote AI calls."""
import argparse
import getpass
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]


def run(args):
    env=os.environ.copy()
    if args.password_prompt:env['SPRING_DATASOURCE_PASSWORD']=getpass.getpass('Local DB password (hidden): ')
    env.pop('DEEPSEEK_API_KEY',None);env['RA_LLM_ENABLED']='false'
    args.out.mkdir(parents=True,exist_ok=True)
    ai=str(ROOT/'services/ai-service/.venv/Scripts/python.exe')
    checks=[('legacy',[sys.executable,'scripts/test_r2_delivery.py','--out',str(args.out/'legacy')],ROOT,dict(env,R3_REPORT_ENABLED='false')),
            ('r3-inquiry',[sys.executable,'scripts/test_r3_integration.py','--out',str(args.out/'r3-inquiry')],ROOT,env),
            ('r3-reports',[sys.executable,'scripts/test_r3_reports.py','--out',str(args.out/'r3-reports')],ROOT,env),
            ('r3-replay',[ai,'scripts/replay_r3_delivery.py','--out',str(args.out/'r3-replay')],ROOT,env),
            ('asr-unit',[str(ROOT/'services/inference-service/.venv/Scripts/python.exe'),'-m','pytest','tests','-q'],ROOT/'services/inference-service',env)]
    results=[]
    for name,cmd,cwd,child in checks:
        print('START '+name,flush=True)
        with (args.out/(name+'.txt')).open('w',encoding='utf-8') as log:
            p=subprocess.run(cmd,cwd=cwd,env=child,stdout=log,stderr=subprocess.STDOUT)
        results.append(dict(name=name,command=cmd,exitCode=p.returncode))
        (args.out/'results.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
        print(('PASS ' if p.returncode==0 else 'FAIL ')+name,flush=True)
    if any(r['exitCode'] for r in results):raise SystemExit(1)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);p.add_argument('--password-prompt',action='store_true');run(p.parse_args())
