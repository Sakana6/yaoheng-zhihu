<script setup lang="ts">
import SessionGate from '../../../packages/frontend/SessionGate.vue';
import { useMock } from '../../../packages/frontend/session';
import { RouterLink, RouterView, useRoute } from 'vue-router';
const route = useRoute();

const navItems = [
  { to: '/medications', label: '药历', icon: 'meds' },
  { to: '/records', label: '记录', icon: 'hub' },
  { to: '/home', label: '首页', icon: 'home', featured: true },
  { to: '/risk', label: '风险', icon: 'shield' },
  { to: '/profile', label: '管理', icon: 'user' },
];
</script>

<template>
  <SessionGate :show-header="false" v-slot="{ logout, hasPatient }">
    <main class="mobile-main app-main">
      <RouterView v-if="hasPatient" v-slot="{ Component }">
        <component :is="Component">
          <template #page-footer>
            <footer v-if="!useMock && route.path === '/profile'" class="profile-session-actions">
              <button type="button" @click="logout">退出登录</button>
            </footer>
          </template>
        </component>
      </RouterView>
      <p v-else>当前账号没有授权患者，请联系本地管理员配置。</p>

      <footer v-if="!hasPatient && !useMock && route.path === '/profile'" class="profile-session-actions">
        <button type="button" @click="logout">退出登录</button>
      </footer>

    <nav class="bottom-nav bottom-nav--custom" aria-label="主导航">
      <RouterLink
        v-for="item in navItems"
        :key="item.to"
        :to="item.to"
        custom
        v-slot="{ href, navigate, isActive }"
      >
        <a
          :href="href"
          class="bottom-link bottom-link--custom"
          :class="{
            'bottom-link--active': isActive,
            'bottom-link--featured': item.featured,
            'bottom-link--featured-active': item.featured && isActive,
          }"
          @click="navigate"
        >
          <span class="bottom-link__icon" :class="`bottom-link__icon--${item.icon}`">
            <svg v-if="item.icon === 'home'" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />
            </svg>
            <svg v-else-if="item.icon === 'meds'" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 4h10a2 2 0 0 1 2 2v12.5A1.5 1.5 0 0 1 17.5 20h-11A1.5 1.5 0 0 1 5 18.5V6a2 2 0 0 1 2-2Z" />
              <path d="M9 9h6M9 13h6M9 17h4" />
            </svg>
            <svg v-else-if="item.icon === 'hub'" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4" />
              <path d="M8 5h8M12 5v14M8 19h8" />
            </svg>
            <svg v-else-if="item.icon === 'user'" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z" />
              <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
            </svg>
            <svg v-else viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3.5 6 6v5.3c0 4.3 2.5 7.3 6 9.2 3.5-1.9 6-4.9 6-9.2V6z" />
              <path d="M9.3 12.2 11 14l3.8-4" />
            </svg>
          </span>
          <span class="bottom-link__label">{{ item.label }}</span>
        </a>
      </RouterLink>
    </nav>
    </main>
  </SessionGate>
</template>

<style scoped>
.profile-session-actions { margin-top: 16px; padding: 0 4px 16px; }
.profile-session-actions button {
  width: 100%;
  padding: 14px;
  border: 1px solid #afc8c0;
  border-radius: 18px;
  color: #1f5f61;
  background: rgba(255, 255, 255, .85);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
</style>
