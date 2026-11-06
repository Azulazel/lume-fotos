const $ = (id) => document.getElementById(id);
const config = window.LUME_CONFIG || {};
let db, modelPromise, selectedEvent, uploading = false, stream, selfieUrl, searching = false, searchGeneration = 0;
const setStatus = (id, message, error = false) => { $(id).textContent = message; $(id).classList.toggle('error', error); };
function requireDB() { if (!db) throw new Error('A galeria está sendo preparada. Volte em breve ou entre em contato com o fotógrafo.'); return db; }
function fail(result) { if (result.error) throw result.error; return result.data; }
function route() { const admin = location.hash === '#admin'; $('visitor').hidden = admin; $('admin').hidden = !admin; if (admin) refreshAdmin().catch(e=>setStatus('login-status',e.message,true)); }
window.addEventListener('hashchange', route);
function loadModels() {
  if (!modelPromise) modelPromise = (async () => {
    if (!window.faceapi) throw new Error('Não foi possível carregar o reconhecimento facial. Confira sua conexão e recarregue a página.');
    const base = 'https://cdn.jsdelivr.net/gh/arifszn/find-me@85e47be58c13d218aa48c158809ead4f609975f2/public/assets/models';
    await Promise.all([faceapi.nets.ssdMobilenetv1.loadFromUri(base), faceapi.nets.faceLandmark68Net.loadFromUri(base), faceapi.nets.faceRecognitionNet.loadFromUri(base)]);
  })().catch(e=>{modelPromise=null;throw e;});
  return modelPromise;
}
function validateImage(file) {
  if (!file || !['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Escolha uma imagem JPG, PNG ou WebP.');
  if (file.size > 15 * 1024 * 1024) throw new Error('A imagem deve ter no máximo 15 MB.');
}
async function describe(file) {
  validateImage(file); await loadModels();
  const img = await faceapi.bufferToImage(file);
  const ratio = Math.min(1, 1800 / Math.max(img.width,img.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(img.width*ratio); canvas.height = Math.round(img.height*ratio);
  canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
  const detections = await faceapi.detectAllFaces(canvas,new faceapi.SsdMobilenetv1Options({minConfidence:0.5})).withFaceLandmarks().withFaceDescriptors();
  canvas.width=0;canvas.height=0;
  return detections.map(d=>Array.from(d.descriptor));
}
async function loadEvents() {
  const list = fail(await requireDB().from('events').select('id,name,event_date,slug').eq('published',true).order('event_date',{ascending:false}));
  $('event-select').replaceChildren(new Option(list.length?'Selecione seu evento':'Nenhum evento disponível ainda',''));
  for (const event of list) $('event-select').add(new Option(event.name+' · '+formatDate(event.event_date), event.slug));
  const slug = new URLSearchParams(location.search).get('evento');
  if (slug && list.some(e=>e.slug===slug)) $('event-select').value=slug;
}
function formatDate(date) { return new Date(date+'T12:00:00').toLocaleDateString('pt-BR'); }
function readyForSearch() {
  requireDB();
  if (!$('event-select').value) throw new Error('Primeiro, selecione o seu evento.');
  if (!$('consent').checked) throw new Error('Confirme o consentimento para buscar suas próprias fotos.');
}
function clearSearch() {
  searchGeneration++;
  if (selfieUrl) URL.revokeObjectURL(selfieUrl); selfieUrl=null;
  $('selfie-preview').removeAttribute('src'); $('selfie-preview').hidden=true; $('selfie-placeholder').hidden=false;
  $('photo-grid').replaceChildren(); $('results').hidden=true; $('clear-search').hidden=true;
  $('selfie-file').value=''; setStatus('search-status','');
}
$('clear-search').onclick=clearSearch;
$('event-select').onchange=clearSearch;
$('consent').onchange=()=>{if(!$('consent').checked)clearSearch();};
$('select-selfie').onclick=()=>{try{readyForSearch();$('selfie-file').click();}catch(e){setStatus('search-status',e.message,true);}};
$('selfie-file').onchange=async e=>{const file=e.target.files[0];if(file)await search(file);e.target.value='';};
async function search(file) {
  if(searching)return;
  clearSearch();const generation=searchGeneration; const eventSlug=$('event-select').value;
  searching=true; $('select-selfie').disabled=true;$('open-camera').disabled=true;
  try {
    readyForSearch(); validateImage(file);
    selfieUrl=URL.createObjectURL(file);$('selfie-preview').src=selfieUrl;$('selfie-preview').hidden=false;$('selfie-placeholder').hidden=true;$('clear-search').hidden=false;
    setStatus('search-status','Preparando a busca… Na primeira vez, os modelos podem levar alguns segundos para carregar.');
    const faces=await describe(file);
    if(generation!==searchGeneration)return;
    if(faces.length!==1)throw new Error(faces.length?'Encontramos mais de um rosto. Escolha uma foto apenas sua.':'Não encontramos um rosto nítido. Tente outra foto, de frente e com boa iluminação.');
    setStatus('search-status','Procurando você nas fotos do evento…');
    const {data,error}=await db.functions.invoke('search-photos',{body:{event: eventSlug, descriptor:faces[0]}});
    if(generation!==searchGeneration)return;
    if(error)throw new Error('Não foi possível concluir a busca. Aguarde um minuto e tente novamente.');
    if(data.error)throw new Error(data.error);
    renderResults(data.photos||[]);setStatus('search-status','Busca concluída.');
  }catch(e){if(generation===searchGeneration)setStatus('search-status',e.message||'Não foi possível concluir a busca.',true);}
  finally{searching=false;$('select-selfie').disabled=false;$('open-camera').disabled=false;}
}
function renderResults(photos) {
  $('results').hidden=false;$('result-title').textContent=photos.length?'Olha você aqui.':'Ainda não encontramos você.';
  $('result-count').textContent=photos.length+' foto'+(photos.length===1?'':'s');
  $('result-description').textContent=photos.length?'Confira as sugestões. Os links ficam disponíveis por 10 minutos; depois, faça uma nova busca.':'Tente uma selfie mais nítida ou confira se escolheu o evento certo. O fotógrafo também pode estar enviando novas fotos.';
  $('photo-grid').replaceChildren();
  for(const photo of photos){
    const card=document.createElement('article');card.className='result-photo';const img=document.createElement('img');img.src=photo.url;img.alt='Foto encontrada no evento';img.loading='lazy';
    const actions=document.createElement('div');actions.className='photo-actions';const label=document.createElement('span');label.textContent=photo.name;
    const link=document.createElement('a');link.href=photo.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Abrir / baixar ↗';
    actions.append(label,link);card.append(img,actions);$('photo-grid').append(card);
  }
  $('results').scrollIntoView({behavior:'smooth',block:'start'});
}
function stopCamera(){if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;$('camera-video').srcObject=null;}
$('open-camera').onclick=async()=>{
 try{readyForSearch();if(!navigator.mediaDevices?.getUserMedia)throw new Error('A câmera não está disponível. Escolha uma foto da galeria.');
 $('camera-dialog').showModal();$('capture').disabled=true;setStatus('camera-status','Solicitando acesso à câmera…');
 stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:900}},audio:false});
 if(!$('camera-dialog').open){stopCamera();return;}
 $('camera-video').srcObject=stream;await $('camera-video').play();$('capture').disabled=false;setStatus('camera-status','');
 }catch(e){stopCamera();if($('camera-dialog').open)$('camera-dialog').close();setStatus('search-status',e.name==='NotAllowedError'?'Acesso à câmera não autorizado. Você pode selecionar uma foto da galeria.':e.message,true);}
};
$('close-camera').onclick=()=>{$('camera-dialog').close();stopCamera();};$('camera-dialog').addEventListener('close',stopCamera);
$('capture').onclick=async()=>{const v=$('camera-video');if(!v.videoWidth)return;const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0);const blob=await new Promise(resolve=>c.toBlob(resolve,'image/jpeg',.92));stopCamera();$('camera-dialog').close();if(blob)await search(new File([blob],'selfie.jpg',{type:'image/jpeg'}));};
window.addEventListener('pagehide',()=>{stopCamera();clearSearch();});
$('login-form').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{setStatus('login-status','Entrando…');const result=await requireDB().auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});fail(result);$('password').value='';await refreshAdmin();}catch(e){setStatus('login-status',e.message,true);}finally{button.disabled=false;}};
async function refreshAdmin(){
 requireDB();const {data:{session}}=await db.auth.getSession();
 let isAdmin=false;if(session){const {data,error}=await db.from('admins').select('user_id').eq('user_id',session.user.id).maybeSingle();if(error)throw error;isAdmin=!!data;}
 $('login-panel').hidden=isAdmin;$('dashboard').hidden=!isAdmin;
 if(session&&!isAdmin){await db.auth.signOut();setStatus('login-status','Esta conta não tem permissão de administrador. Solicite a liberação ao responsável pela plataforma.',true);}
 if(isAdmin)await renderAdminEvents();
}
$('logout').onclick=async()=>{if(uploading){setStatus('admin-status','Aguarde o envio terminar antes de sair.',true);return;}await db.auth.signOut();$('dashboard').hidden=true;$('login-panel').hidden=false;$('upload-panel').hidden=true;setStatus('login-status','Você saiu da conta.');};
$('event-form').onsubmit=async e=>{e.preventDefault();e.submitter.disabled=true;try{const name=$('event-name').value.trim();if(!name)throw new Error('Informe o nome do evento.');const slug=name.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60)+'-'+crypto.randomUUID().slice(0,8);fail(await db.from('events').insert({name,event_date:$('event-date').value,slug,published:false}));e.target.reset();await renderAdminEvents();setStatus('admin-status','Evento criado como rascunho. Envie as fotos e publique quando estiver pronto.');}catch(e){setStatus('admin-status',e.message,true);}finally{e.submitter.disabled=false;}};
async function renderAdminEvents(){
 const events=fail(await db.from('events').select('*').order('created_at',{ascending:false}));$('admin-events').replaceChildren();
 if(!events.length)$('admin-events').textContent='Seu primeiro evento começa aqui. Crie uma galeria acima.';
 for(const event of events){
 const row=document.createElement('article');row.className='event-row';const info=document.createElement('div'),title=document.createElement('h3'),meta=document.createElement('p');title.textContent=event.name;meta.textContent=formatDate(event.event_date)+' · '+(event.published?'Publicado':'Rascunho');info.append(title,meta);
 const actions=document.createElement('div');const upload=document.createElement('button');upload.className='button primary';upload.textContent='Gerenciar fotos';upload.onclick=()=>openUpload(event).catch(e=>setStatus('admin-status',e.message,true));
 const toggle=document.createElement('button');toggle.className='button secondary';toggle.textContent=event.published?'Despublicar':'Publicar';toggle.onclick=async()=>{toggle.disabled=true;try{fail(await db.from('events').update({published:!event.published}).eq('id',event.id));await renderAdminEvents();await loadEvents();}catch(e){setStatus('admin-status',e.message,true);toggle.disabled=false;}};
 const share=document.createElement('button');share.className='text-button';share.textContent='Copiar link';share.onclick=async()=>{const url=new URL(location.href);url.hash='encontrar';url.search='?evento='+event.slug;try{await navigator.clipboard.writeText(url.href);setStatus('admin-status','Link copiado. '+(!event.published?'Publique o evento para disponibilizar a busca.':''));}catch{setStatus('admin-status',url.href);}};
 actions.append(upload,toggle,share);row.append(info,actions);$('admin-events').append(row);
 }
}
async function openUpload(event){if(uploading)throw new Error('Aguarde o lote atual terminar.');selectedEvent=event;$('upload-panel').hidden=false;$('upload-title').textContent=event.name;$('upload-log').replaceChildren();setStatus('upload-status','');await renderAdminPhotos();$('upload-panel').scrollIntoView({behavior:'smooth'});}
$('close-upload').onclick=()=>{if(!uploading)$('upload-panel').hidden=true;};
$('batch-files').onchange=async e=>{
 const files=Array.from(e.target.files);e.target.value='';if(!files.length||uploading)return;
 if(!$('upload-consent').checked){setStatus('upload-status','Confirme a autorização antes de enviar as fotos.',true);return;}
 const event=selectedEvent;uploading=true;$('batch-files').disabled=true;$('close-upload').disabled=true;$('upload-progress').hidden=false;$('upload-progress').max=files.length;$('upload-progress').value=0;$('upload-log').replaceChildren();let sent=0,failed=0;
 for(let i=0;i<files.length;i++){
 const file=files[i];let storagePath,photoId;
 try{setStatus('upload-status','Analisando e enviando '+(i+1)+' de '+files.length+' · '+file.name);const faces=await describe(file);if(!faces.length)throw new Error('Nenhum rosto detectado; foto não enviada.');
 storagePath=event.id+'/'+crypto.randomUUID()+'.'+(file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg');
 fail(await db.storage.from('event-photos').upload(storagePath,file,{contentType:file.type,upsert:false}));
 const row=fail(await db.from('photos').insert({event_id:event.id,storage_path:storagePath,name:file.name,face_count:faces.length}).select('id').single());photoId=row.id;
 fail(await db.from('faces').insert(faces.map(descriptor=>({photo_id:photoId,event_id:event.id,descriptor}))));
 sent++;addLog(file.name+' — '+faces.length+' rosto(s), enviada.');
 }catch(err){failed++;let cleanupError=false;if(photoId){const r=await db.from('photos').delete().eq('id',photoId);cleanupError=!!r.error;}if(storagePath){const r=await db.storage.from('event-photos').remove([storagePath]);cleanupError=cleanupError||!!r.error;}addLog(file.name+' — '+(err.message||'Falha no envio')+(cleanupError?' Revise o armazenamento: a limpeza automática falhou.':''),true);}
 $('upload-progress').value=i+1;
 }
 uploading=false;$('batch-files').disabled=false;$('close-upload').disabled=false;setStatus('upload-status','Lote concluído: '+sent+' enviada(s), '+failed+' não enviada(s).',failed>0);
 try{await renderAdminPhotos();}catch(e){setStatus('admin-status',e.message,true);}
};
function addLog(message,error=false){const li=document.createElement('li');li.textContent=message;if(error)li.className='error';$('upload-log').append(li);}
async function renderAdminPhotos(){
 const photos=fail(await db.from('photos').select('id,name,storage_path,face_count').eq('event_id',selectedEvent.id).order('created_at',{ascending:false}).limit(200));$('admin-photos').replaceChildren();
 if(!photos.length){$('admin-photos').textContent='Nenhuma foto enviada neste evento.';return;}
 const signed=fail(await db.storage.from('event-photos').createSignedUrls(photos.map(p=>p.storage_path),600));
 for(let i=0;i<photos.length;i++){const p=photos[i];const card=document.createElement('article');card.className='result-photo';const img=document.createElement('img');img.src=signed[i].signedUrl;img.alt=p.name;img.loading='lazy';const action=document.createElement('div');action.className='photo-actions';const label=document.createElement('span');label.textContent=p.name+' · '+p.face_count+' rosto(s)';const remove=document.createElement('button');remove.className='text-button';remove.textContent='Excluir';remove.onclick=async()=>{if(uploading||!confirm('Excluir esta foto e seus descritores? Esta ação não pode ser desfeita.'))return;remove.disabled=true;try{fail(await db.storage.from('event-photos').remove([p.storage_path]));fail(await db.from('photos').delete().eq('id',p.id));await renderAdminPhotos();}catch(e){setStatus('upload-status',e.message,true);remove.disabled=false;}};action.append(label,remove);card.append(img,action);$('admin-photos').append(card);}
}
window.addEventListener('beforeunload',e=>{if(uploading){e.preventDefault();e.returnValue='';}});
async function init(){
 try{if(config.supabaseUrl&&config.supabaseAnonKey&&window.supabase){db=window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey);await loadEvents();}else throw new Error('Estamos preparando as galerias. Os eventos aparecerão aqui assim que a configuração for concluída.');}
 catch(e){$('event-select').replaceChildren(new Option('Galerias em preparação',''));$('service-note').hidden=false;$('service-note').textContent=e.message;}
 route();
}
// Module scripts can run before deferred CDN scripts finish; initialize on load.
if(document.readyState==='complete')init();else window.addEventListener('DOMContentLoaded',init,{once:true});
