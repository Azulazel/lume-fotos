import os, sqlite3, json, time, secrets, hashlib, hmac, uuid, math, shutil, io, threading
from pathlib import Path
from contextlib import contextmanager
import numpy as np
import httpx
from PIL import Image
from fastapi import FastAPI, Request, HTTPException, UploadFile, File, Form, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
DATA=Path(os.environ.get('LUME_DATA','/var/lib/lume')); DATA.mkdir(parents=True,exist_ok=True)
PHOTOS=DATA/'photos'; PHOTOS.mkdir(exist_ok=True)
SECRET=os.environ['LUME_SECRET'].encode(); BASE=os.environ.get('PUBLIC_URL','https://lume.163.176.48.125.sslip.io')
LOCK=threading.RLock()
@contextmanager
def connect():
 c=sqlite3.connect(DATA/'lume.sqlite',timeout=30); c.row_factory=sqlite3.Row;c.execute('PRAGMA foreign_keys=ON')
 try: yield c;c.commit()
 except: c.rollback();raise
 finally:c.close()
with connect() as c:
 c.executescript('''PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE,password TEXT);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires INTEGER);
 CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,name TEXT NOT NULL,slug TEXT UNIQUE,event_date TEXT,published INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS photos(id TEXT PRIMARY KEY,event_id TEXT REFERENCES events(id) ON DELETE CASCADE,name TEXT,path TEXT UNIQUE,face_count INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS faces(id INTEGER PRIMARY KEY,photo_id TEXT REFERENCES photos(id) ON DELETE CASCADE,event_id TEXT REFERENCES events(id) ON DELETE CASCADE,descriptor BLOB);
 CREATE INDEX IF NOT EXISTS faces_event ON faces(event_id);
 CREATE INDEX IF NOT EXISTS photos_event ON photos(event_id);
 CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY,window INTEGER,n INTEGER);
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);
 ''')
app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)
app.add_middleware(CORSMiddleware,allow_origins=['https://azulazel.github.io',BASE,'http://127.0.0.1:4173'],allow_methods=['GET','POST','PATCH','DELETE'],allow_headers=['Authorization','Content-Type'])
@app.middleware('http')
async def headers(req,call_next):
 if int(req.headers.get('content-length','0') or 0)>17*1024*1024: return __import__('starlette.responses',fromlist=['JSONResponse']).JSONResponse({'detail':'Arquivo muito grande'},413)
 response=await call_next(req);response.headers['Cache-Control']='no-store';response.headers['X-Content-Type-Options']='nosniff';return response

def digest(value):return hashlib.sha256(value.encode()).hexdigest()
def password_hash(value,salt=None):
 salt=salt or secrets.token_hex(16)
 return salt+':'+hashlib.pbkdf2_hmac('sha256',value.encode(),bytes.fromhex(salt),600000).hex()
def rate(req,scope,maximum):
 key=digest(scope+':'+(req.client.host if req.client else 'unknown'));now=int(time.time())
 with connect() as c:
  c.execute('DELETE FROM limits WHERE window < ?', (now-3600,))
  c.execute('INSERT INTO limits VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET n=CASE WHEN window<? THEN 1 ELSE n+1 END,window=CASE WHEN window<? THEN ? ELSE window END',(key,now,now-60,now-60,now))
  if c.execute('SELECT n FROM limits WHERE key=?',(key,)).fetchone()[0]>maximum: raise HTTPException(429,'Muitas tentativas. Aguarde um minuto.')
def admin(req:Request):
 token=req.headers.get('authorization','').removeprefix('Bearer ')
 with connect() as c:r=c.execute('SELECT u.id,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?',(digest(token),time.time())).fetchone()
 if not r: raise HTTPException(401,'Entre novamente no painel.')
 return dict(r)
