import assert from 'node:assert/strict';
import path from 'node:path';
import {createServer} from 'vite';
const root=path.resolve('apps/mobile-app');
const server=await createServer({root,configFile:path.join(root,'vite.config.ts'),optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:false},logLevel:'error'});
const original=globalThis.fetch;
try{
 const shared=name=>server.ssrLoadModule('/@fs/'+path.resolve('packages/frontend',name).replaceAll('\\','/'));
 const identity=await shared('session.ts'),{useFeedbackDraft}=await shared('feedback-draft.ts');
 identity.session.value={token:'synthetic',userId:1,role:'CAREGIVER'};identity.patients.value=[{id:1,name:'synthetic'}];identity.selectPatient(1);
 let saves=0,requests=0,mode=true,fail=false;
 const artifact={artifactId:'rac_test',artifactHash:'a'.repeat(64),state:'READY',result:{generationMode:'DEEPSEEK',candidates:[{candidateId:'c1',kind:'BG',payload:{value:6.2},eligibleForPrefill:true,subject:'SELF',polarity:'AFFIRMED',anchor:{precision:'INTERVAL',start:'2026-09-29T00:00:00Z',future:false}},{candidateId:'c2',kind:'BP',payload:{systolic:80,diastolic:50},eligibleForPrefill:false,subject:'OTHER',polarity:'AFFIRMED',anchor:{precision:'UNKNOWN',start:null,future:false}}]}};
 globalThis.fetch=async(url,init)=>{
  if(url.endsWith('/capabilities'))return Response.json({code:0,data:{raCandidates:mode}});
  if(url.endsWith('/analysis/latest'))return Response.json({code:0,data:{inputRevision:1}});
  if(url.endsWith('/ra/candidates')){requests++;if(fail)throw Error('offline');return Response.json({code:0,data:artifact});}
  if(url.endsWith('/feedback-records')){saves++;return Response.json({code:0,data:JSON.parse(init.body)});}
  throw Error('unexpected route');
 };
 const d=useFeedbackDraft({medications:[]});d.rawText.value='昨天我血糖6.2';d.reviewed.value=true;
 assert.equal(await d.save(),undefined);assert.equal(saves,0);assert.equal(d.reviewed.value,false);
 assert.equal(d.facts.value.glucose[0].occurredAt,'','interval must not become precise time');assert.equal(d.facts.value.bloodPressure.length,0);
 d.facts.value.glucose[0].occurredAt='2026-09-29T08:00:00';d.reviewed.value=true;
 const saved=await d.save();assert.equal(saved.raArtifactId,'rac_test');assert.equal(saves,1);assert.equal(requests,1);
 d.rawText.value='修订原文';await d.save();assert.equal(requests,2);assert.equal(saves,1);
 fail=true;const offline=useFeedbackDraft({medications:[]});offline.rawText.value='离线文字';await offline.save();assert.equal(saves,1);offline.reviewed.value=true;await offline.save();assert.equal(saves,2);
 mode=false;const legacy=useFeedbackDraft({medications:[]});legacy.rawText.value='原路径';await legacy.save();assert.equal(saves,3);
 console.log('PASS candidate preview never saves, review reset, interval not invented, other excluded, edit invalidates, offline/manual and disabled paths');
}finally{globalThis.fetch=original;await server.close();}
