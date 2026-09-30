"""Windows portable distribution launcher. No installed development tools required."""
import argparse
import ctypes
import getpass
import hashlib
import http.client
import http.server
import json
import os
from pathlib import Path
import secrets
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / 'runtime'
DATA = ROOT / 'data'
DB = 'yaoheng_synthetic_portable'


def job_guard():
    # A Windows job owns only this launcher's child processes. Closing the console
    # cannot leave a database/ASR worker behind or stop another user's service.
    from ctypes import wintypes as w
    class Basic(ctypes.Structure):
        _fields_ = [('ProcessTime',ctypes.c_longlong),('JobTime',ctypes.c_longlong),('Flags',w.DWORD),('Min',ctypes.c_size_t),('Max',ctypes.c_size_t),('Active',w.DWORD),('Affinity',ctypes.c_size_t),('Priority',w.DWORD),('Scheduling',w.DWORD)]
    class IO(ctypes.Structure):
        _fields_ = [(n,ctypes.c_ulonglong) for n in ('ReadOps','WriteOps','OtherOps','ReadBytes','WriteBytes','OtherBytes')]
    class Extended(ctypes.Structure):
        _fields_ = [('Basic',Basic),('IO',IO),('ProcessMemory',ctypes.c_size_t),('JobMemory',ctypes.c_size_t),('PeakProcess',ctypes.c_size_t),('PeakJob',ctypes.c_size_t)]
    k = ctypes.WinDLL('kernel32',use_last_error=True)
    k.CreateJobObjectW.restype=w.HANDLE
    k.SetInformationJobObject.argtypes=[w.HANDLE,ctypes.c_int,ctypes.c_void_p,w.DWORD]
    k.AssignProcessToJobObject.argtypes=[w.HANDLE,w.HANDLE]
    k.GetCurrentProcess.restype=w.HANDLE
    handle=k.CreateJobObjectW(None,None)
    info=Extended();info.Basic.Flags=0x2000
    if not handle or not k.SetInformationJobObject(handle,9,ctypes.byref(info),ctypes.sizeof(info)) or not k.AssignProcessToJobObject(handle,k.GetCurrentProcess()):
        raise ctypes.WinError(ctypes.get_last_error())
    return handle


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1',0)); return s.getsockname()[1]


def clean_env():
    names=('SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMDATA')
    env={k:os.environ[k] for k in names if k in os.environ}
    env.update(PATH=str(Path(os.environ['SYSTEMROOT'])/'System32'),PYTHONUTF8='1',PYTHONNOUSERSITE='1',PYTHONDONTWRITEBYTECODE='1')
    return env


def wait_until(fn,processes,seconds=120):
    deadline=time.monotonic()+seconds
    while time.monotonic()<deadline:
        if any(p.poll() is not None for p in processes):raise RuntimeError('A bundled service exited; inspect data/logs.')
        try:
            value=fn()
            if value:return value
        except (OSError,ValueError,RuntimeError,subprocess.SubprocessError):pass
        time.sleep(.3)
    raise RuntimeError('Startup timed out; inspect data/logs.')


def site(directory,backend):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(directory),**kwargs)
        def log_message(self,*args):pass
        def proxy(self):
            if self.headers.get('Transfer-Encoding'):self.send_error(400);return
            size=int(self.headers.get('Content-Length','0'))
            if not 0<=size<=8*1024*1024:self.send_error(413);return
            connection=http.client.HTTPConnection('127.0.0.1',backend,timeout=95)
            try:
                headers={k:v for k,v in self.headers.items() if k.lower() not in ('host','connection','transfer-encoding')}
                connection.request(self.command,self.path,body=self.rfile.read(size) if size else None,headers=headers)
                r=connection.getresponse();body=r.read();self.send_response(r.status)
                for k,v in r.getheaders():
                    if k.lower() not in ('connection','transfer-encoding','content-length'):self.send_header(k,v)
                self.send_header('Content-Length',str(len(body)));self.end_headers()
                if self.command!='HEAD':self.wfile.write(body)
            except (OSError,http.client.HTTPException):self.send_error(502,'Local backend unavailable')
            finally:connection.close()
        def do_GET(self):
            if self.path.startswith('/api/') or self.path=='/api':return self.proxy()
            if not Path(self.translate_path(self.path)).exists():self.path='/index.html'
            return super().do_GET()
        def do_HEAD(self):
            if self.path.startswith('/api/'):return self.proxy()
            return super().do_HEAD()
        do_POST=do_PUT=do_PATCH=do_DELETE=do_OPTIONS=proxy
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    return server


