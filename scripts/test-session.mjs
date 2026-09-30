import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'vite';

const root = path.resolve('apps/mobile-app');
const server = await createServer({ root, configFile: path.join(root,'vite.config.ts'),
  optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, watch: null } });
const originalFetch = globalThis.fetch;
try {
  const api = await server.ssrLoadModule('/@fs/' + path.resolve('packages/frontend/session.ts').replaceAll('\\','/'));
  api.session.value = {token:'synthetic-memory-only',userId:1,role:'CAREGIVER'};
  api.selectedPatient.value = {id:1,name:'synthetic'};
  globalThis.fetch = async (_url,init) => {
    assert.equal(init.headers.get('Authorization'),'Bearer synthetic-memory-only');
    return new Response(JSON.stringify({code:0,data:{medications:[]}}),{status:200});
  };
  assert.deepEqual(await api.backendRequest('/patients/1/medications'),{medications:[]});
  globalThis.fetch = async () => new Response(JSON.stringify({code:99,message:'BUSINESS_FAILURE',data:{}}),{status:200});
  await assert.rejects(api.backendRequest('/patients'),/BUSINESS_FAILURE/);
  let finish;
  globalThis.fetch = () => new Promise(resolve => {finish=resolve;});
  const stale = api.backendRequest('/patients/1/medications');
  api.clearSession();
  finish(new Response(JSON.stringify({code:0,data:{medications:[{id:1}]}}),{status:200}));
  await assert.rejects(stale,/会话已改变/);
  assert.equal(api.session.value,null);assert.equal(api.selectedPatient.value,null);
  api.session.value={token:'expired',userId:1,role:'CAREGIVER'};
  globalThis.fetch = async () => new Response(JSON.stringify({code:401,message:'SESSION_EXPIRED',data:{}}),{status:401});
  await assert.rejects(api.backendRequest('/patients'),/SESSION_EXPIRED/);
  assert.equal(api.session.value,null);
  let releaseOldPatients, notifyOldPatients;
  const oldPatientsStarted = new Promise(resolve => { notifyOldPatients = resolve; });
  const success = data => new Response(JSON.stringify({ code: 0, data }), { status: 200 });
  globalThis.fetch = async (url, init) => {
    if (url.endsWith('/auth/password-login')) {
      const mobile = JSON.parse(init.body).mobile;
      return success({ token: mobile, userId: mobile === 'old' ? 1 : 2, role: 'CAREGIVER' });
    }
    if (init.headers.get('Authorization') === 'Bearer old') {
      notifyOldPatients();
      return new Promise(resolve => { releaseOldPatients = resolve; });
    }
    return success({ items: [{ id: 2, name: 'new patient' }], nextCursor: null });
  };
  const oldLogin = api.login('old', 'synthetic');
  const oldRejected = assert.rejects(oldLogin, /会话已改变/);
  await oldPatientsStarted;
  await api.login('new', 'synthetic');
  releaseOldPatients(success({ items: [{ id: 1, name: 'old patient' }], nextCursor: null }));
  await oldRejected;
  assert.equal(api.session.value?.userId, 2, 'an old login must not clear the new account');
  assert.equal(api.selectedPatient.value?.id, 2);
  let finishLogout;
  globalThis.fetch = () => new Promise(resolve => { finishLogout = resolve; });
  const leaving = api.logout();
  const leavingRejected = assert.rejects(leaving, /会话已改变/);
  api.selectPatient(2);
  finishLogout(success({ success: true }));
  await leavingRejected;
  assert.equal(api.session.value, null, 'patient switching must not retain a revoked session');
  console.log('PASS authorization header, business error, stale response isolation and expired-session clearing');
} finally {globalThis.fetch=originalFetch;await server.close();}
