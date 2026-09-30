<script setup lang="ts">
defineProps<{
  title: string;
  description: string;
  checklist: string[];
}>();
</script>

<template>
  <section class="card">
    <p class="section-kicker">Frozen Scope</p>
    <h2>{{ title }}</h2>
    <p class="section-description">{{ description }}</p>
    <ul class="checklist">
      <li v-for="item in checklist" :key="item">{{ item }}</li>
    </ul>
    <slot />
  </section>
</template>