def vector(values):
 if not isinstance(values,list) or len(values)!=128 or any(type(x) not in (float,int) or not math.isfinite(x) or abs(x)>2 for x in values):raise HTTPException(400,'Descritor inválido.')
 return np.asarray(values,dtype='<f4')
def photo_url(p):
 expires=int(time.time())+600;signature=hmac.new(SECRET,(p['id']+':'+str(expires)).encode(),hashlib.sha256).hexdigest()
 return BASE+'/api/media/'+p['id']+'?expires='+str(expires)+'&signature='+signature
class Login(BaseModel):email:str=Field(max_length=254);password:str=Field(min_length=6,max_length=256)
class Event(BaseModel):name:str=Field(min_length=1,max_length=100);event_date:str;slug:str=Field(min_length=1,max_length=120)
class Publish(BaseModel):published:bool
class Search(BaseModel):event:str=Field(max_length=120);descriptor:list[float]=Field(min_length=128,max_length=128)

# One-time, read-only migration. Only an existing Supabase admin can bootstrap.
def bootstrap(email,password):
 url=os.environ.get('LEGACY_URL');key=os.environ.get('LEGACY_ANON')
 if not url or not key:raise HTTPException(401,'Conta não encontrada.')
 with httpx.Client(timeout=90) as client:
  r=client.post(url+'/auth/v1/token?grant_type=password',headers={'apikey':key},json={'email':email,'password':password})
  if r.status_code!=200:raise HTTPException(401,'E-mail ou senha inválidos.')
  auth=r.json();headers={'apikey':key,'Authorization':'Bearer '+auth['access_token']};uid=auth['user']['id']
  check=client.get(url+'/rest/v1/admins',headers=headers,params={'user_id':'eq.'+uid,'select':'user_id'});check.raise_for_status()
  if not check.json():raise HTTPException(403,'Esta conta não é administradora.')
  def rows(table):
   allrows=[];offset=0
   while True:
    res=client.get(url+'/rest/v1/'+table,headers=headers,params={'select':'*','limit':500,'offset':offset,'order':'id.asc'});res.raise_for_status();batch=res.json();allrows.extend(batch)
    if len(batch)<500:return allrows
    offset+=500
  events=rows('events');photos=rows('photos');faces=rows('faces')
  # Download to private disk before committing the entire database transaction.
  for p in photos:
   target=PHOTOS/p['id']
   if not target.exists():
    image=client.get(url+'/storage/v1/object/authenticated/event-photos/'+p['storage_path'],headers=headers);image.raise_for_status()
    if shutil.disk_usage(DATA).free<len(image.content)+2*1024**3:raise HTTPException(507,'Espaço insuficiente para migrar.')
    temp=target.with_suffix('.tmp');temp.write_bytes(image.content);temp.replace(target)
  with connect() as c:
   for e in events:c.execute('INSERT OR IGNORE INTO events(id,name,slug,event_date,published,created_at) VALUES(?,?,?,?,?,?)',(e['id'],e['name'],e['slug'],e['event_date'],int(e['published']),e['created_at']))
   for p in photos:c.execute('INSERT OR IGNORE INTO photos(id,event_id,name,path,face_count,created_at) VALUES(?,?,?,?,?,?)',(p['id'],p['event_id'],p['name'],p['id'],p['face_count'],p['created_at']))
   for f in faces:
    values=json.loads(f['descriptor']) if isinstance(f['descriptor'],str) else f['descriptor']
    c.execute('INSERT INTO faces(photo_id,event_id,descriptor) VALUES(?,?,?)',(f['photo_id'],f['event_id'],vector(values).tobytes()))
   c.execute('INSERT INTO users VALUES(?,?,?)',(uid,email,password_hash(password)))
   c.execute('INSERT OR REPLACE INTO settings VALUES(?,?)',('migration',json.dumps({'events':len(events),'photos':len(photos),'faces':len(faces),'finished':int(time.time())})))
 return uid
