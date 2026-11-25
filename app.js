import {compressPhoto} from './compression.js';
import {BatchQueue} from './batch-queue.js';
let authToken=sessionStorage.getItem('lume-oracle-token')||'';
async function api(path,method='GET',body){const headers={};if(authToken)headers.Authorization='Bearer '+authToken;if(body && !(body instanceof FormData))headers['Content-Type']='application/json';const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),180000);let response;try{response=await fetch(window.LUME_CONFIG.apiUrl+path,{method,headers,signal:controller.signal,body:body?(body instanceof FormData?body:JSON.stringify(body)):undefined});}catch(cause){const error=new Error(cause.name==='AbortError'?'O envio demorou demais. Tentando recuperar a conexão.':'Falha de conexão. Confira sua internet.');error.retryable=true;throw error;}finally{clearTimeout(timeout);}const data=await response.json().catch(()=>({}));if(!response.ok){const error=new Error(typeof data.detail==='string'?data.detail:'Não foi possível concluir a operação.');error.status=response.status;error.retryable=response.status>=500;throw error;}return data;}

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
 validateImage(file);await loadModels();let img,url;const canvas=document.createElement('canvas');
 try{if(typeof createImageBitmap==='function')img=await createImageBitmap(file,{imageOrientation:'from-image'});else{url=URL.createObjectURL(file);img=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Não foi possível abrir esta imagem.'));image.src=url;});}
 const ratio=Math.min(1,1800/Math.max(img.width,img.height));canvas.width=Math.round(img.width*ratio);canvas.height=Math.round(img.height*ratio);canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);img.close?.();img=null;
 const detections=await faceapi.detectAllFaces(canvas,new faceapi.SsdMobilenetv1Options({minConfidence:.5})).withFaceLandmarks().withFaceDescriptors();return detections.map(d=>Array.from(d.descriptor));
 }finally{img?.close?.();if(url)URL.revokeObjectURL(url);canvas.width=0;canvas.height=0;}
}
async function loadEvents() {
  const list = await api('/events');
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
async function search(file, references = null) {
  if(searching)return;
  clearSearch();const generation=searchGeneration; const eventSlug=$('event-select').value;
  searching=true; $('select-selfie').disabled=true;$('open-camera').disabled=true;
  try {
    readyForSearch(); validateImage(file);
    selfieUrl=URL.createObjectURL(file);$('selfie-preview').src=selfieUrl;$('selfie-preview').hidden=false;$('selfie-placeholder').hidden=true;$('clear-search').hidden=false;
    setStatus('search-status','Preparando a busca… Na primeira vez, os modelos podem levar alguns segundos para carregar.');
    const faces=references || await describe(file);
    if(generation!==searchGeneration)return;
    if(!references && faces.length!==1)throw new Error(faces.length?'Encontramos mais de um rosto. Escolha uma foto apenas sua.':'Não encontramos um rosto nítido. Tente outra foto, de frente e com boa iluminação.');
    setStatus('search-status','Procurando você nas fotos do evento…');
    const matches=new Map();
    for (let i=0;i<faces.length;i++){
      if(generation!==searchGeneration)return;
      setStatus('search-status','Buscando com a referência '+(i+1)+' de '+faces.length+'…');
      const result=await api('/search','POST',{event:eventSlug,descriptor:faces[i]});
      for(const photo of result.photos||[])matches.set(photo.id,photo);
    }
    const data={photos:[...matches.values()]};const error=null;
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
    const card=document.createElement('article');card.className='result-photo';const img=document.createElement('img');img.src=photo.url+'&thumb=1';img.alt='Foto encontrada no evento';img.loading='lazy';
    const actions=document.createElement('div');actions.className='photo-actions';const label=document.createElement('span');label.textContent=photo.name;
    const link=document.createElement('a');link.href=photo.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Abrir / baixar ↗';
    actions.append(label,link);card.append(img,actions);$('photo-grid').append(card);
  }
  $('results').scrollIntoView({behavior:'smooth',block:'start'});
}

let cameraSession=0,cameraShots=[],cameraDescriptors=[],cameraBusy=false;
const cameraSteps=[
 ['Olhe de frente','Posicione seu rosto dentro da moldura, em um local iluminado. Você pode sorrir naturalmente.','Capturar de frente'],
 ['Vire levemente para a sua esquerda','Mantenha os dois olhos visíveis. Não precisa ficar de perfil.','Capturar à esquerda'],
 ['Vire levemente para a sua direita','Mantenha o rosto dentro da moldura e os dois olhos visíveis.','Capturar à direita']
];
function updateCameraStep(){
 const step=cameraShots.length,guide=cameraSteps[step];
 $('camera-step').textContent='Foto '+(step+1)+' de 3';
 $('camera-instruction').textContent=guide[0];$('camera-hint').textContent=guide[1];
 $('capture').textContent=guide[2];$('camera-frame').dataset.step=String(step);
}
function stopCamera(){
 cameraSession++;if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;
 $('camera-video').srcObject=null;cameraShots=[];cameraDescriptors=[];cameraBusy=false;
}
$('open-camera').onclick=async()=>{
 if($('camera-dialog').open)return;
 const session=++cameraSession;cameraShots=[];cameraDescriptors=[];updateCameraStep();
 try{
 readyForSearch();if(!navigator.mediaDevices?.getUserMedia)throw new Error('A câmera não está disponível. Escolha uma foto da galeria.');
 $('camera-dialog').showModal();$('capture').disabled=true;setStatus('camera-status','Solicitando acesso à câmera…');
 const incoming=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:1280}},audio:false});
 if(session!==cameraSession||!$('camera-dialog').open){incoming.getTracks().forEach(t=>t.stop());return;}
 stream=incoming;$('camera-video').srcObject=stream;await $('camera-video').play();
 setStatus('camera-status','Preparando reconhecimento facial…');await loadModels();
 if(session!==cameraSession)return;
 $('capture').disabled=false;setStatus('camera-status','Ajuste a posição e toque no botão para capturar.');
 }catch(e){if(session!==cameraSession)return;stopCamera();if($('camera-dialog').open)$('camera-dialog').close();setStatus('search-status',e.name==='NotAllowedError'?'Acesso à câmera não autorizado. Você pode selecionar uma foto da galeria.':e.message,true);}
};
$('close-camera').onclick=()=>{$('camera-dialog').close();stopCamera();};
$('camera-dialog').addEventListener('close',stopCamera);
$('capture').onclick=async()=>{
 if(cameraBusy)return;const v=$('camera-video');if(!v.videoWidth)return;
 const session=cameraSession;cameraBusy=true;$('capture').disabled=true;
 const canvas=document.createElement('canvas');canvas.width=v.videoWidth;canvas.height=v.videoHeight;
 try{
 canvas.getContext('2d').drawImage(v,0,0);setStatus('camera-status','Conferindo sua captura…');
 const faces=await faceapi.detectAllFaces(canvas,new faceapi.SsdMobilenetv1Options({minConfidence:.5})).withFaceLandmarks().withFaceDescriptors();
 if(session!==cameraSession)return;
 if(faces.length!==1)throw new Error(faces.length?'Deixe somente o seu rosto na câmera.':'Não consegui detectar o rosto. Vire um pouco menos e procure boa iluminação.');
 const box=faces[0].detection.box;
 if(box.width/canvas.width<.18||box.height/canvas.height<.22)throw new Error('Aproxime um pouco o rosto da câmera e tente novamente.');
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.94));
 if(session!==cameraSession)return;if(!blob)throw new Error('Não foi possível capturar. Tente novamente.');
 cameraShots.push(new File([blob],'selfie-'+cameraShots.length+'.jpg',{type:'image/jpeg'}));
 cameraDescriptors.push(Array.from(faces[0].descriptor));
 if(cameraShots.length===3){
 const preview=cameraShots[0],references=cameraDescriptors.slice();
 stopCamera();$('camera-dialog').close();await search(preview,references);
 }else{updateCameraStep();setStatus('camera-status','Foto anterior capturada. Ajuste a posição para a próxima.');}
 }catch(e){if(session===cameraSession)setStatus('camera-status',e.message,true);}
 finally{canvas.width=0;canvas.height=0;if(session===cameraSession){cameraBusy=false;$('capture').disabled=false;}}
};
window.addEventListener('pagehide',()=>{stopCamera();clearSearch();});
$('login-form').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{setStatus('login-status','Entrando…');setStatus('login-status','Entrando…');const result=await api('/auth/login','POST',{email:$('email').value.trim(),password:$('password').value});authToken=result.token;sessionStorage.setItem('lume-oracle-token',authToken);$('password').value='';await refreshAdmin();}catch(e){setStatus('login-status',e.message,true);}finally{button.disabled=false;}};
async function refreshAdmin(){
 let isAdmin=false;if(authToken){try{await api('/auth/me');isAdmin=true;}catch{authToken='';sessionStorage.removeItem('lume-oracle-token');}}
 $('login-panel').hidden=isAdmin;$('dashboard').hidden=!isAdmin;
 if(isAdmin){await renderAdminEvents();const stats=await api('/admin/stats');setStatus('admin-status','Oracle · '+(stats.available_bytes/1024**3).toFixed(1)+' GB livres · '+stats.photos+' fotos');}
}
$('logout').onclick=async()=>{if(uploading){setStatus('admin-status','Aguarde o envio terminar antes de sair.',true);return;}await api('/auth/logout','POST');authToken='';sessionStorage.removeItem('lume-oracle-token');$('dashboard').hidden=true;$('login-panel').hidden=false;$('upload-panel').hidden=true;setStatus('login-status','Você saiu da conta.');};
$('event-form').onsubmit=async e=>{e.preventDefault();e.submitter.disabled=true;try{const name=$('event-name').value.trim();if(!name)throw new Error('Informe o nome do evento.');const slug=name.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60)+'-'+crypto.randomUUID().slice(0,8);await api('/admin/events','POST',{name,event_date:$('event-date').value,slug});e.target.reset();await renderAdminEvents();setStatus('admin-status','Evento criado como rascunho. Envie as fotos e publique quando estiver pronto.');}catch(e){setStatus('admin-status',e.message,true);}finally{e.submitter.disabled=false;}};
async function renderAdminEvents(){
 const events=await api('/admin/events');$('admin-events').replaceChildren();
 if(!events.length)$('admin-events').textContent='Seu primeiro evento começa aqui. Crie uma galeria acima.';
 for(const event of events){
 const row=document.createElement('article');row.className='event-row';const info=document.createElement('div'),title=document.createElement('h3'),meta=document.createElement('p');title.textContent=event.name;meta.textContent=formatDate(event.event_date)+' · '+(event.published?'Publicado':'Rascunho');info.append(title,meta);
 const actions=document.createElement('div');const upload=document.createElement('button');upload.className='button primary';upload.textContent='Gerenciar fotos';upload.onclick=()=>openUpload(event).catch(e=>setStatus('admin-status',e.message,true));
 const toggle=document.createElement('button');toggle.className='button secondary';toggle.textContent=event.published?'Despublicar':'Publicar';toggle.onclick=async()=>{toggle.disabled=true;try{await api('/admin/events/'+event.id,'PATCH',{published:!event.published});await renderAdminEvents();await loadEvents();}catch(e){setStatus('admin-status',e.message,true);toggle.disabled=false;}};
 const share=document.createElement('button');share.className='text-button';share.textContent='Copiar link';share.onclick=async()=>{const url=new URL(location.href);url.hash='encontrar';url.search='?evento='+event.slug;try{await navigator.clipboard.writeText(url.href);setStatus('admin-status','Link copiado. '+(!event.published?'Publique o evento para disponibilizar a busca.':''));}catch{setStatus('admin-status',url.href);}};
 actions.append(upload,toggle,share);row.append(info,actions);$('admin-events').append(row);
 }
}
async function openUpload(event){if(uploading)throw new Error('Aguarde o lote atual terminar.');if(selectedEvent?.id!==event.id){batchQueue=null;batchStarted=0;$('batch-controls').hidden=true;}selectedEvent=event;$('upload-panel').hidden=false;$('upload-title').textContent=event.name;$('upload-log').replaceChildren();setStatus('upload-status','');await renderAdminPhotos();$('upload-panel').scrollIntoView({behavior:'smooth'});}
$('close-upload').onclick=()=>{if(!uploading)$('upload-panel').hidden=true;};
let batchQueue=null,batchStarted=0,batchEvent=null,batchMode='quality',batchWakeLock=null;
const sizes=n=>(n/1024/1024).toFixed(1)+' MB';
function batchUpdate(item){
 if(!batchQueue)return;const c=batchQueue.counts,completed=c.done+c.failed+c.skipped;const elapsed=batchStarted?Math.max(1,(performance.now()-batchStarted)/1000):0;const remaining=c.total-completed;const eta=completed&&elapsed?Math.ceil(remaining*elapsed/completed/60):null;
 $('upload-progress').hidden=false;$('upload-progress').max=c.total||1;$('upload-progress').value=completed;
 const bytes=batchQueue.items.filter(i=>i.state==='done').reduce((s,i)=>s+(i.sentBytes||0),0);
 $('batch-counts').textContent=c.total+' selecionadas · '+c.done+' enviadas · '+c.failed+' falhas · '+c.skipped+' sem rosto · '+remaining+' restantes';
 $('batch-timing').textContent=(batchStarted?'Tempo: '+Math.floor(elapsed/60)+'min '+Math.floor(elapsed%60)+'s · ':'')+'Transferido: '+sizes(bytes)+(eta&&batchQueue.running?' · estimativa: ~'+eta+' min':'');
 $('start-batch').disabled=uploading||batchQueue.running||!c.pending;$('pause-batch').hidden=!batchQueue.running;$('pause-batch').textContent=batchQueue.paused?'Continuar lote':'Pausar lote';$('cancel-batch').hidden=!batchQueue.running;$('retry-batch').hidden=batchQueue.running||!c.failed;
 $('batch-files').disabled=uploading||batchQueue.running;$('batch-folder').disabled=uploading||batchQueue.running;$('upload-quality').disabled=uploading||batchQueue.running;$('batch-parallel').disabled=uploading||batchQueue.running;$('close-upload').disabled=uploading||batchQueue.running;
 if(item&&['done','failed','skipped'].includes(item.state))addLog(item.file.name+' — '+(item.state==='done'?'enviada · '+sizes(item.sentBytes):item.error),item.state==='failed');
 if(batchQueue.paused)setStatus('upload-status','Lote pausado. Os envios já iniciados podem terminar; clique em Continuar lote para retomar.');
 else if(batchQueue.running)setStatus('upload-status',c.preparing?'Analisando a próxima foto; '+(c.uploading+c.retrying)+' envio(s) em andamento.':'Enviando fotos e preparando a fila…');
 else if(batchStarted)setStatus('upload-status',c.pending?'Lote interrompido. Clique em Iniciar / continuar para enviar as restantes.':'Lote concluído. '+(c.failed?'Use Repetir falhas para tentar somente as que falharam.':''),c.failed>0);
}
function selectBatch(e){const files=Array.from(e.target.files);e.target.value='';if(!files.length||uploading)return;batchEvent=selectedEvent;batchStarted=0;$('upload-log').replaceChildren();
 batchQueue=new BatchQueue(files.map(file=>({file,key:crypto.randomUUID(),state:'pending',sentBytes:0})),{
 concurrency:3,onChange:batchUpdate,
 prepare:async item=>{validateImage(item.file);const compressed=compressPhoto(item.file,batchMode);let faces;try{faces=await describe(item.file);}catch(e){await compressed;throw e;}const result=await compressed;if(!faces.length){const e=new Error('Nenhum rosto detectado; foto não enviada.');e.skip=true;throw e;}item.sentBytes=result.file.size;return {file:result.file,faces};},
 upload:async(item,prepared)=>{const form=new FormData();form.append('file',prepared.file);form.append('descriptors',JSON.stringify(prepared.faces));form.append('upload_key',item.key);return api('/admin/events/'+batchEvent.id+'/photos','POST',form);}
 });$('batch-controls').hidden=false;setStatus('upload-status','Lote preparado. Você pode selecionar mais de 500 fotos de uma vez. Clique em Iniciar / continuar.');batchUpdate();}
