"""M7: clean source archive, fresh dependencies, real upgrade and local smoke.
Only dedicated synthetic databases and a new .runtime-logs directory are used.
"""
import hashlib,json,os,shutil,socket,subprocess,sys,tempfile,time,urllib.request,urllib.error,uuid,zipfile
from pathlib import Path
import local_database as db
import r1_local as local
ROOT=db.ROOT
OUT=ROOT/'.runtime-logs/r2-release-evidence'

def run():
    OUT.mkdir(parents=True,exist_ok=True)
    work=ROOT/'.runtime-logs'/('r2-release-'+uuid.uuid4().hex[:8]);work.mkdir(parents=True)
    checks=[]
    def check(name,command,cwd=ROOT):
        print('START '+name,flush=True)
        done=subprocess.run(command,cwd=cwd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        (OUT/(name+'.txt')).write_bytes(done.stdout)
        checks.append(dict(name=name,command=command,cwd=str(cwd),exitCode=done.returncode))
        (OUT/'release-results.json').write_text(json.dumps(checks,indent=2),encoding='utf-8')
        if done.returncode:raise RuntimeError(name+' failed; see evidence')
        print('PASS '+name,flush=True)
    # An actual V009 database, not a current database with version markers removed.
    database='yaoheng_synthetic_m7_'+uuid.uuid4().hex[:8]
    with tempfile.TemporaryDirectory() as temporary:
        legacy=Path(temporary);migrations=legacy/'database/migrations/mysql';migrations.mkdir(parents=True)
        for path in (ROOT/'database/migrations/mysql').glob('V*.sql'):
            if int(path.name[1:4])<=9:shutil.copy2(path,migrations/path.name)
        db.ROOT=legacy
        try:db.provision(database)
        finally:db.ROOT=ROOT
    before=db.sql(database,'select * from patient_medication order by id')
    try:local.verify_schema(database);raise AssertionError('Old schema accepted')
    except RuntimeError as error:assert 'V010' in str(error) and 'V011' in str(error)
    local.backup(database,work/'before-upgrade.sql')
    db.provision(database);db.provision(database);local.verify_schema(database)
    assert db.sql(database,'select * from patient_medication order by id')==before
    assert db.sql(database,'select count(*) from capture_task')=='0'
    restored=database+'_oldrestore';local.restore(restored,work/'before-upgrade.sql');db.provision(restored)
    assert db.sql(restored,'select * from patient_medication order by id')==before
    (OUT/'upgrade.json').write_text(json.dumps(dict(database=database,restoredDatabase=restored,fromVersion='V009',toVersion='V011',rowsPreserved=True,repeatedMigration=True,oldSchemaRejected=True,backupRestoreThenUpgrade=True),indent=2),encoding='utf-8')
    print('PASS actual V009 upgrade, preserved rows, backup recovery and repeated migration',flush=True)
    archive=work/'r2-source.zip';local.package(archive)
    clean=work/'clean';clean.mkdir()
    with zipfile.ZipFile(archive) as z:
        manifest=json.loads(z.read('MANIFEST.json'))
        for name,digest in manifest['files'].items():
            assert hashlib.sha256(z.read(name)).hexdigest()==digest,name
            assert not name.startswith('docs/handoff/arkts/') and '.env' not in Path(name).parts
        assert any(any(ord(c)>127 for c in n) and n.endswith('.png') for n in manifest['files'])
        z.extractall(clean)
    assert not (clean/'node_modules').exists() and not (clean/'services/backend/target').exists() and not (clean/'services/ai-service/.venv').exists()
    check('clean-npm-install',['npm.cmd','ci','--no-audit','--no-fund'],clean)
    check('clean-ai-install',['uv','sync','--frozen'],clean/'services/ai-service')
    check('clean-backend-build',['mvn.cmd','-q','-f','services/backend/pom.xml','clean','compile'],clean)
    check('clean-mobile-build',['npm.cmd','run','build:mobile'],clean)
    check('clean-doctor-build',['npm.cmd','run','build:doctor'],clean)
    check('clean-four-service-smoke',[sys.executable,'scripts/r1_local.py','run','--database',database,'--auto-ports','--smoke'],clean)
    # This uses the extracted source, its new Java classes, and its packaged fixtures.
    check('clean-capture-integration',[sys.executable,'scripts/test_capture_integration.py'],clean)
    check('clean-disabled-fallback',[sys.executable,'scripts/test_capture_disabled.py','--database',database],clean)
    receipt=dict(sourceCommit=manifest['commit'],archive=str(archive),sha256=hashlib.sha256(archive.read_bytes()).hexdigest(),cleanDirectory=str(clean),database=database,sharedMachineToolchains=True,freshProjectDependencies=True)
    (OUT/'clean-package-receipt.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')
    print('PASS M7 clean archive build/start/capture/fallback; own services stopped',flush=True)
if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--out',type=Path,default=OUT)
    OUT=parser.parse_args().out.resolve();run()