@app.get('/api/health')
def health():
 with connect() as c:c.execute('SELECT 1')
 return {'status':'ok','backend':'oracle'}
@app.post('/api/auth/login')
def login(body:Login,req:Request):
 rate(req,'login',6);email=body.email.strip().lower()
 with LOCK:
  with connect() as c:user=c.execute('SELECT * FROM users WHERE email=?',(email,)).fetchone();count=c.execute('SELECT count(*) FROM users').fetchone()[0]
  if user:
   if not hmac.compare_digest(user['password'],password_hash(body.password,user['password'].split(':')[0])):raise HTTPException(401,'E-mail ou senha inválidos.')
   uid=user['id']
  elif not count:
   try:uid=bootstrap(email,body.password)
   except HTTPException:raise
   except Exception:raise HTTPException(503,'Não foi possível migrar os dados. Sua origem foi preservada; tente novamente.')
  else:raise HTTPException(401,'E-mail ou senha inválidos.')
 token=secrets.token_urlsafe(48)
 with connect() as c:
  c.execute('DELETE FROM sessions WHERE expires<?',(time.time(),));c.execute('INSERT INTO sessions VALUES(?,?,?)',(digest(token),uid,int(time.time())+43200))
 return {'token':token,'user':{'id':uid,'email':email}}
@app.get('/api/auth/me')
def me(user=Depends(admin)):return user
@app.post('/api/auth/logout')
def logout(req:Request,user=Depends(admin)):
 with connect() as c:c.execute('DELETE FROM sessions WHERE token=?',(digest(req.headers['authorization'].removeprefix('Bearer ')),))
 return {'ok':True}
@app.get('/api/events')
def events():
 with connect() as c:return [dict(r) for r in c.execute('SELECT id,name,slug,event_date FROM events WHERE published=1 ORDER BY event_date DESC')]
@app.get('/api/admin/events')
def admin_events(user=Depends(admin)):
 with connect() as c:return [dict(r) for r in c.execute('SELECT * FROM events ORDER BY created_at DESC')]
@app.post('/api/admin/events')
def create_event(body:Event,user=Depends(admin)):
 import datetime,re
 try:datetime.date.fromisoformat(body.event_date)
 except ValueError:raise HTTPException(400,'Data inválida.')
 if not re.fullmatch('[a-z0-9-]+',body.slug):raise HTTPException(400,'Link inválido.')
 id=str(uuid.uuid4())
 with connect() as c:
  try:c.execute('INSERT INTO events(id,name,slug,event_date) VALUES(?,?,?,?)',(id,body.name.strip(),body.slug,body.event_date))
  except sqlite3.IntegrityError:raise HTTPException(409,'O link do evento já existe.')
 return {'id':id}
@app.patch('/api/admin/events/{id}')
def update_event(id:str,body:Publish,user=Depends(admin)):
 with connect() as c:
  if c.execute('UPDATE events SET published=? WHERE id=?',(int(body.published),id)).rowcount==0:raise HTTPException(404,'Evento não encontrado.')
 return {'ok':True}
@app.get('/api/admin/stats')
def stats(user=Depends(admin)):
 disk=shutil.disk_usage(DATA)
 with connect() as c:return {'available_bytes':disk.free,'total_bytes':disk.total,'photos':c.execute('SELECT count(*) FROM photos').fetchone()[0],'migration':json.loads((c.execute("SELECT value FROM settings WHERE key='migration'").fetchone() or ['null'])[0])}
@app.get('/api/admin/events/{event}/photos')
def list_photos(event:str,offset:int=0,user=Depends(admin)):
 if offset<0:raise HTTPException(400)
 with connect() as c:rows=[dict(r) for r in c.execute('SELECT * FROM photos WHERE event_id=? ORDER BY created_at DESC,id LIMIT 100 OFFSET ?',(event,offset))]
 return [{**p,'url':photo_url(p)} for p in rows]
