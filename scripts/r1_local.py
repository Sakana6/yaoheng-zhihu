"""Local R1 lifecycle and synthetic-only backup/restore. Never persists credentials."""
import argparse,hashlib,json,os,re,shutil,socket,subprocess,sys,time,urllib.request,webbrowser,zipfile
from pathlib import Path
from local_database import ROOT,BIN,sql

def synthetic(name):
    if not re.fullmatch(r'yaoheng_synthetic_[a-z0-9_]+',name):raise ValueError('Dedicated yaoheng_synthetic_* database required')
    return name

def backup(database,path):
    synthetic(database);path=Path(path).resolve()
    if path.exists() or path.with_suffix('.json').exists():raise ValueError('Backup destination must be new')
    path.parent.mkdir(parents=True,exist_ok=True)
    env=os.environ.copy();env['MYSQL_PWD']=env.get('DB_PASSWORD') or env.get('SPRING_DATASOURCE_PASSWORD','')
    if not env['MYSQL_PWD']:raise ValueError('Database password must come from environment')
    result=subprocess.run([str(BIN/'mysqldump.exe'),'-h','127.0.0.1','-u',env.get('DB_USER','root'),'--set-gtid-purged=OFF','--single-transaction','--default-character-set=utf8mb4',database],env=env,capture_output=True,check=True)
    path.write_bytes(result.stdout)
    path.with_suffix('.json').write_text(json.dumps(dict(database=database,sha256=hashlib.sha256(result.stdout).hexdigest()),indent=2),encoding='utf-8')
    print('Backup written:',path)

def restore(database,path):
    synthetic(database);path=Path(path).resolve();meta=json.loads(path.with_suffix('.json').read_text(encoding='utf-8'));synthetic(meta['database'])
    content=path.read_bytes()
    if hashlib.sha256(content).hexdigest()!=meta['sha256']:raise ValueError('Backup checksum mismatch')
    if sql(None,f"select schema_name from information_schema.schemata where schema_name='{database}'"):raise ValueError('Restore refuses an existing database')
    sql(None,f'create database `{database}` character set utf8mb4')
    sql(database,content.decode('utf-8'))
    print('Restored into new synthetic database:',database)

DEFAULT_PORTS = dict(backend=3000,ai=8000,mobile=5173,doctor=5174)

def port_available(port):
    # Check both loopbacks: Windows Vite may occupy only ::1.
    for family,address in [(socket.AF_INET,'127.0.0.1'),(socket.AF_INET6,'::1')]:
        with socket.socket(family,socket.SOCK_STREAM) as probe:
            try:
                if hasattr(socket,'SO_EXCLUSIVEADDRUSE'):probe.setsockopt(socket.SOL_SOCKET,socket.SO_EXCLUSIVEADDRUSE,1)
                probe.bind((address,port))
            except OSError:return False
    return True

def select_ports(auto=False):
    ports={}
    for name,preferred in DEFAULT_PORTS.items():
        for port in range(preferred,preferred+(100 if auto else 1)):
            if port not in ports.values() and port_available(port):
                ports[name]=port;break
        else:raise RuntimeError(f'No free port for {name} near {preferred}; existing processes were not stopped')
    return ports

def service_urls(ports):
    return {name:f'http://127.0.0.1:{port}' for name,port in ports.items()}

def child_environment(env,name):
    """Only the AI child receives the supplier credential; frontend never receives DB secrets."""
    result=env.copy()
    if name!='ai':result.pop('DEEPSEEK_API_KEY',None)
    if name!='backend':
        for key in ['DB_PASSWORD','SPRING_DATASOURCE_PASSWORD','MYSQL_PWD']:result.pop(key,None)
    return result

def health(ports=None,quiet=False):
    for name,base in service_urls(ports or DEFAULT_PORTS).items():
        url=base+('/api/health' if name=='backend' else '/health' if name in ('ai','asr') else '')
        with urllib.request.urlopen(url,timeout=3) as response:
            data=response.read()
            if name=='backend':
                payload=json.loads(data)
                if not payload.get('data',payload)['database']['ready']:raise RuntimeError('Database is not ready')
            if not quiet:print(name,response.status)

