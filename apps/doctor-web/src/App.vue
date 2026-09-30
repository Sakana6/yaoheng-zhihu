<script setup lang="ts">
import SessionGate from '../../../packages/frontend/SessionGate.vue';
import { useMock, selectedPatient, session, sessionEpoch } from '../../../packages/frontend/session';
import { computed } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { useDoctorRouting } from './lib/doctor-routing';

import { doctorRuntimeConfig } from './lib/api';
import gardenBg from '../static/pictures/宁静花园中的晨光小径.png';

interface NavItem {
  label: string;
  icon: string;
  to: string;
  badge?: string;
}

const route = useRoute();
const {allowed,ready}=useDoctorRouting(route,useRouter());
const migratingLegacy=computed(()=>!useMock&&typeof route.query.care==='string'&&['home','medications','records','risk','profile'].includes(route.query.care));

const doctorProfile = {
  name: '张医生',
  title: '主任医师 / 心内与慢病联合门诊',
  completion: 66,
};

const navItems = computed<NavItem[]>(() => [
  {
    label: '工作台',
    icon: 'M12 3.2 3.5 9.8v8.4a1 1 0 0 0 1 1h5.2v-5.2h4.6V19h5.2a1 1 0 0 0 1-1V9.8L12 3.2Z',
    to: '/patients',
  },
  {
    label: '患者管理',
    icon: 'M12 12.5a4.2 4.2 0 1 0-4.2-4.2 4.2 4.2 0 0 0 4.2 4.2Zm-7.4 8.3a6.7 6.7 0 0 1 13.4 0M19.2 9.1a3.1 3.1 0 1 0-3.1-3.1m4.4 14.8a5 5 0 0 0-3.2-4.7',
    to: `/patients/${useMock ? 1 : selectedPatient.value?.id ?? ''}`,
  },
  {
    label: '用药管理',
    icon: 'M8 4.5h8.2A1.8 1.8 0 0 1 18 6.3v13.2a1.8 1.8 0 0 1-1.8 1.8H7.8A1.8 1.8 0 0 1 6 19.5V6.3A1.8 1.8 0 0 1 7.8 4.5Zm2.8-2.1h2.4m-4.8 7.2h7.2m-7.2 4.3h7.2',
    to: '/medications',
  },
  {
    label: '随访管理',
    icon: 'M7.2 5.4h9.6a2 2 0 0 1 2 2v9.2a2 2 0 0 1-2 2H11l-4.6 3.2v-3.2H7.2a2 2 0 0 1-2-2V7.4a2 2 0 0 1 2-2Zm2.5 4.3h4.6m-4.6 3.5h6.6',
    to: '/follow-ups',
  },
  {
    label: '知识库',
    icon: 'M7.5 4.6h9a2 2 0 0 1 2 2v10.8a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V6.6a2 2 0 0 1 2-2Zm2.4 3.5h4.8m-4.8 4h4.8m-4.8 4h3.1',
    to: '/knowledge-base',
    badge: 'NEW',
  },
]);

const activeRouteLabel = computed(() => String(route.meta.title ?? '工作台'));

function isNavItemActive(item: NavItem): boolean {
  if (route.path === item.to) {
    return true;
  }

  if (item.label === '患者管理') {
    return /^\/patients\/\d+$/.test(route.path) && !route.path.endsWith('/summary');
  }

  return false;
}

const shellStyle = computed(() => ({
  '--doctor-shell-bg': `url(${gardenBg})`,
}));
</script>

