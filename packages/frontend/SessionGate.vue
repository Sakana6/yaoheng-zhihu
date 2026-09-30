<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { startReminderNotifications } from './notification-session';
import { login, logout, patients, selectedPatient, selectPatient, session, sessionEpoch, useMock, refreshPatients } from './session';
withDefaults(defineProps<{ showHeader?: boolean }>(), { showHeader: true });
const mobile = ref('');
const password = ref('');
const busy = ref(false);
const error = ref('');
const localTestMobile = (import.meta.env.VITE_LOCAL_TEST_MOBILE ?? '').trim();
const localTestPassword = import.meta.env.VITE_LOCAL_TEST_PASSWORD ?? '';
const localHostname = typeof window === 'undefined' || ['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname);
const localTestLoginEnabled = import.meta.env.DEV && localHostname && !!localTestMobile && !!localTestPassword;
// A webview reload loses its in-memory identity; remove the prior session's native notifications too.
let stopNotifications: (() => void) | undefined;
onMounted(()=>{if(!useMock)stopNotifications=watch([sessionEpoch,selectedPatient,session],(_,__,cleanup)=>{
  cleanup(startReminderNotifications());
},{immediate:true,flush:'sync'});});
onUnmounted(()=>stopNotifications?.());
async function authenticate(account: string, secret: string) {
  if (busy.value) return;
  busy.value = true; error.value = '';
  try { await login(account, secret); password.value = ''; }
  catch (e) { error.value = e instanceof Error ? e.message : '登录失败'; }
  finally { busy.value = false; }
}
async function leave() { try { await logout(); } catch { error.value = '本地已退出；服务端会话将在到期后失效。'; } }
async function submit() { await authenticate(mobile.value, password.value); }
async function loginLocalTestAccount() { if (localTestLoginEnabled) await authenticate(localTestMobile, localTestPassword); }
async function refresh(){try{await refreshPatients();error.value='';}catch(e){error.value=String(e);}}
</script>
<template>
  <slot v-if="useMock" :has-patient="true" />
  <form v-else-if="!session" class="session-login" @submit.prevent="submit">
    <h1>药衡智护 · 本地试用登录</h1>
    <button v-if="localTestLoginEnabled" class="local-test-login" type="button" :disabled="busy" @click="loginLocalTestAccount">
      {{ busy ? '登录中…' : '一键登录本地测试账号' }}
    </button>
    <details v-if="localTestLoginEnabled" class="manual-login">
      <summary>使用其他账号</summary>
      <label>账号<input v-model="mobile" autocomplete="username" /></label>
      <label>密码<input v-model="password" type="password" autocomplete="current-password" /></label>
      <button :disabled="busy || !mobile || !password">{{ busy ? '登录中…' : '登录其他账号' }}</button>
    </details>
    <template v-else>
      <label>账号<input v-model="mobile" autocomplete="username" required /></label>
      <label>密码<input v-model="password" type="password" autocomplete="current-password" required /></label>
      <button :disabled="busy">{{ busy ? '登录中…' : '登录' }}</button>
    </template>
    <p role="alert">{{ error }}</p>
  </form>
  <section v-else>
    <header v-if="showHeader" class="session-bar">
      <strong>本地服务 · {{ session.role === 'DOCTOR' ? '医生查看与报告' : '家属管理' }}</strong>
      <label>当前患者
        <select :value="selectedPatient?.id" @change="selectPatient(Number(($event.target as HTMLSelectElement).value))">
          <option v-for="patient in patients" :key="patient.id" :value="patient.id">{{ patient.name }}</option>
        </select>
      </label>
      <button @click="leave">退出登录</button>
      <button @click="refresh">刷新授权患者</button>
      <p role="alert">{{error}}</p>
    </header>
    <slot v-if="selectedPatient || !showHeader" :key="sessionEpoch" :logout="leave" :has-patient="!!selectedPatient" />
    <p v-else>当前账号没有授权患者，请联系本地管理员配置。</p>
  </section>
</template>
<style scoped>
.session-login { max-width: 460px; margin: 12vh auto; padding: 28px; background: white; border-radius: 18px; }
.session-login label { display: grid; gap: 8px; margin: 20px 0; }
.local-test-login { width: 100%; margin-top: 20px; font-weight: 700; }
.manual-login { margin-top: 18px; }
.manual-login summary { cursor: pointer; }
input, select, button { padding: 10px; border: 1px solid #afc8c0; border-radius: 8px; }
.session-bar { display: flex; flex-wrap: wrap; gap: 18px; align-items: center; padding: 18px; background: #e8f3ef; }
[role=alert] { color: #a42e2e; }
</style>