def verify_schema(database):
    required = {path.name.split('__')[0] for path in (ROOT/'database/migrations/mysql').glob('V*.sql')}
    if not required:
        raise RuntimeError('Migration files missing; cannot verify database readiness')
    applied = set(sql(database, 'select version from schema_migration').splitlines())
    missing = sorted(required - applied)
    if missing:
        raise RuntimeError('Apply missing migrations '+', '.join(missing)+' first: python scripts/local_database.py --database '+database)


def run(database,smoke=False,auto_ports=False,open_browser=False):
    synthetic(database)
    ports=select_ports(auto_ports);urls=service_urls(ports)
    local_asr=os.environ.get('CAPTURE_VOICE_MODE')=='local'
    if local_asr:
        for port in range(8011,8111):
            if port not in ports.values() and port_available(port):ports['asr']=port;break
        else:raise RuntimeError('No local ASR port available')
        model=Path(os.environ.get('LOCAL_ASR_MODEL_DIR',''))
        if not (model/'model.int8.onnx').is_file() or not (ROOT/'services/inference-service/.venv/Scripts/python.exe').is_file():
            raise RuntimeError('Local ASR resources missing; see M11 local guide or disable local voice mode')
        urls=service_urls(ports)
    env=os.environ.copy();env.update(DB_ENABLED='true',APP_MODE='real',DB_NAME=database,DB_HOST='127.0.0.1',DB_PORT='3306',DB_USER=env.get('DB_USER') or env.get('SPRING_DATASOURCE_USERNAME','root'),DB_PASSWORD=env.get('DB_PASSWORD') or env.get('SPRING_DATASOURCE_PASSWORD',''),PORT=str(ports['backend']),AI_SERVICE_URL=urls['ai'],AI_WORKER_ENABLED='true',VITE_DATA_SOURCE='backend',VITE_API_BASE_URL=urls['backend']+'/api',AI_KB_MODE='local',AI_KB_ENABLE_OPENFDA='false',AI_KB_ENABLE_RXNAV='false')
    env.pop('VITE_USE_MOCK',None)
    if local_asr:env['LOCAL_ASR_URL']=urls['asr'];env['LOCAL_ASR_MODEL_DIR']=str(model.resolve())
    env.setdefault('RA_LLM_BUDGET_PATH',str(ROOT/'.local-evidence/ra-provider-budget.sqlite3'))
    # An empty value also prevents the AI service's .env loader from restoring a cloud key.
    env['DASHSCOPE_API_KEY']=''
    if not env['DB_PASSWORD']:raise ValueError('Set DB_PASSWORD or SPRING_DATASOURCE_PASSWORD')
    verify_schema(database)
    home=re.search(r'java.home\s*=\s*(.+)',subprocess.run(['java','-XshowSettings:properties','-version'],capture_output=True,text=True,check=True).stderr).group(1).strip()
    classpath_file=ROOT/'services/backend/target/classpath.txt'
    if not classpath_file.exists():
        mvn=shutil.which('mvn')
        if not mvn:raise RuntimeError('Maven is required to regenerate classpath after a clean backend build')
        subprocess.run([mvn,'-q','-f',str(ROOT/'services/backend/pom.xml'),'dependency:build-classpath',f'-Dmdep.outputFile={classpath_file}'],check=True)
    cp=str(ROOT/'services/backend/target/classes')+os.pathsep+classpath_file.read_text().strip()
    node=shutil.which('node');python=ROOT/'services/ai-service/.venv/Scripts/python.exe';vite=ROOT/'node_modules/vite/bin/vite.js'
    commands=[('backend',[str(Path(home)/'bin/java.exe'),'-cp',cp,'com.yaoheng.backend.BackendApplication'],ROOT),('ai',[str(python),'-m','uvicorn','app.main:app','--host','127.0.0.1','--port',str(ports['ai'])],ROOT/'services/ai-service')]
    if local_asr:commands.append(('asr',[str(ROOT/'services/inference-service/.venv/Scripts/python.exe'),'-m','uvicorn','server:app','--host','127.0.0.1','--port',str(ports['asr'])],ROOT/'services/inference-service'))
    commands.extend((name,[node,str(vite),'--host','127.0.0.1','--port',str(ports[name]),'--strictPort'],ROOT/'apps'/app) for name,app in [('mobile','mobile-app'),('doctor','doctor-web')])
    logs=ROOT/'.runtime-logs'/f'local-{os.getpid()}';logs.mkdir(parents=True,exist_ok=True);owned=[];handles=[]
    try:
        for name,command,cwd in commands:
            log=(logs/f'r1-{name}.log').open('a',encoding='utf-8');handles.append(log)
            owned.append(subprocess.Popen(command,cwd=cwd,env=child_environment(env,name),stdout=log,stderr=log))
        print(f'Source: {ROOT}\nLogs: {logs}\nStarting local services. Ctrl+C stops only these {len(commands)} owned processes.',flush=True)
        for _ in range(60):
            if any(p.poll() is not None for p in owned):raise RuntimeError(f'A service exited; inspect {logs}')
            try:health(ports,quiet=True);break
            except OSError:time.sleep(.5)
        else:raise RuntimeError('Local health check timed out')
        if any(p.poll() is not None for p in owned):raise RuntimeError(f'A service exited; inspect {logs}')
        for name,url in urls.items():print(f'READY {name}: {url}',flush=True)
        print('Keep this terminal open. Ctrl+C stops this launch.',flush=True)
        if smoke:return
        if open_browser:
            for name in ['mobile','doctor']:
                try:
                    if not webbrowser.open(urls[name],new=2):print(f'Open manually: {urls[name]}',flush=True)
                except Exception:print(f'Open manually: {urls[name]}',flush=True)
        while all(p.poll() is None for p in owned):time.sleep(.5)
        raise RuntimeError('A service exited; stopping the remaining owned services')
    except KeyboardInterrupt:print('Stopping owned services...')
    finally:
        for p in reversed(owned):
            if p.poll() is None:
                p.terminate()
                try:p.wait(timeout=10)
                except subprocess.TimeoutExpired:p.kill();p.wait(timeout=5)
        for handle in handles:handle.close()
        print('Owned services stopped.',flush=True)