def run(args):
    guard=job_guard()
    DATA.mkdir(exist_ok=True)
    # Refuse a second launcher before touching credentials or database files.
    import msvcrt
    lock=(DATA/'launcher.lock').open('a+b');lock.seek(0)
    try:msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
    except OSError:raise RuntimeError('This portable directory is already running.')
    logs=DATA/'logs';logs.mkdir(exist_ok=True)
    credentials=DATA/'database-credential.json'
    if credentials.exists():password=json.loads(credentials.read_text())['password']
    else:
        password=secrets.token_hex(24)
        credentials.write_text(json.dumps({'password':password}),encoding='utf-8')
    dbdir=DATA/'mysql'
    mysql=RUNTIME/'mysql/bin/mysql.exe'
    mysqld=RUNTIME/'mysql/bin/mysqld.exe'
    ports=set()
    while len(ports)<4:ports.add(free_port())
    dbport,backend,ai,asr=sorted(ports)
    processes=[];handles=[];servers=[]
    env=clean_env()
    def start(name,cmd,cwd,extra=None):
        log=(logs/(name+'.log')).open('w',encoding='utf-8');handles.append(log)
        child=dict(env,**(extra or {}))
        p=subprocess.Popen([str(x) for x in cmd],cwd=cwd,env=child,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW)
        processes.append(p);return p
    def sql(database,text):
        cmd=[str(mysql),'--no-defaults','--protocol=TCP','-h127.0.0.1',f'-P{dbport}','-uroot','--default-character-set=utf8mb4','--batch','--skip-column-names']
        if database:cmd.append(database)
        r=subprocess.run(cmd,input=text,text=True,encoding='utf-8',capture_output=True,env=dict(env,MYSQL_PWD=password),timeout=60,creationflags=subprocess.CREATE_NO_WINDOW)
        if r.returncode:raise RuntimeError('Portable database operation failed: '+r.stderr.replace(password,'[redacted]'))
        return r.stdout.strip()
    init=DATA/'mysql-init.sql'
    try:
        if not (dbdir/'mysql').exists():
            print('Initializing isolated synthetic database (first launch)...',flush=True)
            with (logs/'mysql-initialize.log').open('w') as log:
                subprocess.run([str(mysqld),'--no-defaults','--initialize-insecure',f'--basedir={RUNTIME/"mysql"}',f'--datadir={dbdir}'],env=env,stdout=log,stderr=log,check=True,timeout=180,creationflags=subprocess.CREATE_NO_WINDOW)
        init.write_text(f"ALTER USER 'root'@'localhost' IDENTIFIED BY '{password}';\n",encoding='utf-8')
        start('mysql',[mysqld,'--no-defaults',f'--basedir={RUNTIME/"mysql"}',f'--datadir={dbdir}',f'--port={dbport}','--bind-address=127.0.0.1','--mysqlx=0','--local-infile=0',f'--init-file={init}','--innodb-buffer-pool-size=64M'],ROOT)
        wait_until(lambda:sql(None,'select 1')=='1',processes)
        init.unlink(missing_ok=True)
        sys.path.insert(0,str(ROOT/'scripts'))
        import local_database
        local_database.sql=sql
        local_database.provision(DB)
        key=os.getenv('DEEPSEEK_API_KEY','') if args.key_env else ''
        if args.ask_key:key=getpass.getpass('DeepSeek API key (blank = offline): ').strip()
        ai_env=dict(RA_ENABLED='true',RA_LLM_ENABLED='true' if key else 'false',AI_KB_MODE='local',AI_KB_ENABLE_OPENFDA='false',AI_KB_ENABLE_RXNAV='false',DASHSCOPE_API_KEY='',RA_LLM_BUDGET_PATH=str(DATA/'provider-budget.sqlite3'))
        if key:ai_env['DEEPSEEK_API_KEY']=key
        start('ai',[RUNTIME/'python-ai/python.exe','-m','uvicorn','app.main:app','--host','127.0.0.1','--port',ai],ROOT/'services/ai-service',ai_env)
        voice=(RUNTIME/'asr-model/model.int8.onnx').exists() and not args.no_asr
        if voice:start('asr',[RUNTIME/'python-asr/python.exe','-m','uvicorn','server:app','--host','127.0.0.1','--port',asr],ROOT/'services/inference-service',dict(LOCAL_ASR_MODEL_DIR=str(RUNTIME/'asr-model')))
        backend_env=dict(DB_ENABLED='true',APP_MODE='real',DB_HOST='127.0.0.1',DB_PORT=str(dbport),DB_NAME=DB,DB_USER='root',DB_PASSWORD=password,PORT=str(backend),AI_SERVICE_URL=f'http://127.0.0.1:{ai}',AI_WORKER_ENABLED='true',RA_ENABLED='true',R3_REPORT_ENABLED='true',CAPTURE_OCR_MODE='deepseek' if key else 'disabled',CAPTURE_VOICE_MODE='local' if voice else 'disabled',CAPTURE_STORAGE_ROOT=str(DATA/'captures'),LOCAL_ASR_URL=f'http://127.0.0.1:{asr}')
        start('backend',[RUNTIME/'java/bin/java.exe','-cp',str(ROOT/'services/backend/target/classes')+os.pathsep+str(RUNTIME/'java-libs/*'),'com.yaoheng.backend.BackendApplication'],ROOT,backend_env)
        urls={}
        for name,folder in [('mobile','mobile-app'),('doctor','doctor-web')]:
            server=site(ROOT/'apps'/folder/'dist',backend);servers.append(server);urls[name]=f'http://127.0.0.1:{server.server_port}'
        def fetch(url):
            with urllib.request.urlopen(url,timeout=3) as response:return json.load(response)
        wait_until(lambda:fetch(f'http://127.0.0.1:{ai}/health'),processes)
        if voice:wait_until(lambda:fetch(f'http://127.0.0.1:{asr}/health')['modelReady'],processes)
        def backend_ready():
            result=fetch(urls['mobile']+'/api/health')
            return result.get('data',result)['database']['ready']
        wait_until(backend_ready,processes)
        receipt=dict(urls=urls,ports=dict(db=dbport,backend=backend,ai=ai,asr=asr if voice else None),pids=[p.pid for p in processes],mode='deepseek' if key else 'offline',asr=voice)
        (DATA/'ready.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')
        print('READY '+json.dumps(receipt),flush=True)
        print('Synthetic login: 13800000001 (family), 13800000002 (doctor); password: Trial-2026!\nKeep this window open. Ctrl+C stops this instance.',flush=True)
        if not args.no_browser:
            for url in urls.values():webbrowser.open(url)
        if args.smoke:return
        stop=DATA/'STOP'
        while not stop.exists():
            if any(p.poll() is not None for p in processes):raise RuntimeError('A service exited; inspect data/logs.')
            time.sleep(.5)
        stop.unlink()
    except KeyboardInterrupt:print('Stopping owned services...',flush=True)
    finally:
        init.unlink(missing_ok=True)
        (DATA/'ready.json').unlink(missing_ok=True)
        for s in servers:s.shutdown();s.server_close()
        if processes:
            try:sql(None,'SHUTDOWN')
            except Exception:pass
        for p in reversed(processes):
            if p.poll() is None:
                p.terminate()
                try:p.wait(timeout=12)
                except subprocess.TimeoutExpired:p.kill();p.wait()
        for h in handles:h.close()
        lock.close()
        print('Owned services stopped. Your data remains in data/.',flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--ask-key',action='store_true');p.add_argument('--key-env',action='store_true');p.add_argument('--no-browser',action='store_true');p.add_argument('--no-asr',action='store_true');p.add_argument('--smoke',action='store_true')
    try:run(p.parse_args())
    except Exception as e:print('ERROR: '+str(e),file=sys.stderr);sys.exit(1)
