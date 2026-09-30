import assert from 'node:assert/strict';
import path from 'node:path';
import {createServer} from 'vite';
import {effectScope,nextTick} from 'vue';
import {createRouter,createMemoryHistory} from 'vue-router';
const root=path.resolve('apps/doctor-web');
const server=await createServer({root,configFile:path.join(root,'vite.config.ts'),optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:false},logLevel:'error'});
const originalFetch=globalThis.fetch;
const response=(data,status=200)=>new Response(JSON.stringify({code:status===200?0:status,message:'synthetic failure',data}),{status});
try {
  const identity=await server.ssrLoadModule('/@fs/'+path.resolve('packages/frontend/session.ts').replaceAll('\\','/'));
  const {useDoctorData}=await server.ssrLoadModule('/src/lib/doctor-data.ts');
  const {doctorPatientRoute,useDoctorRouting}=await server.ssrLoadModule('/src/lib/doctor-routing.ts');
  identity.session.value={token:'synthetic',userId:7,role:'DOCTOR'};identity.patients.value=[{id:42,name:'甲'},{id:73,name:'乙'}];identity.selectPatient(73);
  const seen=[];globalThis.fetch=async(url,init)=>{seen.push({url,method:init.method??'GET'});return response(url.endsWith('/profile')?null:url.includes('/medications')?{medications:[{id:91,version:2,genericName:'合成药乙'}]}:{items:[{recordId:'r73',version:3}]},url.endsWith('/profile')?503:200);};
  const ui=useDoctorData();await Promise.all([ui.loadProfile(),ui.loadMedications(),ui.loadTimeline('2026-09-29')]);
  assert.match(ui.profile.error.value,/读取失败/);assert.equal(ui.medications.value.value[0].version,2);assert.equal(ui.timeline.value.value[0].recordId,'r73');
  assert.ok(seen.every(r=>r.method==='GET'&&r.url.includes('/patients/73/')));
  globalThis.fetch=async()=>response({id:73,version:1,name:'乙'});await ui.loadProfile();assert.equal(ui.profile.error.value,'');
  const pending=[];globalThis.fetch=(url,init)=>new Promise(resolve=>pending.push({url,init,resolve}));
  const old=ui.loadTimeline('2026-09-28'),newer=ui.loadTimeline('2026-09-29');assert.deepEqual(ui.timeline.value.value,[]);
  pending[1].resolve(response({items:[{recordId:'today'}]}));await newer;pending[0].resolve(response({items:[{recordId:'yesterday'}]}));await old;assert.equal(ui.timeline.value.value[0].recordId,'today');
  const late=ui.loadMedications();identity.selectPatient(42);pending.at(-1).resolve(response({medications:[{id:999}]}));await late;assert.equal(ui.medications.value.value[0].id,91);
  ui.dispose();const count=pending.length;await ui.loadProfile();await ui.loadMedications();assert.equal(pending.length,count);
  for(const value of ['invalid','0','-1','1e2','9007199254740992'])assert.equal(doctorPatientRoute('/patients/'+value).id,null);
  const router=createRouter({history:createMemoryHistory(),routes:[{path:'/:rest(.*)*',component:{}}]});await router.push('/patients/73');await router.isReady();
  const scope=effectScope();const access=scope.run(()=>useDoctorRouting(new Proxy({}, {get:(_,key)=>router.currentRoute.value[key]}),router));
  assert.equal(identity.selectedPatient.value.id,73);assert.equal(access.ready.value,true);
  identity.selectPatient(42);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(router.currentRoute.value.path,'/patients/42');
  await router.push('/patients/73/summary?care=risk');assert.equal(identity.selectedPatient.value.id,73);identity.selectPatient(42);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(router.currentRoute.value.fullPath,'/patients/42/summary');
  for(const [care,target] of [['home','/patients'],['medications','/medications'],['records','/follow-ups'],['risk','/patients/42/summary'],['profile','/patients/42']]){await router.push('/patients?care='+care+'&keep=trace');await new Promise(resolve=>setTimeout(resolve,0));assert.equal(router.currentRoute.value.path,target);assert.equal(router.currentRoute.value.query.keep,'trace');assert.equal(router.currentRoute.value.query.care,undefined);}
  await router.push('/patients/42/summary?runId=old&snapshotId=old');identity.selectPatient(73);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(router.currentRoute.value.path,'/patients/73/summary');assert.equal(router.currentRoute.value.query.snapshotId,undefined);assert.equal(router.currentRoute.value.query.runId,undefined);identity.selectPatient(42);await new Promise(resolve=>setTimeout(resolve,0));
  await router.push('/patients/999');assert.equal(access.allowed.value,false);assert.equal(identity.selectedPatient.value.id,42);
  await router.push('/patients/73');identity.patients.value=[{id:42,name:'甲'}];assert.equal(access.allowed.value,false);assert.equal(access.ready.value,false);
  identity.clearSession();await router.push('/patients/73');identity.session.value={token:'synthetic',userId:7,role:'DOCTOR'};identity.patients.value.push({id:42,name:'甲'},{id:73,name:'乙'});identity.selectedPatient.value=identity.patients.value[0];await nextTick();assert.equal(identity.selectedPatient.value.id,73);assert.equal(access.ready.value,true);
  scope.stop();console.log('PASS UI05 doctor: read-only current-patient GETs, isolated failure/retry, date race, stale patient response, disposal, non-first-patient route/login, selector URL, summary/query, invalid ID and revoked access');
} finally {globalThis.fetch=originalFetch;await server.close();}
