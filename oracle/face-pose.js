// Coordinates refer to the unmirrored camera image; preview is mirrored.
export function assessPose(faces, width, height, step, baseline=0) {
 if(faces.length!==1)return {ok:false,message:faces.length?'Deixe somente seu rosto na câmera.':'Posicione seu rosto na moldura e procure boa iluminação.'};
 const f=faces[0],b=f.detection.box,p=f.landmarks.positions;
 const cx=(b.x+b.width/2)/width,cy=(b.y+b.height/2)/height;
 if(b.width/width<.29||b.height/height<.32)return {ok:false,message:'Aproxime um pouco o rosto.'};
 if(b.width/width>.68||b.height/height>.80)return {ok:false,message:'Afaste um pouco o rosto.'};
 if(Math.abs(cx-.5)>.10||Math.abs(cy-.5)>.12)return {ok:false,message:'Centralize o rosto dentro da moldura.'};
 const mean=points=>({x:points.reduce((s,p)=>s+p.x,0)/points.length,y:points.reduce((s,p)=>s+p.y,0)/points.length});
 const a=mean(p.slice(36,42)),z=mean(p.slice(42,48)),dx=z.x-a.x,dy=z.y-a.y,span=Math.hypot(dx,dy);
 if(!Number.isFinite(span)||span<10||Math.abs(dy/span)>.20)return {ok:false,message:'Mantenha a cabeça reta, sem inclinar para o ombro.'};
 const yaw=((p[30].x-(a.x+z.x)/2)*dx+(p[30].y-(a.y+z.y)/2)*dy)/(span*span);
 const pitch=((p[30].y-(a.y+z.y)/2)*dx-(p[30].x-(a.x+z.x)/2)*dy)/(span*span);
 if(!Number.isFinite(yaw)||!Number.isFinite(pitch)||pitch<.15||pitch>.95)return {ok:false,message:'Mantenha a câmera na altura dos olhos.'};
 const turn=yaw-baseline;
 const ok=step===0?Math.abs(yaw)<.11:step===1?turn>.17&&turn<.55:turn<-.17&&turn>-.55;
 return {ok,yaw,cx,cy,message:ok?'Perfeito! Segure essa posição…':step===0?'Olhe de frente para a câmera.':Math.abs(turn)>.55?'Vire um pouco menos; mantenha os dois olhos visíveis.':step===1?'Vire levemente para sua esquerda ←':'Vire levemente para sua direita →'};
}
export class PoseHold {
 reset(){this.start=null;this.last=null;this.count=0;}
 constructor(){this.reset();}
 update(p,now){
 if(!p.ok){this.reset();return 0;}
 if(!this.last||now-this.last.time>2500||Math.abs(p.cx-this.last.cx)>.035||Math.abs(p.cy-this.last.cy)>.035||Math.abs(p.yaw-this.last.yaw)>.09){this.start=now;this.count=0;}
 this.last={...p,time:now};this.count++;
 return this.count<3?Math.min(.9,(now-this.start)/1000):Math.min(1,(now-this.start)/1000);
 }
}
