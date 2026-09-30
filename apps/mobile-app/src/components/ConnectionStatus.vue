<script setup lang="ts">
withDefaults(defineProps<{ label?: string; completed?: number; total?: number }>(), { label: '正在连接并读取记录', completed: 0, total: 0 });
</script>
<template>
  <div class="connection-status" role="status" aria-live="polite" aria-busy="true">
    <div class="connection-status__head"><span class="connection-status__spinner" aria-hidden="true"></span><div><strong>{{ label }}</strong><p>正在读取本地服务，请稍候…</p></div></div>
    <p v-if="total" class="connection-status__progress">已读取 {{ completed }} / {{ total }} 天记录</p>
    <div class="connection-status__skeleton" aria-hidden="true"><span></span><span></span><span></span></div>
  </div>
</template>
<style scoped>
.connection-status { width: 100%; min-width: 0; color: #244c5a; text-align: left; }
.connection-status__head { display: flex; align-items: center; gap: 14px; }
.connection-status strong { font-size: 15px; line-height: 1.6; }
.connection-status p { margin: 5px 0 0; font-size: 13px; line-height: 1.6; color: #607b88; }
.connection-status__spinner { flex: 0 0 26px; width: 26px; height: 26px; box-sizing: border-box; border: 3px solid #d9e9e5; border-top-color: #2d7975; border-radius: 50%; animation: connection-spin .9s linear infinite; }
.connection-status__skeleton { display: grid; gap: 10px; margin-top: 20px; }
.connection-status__skeleton span { height: 12px; border-radius: 8px; background: #dcebe7; animation: connection-pulse 1.4s ease-in-out infinite alternate; }
.connection-status__skeleton span:nth-child(2) { width: 82%; }.connection-status__skeleton span:nth-child(3) { width: 62%; }
@keyframes connection-spin { to { transform: rotate(360deg); } } @keyframes connection-pulse { to { opacity: .35; } }
@media(prefers-reduced-motion: reduce) { .connection-status__spinner, .connection-status__skeleton span { animation: none; } }
</style>
