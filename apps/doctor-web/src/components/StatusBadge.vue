<script setup lang="ts">
import { computed } from 'vue';

import type { BadgeTone } from '../lib/format';

const props = withDefaults(
  defineProps<{
    label: string;
    tone?: BadgeTone;
  }>(),
  {
    tone: 'neutral',
  },
);

const classes = computed(() => ['status-badge', `status-badge--${props.tone}`]);
</script>

<template>
  <span :class="classes">
    <i class="status-badge__dot" />
    {{ label }}
  </span>
</template>

<style scoped>
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  border: 1px solid transparent;
  backdrop-filter: blur(6px);
}

.status-badge__dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.88;
}

.status-badge--neutral {
  color: #5c7277;
  background: rgba(92, 114, 119, 0.12);
  border-color: rgba(92, 114, 119, 0.16);
}

.status-badge--info {
  color: #0d6670;
  background: rgba(13, 102, 112, 0.12);
  border-color: rgba(13, 102, 112, 0.18);
}

.status-badge--success {
  color: #216850;
  background: rgba(33, 104, 80, 0.12);
  border-color: rgba(33, 104, 80, 0.18);
}

.status-badge--warning {
  color: #975f00;
  background: rgba(245, 158, 11, 0.15);
  border-color: rgba(245, 158, 11, 0.2);
}

.status-badge--danger {
  color: #a33631;
  background: rgba(163, 54, 49, 0.14);
  border-color: rgba(163, 54, 49, 0.18);
}
</style>
