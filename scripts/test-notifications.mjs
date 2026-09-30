import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'vite';
const root=path.resolve('apps/mobile-app');
const server=await createServer({root,configFile:path.join(root,'vite.config.ts'),optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null}});
try{
 const {NotificationQueue}=await server.ssrLoadModule('/@fs/'+path.resolve('packages/frontend/notification-core.ts').replaceAll('\\','/'));
 let pending=[],calls=0;
 const adapter={async clear(){pending=[];},async schedule(items){calls++;pending=items;}};
 const queue=new NotificationQueue(adapter);
 const occurrence=(id,status='PENDING',delay=60000)=>({occurrenceId:id,executionStatus:status,plannedAt:new Date(Date.now()+delay).toISOString()});
 await queue.sync([occurrence('a'),occurrence('b'),occurrence('done','DONE'),occurrence('past','PENDING',-10)],true);
 assert.equal(pending.length,2);assert.notEqual(pending[0].id,pending[1].id);
 assert.deepEqual(pending.map(x=>x.occurrence.occurrenceId),['a','b']);
 await queue.sync([occurrence('b')],true);assert.equal(pending.length,1);assert.equal(pending[0].occurrence.occurrenceId,'b');
 await queue.sync([occurrence('c')],false);assert.deepEqual(pending,[]);
 let release,started;
 const began=new Promise(r=>started=r);
 adapter.schedule=async items=>{started();await new Promise(r=>release=r);pending=items;};
 const inFlight=queue.sync([occurrence('stale')],true);await began;
 const logout=queue.stop();release();await Promise.all([inFlight,logout]);assert.deepEqual(pending,[]);
 adapter.schedule=async()=>{throw Error('synthetic plugin failure');};
 await assert.rejects(queue.sync([occurrence('failed')],true),/synthetic/);
 adapter.schedule=async items=>{pending=items;};await queue.sync([occurrence('new-session')],true);
 assert.equal(pending[0].occurrence.occurrenceId,'new-session');await queue.stop();assert.deepEqual(pending,[]);
 console.log('PASS notification software adapter: ID mapping, completed/past filtering, replace/cancel, permission denial, logout race, failure recovery');
}finally{await server.close();}
