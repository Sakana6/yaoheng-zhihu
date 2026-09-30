"""V011 -> V012 additive upgrade against a fresh, dedicated synthetic database."""
import json
import shutil
import tempfile
import uuid
from pathlib import Path
import local_database as db


def run(output=None):
    root=db.ROOT
    name='yaoheng_synthetic_r3_upgrade_'+uuid.uuid4().hex[:8]
    with tempfile.TemporaryDirectory(prefix='yaoheng-r3-upgrade-') as directory:
        temporary=Path(directory);migrations=temporary/'database/migrations/mysql';migrations.mkdir(parents=True)
        for file in (root/'database/migrations/mysql').glob('V*.sql'):
            if file.name.split('__')[0]<='V011':shutil.copy2(file,migrations/file.name)
        try:
            db.ROOT=temporary;db.provision(name)
        finally:db.ROOT=root
        before=db.sql(name,'select * from patient_medication order by id')
        assert db.sql(name,"select count(*) from schema_migration where version='V012'")=='0'
        db.provision(name);db.provision(name)
        assert db.sql(name,'select * from patient_medication order by id')==before
        assert db.sql(name,"select count(*) from schema_migration where version='V012'")=='1'
        assert db.sql(name,'select count(*) from r3_inquiry_context')=='0'
    directory=output or root/'docs/handoff/evidence/R3-M9-2026-09-30'
    directory.mkdir(parents=True,exist_ok=True)
    out=directory/'upgrade.json'
    out.write_text(json.dumps(dict(database=name,fromVersion='V011',toVersion='V012',medicationRowsUnchanged=True,repeatedMigration=True,status='PASS'),indent=2),encoding='utf-8')
    print('PASS actual V011 to V012 upgrade, existing medication rows unchanged, repeated migration')


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--out',type=Path)
    run(parser.parse_args().out)