def package(path):
    path=Path(path).resolve()
    if path.exists():raise ValueError('Package destination must be new')
    path.parent.mkdir(parents=True,exist_ok=True);files={}
    selected=('apps/','packages/','services/','database/','scripts/','docs/handoff/','docs/freeze/')
    names=subprocess.check_output(['git','ls-files','-z','--cached','--others','--exclude-standard'],cwd=ROOT).decode('utf-8').rstrip('\0').split('\0')
    for name in names:
        p=ROOT/name
        if p.is_file() and not name.startswith('docs/handoff/arkts/') and (name.startswith(selected) or name in ['package.json','package-lock.json','tsconfig.base.json','README.md','.gitignore','run-demo.ps1']) and not any(part.startswith('.env') for part in p.parts) and p.suffix.lower() not in ['.docx','.pdf']:
            files[name]=p
    # Rebuildable source plus the verified current production frontend artifacts.
    for app in ['mobile-app','doctor-web']:
        for p in (ROOT/'apps'/app/'dist').rglob('*'):
            if p.is_file():files[p.relative_to(ROOT).as_posix()]=p
    checks={name:hashlib.sha256(p.read_bytes()).hexdigest() for name,p in files.items()}
    with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as out:
        for name,p in files.items():out.write(p,name)
        out.writestr('MANIFEST.json',json.dumps(dict(commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),files=checks),ensure_ascii=False,indent=2))
    print('Package:',path,'SHA256:',hashlib.sha256(path.read_bytes()).hexdigest())

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['run','check','backup','restore','package']);parser.add_argument('--database',default='yaoheng_synthetic_r1');parser.add_argument('--file');parser.add_argument('--smoke',action='store_true');parser.add_argument('--auto-ports',action='store_true');parser.add_argument('--open-browser',action='store_true');args=parser.parse_args()
    if args.action in ['backup','restore','package'] and not args.file:parser.error('--file required')
    try:
        if args.action=='run':run(args.database,args.smoke,args.auto_ports,args.open_browser)
        elif args.action=='check':health()
        elif args.action=='backup':backup(args.database,args.file)
        elif args.action=='restore':restore(args.database,args.file)
        else:package(args.file)
    except Exception as error:print(type(error).__name__+': '+str(error),file=sys.stderr);sys.exit(1)