<template>
  <SessionGate :show-header="false" v-slot="{ logout, hasPatient }">
    <section v-if="!useMock && session?.role !== 'DOCTOR'" class="page-state">
      <p role="alert">当前账号无医生端访问权限，请切换医生账号。</p>
      <button type="button" class="button" @click="logout">退出登录</button>
    </section>
    <div v-else class="doctor-shell" :style="shellStyle">
    <aside class="doctor-sidebar">
      <div class="sidebar-brand">
        <div class="sidebar-brand__mark">
          <div class="sidebar-brand__logo-ring">
            <span>YH</span>
          </div>
        </div>
        <div>
          <h1>药衡智护</h1>
          <p>医生端工作台</p>
        </div>
      </div>

      <nav class="sidebar-nav">
        <RouterLink
          v-for="item in navItems"
          :key="item.label"
          :to="item.to"
          class="sidebar-link"
          :class="{ 'is-active': isNavItemActive(item) }"
        >
          <span class="sidebar-link__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path :d="item.icon" />
            </svg>
          </span>
          <span class="sidebar-link__label">{{ item.label }}</span>
          <span v-if="item.badge" class="sidebar-link__badge">{{ item.badge }}</span>
        </RouterLink>
      </nav>

      <button type="button" class="sidebar-settings">
        <span class="sidebar-link__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="M12 8.3a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Zm8.1 3-.9-.3a7 7 0 0 0-.6-1.5l.5-.8a1 1 0 0 0-.1-1.3l-1-1a1 1 0 0 0-1.3-.1l-.8.5a7 7 0 0 0-1.5-.6l-.3-.9a1 1 0 0 0-.9-.7h-1.4a1 1 0 0 0-.9.7l-.3.9a7 7 0 0 0-1.5.6l-.8-.5a1 1 0 0 0-1.3.1l-1 1a1 1 0 0 0-.1 1.3l.5.8a7 7 0 0 0-.6 1.5l-.9.3a1 1 0 0 0-.7.9v1.4a1 1 0 0 0 .7.9l.9.3a7 7 0 0 0 .6 1.5l-.5.8a1 1 0 0 0 .1 1.3l1 1a1 1 0 0 0 1.3.1l.8-.5a7 7 0 0 0 1.5.6l.3.9a1 1 0 0 0 .9.7h1.4a1 1 0 0 0 .9-.7l.3-.9a7 7 0 0 0 1.5-.6l.8.5a1 1 0 0 0 1.3-.1l1-1a1 1 0 0 0 .1-1.3l-.5-.8a7 7 0 0 0 .6-1.5l.9-.3a1 1 0 0 0 .7-.9v-1.4a1 1 0 0 0-.7-.9Z"
            />
          </svg>
        </span>
        <span class="sidebar-link__label">设置</span>
      </button>

      <section v-if="useMock" class="doctor-profile-card">
        <div class="doctor-profile-card__head">
          <div class="doctor-profile-card__avatar">张</div>
          <div>
            <strong>{{ doctorProfile.name }}</strong>
            <p>{{ doctorProfile.title }}</p>
          </div>
        </div>

        <div class="doctor-profile-card__progress">
          <div class="doctor-profile-card__meta">
            <span>今日工作已完成 {{ doctorProfile.completion }}%</span>
            <button type="button" aria-label="更多">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="m8 10 4 4 4-4" />
              </svg>
            </button>
          </div>
          <div class="doctor-profile-card__track">
            <span :style="{ width: `${doctorProfile.completion}%` }"></span>
          </div>
        </div>
      </section>
    </aside>

    <main class="doctor-main">
      <header class="doctor-topbar">
        <div class="doctor-topbar__crumb">
          <span>医生端工作台</span>
          <strong>{{ activeRouteLabel }}</strong>
        </div>

        <div class="doctor-topbar__tools">
          <label class="doctor-search">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M10.8 18a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4Zm9 2-4.1-4.1" />
            </svg>
            <input type="text" placeholder="搜索患者、用药、随访记录..." />
            <kbd>⌘K</kbd>
          </label>

          <div class="doctor-online-chip">
            <i></i>
            <span>{{ doctorRuntimeConfig.useMock ? '在线' : '在线' }}</span>
          </div>
        </div>
      </header>

      <section v-if="!useMock && !hasPatient && route.path !== '/patients'" class="page-state">当前账号没有授权患者，请从工作台刷新患者列表。<RouterLink to="/patients">返回工作台</RouterLink></section>
      <section v-else-if="!useMock && !allowed" class="page-state" role="alert">没有该患者的访问权限。请从工作台选择授权患者。<RouterLink to="/patients">返回工作台</RouterLink></section>
      <p v-else-if="migratingLegacy && hasPatient" class="page-state">正在恢复原页面入口…</p>
      <RouterView v-else-if="useMock || ready" :key="route.path + ':' + sessionEpoch" />
      <p v-else class="page-state">正在切换授权患者…</p>
      <footer v-if="!useMock && (!hasPatient || /^\/patients\/[^/]+\/?$/.test(route.path))" class="doctor-session-actions">
        <button type="button" class="button" @click="logout">退出登录</button>
      </footer>
    </main>
    </div>
  </SessionGate>
</template>

<style scoped>
.doctor-session-actions { display: flex; justify-content: flex-end; padding: 12px 0; }
.doctor-shell {
  position: relative;
  display: grid;
  grid-template-columns: 212px minmax(0, 1fr);
  gap: 22px;
  min-height: 100vh;
  padding: 32px;
  background:
    linear-gradient(180deg, rgba(244, 249, 255, 0.72), rgba(239, 245, 252, 0.64)),
    var(--doctor-shell-bg) center / cover no-repeat;
}

.doctor-shell::before {
  content: '';
  position: absolute;
  inset: 18px;
  border-radius: 28px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.24), rgba(255, 255, 255, 0.08));
  pointer-events: none;
}

.doctor-sidebar,
.doctor-main {
  position: relative;
  z-index: 1;
}

.doctor-sidebar {
  position: sticky;
  top: 32px;
  align-self: start;
  display: flex;
  flex-direction: column;
  gap: 24px;
  height: calc(100vh - 64px);
  padding: 24px 16px 18px;
  border-radius: 24px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.74), rgba(255, 255, 255, 0.6));
  border: 1px solid rgba(255, 255, 255, 0.72);
  box-shadow:
    0 20px 50px rgba(73, 108, 149, 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.75);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  overflow-y: auto;
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 8px 0;
}

