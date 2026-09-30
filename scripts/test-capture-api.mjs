import assert from 'node:assert/strict';
import path from 'node:path';
import {createServer} from 'vite';
const root=path.resolve('apps/mobile-app');
const server=await createServer({root,configFile:path.join(root,'vite.config.ts'),optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:false}});
const original=globalThis.fetch;
try {
  const shared=name=>server.ssrLoadModule('/@fs/'+path.resolve('packages/frontend',name).replaceAll('\\','/'));
  const identity=await shared('session.ts'),{useCaptureApi}=await shared('capture-api.ts');
  identity.session.value={token:'synthetic',userId:1,role:'CAREGIVER'};
  identity.patients.value=[{id:1,name:'a'},{id:2,name:'b'}];identity.selectPatient(1);
  const api=useCaptureApi(),calls=[];
  globalThis.fetch=async(url,init)=>{calls.push({url,init});throw Error('offline');};
  const file=new File(['synthetic'],'label.png',{type:'image/png'});
  await assert.rejects(api.upload(file),/offline/);
  globalThis.fetch=async(url,init)=>{calls.push({url,init});return Response.json({code:0,data:{taskId:'cap_test',version:1}});};
  await api.upload(file);
  assert.equal(calls[0].init.headers.get('Idempotency-Key'),calls[1].init.headers.get('Idempotency-Key'));
  assert.equal(calls[1].init.headers.get('Content-Type'),'image/png');
  assert.equal(calls[1].init.headers.get('Authorization'),'Bearer synthetic');
  assert.equal(calls[1].init.body,file);
  await assert.rejects(api.upload(new File(['x'],'a.svg',{type:'image/svg+xml'})),/PNG/);
  let release;globalThis.fetch=()=>new Promise(r=>release=r);
  const pending=api.normalize('metformin');identity.selectPatient(2);
  release(Response.json({code:0,data:{taskId:'stale'}}));await assert.rejects(pending,/会话/);
  await assert.rejects(api.get('cap_test'),/会话/);
  console.log('PASS binary MIME, retry key, validation, auth and stale-patient capture rejection');
} finally {globalThis.fetch=original;await server.close();}
