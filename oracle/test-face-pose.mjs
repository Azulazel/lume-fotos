
import assert from 'node:assert/strict';
import {assessPose,PoseHold} from './face-pose.js';
function face(yaw=0,overrides={}) {
 const positions=Array.from({length:68},()=>({x:240,y:280}));
 for(let i=36;i<42;i++)positions[i]={x:190,y:250};
 for(let i=42;i<48;i++)positions[i]={x:290,y:250};
 positions[30]={x:240+yaw*100,y:300};
 return {detection:{box:{x:140,y:150,width:200,height:330,...overrides}},landmarks:{positions}};
}
const check=(f,step,base=0)=>assessPose(f,480,640,step,base);
assert.equal(check([face()],0).ok,true);
assert.equal(check([face(.3)],0).ok,false);
assert.equal(check([face(.3)],1).ok,true); // User left = raw image right = mirrored preview left.
assert.equal(check([face(-.3)],1).ok,false);
assert.equal(check([face(-.3)],2).ok,true);
assert.equal(check([face(.3)],2).ok,false);
assert.equal(check([face(.7)],1).ok,false);
assert.equal(check([face(.23)],1,.08).ok,false);
assert.equal(check([],0).ok,false);
assert.equal(check([face(),face()],0).ok,false);
assert.equal(check([face(0,{width:80})],0).ok,false);
assert.equal(check([face(0,{x:10})],0).ok,false);
const hold=new PoseHold(),good=check([face()],0);
assert.equal(hold.update(good,0),0);
assert.ok(hold.update(good,500)<1);
assert.equal(hold.update(good,1100),1);
hold.update({ok:false},1200);
assert.equal(hold.update(good,1300),0);
assert.equal(hold.update({...good,cx:good.cx+.05},1800),0);
assert.equal(hold.update(good,5000),0);
console.log('PASS: front, left/right mirrored directions, wrong angle, framing, multiple faces, stable hold and resets.');
