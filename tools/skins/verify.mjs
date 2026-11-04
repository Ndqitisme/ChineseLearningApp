// Structural atlas checks plus offline browser playback, all without application services.
// Usage: node tools/skins/verify.mjs [CDP port, default 9223]
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const skin=JSON.parse(await fs.readFile(path.join(root,'public/skins/assistant/skin.json'),'utf8'));
const report=JSON.parse(await fs.readFile(path.join(root,'.cache/render3d/reference-v3/validation.json'),'utf8'));
assert.equal(report.complete,true);
assert.deepEqual(report.failures,[]);
assert.ok(report.worstPenetrationMm<=3);
const expected=['idle','breathe','blink','look','wink','think','talk','wave','happy','drag','sleep'];
for(const name of expected){
 const steps=skin.animations[name];assert.ok(steps?.length,name);
 for(const [index,ms] of steps){assert.ok(Number.isInteger(index)&&index>=0&&index<skin.count);assert.ok(ms>=0);}
 assert.equal(steps.at(-1)[1],0,`${name} must hold its final frame`);
 if(!['idle','drag','sleep'].includes(name))assert.equal(steps.at(-1)[0],skin.animations.idle[0][0]);
}
const port=process.argv[2]||'9223';
const tabs=await (await fetch(`http://localhost:${port}/json`)).json();
const tab=tabs.find(t=>t.type==='page');assert.ok(tab,'No Chrome review page');
const ws=new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej});
let id=0;const pending=new Map(),errors=[];
ws.onmessage=e=>{const msg=JSON.parse(e.data);if(msg.id){const p=pending.get(msg.id);pending.delete(msg.id);msg.error?p?.reject(msg.error):p?.resolve(msg.result)}
 else if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.text)};
const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}))});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value};
await call('Runtime.enable');await call('Page.enable');
await call('Emulation.setDeviceMetricsOverride',{width:1180,height:1000,deviceScaleFactor:1,mobile:false});
await call('Page.navigate',{url:pathToFileURL(path.join(root,'output/character/review.html')).href});
await new Promise(r=>setTimeout(r,1200));
assert.equal(await evaluate('atlas.complete && atlas.naturalWidth > 0'),true,'Atlas loads');
assert.equal(await evaluate('[...document.images].every(img => img.complete && img.naturalWidth > 0)'),true,'Review stills and references load');
assert.equal(await evaluate('atlas.naturalWidth'),skin.frameW*skin.columns);
assert.equal(await evaluate('atlas.naturalHeight'),skin.frameH*Math.ceil(skin.count/skin.columns));
for(const name of expected){
 await evaluate(`select(${JSON.stringify(name)});playing=false;tick();`);
 const state=await evaluate('({name:action,count:steps.length,range:Number(scrub.max)})');
 assert.equal(state.name,name);assert.equal(state.count,skin.animations[name].length);assert.equal(state.range,state.count-1);
 await evaluate('i=steps.length-1;draw();');
}
await evaluate('select("wave");playing=true;tick();');
const first=await evaluate('i');await new Promise(r=>setTimeout(r,240));assert.notEqual(await evaluate('i'),first,'Playback advances');
await evaluate('playing=false;i=15;tick();');
await new Promise(r=>setTimeout(r,250));
assert.equal(await evaluate('raw.get(steps[i][0])?.naturalWidth'),460,'Original render preview loads');
await evaluate('document.querySelector("#quality").value="atlas";draw();');
await evaluate('document.querySelector("#quality").value="render";draw();');
await call('Page.captureScreenshot',{format:'png'}).then(r=>fs.writeFile(path.join(root,'output/character/review-browser.png'),Buffer.from(r.data,'base64')));
await evaluate('document.querySelector("#mirror").click();');assert.equal(await evaluate('mirrored'),true);
await evaluate('document.querySelector("#scrub").value=3;document.querySelector("#scrub").dispatchEvent(new Event("input"));');assert.equal(await evaluate('i'),3);
assert.deepEqual(errors,[],'No browser exceptions');
console.log(`PASS: ${skin.count} atlas frames, ${expected.length} actions, playback, scrub, mirror, bounds and joint validation.`);
ws.close();