.sidebar-brand__mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(59, 173, 151, 0.2), rgba(62, 109, 233, 0.12));
}

.sidebar-brand__logo-ring {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 999px;
  border: 2px solid rgba(51, 137, 126, 0.72);
  color: #257464;
  font-size: 10px;
  font-weight: 800;
}

.sidebar-brand h1 {
  margin: 0;
  font-size: 18px;
  line-height: 1.1;
  color: #29435f;
}

.sidebar-brand p {
  margin: 6px 0 0;
  color: #7d8ea8;
  font-size: 13px;
}

.sidebar-nav {
  display: grid;
  gap: 6px;
}

.sidebar-link,
.sidebar-settings {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 0 14px;
  border-radius: 14px;
  color: #4a5f7b;
  background: transparent;
  border: 1px solid transparent;
  transition:
    background-color 180ms ease,
    color 180ms ease,
    transform 180ms ease,
    box-shadow 180ms ease;
}

.sidebar-link:hover,
.sidebar-settings:hover,
.sidebar-link.is-active {
  color: #4471f3;
  background: rgba(72, 116, 244, 0.12);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.52);
}

.sidebar-link__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
}

.sidebar-link__icon svg {
  width: 20px;
  height: 20px;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.sidebar-link__label {
  flex: 1 1 auto;
  text-align: left;
  font-size: 15px;
  font-weight: 600;
}

.sidebar-link__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 40px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: rgba(72, 116, 244, 0.12);
  color: #5a80f5;
  font-size: 11px;
  font-weight: 700;
}

.sidebar-settings {
  margin-top: auto;
}

.doctor-profile-card {
  display: grid;
  gap: 18px;
  padding: 16px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.76);
  border: 1px solid rgba(255, 255, 255, 0.82);
  box-shadow: 0 16px 30px rgba(89, 110, 142, 0.1);
}

.doctor-profile-card__head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.doctor-profile-card__avatar {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 14px;
  background: linear-gradient(135deg, #5b84f8, #8aa9ff);
  color: #fff;
  font-size: 18px;
  font-weight: 700;
  box-shadow: 0 10px 18px rgba(91, 132, 248, 0.24);
}

.doctor-profile-card strong {
  display: block;
  color: #2e4560;
  font-size: 16px;
}

.doctor-profile-card p {
  margin: 4px 0 0;
  color: #7d8ea8;
  font-size: 13px;
}

.doctor-profile-card__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  color: #485e78;
  font-size: 13px;
  font-weight: 600;
}

.doctor-profile-card__meta button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  background: rgba(84, 102, 130, 0.08);
  color: #637998;
}

.doctor-profile-card__meta svg {
  width: 16px;
  height: 16px;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.doctor-profile-card__track {
  position: relative;
  height: 10px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(133, 153, 182, 0.18);
}

.doctor-profile-card__track span {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
  background: linear-gradient(90deg, #49c99b, #96d8f6);
}

.doctor-main {
  display: grid;
  gap: 20px;
  min-width: 0;
}

.doctor-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 4px 0;
}

.doctor-topbar__crumb {
  display: grid;
  gap: 4px;
}

.doctor-topbar__crumb span {
  color: #89a0bd;
  font-size: 13px;
  font-weight: 600;
}

.doctor-topbar__crumb strong {
  color: #354a67;
  font-size: 20px;
}

.doctor-topbar__tools {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
}

.doctor-search {
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(100%, 420px);
  min-height: 52px;
  padding: 0 16px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.78);
  box-shadow: 0 16px 36px rgba(96, 119, 151, 0.08);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.doctor-search svg {
  width: 20px;
  height: 20px;
  stroke: #95a4bb;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
  fill: none;
}

.doctor-search input {
  flex: 1 1 auto;
  border: 0;
  outline: 0;
  background: transparent;
  color: #3b4d66;
  font-size: 14px;
}

.doctor-search input::placeholder {
  color: #9babc0;
}

.doctor-search kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 34px;
  height: 24px;
  padding: 0 8px;
  border-radius: 8px;
  background: rgba(149, 164, 187, 0.12);
  color: #95a4bb;
  font-size: 11px;
  font-weight: 700;
}

.doctor-online-chip {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  padding: 0 18px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.78);
  color: #3f6e5d;
  font-size: 14px;
  font-weight: 700;
  box-shadow: 0 16px 36px rgba(96, 119, 151, 0.08);
}

.doctor-online-chip i {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: #51c981;
  box-shadow: 0 0 0 5px rgba(81, 201, 129, 0.12);
}

@media (max-width: 1200px) {
  .doctor-shell {
    grid-template-columns: 1fr;
  }

  .doctor-sidebar {
    position: relative;
    top: auto;
    align-self: stretch;
    height: auto;
    min-height: auto;
    overflow: visible;
  }
}

@media (max-width: 720px) {
  .doctor-shell {
    padding: 18px;
  }

  .doctor-topbar,
  .doctor-topbar__tools {
    flex-direction: column;
    align-items: stretch;
  }

  .doctor-search {
    width: 100%;
  }
}
</style>
