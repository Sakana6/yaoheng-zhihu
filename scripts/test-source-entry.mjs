import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer } from 'vite';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

const repo = fileURLToPath(new URL('../', import.meta.url));
const normalize = value => value.replaceAll('\\', '/').split('?')[0];

for (const app of ['mobile-app', 'doctor-web']) {
  const root = path.join(repo, 'apps', app);
  const config = { root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'error' };
  const server = await createServer({
    ...config,
    // This test resolves modules and loads SSR code; it does not need a background browser pre-bundle.
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, watch: null },
  });
  try {
    const checks = [['./router', 'src/main.ts', 'src/router/index.ts'],
      ['../lib/api', app === 'mobile-app' ? 'src/views/HomeView.vue' : 'src/views/PatientDetailView.vue', 'src/lib/api.ts']];
    if (app === 'mobile-app') checks.push(['../stores/mvp', 'src/views/ProfileView.vue', 'src/stores/mvp.ts']);
    for (const [source, importer, expected] of checks) {
      const result = await server.environments.client.pluginContainer.resolveId(source, path.join(root, importer));
      assert.equal(normalize(result?.id ?? ''), normalize(path.join(root, expected)));
    }

    if (app === 'mobile-app') {
      const cache = new Map();
      cache.set('mobile-mvp-flow', JSON.stringify({ medications: [{
        id: 70000, genericName: 'Valsartan', brandName: 'Diovan', dose: '80mg',
        frequency: 'QD', administrationTime: 'AFTER_BREAKFAST', status: 'ACTIVE',
      }] }));
      const previousWindow = globalThis.window;
      globalThis.window = { localStorage: {
        getItem: key => cache.get(key) ?? null,
        setItem: (key, value) => cache.set(key, value),
      } };
      try {
        const { useMvpStore } = await server.ssrLoadModule('/src/stores/mvp.ts');
        const pinia = createPinia();
        setActivePinia(pinia);
        const store = useMvpStore(pinia);
        assert.equal(store.state.medications[0].genericName, '缬沙坦胶囊');
        store.addMedication({ id: 71001, genericName: 'Metformin', brandName: 'Glucophage',
          dose: '0.5g', frequency: 'QD', administrationTime: 'AFTER_BREAKFAST', status: 'ACTIVE' });
        assert.equal(store.state.medications[0].genericName, '二甲双胍片');
        assert.equal(store.state.reminders.length, 3);
        const reminderId = store.state.reminders[0].reminderId;
        store.updateReminderStatus(reminderId, 'DONE');
        store.generateRisk();
        await nextTick();
        assert.equal(store.state.risk.deintensificationScore, 92); // Preserve DEMO until its planned migration.
        assert.equal(store.state.reminders[0].status, 'DONE');
        assert.ok(cache.has('mobile-mvp-flow'));
        store.$dispose();

        const reloadedPinia = createPinia();
        setActivePinia(reloadedPinia);
        const reloaded = useMvpStore(reloadedPinia);
        assert.equal(reloaded.state.medications[0].id, 71001);
        assert.equal(reloaded.state.medications.length, 2);
        assert.equal(reloaded.state.reminders[0].status, 'DONE');
        assert.equal(reloaded.state.risk.deintensificationScore, 92);
        reloaded.$dispose();
        cache.set('mobile-mvp-flow', '{broken');
        const fallbackPinia = createPinia();
        setActivePinia(fallbackPinia);
        const fallback = useMvpStore(fallbackPinia);
        assert.equal(fallback.state.medications.length, 0);
        fallback.$dispose();
      } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
      }
    }
  } finally {
    await server.close();
  }

  let checked = false;
  await build({ ...config, build: { write: false }, plugins: [{
    name: 'assert-typescript-source-graph',
    generateBundle() {
      const ids = [...this.getModuleIds()].map(normalize);
      for (const expected of ['src/main.ts', 'src/router/index.ts', 'src/lib/api.ts']) {
        assert.ok(ids.includes(normalize(path.join(root, expected))), `${app}: missing ${expected}`);
      }
      if (app === 'mobile-app') assert.ok(ids.includes(normalize(path.join(root, 'src/stores/mvp.ts'))));
      for (const id of ids) {
        if (id.startsWith(normalize(path.join(root, 'src')) + '/') && id.endsWith('.js')) {
          assert.ok(!fs.existsSync(id.slice(0, -3) + '.ts'), `Legacy JS shadows TS in production: ${id}`);
        }
      }
      checked = true;
    },
  }] });
  assert.ok(checked, `${app}: production graph check did not run`);
  console.log(`PASS ${app}: development resolution and production source graph`);
}
console.log('PASS mobile DEMO: medication, reminders, risk, persisted reload and corrupt-cache recovery');
