<script setup lang="ts">
withDefaults(
  defineProps<{
    kicker?: string;
    title: string;
    subtitle?: string;
  }>(),
  {
    kicker: '',
    subtitle: '',
  },
);
</script>

<template>
  <section class="info-panel">
    <header class="info-panel__header">
      <div class="info-panel__copy">
        <p v-if="kicker" class="info-panel__kicker">{{ kicker }}</p>
        <h2 class="info-panel__title">{{ title }}</h2>
        <p v-if="subtitle" class="info-panel__subtitle">{{ subtitle }}</p>
      </div>
      <div v-if="$slots.actions" class="info-panel__actions">
        <slot name="actions" />
      </div>
    </header>
    <div class="info-panel__body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.info-panel {
  position: relative;
  display: grid;
  gap: 18px;
  padding: 22px;
  overflow: hidden;
  border-radius: 28px;
  background:
    radial-gradient(circle at top right, rgba(255, 255, 255, 0.5), transparent 28%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.9) 0%, rgba(243, 249, 252, 0.88) 100%);
  border: 1px solid var(--glass-border);
  box-shadow: var(--panel-shadow);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.info-panel::before {
  content: '';
  position: absolute;
  inset: 0 auto auto 0;
  width: 160px;
  height: 160px;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(77, 168, 204, 0.14) 0%, rgba(77, 168, 204, 0) 72%);
  transform: translate(-38%, -38%);
  pointer-events: none;
}

.info-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.info-panel__copy {
  position: relative;
  z-index: 1;
  max-width: 760px;
}

.info-panel__actions {
  position: relative;
  z-index: 1;
}

.info-panel__kicker {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent-cyan-strong);
}

.info-panel__title {
  margin: 0;
  font-size: 22px;
  line-height: 1.15;
  color: var(--ink-strong);
}

.info-panel__subtitle {
  margin: 12px 0 0;
  color: var(--ink-soft);
  line-height: 1.7;
  font-size: 14px;
}

.info-panel__body {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 18px;
}

@media (max-width: 720px) {
  .info-panel {
    padding: 22px;
    border-radius: 24px;
  }

  .info-panel__header {
    flex-direction: column;
  }

  .info-panel__title {
    font-size: 24px;
  }
}
</style>
