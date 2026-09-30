"""Prepare only the selected local synthetic demo database before services start."""
import argparse
import hashlib
import uuid
from datetime import datetime
from local_database import ROOT, sql, provision
from r1_local import synthetic, backup, verify_schema


def prepare(database):
    synthetic(database)
    exists=sql(None,f"select schema_name from information_schema.schemata where schema_name='{database}'")
    pending=[]
    if exists:
        tables=set(sql(database,'show tables').splitlines())
        versions=set(sql(database,'select version from schema_migration').splitlines()) if 'schema_migration' in tables else set()
        checksums=dict(line.split('\t',1) for line in sql(database,'select version,sha256 from migration_checksum').splitlines()) if 'migration_checksum' in tables else {}
        for path in sorted((ROOT/'database/migrations/mysql').glob('V*.sql')):
            version=path.name.split('__')[0]
            if version in versions:
                if checksums.get(version)!=hashlib.sha256(path.read_text(encoding='utf-8').encode()).hexdigest():
                    raise RuntimeError(version+': migration checksum missing or changed; refusing automatic upgrade')
            else:pending.append(version)
        if not pending:
            verify_schema(database)
            print('Demo schema is current; existing data unchanged.',flush=True)
            return
        destination=ROOT/'.runtime-logs'/'startup-backups'/(database+'-'+datetime.now().strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:8]+'.sql')
        print('Pending demo migrations: '+', '.join(pending)+'. Backing up before upgrade.',flush=True)
        backup(database,destination)  # A failed backup must prevent all migration writes.
    provision(database)
    verify_schema(database)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--database',required=True)
    prepare(parser.parse_args().database)