@app.post('/api/admin/events/{event}/photos')
def upload(event:str,file:UploadFile=File(...),descriptors:str=Form(...),user=Depends(admin)):
 try:values=json.loads(descriptors)
 except ValueError:raise HTTPException(400,'Descritores inválidos.')
 if not isinstance(values,list) or not 1<=len(values)<=100:raise HTTPException(400,'Quantidade de rostos inválida.')
 vectors=[vector(v) for v in values]
 with connect() as c:
  if not c.execute('SELECT 1 FROM events WHERE id=?',(event,)).fetchone():raise HTTPException(404,'Evento não encontrado.')
 content=file.file.read(15*1024*1024+1)
 if len(content)>15*1024*1024:raise HTTPException(413,'Máximo de 15 MB por foto.')
 try:
  image=Image.open(io.BytesIO(content));image.verify()
  if image.format not in ['JPEG','PNG','WEBP']:raise ValueError()
 except Exception:raise HTTPException(400,'Imagem inválida. Use JPG, PNG ou WebP.')
 if shutil.disk_usage(DATA).free<len(content)+2*1024**3:raise HTTPException(507,'Disco quase cheio.')
 id=str(uuid.uuid4());target=PHOTOS/id;target.write_bytes(content)
 try:
  with connect() as c:
   c.execute('INSERT INTO photos(id,event_id,name,path,face_count) VALUES(?,?,?,?,?)',(id,event,(file.filename or 'foto')[:255],id,len(values)))
   c.executemany('INSERT INTO faces(photo_id,event_id,descriptor) VALUES(?,?,?)',[(id,event,v.tobytes()) for v in vectors])
 except:target.unlink(missing_ok=True);raise
 return {'id':id,'face_count':len(values)}
@app.delete('/api/admin/photos/{id}')
def delete_photo(id:str,user=Depends(admin)):
 with connect() as c:
  p=c.execute('SELECT * FROM photos WHERE id=?',(id,)).fetchone()
  if not p:raise HTTPException(404)
  c.execute('DELETE FROM photos WHERE id=?',(id,))
 (PHOTOS/p['path']).unlink(missing_ok=True)
 return {'ok':True}
@app.post('/api/search')
def search(body:Search,req:Request):
 rate(req,'search',12);v=vector(body.descriptor);matches={}
 with connect() as c:
  event=c.execute('SELECT id FROM events WHERE slug=? AND published=1',(body.event,)).fetchone()
  if not event:return {'photos':[]}
  cursor=c.execute('SELECT photo_id,descriptor FROM faces WHERE event_id=?',(event['id'],))
  while True:
   rows=cursor.fetchmany(1000)
   if not rows:break
   matrix=np.stack([np.frombuffer(r['descriptor'],dtype='<f4') for r in rows]);distances=np.linalg.norm(matrix-v,axis=1)
   for row,d in zip(rows,distances):
    if d<0.52:matches[row['photo_id']]=min(float(d),matches.get(row['photo_id'],100))
  result=[]
  for id in sorted(matches,key=matches.get)[:100]:
   p=c.execute('SELECT * FROM photos WHERE id=?',(id,)).fetchone()
   if p:result.append({'id':id,'name':p['name'],'url':photo_url(p)})
 return {'photos':result}
@app.get('/api/media/{id}')
def media(id:str,expires:int,signature:str):
 expected=hmac.new(SECRET,(id+':'+str(expires)).encode(),hashlib.sha256).hexdigest()
 if expires<time.time() or expires>time.time()+610 or not hmac.compare_digest(expected,signature):raise HTTPException(403,'Link expirado ou inválido.')
 with connect() as c:p=c.execute('SELECT * FROM photos WHERE id=?',(id,)).fetchone()
 if not p or not (PHOTOS/p['path']).is_file():raise HTTPException(404)
 return FileResponse(PHOTOS/p['path'],filename=p['name'],content_disposition_type='inline')