$('batch-files').onchange=selectBatch;$('batch-folder').onchange=selectBatch;
async function runBatch(retry=false){if(!batchQueue||batchQueue.running||uploading)return;if(!$('upload-consent').checked){setStatus('upload-status','Confirme a autorização antes de iniciar o lote.',true);return;}if(batchEvent.id!==selectedEvent.id){setStatus('upload-status','Selecione as fotos novamente para este evento.',true);return;}
 uploading=true;batchMode=$('upload-quality').value;batchQueue.concurrency=Number($('batch-parallel').value);if(!batchStarted)batchStarted=performance.now();batchUpdate();setStatus('upload-status','Preparando reconhecimento facial… Na primeira vez, aguarde o carregamento dos modelos.');let timer,fatal;
 try{await api('/auth/me');await loadModels();try{batchWakeLock=await navigator.wakeLock?.request('screen');}catch{}timer=setInterval(()=>batchUpdate(),1000);if(retry)await batchQueue.retryFailures();else await batchQueue.run();}
 catch(error){fatal=error;}finally{clearInterval(timer);await batchWakeLock?.release().catch(()=>{});batchWakeLock=null;uploading=false;batchUpdate();if(fatal)setStatus('upload-status',fatal.message,true);}
 try{await renderAdminPhotos();}catch(error){setStatus('admin-status',error.message,true);}
}
$('start-batch').onclick=()=>runBatch();$('retry-batch').onclick=()=>runBatch(true);$('pause-batch').onclick=()=>{if(batchQueue.paused)batchQueue.resume();else batchQueue.pause();};$('cancel-batch').onclick=()=>batchQueue.cancel();
function addLog(message,error=false){const li=document.createElement('li');li.textContent=message;if(error)li.className='error';$('upload-log').append(li);while($('upload-log').children.length>100)$('upload-log').firstChild.remove();}
let photoOffset=0;
async function renderAdminPhotos(append=false){
 const eventId=selectedEvent.id;if(!append){photoOffset=0;$('admin-photos').replaceChildren();}
 $('load-more-photos').disabled=true;let photos;try{photos=await api('/admin/events/'+eventId+'/photos?offset='+photoOffset);}finally{$('load-more-photos').disabled=false;}
 if(selectedEvent.id!==eventId)return;photoOffset+=photos.length;$('load-more-photos').hidden=photos.length<100;
 if(!photos.length&&!append){$('admin-photos').textContent='Nenhuma foto enviada neste evento.';return;}

 for(let i=0;i<photos.length;i++){const p=photos[i];const card=document.createElement('article');card.className='result-photo';const img=document.createElement('img');img.src=p.url+'&thumb=1';img.alt=p.name;img.loading='lazy';const action=document.createElement('div');action.className='photo-actions';const label=document.createElement('span');label.textContent=p.name+' · '+p.face_count+' rosto(s)';const remove=document.createElement('button');remove.className='text-button';remove.textContent='Excluir';remove.onclick=async()=>{if(uploading||!confirm('Excluir esta foto e seus descritores? Esta ação não pode ser desfeita.'))return;remove.disabled=true;try{await api('/admin/photos/'+p.id,'DELETE');await renderAdminPhotos();}catch(e){setStatus('upload-status',e.message,true);remove.disabled=false;}};action.append(label,remove);card.append(img,action);$('admin-photos').append(card);}
}
$('load-more-photos').onclick=()=>renderAdminPhotos(true).catch(e=>setStatus('admin-status',e.message,true));
window.addEventListener('beforeunload',e=>{if(uploading){e.preventDefault();e.returnValue='';}});
async function init(){
 try{if(config.apiUrl){db=true;await loadEvents();}else throw new Error('Estamos preparando as galerias. Os eventos aparecerão aqui assim que a configuração for concluída.');}
 catch(e){$('event-select').replaceChildren(new Option('Galerias em preparação',''));$('service-note').hidden=false;$('service-note').textContent=e.message;}
 route();
}
// Module scripts can run before deferred CDN scripts finish; initialize on load.
if(document.readyState==='complete')init();else window.addEventListener('DOMContentLoaded',init,{once:true});
