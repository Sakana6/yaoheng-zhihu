import assert from 'node:assert/strict';
import path from 'node:path';
import {createServer} from 'vite';
const root=path.resolve('apps/mobile-app');
const server=await createServer({root,configFile:path.join(root,'vite.config.ts'),optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:false},logLevel:'error'});
const original=globalThis.fetch;
try {
  const shared=name=>server.ssrLoadModule('/@fs/'+path.resolve('packages/frontend',name).replaceAll('\\','/'));
  const identity=await shared('session.ts'),{useMedicationCapture}=await shared('medication-capture.ts');
  identity.session.value={token:'synthetic',userId:1,role:'CAREGIVER'};
  identity.patients.value=[{id:1,name:'synthetic'}];identity.selectPatient(1);
  const response=data=>Response.json({code:0,data});
  let state={taskId:'cap_test',kind:'TEXT',status:'REJECTED',version:2,result:{candidates:[]}},processed=0;
  globalThis.fetch=async(url,init)=>{
    if(url.endsWith('/process')){processed++;assert.equal(JSON.parse(init.body).expectedVersion,2);state={...state,status:'CANDIDATE_READY',version:4};}
    return response(state);
  };
  const capture=useMedicationCapture();await capture.normalize('代文');
  assert.equal(processed,1,'same rejected text must be reprocessed');assert.equal(capture.task.value.status,'CANDIDATE_READY');
  globalThis.fetch=async()=>{throw Error('offline')};await capture.normalize('另一个药名');
  assert.equal(capture.task.value,null,'a failed new input must not retain the previous evidence binding');assert.deepEqual(capture.confirmation(),{});
  globalThis.fetch=async()=>response(state);
  state={...state,status:'CONFIRMED',version:5};await capture.normalize('代文');assert.equal(processed,1);assert.throws(()=>capture.confirmation(),/已确认/);
  capture.reset();
  // Cancellation while the authoritative GET is pending must abort that GET and never revive a task.
  let entered,signal;const waiting=new Promise(resolve=>entered=resolve);
  globalThis.fetch=async(url,init)=>{
    if(url.endsWith('/text'))return response({...state,status:'CANDIDATE_READY'});
    signal=init.signal;entered();return new Promise((resolve,reject)=>signal?.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));
  };
  const pending=capture.normalize('新草稿');await waiting;capture.reset();
  assert.ok(signal?.aborted,'reset must abort authoritative state read');await pending;
  assert.equal(capture.task.value,null);assert.equal(capture.busy.value,false);
  // A purged image is retained as history but must not be presented as a new successful recognition.
  globalThis.fetch=async()=>response({...state,kind:'IMAGE',status:'CANDIDATE_READY',fileDeleted:true});
  await capture.recognize(new File(['synthetic'],'test.png',{type:'image/png'}));
  assert.match(capture.message.value,/清理|不可用/);
  globalThis.fetch=async()=>{throw Error('image upload offline')};
  await capture.recognize(new File(['new image'],'new.png',{type:'image/png'}));
  assert.equal(capture.task.value,null,'failed replacement image must not bind the previous evidence');
  assert.deepEqual(capture.confirmation(),{});
  capture.reset();
  console.log('PASS rejected-text retry, terminal confirmation, cancellation propagation and purged-image presentation');
  const {useVoiceCapture}=await shared('voice-capture.ts');
  const voice=useVoiceCapture(),audio=new Blob(['synthetic'],{type:'audio/wav'});
  state={taskId:'voice',kind:'VOICE',status:'CANDIDATE_READY',version:1,result:{text:'not taken'}};
  globalThis.fetch=async()=>response(state);await voice.transcribe(audio);assert.equal(voice.task.value.taskId,'voice');
  let resolveUpload,started;const start=new Promise(r=>started=r);
  globalThis.fetch=()=>new Promise(r=>{resolveUpload=r;started();});
  const next=voice.transcribe(audio);await start;
  assert.equal(voice.task.value,null,'new upload must hide old actionable candidate');voice.cancel();
  resolveUpload(response(state));await next;assert.equal(voice.task.value,null,'cancelled upload cannot revive a preview');
  globalThis.fetch=async(url,init)=>{if(url.endsWith('/reject'))state={...state,status:'REJECTED',version:2};return response(state);};
  await voice.transcribe(audio);await voice.reject();assert.equal(voice.task.value.status,'REJECTED');
  let uploadKey;
  globalThis.fetch=async(url,init)=>{if(url.endsWith('/voice')&&init.method==='POST')uploadKey=init.headers.get('Idempotency-Key');return response({...state,status:'CANDIDATE_READY',version:3});};
  await voice.transcribe(audio);assert.ok(uploadKey);assert.equal(voice.task.value.status,'CANDIDATE_READY');
  voice.dispose();assert.equal(voice.task.value,null);assert.equal(voice.busy.value,false);
  console.log('PASS voice replacement, cancellation, stale responses, reject/retry and disposal');
} finally {globalThis.fetch=original;await server.close();}
