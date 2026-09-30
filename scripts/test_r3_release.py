"""Build and exercise an extracted R3 source archive with fresh project dependencies."""
import argparse, hashlib, json, subprocess, sys, uuid, zipfile
from pathlib import Path
from local_database import ROOT
from r1_local import package


def run(out):
    out.mkdir(parents=True,exist_ok=True)
    work=ROOT/'.runtime-logs'/('r3-release-'+uuid.uuid4().hex[:8]);work.mkdir(parents=True)
    archive=work/'r3-candidate.zip';package(archive);clean=work/'clean';clean.mkdir()
    with zipfile.ZipFile(archive) as z:
        manifest=json.loads(z.read('MANIFEST.json'))
        for name,digest in manifest['files'].items():
            assert hashlib.sha256(z.read(name)).hexdigest()==digest
            assert not name.startswith(('docs/handoff/arkts/','.Harmony/','.harmony/'))
            assert not any(p in ('node_modules','.venv','target') or p.startswith('.env') for p in Path(name).parts)
        z.extractall(clean)
    checks=[]
    def check(name,command,cwd=clean):
        print('START '+name,flush=True)
        result=subprocess.run(command,cwd=cwd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        (out/(name+'.txt')).write_bytes(result.stdout);checks.append(dict(name=name,exitCode=result.returncode,command=command))
        (out/'results.json').write_text(json.dumps(checks,indent=2),encoding='utf-8')
        if result.returncode:raise RuntimeError(name+' failed')
        print('PASS '+name,flush=True)
    check('npm-install',['npm.cmd','ci','--no-audit','--no-fund'])
    check('ai-install',['uv','sync','--frozen'],clean/'services/ai-service')
    check('backend-build',['mvn.cmd','-q','-f','services/backend/pom.xml','clean','test-compile'])
    check('backend-classpath',['mvn.cmd','-q','-f','services/backend/pom.xml','dependency:build-classpath','-Dmdep.outputFile=target/classpath.txt'])
    check('mobile-build',['npm.cmd','run','build:mobile']);check('doctor-build',['npm.cmd','run','build:doctor'])
    python=str(clean/'services/ai-service/.venv/Scripts/python.exe')
    check('ai-tests',[python,'-m','pytest','tests','-q'],clean/'services/ai-service')
    check('replay',[python,'scripts/replay_r3_delivery.py','--out',str(out/'replay')])
    check('reports-integration',[sys.executable,'scripts/test_r3_reports.py','--out',str(out/'integration')])
    database=json.loads((out/'integration/receipt.json').read_text())['database']
    check('four-service-smoke',[sys.executable,'scripts/r1_local.py','run','--database',database,'--auto-ports','--smoke'])
    receipt=dict(archive=str(archive),cleanDirectory=str(clean),sha256=hashlib.sha256(archive.read_bytes()).hexdigest(),sourceBaseCommit=manifest['commit'],sourceFiles=manifest['files'],freshProjectDependencies=True,sharedMachineToolchains=True,status='PASS')
    (out/'receipt.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')
    print('PASS extracted R3 archive: fresh dependencies, builds, AI, replay, real reports and four-service launch')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--out',type=Path,required=True);run(parser.parse_args().out.resolve())
