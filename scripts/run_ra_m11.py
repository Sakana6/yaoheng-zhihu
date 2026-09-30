"""M11 developer launcher: original UI, hidden credentials, owned local services only."""
import argparse
import getpass
import os
from pathlib import Path
import shutil
import subprocess

import r1_local
from prepare_demo_database import prepare


def run(args):
    r1_local.synthetic(args.database)
    root=r1_local.ROOT
    # Build before acquiring any provider credential. Never store it in a shell command.
    mvn=shutil.which('mvn')
    if not mvn:raise RuntimeError('Maven missing')
    build_env=os.environ.copy();build_env.pop('DEEPSEEK_API_KEY',None)
    subprocess.run([mvn,'-q','-f',str(root/'services/backend/pom.xml'),'compile','dependency:build-classpath','-Dmdep.outputFile=target/classpath.txt'],check=True,env=build_env)
    if not os.getenv('DB_PASSWORD') and not os.getenv('SPRING_DATASOURCE_PASSWORD'):
        os.environ['SPRING_DATASOURCE_PASSWORD']=getpass.getpass('Local MySQL password (hidden): ')
    prepare(args.database)
    if not args.no_llm and not os.getenv('DEEPSEEK_API_KEY'):
        os.environ['DEEPSEEK_API_KEY']=getpass.getpass('DeepSeek key (hidden; blank uses manual entry): ')
    enabled=not args.no_llm and bool(os.getenv('DEEPSEEK_API_KEY'))
    os.environ['RA_LLM_ENABLED']='true' if enabled else 'false'
    os.environ['CAPTURE_OCR_MODE']='deepseek' if enabled else 'disabled'
    os.environ['CAPTURE_VOICE_MODE']='disabled' if args.no_asr else 'local'
    os.environ['LOCAL_ASR_MODEL_DIR']=str(args.model.resolve())
    print('M11: original UI; OCR '+('DeepSeek' if enabled else 'manual')+'; voice '+('manual' if args.no_asr else 'local ASR'))
    try:r1_local.run(args.database,smoke=args.smoke,auto_ports=True,open_browser=not args.no_browser)
    finally:os.environ.pop('DEEPSEEK_API_KEY',None)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--database',default='yaoheng_synthetic_m11_demo')
    p.add_argument('--model',type=Path,default=r1_local.ROOT/'.local-evidence/asr/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09')
    p.add_argument('--no-llm',action='store_true');p.add_argument('--no-asr',action='store_true')
    p.add_argument('--no-browser',action='store_true');p.add_argument('--smoke',action='store_true')
    run(p.parse_args())
