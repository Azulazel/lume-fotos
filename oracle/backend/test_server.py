import os,tempfile,unittest,io,time
from pathlib import Path
TMP=tempfile.TemporaryDirectory();os.environ['LUME_DATA']=TMP.name;os.environ['LUME_SECRET']='testing-only-secret';os.environ['PUBLIC_URL']='https://testserver'
from fastapi.testclient import TestClient
import server
from PIL import Image
class API(unittest.TestCase):
 def setUp(self):
  with server.connect() as c:
   for table in ['sessions','faces','photos','events','users','limits','settings']:c.execute('DELETE FROM '+table)
   c.execute('INSERT INTO users VALUES(?,?,?)',('qa','qa@example.invalid',server.password_hash('test-password-123')))
  self.client=TestClient(server.app)
  r=self.client.post('/api/auth/login',json={'email':'qa@example.invalid','password':'test-password-123'});self.assertEqual(r.status_code,200);self.headers={'Authorization':'Bearer '+r.json()['token']}
 def event(self):
  r=self.client.post('/api/admin/events',headers=self.headers,json={'name':'QA event','event_date':'2026-11-17','slug':'qa-event'});self.assertEqual(r.status_code,200);return r.json()['id']
 def upload(self,event):
  buf=io.BytesIO();Image.new('RGB',(20,20),'blue').save(buf,format='PNG')
  r=self.client.post('/api/admin/events/'+event+'/photos',headers=self.headers,files={'file':('test.png',buf.getvalue(),'image/png')},data={'descriptors':server.json.dumps([[.1]*128])});self.assertEqual(r.status_code,200);return r.json()['id']
 def test_auth(self):
  self.assertEqual(self.client.get('/api/admin/events').status_code,401)
  self.assertEqual(self.client.post('/api/auth/login',json={'email':'qa@example.invalid','password':'wrong-password'}).status_code,401)
  self.assertEqual(self.client.post('/api/auth/logout',headers=self.headers).status_code,200)
  self.assertEqual(self.client.get('/api/auth/me',headers=self.headers).status_code,401)
 def test_full_photo_lifecycle(self):
  event=self.event();photo=self.upload(event)
  self.assertEqual(self.client.get('/api/events').json(),[])
  self.assertEqual(self.client.post('/api/search',json={'event':'qa-event','descriptor':[.1]*128}).json()['photos'],[])
  self.client.patch('/api/admin/events/'+event,headers=self.headers,json={'published':True})
  self.assertEqual(len(self.client.get('/api/events').json()),1)
  result=self.client.post('/api/search',json={'event':'qa-event','descriptor':[.1]*128}).json()['photos'];self.assertEqual(len(result),1)
  self.assertEqual(self.client.get(result[0]['url']).status_code,200)
  self.assertEqual(self.client.get('/api/media/'+photo+'?expires='+str(int(time.time())+60)+'&signature=bad').status_code,403)
  self.assertEqual(self.client.post('/api/search',json={'event':'qa-event','descriptor':[1.0]*128}).json()['photos'],[])
  self.assertEqual(self.client.get('/api/admin/events/'+event+'/photos?offset=1',headers=self.headers).json(),[])
  self.client.delete('/api/admin/photos/'+photo,headers=self.headers)
  self.assertEqual(self.client.get(result[0]['url']).status_code,404)
  with server.connect() as c:self.assertEqual(c.execute('SELECT count(*) FROM faces').fetchone()[0],0)
 def test_validation_and_rate_limit(self):
  self.assertEqual(self.client.post('/api/search',json={'event':'x','descriptor':[1]}).status_code,422)
  for i in range(12):self.assertEqual(self.client.post('/api/search',json={'event':'x','descriptor':[.1]*128}).status_code,200)
  self.assertEqual(self.client.post('/api/search',json={'event':'x','descriptor':[.1]*128}).status_code,429)
 def test_invalid_upload(self):
  event=self.event()
  r=self.client.post('/api/admin/events/'+event+'/photos',headers=self.headers,files={'file':('x.png',b'not an image','image/png')},data={'descriptors':server.json.dumps([[.1]*128])});self.assertEqual(r.status_code,400)
  with server.connect() as c:self.assertEqual(c.execute('SELECT count(*) FROM photos').fetchone()[0],0)
if __name__=='__main__':unittest.main(verbosity=2)
