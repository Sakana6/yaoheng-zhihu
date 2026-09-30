<script setup lang="ts">
import { computed } from 'vue';

import type { BadgeTone } from '../lib/format';

const props = withDefaults(
  defineProps<{
    title: string;
    value: string | number;
    subtitle?: string;
    tone?: BadgeTone;
    progress?: number | null;
  }>(),
  {
    subtitle: '',
    tone: 'info',
    progress: null,
  },
);

const clampedProgress = computed(() => {
  if (typeof props.progress !== 'number') {
    return null;
  }

  return Math.min(100, Math.max(0, props.progress));
});
</script>

<template>
  <article class="metric-card" :class="`metric-card--${tone}`">
    <div class="metric-card__head">
      <p class="metric-card__title">{{ title }}</p>
      <slot name="badge" />
    </div>
    <strong class="metric-card__value">{{ value }}</strong>
    <p v-if="subtitle" class="metric-card__subtitle">{{ subtitle }}</p>
    <div v-if="clampedProgress !== null" class="metric-card__track">
      <span class="metric-card__fill" :style="{ width: `${clampedProgress}%` }" />
    </div>
  </article>
</template>

<style scoped>
.metric-card {
  position: relative;
  display: grid;
  gap: 12px;
  min-height: 160px;
  padding: 18px;
  overflow: hidden;
  border-radius: 26px;
  background:
    radial-gradient(circle at top right, rgba(255, 255, 255, 0.48), transparent 28%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.9) 0%, rgba(242, 248, 251, 0.88) 100%);
  border: 1px solid var(--glass-border);
  box-shadow: var(--panel-shadow);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}

.metric-card::after {
  content: '';
  position: absolute;
  inset: auto -36px -42px auto;
  width: 132px;
  height: 132px;
  border-radius: 999px;
  background: rgba(22, 99, 107, 0.08);
  filter: blur(6px);
}

.metric-card__head {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.metric-card__title {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(25, 62, 68, 0.68);
}

.metric-card__value {
  position: relative;
  z-index: 1;
  font-size: 28px;
  line-height: 1;
  color: var(--ink-strong);
}

.metric-card__subtitle {
  position: relative;
  z-index: 1;
  margin: 0;
  color: var(--ink-soft);
  line-height: 1.55;
  font-size: 13px;
}

.metric-card__track {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 9px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(17, 80, 87, 0.09);
}

.metric-card__fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
}

.metric-card--info .metric-card__fill {
  background: linear-gradient(90deg, #1d7d84 0%, #59c0b3 100%);
}

.metric-card--success .metric-card__fill {
  background: linear-gradient(90deg, #2e7d5a 0%, #69c79f 100%);
}

.metric-card--warning .metric-card__fill {
  background: linear-gradient(90deg, #c67b1a 0%, #f3b144 100%);
}

.metric-card--danger .metric-card__fill {
  background: linear-gradient(90deg, #b64f42 0%, #eb8b72 100%);
}
</style>
