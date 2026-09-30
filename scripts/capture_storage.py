"""Offline local evidence operations. Never stores credentials or deletes clinical facts."""
import argparse, hashlib, json, os, re, tempfile, zipfile
from pathlib import Path
from local_database import sql
from r1_local import backup as db_backup, restore as db_restore, synthetic

def rows(database):
    raw=sql(synthetic(database),"select concat(patient_id,'/',content_hash,'.bin') from capture_task where kind='IMAGE' and file_deleted=false")
    return [s for s in raw.splitlines() if s]

def safe(root, relative):
    if not re.fullmatch(r'[1-9][0-9]*/[a-f0-9]{64}\.bin',relative):raise ValueError('Invalid evidence key')
    target=root/relative
    for item in [target,*target.parents]:
        if item.is_symlink():raise ValueError('Symlink is not allowed')
    if not target.resolve().is_relative_to(root.resolve()):raise ValueError('Evidence escapes root')
    return target

def backup(database, root, destination):
    root=Path(root).resolve();destination=Path(destination).resolve()
    if destination.exists():raise ValueError('Backup destination must be new')
    files={}
    for relative in rows(database):
        data=safe(root,relative).read_bytes()
        if hashlib.sha256(data).hexdigest()!=Path(relative).stem:raise ValueError('Evidence hash mismatch')
        files['evidence/'+relative]=data
    with tempfile.TemporaryDirectory() as temporary:
        dump=Path(temporary)/'database.sql';db_backup(database,dump)
        files['database.sql']=dump.read_bytes();files['database.json']=dump.with_suffix('.json').read_bytes()
    manifest=dict(version=1,database=database,files={name:hashlib.sha256(data).hexdigest() for name,data in files.items()})
    destination.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(destination,'x',zipfile.ZIP_DEFLATED) as archive:
        for name,data in files.items():archive.writestr(name,data)
        archive.writestr('manifest.json',json.dumps(manifest))
    print('PASS capture backup: database +',len(files)-2,'verified images')

def restore(database, root, source):
    synthetic(database);root=Path(root).absolute()
    if root.exists():raise ValueError('Restore requires a new evidence directory')
    with zipfile.ZipFile(source) as archive:
        manifest=json.loads(archive.read('manifest.json'));files={}
        if manifest.get('version')!=1:raise ValueError('Unsupported backup version')
        if set(archive.namelist())!=set(manifest['files'])|{'manifest.json'} or len(archive.namelist())!=len(set(archive.namelist())):raise ValueError('Unexpected archive entries')
        for name,digest in manifest['files'].items():
            if name not in ('database.sql','database.json'):
                if not name.startswith('evidence/'):raise ValueError('Unknown backup path')
                safe(root,name[9:])
            data=archive.read(name)
            if hashlib.sha256(data).hexdigest()!=digest:raise ValueError('Backup hash mismatch')
            if name.startswith('evidence/') and digest!=Path(name).stem:raise ValueError('Evidence content hash mismatch')
            files[name]=data
    # Verify the entire archive before creating the database or output directory.
    with tempfile.TemporaryDirectory() as temporary:
        dump=Path(temporary)/'database.sql';dump.write_bytes(files['database.sql']);dump.with_suffix('.json').write_bytes(files['database.json'])
        db_restore(database,dump)
    root.mkdir(parents=True)
    for name,data in files.items():
        if name.startswith('evidence/'):
            target=safe(root,name[9:]);target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
    expected=set(rows(database));actual={str(p.relative_to(root)).replace('\\','/') for p in root.glob('*/*.bin')}
    if expected!=actual:raise ValueError('Restored database and evidence do not match')
    print('PASS capture restore: all active evidence reconciled')

def cleanup(database, root):
    import time
    root=Path(root).resolve();retained=set(rows(database));removed=0
    for path in root.glob('*/*'):
        relative=path.relative_to(root).as_posix()
        if path.is_symlink():raise ValueError('Symlink is not allowed')
        # Interrupted upload temporary files and unreferenced content: grace period one day.
        if time.time()-path.stat().st_mtime<86400:continue
        if re.fullmatch(r'[1-9][0-9]*/[a-f0-9]{64}\.bin',relative) and relative not in retained:
            safe(root,relative).unlink();removed+=1
        elif re.fullmatch(r'[1-9][0-9]*/upload-[a-zA-Z0-9_-]+\.tmp',relative):path.unlink();removed+=1
    print('PASS orphan cleanup:',removed,'files; retained metadata and medication facts')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['backup','restore','cleanup']);parser.add_argument('--database',required=True);parser.add_argument('--root',required=True);parser.add_argument('--file');parser.add_argument('--offline',action='store_true',required=True,help='Confirm application writers are stopped for a consistent snapshot')
    args=parser.parse_args()
    if args.action in ('backup','restore') and not args.file:parser.error('--file required')
    if args.action=='backup':backup(args.database,args.root,args.file)
    elif args.action=='restore':restore(args.database,args.root,args.file)
    else:cleanup(args.database,args.root)
