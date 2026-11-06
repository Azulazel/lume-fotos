import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store'};
const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return respond({error:'Método não permitido.'},405);
 try{
  const url=Deno.env.get('SUPABASE_URL')!; const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  // Store only a rotating, salted hash of the gateway IP. Never log descriptors.
  const ip=req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key+new Date().toISOString().slice(0,10)+ip));
  const rateKey=Array.from(new Uint8Array(hash)).map(x=>x.toString(16).padStart(2,'0')).join('');
  const limited=await db.rpc('allow_photo_search',{rate_key:rateKey});
  if(limited.error)throw limited.error;if(!limited.data)return respond({error:'Muitas buscas. Aguarde um minuto e tente novamente.'},429);
  const raw=await req.text();if(raw.length>16000)return respond({error:'Requisição muito grande.'},413);
  let body;try{body=JSON.parse(raw);}catch{return respond({error:'Requisição inválida.'},400);}
  const {event,descriptor}=body||{};
  if(typeof event!=='string'||event.length>120||!Array.isArray(descriptor)||descriptor.length!==128||descriptor.some((v:unknown)=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>2))return respond({error:'Dados de busca inválidos.'},400);
  const {data,error}=await db.rpc('match_event_photos',{event_slug:event,query_descriptor:descriptor});
  if(error)throw error;if(!data?.length)return respond({photos:[]});
  const signed=await db.storage.from('event-photos').createSignedUrls(data.map((p:any)=>p.storage_path),600,{download:true});
  if(signed.error)throw signed.error;
  return respond({photos:data.map((p:any,i:number)=>({id:p.id,name:p.name,url:signed.data[i]?.signedUrl})).filter((p:any)=>p.url)});
 }catch{return respond({error:'A busca está indisponível no momento. Tente novamente.'},500);}
});
