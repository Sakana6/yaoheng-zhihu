<script setup lang="ts">
import { onMounted, ref } from 'vue';

import { mobileApi } from '../lib/api';
import {
  formatDate,
  formatDateTime,
  formatEventType,
  formatRiskDirection,
  getRiskTone,
} from '../lib/format';
import type { MobileJointEvent } from '../lib/types';

const loading = ref(true);
const error = ref('');
const jointEvents = ref<MobileJointEvent[]>([]);

onMounted(async () => {
  try {
    const data = await mobileApi.getJointEvents();
    jointEvents.value = data.jointEvents;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Request failed';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="mobile-page">
    <section v-if="loading" class="mobile-card">
      <p class="section-description">Loading joint events...</p>
    </section>

    <section v-else-if="error" class="mobile-card">
      <p class="section-description">{{ error }}</p>
    </section>

    <section v-else class="mobile-card">
      <ul class="mobile-list">
        <li
          v-for="event in jointEvents"
          :key="`${event.eventType}-${event.timeWindowStart}`"
          class="mobile-list-item"
        >
          <div class="mobile-list-item__row">
            <div>
              <p class="section-eyebrow">{{ event.eventType }}</p>
              <strong>{{ event.eventLabel || formatEventType(event.eventType) }}</strong>
            </div>
            <span :class="`status-chip status-chip--${getRiskTone(event.severity)}`">
              {{ event.severity }}
            </span>
          </div>

          <p>Date {{ formatDate(event.eventDate) }}</p>
          <p>Window {{ formatDateTime(event.timeWindowStart) }} | {{ formatDateTime(event.timeWindowEnd) }}</p>

          <div class="pill-row">
            <span v-for="direction in event.riskDirections" :key="direction" class="pill pill--soft">
              {{ formatRiskDirection(direction) }}
            </span>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
