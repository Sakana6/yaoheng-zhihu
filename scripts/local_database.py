"""Dedicated synthetic MySQL setup. Credentials are read only from environment."""
import argparse
import hashlib
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
BIN = Path(os.environ.get('MYSQL_BIN', r'C:\Program Files\MySQL\MySQL Server 9.6\bin'))

def sql(database, text):
    env = os.environ.copy()
    env['MYSQL_PWD'] = env.get('DB_PASSWORD') or env.get('SPRING_DATASOURCE_PASSWORD', '')
    if not env['MYSQL_PWD']:
        raise RuntimeError('Set DB_PASSWORD or SPRING_DATASOURCE_PASSWORD')
    args = [str(BIN / 'mysql.exe'), '-h', '127.0.0.1', '-u', env.get('DB_USER', env.get('SPRING_DATASOURCE_USERNAME', 'root')), '--default-character-set=utf8mb4', '--batch', '--skip-column-names']
    if database:
        args.append(database)
    result = subprocess.run(args, input=text, text=True, encoding='utf-8', capture_output=True, env=env)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()

def provision(database):
    if not re.fullmatch(r'yaoheng_synthetic_[a-z0-9_]+', database):
        raise ValueError('Only dedicated yaoheng_synthetic_* databases are allowed')
    sql(None, f'create database if not exists `{database}` character set utf8mb4;')
    sql(database, 'create table if not exists schema_migration(version varchar(64) primary key, applied_at datetime(6) not null default current_timestamp(6)); create table if not exists migration_checksum(version varchar(64) primary key, sha256 char(64) not null);')
    for migration in sorted((ROOT / 'database/migrations/mysql').glob('V*.sql')):
        version = migration.name.split('__')[0]
        content = migration.read_text(encoding='utf-8')
        digest = hashlib.sha256(content.encode()).hexdigest()
        existing = sql(database, f"select sha256 from migration_checksum where version='{version}'")
        if existing:
            if existing != digest:
                raise RuntimeError(f'{version}: checksum mismatch; do not edit applied migrations')
            print(f'{version}: checksum verified, skipped')
            continue
        sql(database, content)
        sql(database, f"insert into schema_migration(version) values('{version}'); insert into migration_checksum values('{version}','{digest}');")
        print(f'{version}: applied')
    # Synthetic credentials only; database root credentials never enter the seed.
    salt = b'yaoheng-local-synthetic-v1'
    password = 'Trial-2026!'
    hashed = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 210000).hex()
    encoded = f'pbkdf2$210000${salt.hex()}${hashed}'
    sql(database, f"""
      update user_account set password_hash='{encoded}' where id in (1,2) and password_hash is null;
      insert ignore into user_account(id,mobile,nickname,role,password_hash) values(3,'13800000003','合成家属乙','CAREGIVER','{encoded}');
      insert ignore into patient(id,name,gender,birthday,living_status,digital_ability_level,created_by) values(2,'合成患者乙','MALE','1950-01-01','WITH_FAMILY','LOW',3);
      insert ignore into patient_caregiver_relation(id,patient_id,user_id,relation_type,is_primary) values(2,2,3,'FAMILY',true);
      insert ignore into patient(id,name,gender,birthday,living_status,digital_ability_level,created_by) values(3,'合成患者丙','FEMALE','1955-01-01','WITH_FAMILY','LOW',1);
      insert ignore into patient_caregiver_relation(id,patient_id,user_id,relation_type,is_primary) values(3,3,1,'FAMILY',false);
      insert ignore into patient_doctor_relation values(1,2,current_timestamp);
    """)
    print('Synthetic accounts provisioned; no existing application databases modified')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--database', default='yaoheng_synthetic_r1')
    args = parser.parse_args()
    provision(args.database)
