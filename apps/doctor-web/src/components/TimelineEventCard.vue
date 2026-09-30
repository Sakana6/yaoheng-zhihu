<script setup lang="ts">
import { computed } from 'vue';

import {
  formatDate,
  formatDateTime,
  formatEventType,
  formatEvidenceEntries,
  formatRiskDirection,
  getRiskLevel,
} from '../lib/format';
import type { JointEvent } from '../lib/types';

import StatusBadge from './StatusBadge.vue';

const props = defineProps<{
  event: Omit<JointEvent, 'severity'> & { severity: number | null };
}>();

const severityMeta = computed(() => props.event.severity == null ? {label:'复查线索',tone:'neutral' as const} : getRiskLevel(props.event.severity));
const evidenceItems = computed(() => formatEvidenceEntries(props.event.evidence));
const eventTitle = computed(() => props.event.eventLabel || formatEventType(props.event.eventType));
</script>

<template>
  <article class="timeline-card">
    <div class="timeline-card__rail" :class="`timeline-card__rail--${severityMeta.tone}`" />

    <div class="timeline-card__head">
      <div>
        <p class="timeline-card__code">{{ event.eventType }}</p>
        <h3>{{ eventTitle }}</h3>
      </div>
      <div class="timeline-card__meta">
        <StatusBadge :label="severityMeta.label" :tone="severityMeta.tone" />
        <strong>{{ event.severity ?? '—' }}</strong>
      </div>
    </div>

    <div class="timeline-card__time">
      <span>事件日期 {{ formatDate(event.eventDate) }}</span>
      <span>时间窗 {{ formatDateTime(event.timeWindowStart) }} - {{ formatDateTime(event.timeWindowEnd) }}</span>
    </div>

    <div class="timeline-card__chips">
      <StatusBadge
        v-for="direction in event.riskDirections"
        :key="direction"
        :label="formatRiskDirection(direction)"
        tone="info"
      />
    </div>

    <dl class="timeline-card__evidence">
      <template v-for="item in evidenceItems" :key="item.label">
        <div class="timeline-card__evidence-item">
          <dt>{{ item.label }}</dt>
          <dd>{{ item.value }}</dd>
        </div>
      </template>
    </dl>
  </article>
</template>

<style scoped>
.timeline-card {
  position: relative;
  display: grid;
  gap: 18px;
  padding: 22px 22px 22px 28px;
  overflow: hidden;
  border-radius: 24px;
  background:
    radial-gradient(circle at top right, rgba(255, 255, 255, 0.44), transparent 28%),
    linear-gradient(180deg, rgba(248, 252, 251, 0.96) 0%, rgba(255, 255, 255, 0.92) 100%);
  border: 1px solid var(--glass-border);
  box-shadow: 0 12px 26px rgba(60, 102, 132, 0.08);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.timeline-card__rail {
  position: absolute;
  inset: 18px auto 18px 12px;
  width: 4px;
  border-radius: 999px;
}

.timeline-card__rail--info {
  background: linear-gradient(180deg, #2a8a94 0%, #63cabd 100%);
}

.timeline-card__rail--success {
  background: linear-gradient(180deg, #327958 0%, #6dc8a1 100%);
}

.timeline-card__rail--warning {
  background: linear-gradient(180deg, #d58a1c 0%, #f6c05a 100%);
}

.timeline-card__rail--danger {
  background: linear-gradient(180deg, #bf5a4c 0%, #ef9074 100%);
}

.timeline-card__rail--neutral {
  background: linear-gradient(180deg, #76898f 0%, #a4b2b6 100%);
}

.timeline-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.timeline-card__code {
  margin: 0 0 8px;
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent-cyan-strong);
}

.timeline-card h3 {
  margin: 0;
  font-size: 22px;
  line-height: 1.24;
  color: var(--ink-strong);
}

.timeline-card__meta {
  display: flex;
  align-items: center;
  gap: 12px;
}

.timeline-card__meta strong {
  font-size: 34px;
  line-height: 1;
  color: var(--ink-strong);
}

.timeline-card__time {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 18px;
  color: var(--ink-soft);
  font-size: 14px;
}

.timeline-card__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.timeline-card__evidence {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 14px;
  margin: 0;
}

.timeline-card__evidence-item {
  padding: 14px 16px;
  border-radius: 18px;
  background: rgba(18, 64, 70, 0.05);
}

.timeline-card__evidence dt {
  margin: 0 0 6px;
  font-size: 13px;
  color: var(--ink-muted);
}

.timeline-card__evidence dd {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.55;
  color: var(--ink-strong);
}

@media (max-width: 720px) {
  .timeline-card__head {
    flex-direction: column;
  }

  .timeline-card__meta {
    justify-content: flex-start;
  }
}
</style>
