import sqlite3,os,time
from pathlib import Path
folder=Path('/var/lib/lume/backups');folder.mkdir(mode=0o700,exist_ok=True)
name=folder/time.strftime('database-%Y-%m-%d.sqlite')
source=sqlite3.connect('/var/lib/lume/lume.sqlite');target=sqlite3.connect(name);source.backup(target);target.close();source.close()
os.chmod(name,0o600)
for old in folder.glob('database-*.sqlite'):
 if old.stat().st_mtime<time.time()-14*86400:old.unlink()
