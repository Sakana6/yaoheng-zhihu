"""Export a clean source repository and a self-contained Windows x64 distribution."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import urllib.request
import zipfile

ROOT=Path(__file__).resolve().parents[2]
IGNORE=shutil.ignore_patterns('__pycache__','*.pyc','.pytest_cache','.env','.env.*','node_modules','.venv','.git','*.log')


def copytree(src,dst):
    shutil.copytree(src,dst,ignore=IGNORE,dirs_exist_ok=True)


def python_runtime(base,venv,dest):
    dest.mkdir(parents=True)
    for p in base.iterdir():
        if p.is_file() and (p.suffix in ('.exe','.dll') or 'LICENSE' in p.name):shutil.copy2(p,dest/p.name)
    copytree(base/'DLLs',dest/'DLLs')
    shutil.copytree(base/'Lib',dest/'Lib',ignore=shutil.ignore_patterns('site-packages','__pycache__','*.pyc','test','tests','idlelib','tkinter','ensurepip'))
    copytree(venv/'Lib/site-packages',dest/'Lib/site-packages')
    # No pyvenv.cfg, machine paths or console-script executables are transported.


def build(out):
    if out.exists():raise ValueError('Choose a new output directory')
    out.mkdir(parents=True)
    source=out/'source';source.mkdir()
    names=subprocess.check_output(['git','ls-files','-z'],cwd=ROOT).decode().split('\0')
    names+=['scripts/portable/'+p.name for p in (ROOT/'scripts/portable').glob('*') if p.is_file()]
    prefixes=('apps/mobile-app/','apps/doctor-web/','packages/','services/','database/','scripts/')
    roots={'package.json','package-lock.json','tsconfig.base.json','.gitignore'}
    for name in sorted(set(names)):
        p=ROOT/name
        if not name or not p.is_file() or not (name.startswith(prefixes) or name in roots):continue
        if name.startswith('apps/mobile-app/android/'):continue
        parts=Path(name).parts
        if any(x.startswith('.env') or x in ('.codex','node_modules','.venv','dist','target','out','__pycache__','.pytest_cache') for x in parts):continue
        if p.suffix.lower() in ('.log','.pyc'):continue
        target=source/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,target)
    shutil.copy2(ROOT/'scripts/portable/README.md',source/'README.md')
    (source/'.gitignore').write_text((source/'.gitignore').read_text()+'\n/runtime/\n/data/\n/portable-build/\n*.zip\n',encoding='utf-8')
    # Relative /api makes both prebuilt apps independent of runtime-selected ports.
    env=os.environ.copy();env.update(VITE_DATA_SOURCE='backend',VITE_API_BASE_URL='/api');env.pop('VITE_USE_MOCK',None)
    for app in ('mobile','doctor'):
        subprocess.run(['npm.cmd','run','build:'+app],cwd=ROOT,env=env,check=True)
    subprocess.run(['mvn.cmd','-q','-f','services/backend/pom.xml','compile','dependency:build-classpath','-Dmdep.outputFile=target/classpath.txt'],cwd=ROOT,check=True)
    portable=out/'Yaoheng-Windows-x64';copytree(source,portable)
    runtime=portable/'runtime';runtime.mkdir()
    for app in ('mobile-app','doctor-web'):copytree(ROOT/'apps'/app/'dist',portable/'apps'/app/'dist')
    copytree(ROOT/'services/backend/target/classes',portable/'services/backend/target/classes')
    libs=runtime/'java-libs';libs.mkdir()
    for name in (ROOT/'services/backend/target/classpath.txt').read_text().strip().split(os.pathsep):shutil.copy2(name,libs/Path(name).name)
    ai_base=Path(subprocess.check_output([str(ROOT/'services/ai-service/.venv/Scripts/python.exe'),'-c','import sys;print(sys.base_prefix)'],text=True).strip())
    asr_base=Path(subprocess.check_output([str(ROOT/'services/inference-service/.venv/Scripts/python.exe'),'-c','import sys;print(sys.base_prefix)'],text=True).strip())
    python_runtime(ai_base,ROOT/'services/ai-service/.venv',runtime/'python-ai')
    python_runtime(asr_base,ROOT/'services/inference-service/.venv',runtime/'python-asr')
    model=ROOT/'.local-evidence/asr/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09'
    if hashlib.sha256((model/'model.int8.onnx').read_bytes()).hexdigest()!='12ca1a2ae7ecf3e0019ef2822307ee0b5cadc9196569e379b4c4026f8205276d':raise ValueError('ASR model checksum')
    copytree(model,runtime/'asr-model')
    (runtime/'asr-model/LICENSE-2.0.txt').write_bytes(urllib.request.urlopen('https://www.apache.org/licenses/LICENSE-2.0.txt',timeout=30).read())
    mysql=Path(os.environ.get('MYSQL_DISTRIBUTION',r'C:\Program Files\MySQL\MySQL Server 9.6'))
    for folder in ('bin','lib','share','docs'):copytree(mysql/folder,runtime/'mysql'/folder)
    for p in mysql.iterdir():
        if p.is_file() and p.name.startswith(('LICENSE','README')):shutil.copy2(p,runtime/'mysql'/p.name)
    # Redistributable OpenJDK instead of copying the developer's installed Oracle JDK.
    request=urllib.request.Request('https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jre&os=windows&vendor=eclipse',headers={'User-Agent':'Yaoheng-portable-build'})
    package=json.load(urllib.request.urlopen(request,timeout=60))[0]['binary']['package']
    archive=out/'temurin-jre.zip';urllib.request.urlretrieve(package['link'],archive)
    if hashlib.sha256(archive.read_bytes()).hexdigest()!=package['checksum']:raise ValueError('JRE checksum')
    with zipfile.ZipFile(archive) as z:z.extractall(out/'jre-unpacked')
    java=next((out/'jre-unpacked').iterdir());copytree(java,runtime/'java')
    notices=dict(java=package,python=['https://www.python.org/psf/license/','https://github.com/astral-sh/python-build-standalone'],mysql=dict(version='9.6',source='https://downloads.mysql.com/archives/community/',license='runtime/mysql/LICENSE'),asr=dict(model='https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models',upstream='https://huggingface.co/ASLP-lab/WSYue-ASR',license='Apache-2.0'),dependencies='Python dist-info licenses and metadata preserved under runtime/python-*/Lib/site-packages')
    (portable/'THIRD_PARTY.json').write_text(json.dumps(notices,indent=2),encoding='utf-8')
    for filename,args in [('Start.cmd',''),('Start-DeepSeek.cmd','--ask-key')]:
        text='@echo off\r\nchcp 65001 >nul\r\ncd /d "%~dp0"\r\n"%~dp0runtime\\python-ai\\python.exe" "%~dp0scripts\\portable\\launcher.py" '+args+'\r\nif errorlevel 1 pause\r\n'
        (portable/filename).write_bytes(text.encode('utf-8'))
    print(json.dumps({'source':str(source),'portable':str(portable)}),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--out',required=True,type=Path);build(p.parse_args().out.resolve())
