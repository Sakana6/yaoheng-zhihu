<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import InfoPanel from '../components/InfoPanel.vue';
import MetricCard from '../components/MetricCard.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { doctorApi } from '../lib/api';
import { formatDatasetValue } from '../lib/format';
import type { KnowledgeDataset } from '../lib/types';

import {useMock} from '../../../../packages/frontend/session';
const loading = ref(useMock);
const error = ref('');
const datasets = ref<KnowledgeDataset[]>([]);

const metrics = computed(() => {
  if(!useMock)return ['数据集','总行数','总字段数','数据来源'].map(title=>({title,value:'—',subtitle:'当前版本未开放',tone:'info' as const,progress:0}));
  const all = datasets.value;
  const totalRows = all.reduce((sum, item) => sum + item.rows.length, 0);
  const totalColumns = all.reduce((sum, item) => sum + item.columns.length, 0);

  return [
    { title: '数据集', value: all.length, subtitle: '当前知识库已挂载的模拟数据集', tone: 'info' as const, progress: 100 },
    { title: '总行数', value: '3w+', subtitle: '药品与随访记录总样本量', tone: 'success' as const, progress: 100 },
    { title: '总字段数', value: '2w+', subtitle: '用于查看传递结构的字段总量', tone: 'warning' as const, progress: 100 },
    { title: '数据来源', value: '正规医疗库', subtitle: '当前展示的是医生端调试样本', tone: 'danger' as const, progress: 100 },
  ];
});

async function loadKnowledgeBase() {
  loading.value = true;
  error.value = '';

  try {
    const response = await doctorApi.getKnowledgeBase();
    datasets.value = response.datasets;
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载知识库失败';
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  if(useMock)void loadKnowledgeBase();
});
</script>

<template>
  <div class="page-stack">
    <section class="hero-banner manage-hero">
      <div>
        <p class="hero-banner__eyebrow">Knowledge Base</p>
        <h1>知识库</h1>
        <p class="hero-banner__lead">
          {{useMock?'展示模拟药品与随访记录数据集。':'知识库管理将在后续阶段开放；当前页面不展示虚构规模或临床来源。'}}
        </p>
      </div>
    </section>

    <section v-if="loading" class="page-state">
      <p>正在加载知识库数据集...</p>
    </section>

    <section v-else-if="error" class="page-state page-state--error">
      <p>{{ error }}</p>
    </section>

    <template v-else>
      <section class="metric-grid">
        <MetricCard
          v-for="item in metrics"
          :key="item.title"
          :title="item.title"
          :value="item.value"
          :subtitle="item.subtitle"
          :tone="item.tone"
          :progress="item.progress"
        />
      </section>

      <InfoPanel
        kicker="Datasets"
        title="传递数据集总览"
        subtitle="按数据集展开字段和样本行，便于核对医生端接收到的结构。"
      >
        <div class="dataset-stack"><p v-if="!useMock">当前版本未开放知识库管理。请通过患者报告查看现有规则分析结果。</p>
          <article v-for="dataset in datasets" :key="dataset.id" class="dataset-card">
            <header class="dataset-card__head">
              <div>
                <p>{{ dataset.id }}</p>
                <h3>{{ dataset.title }}</h3>
                <span>{{ dataset.description }}</span>
              </div>
              <StatusBadge :label="`${dataset.rows.length} 行 / ${dataset.columns.length} 列`" tone="info" />
            </header>

            <div class="dataset-table">
              <div class="dataset-table__row dataset-table__row--head">
                <span v-for="column in dataset.columns" :key="column">{{ column }}</span>
              </div>

              <div
                v-for="(row, rowIndex) in dataset.rows"
                :key="`${dataset.id}-${rowIndex}`"
                class="dataset-table__row"
              >
                <span v-for="column in dataset.columns" :key="column">
                  {{ formatDatasetValue(row[column] ?? null) }}
                </span>
              </div>
            </div>
          </article>
        </div>
      </InfoPanel>
    </template>
  </div>
</template>

<style scoped>
.manage-hero {
  padding: 12px 6px 0;
}

.manage-hero h1 {
  margin: 0;
  font-size: 46px;
  line-height: 0.98;
  color: var(--ink-strong);
  letter-spacing: -0.04em;
}

.manage-hero p {
  margin: 10px 0 0;
}

.dataset-stack {
  display: grid;
  gap: 18px;
}

.dataset-card {
  display: grid;
  gap: 16px;
  padding: 20px;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(220, 230, 239, 0.92);
}

.dataset-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.dataset-card__head p {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #178494;
}

.dataset-card__head h3 {
  margin: 0;
  color: var(--ink-strong);
  font-size: 24px;
}

.dataset-card__head span {
  display: block;
  margin-top: 8px;
  color: var(--ink-soft);
  line-height: 1.7;
}

.dataset-table {
  display: grid;
  gap: 8px;
  overflow-x: auto;
}

.dataset-table__row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
  min-width: 960px;
}

.dataset-table__row span {
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(248, 251, 255, 0.82);
  border: 1px solid rgba(221, 231, 240, 0.88);
  color: #40536b;
  font-size: 13px;
  line-height: 1.6;
}

.dataset-table__row--head span {
  background: rgba(91, 132, 248, 0.1);
  border-color: rgba(91, 132, 248, 0.12);
  color: #486bda;
  font-weight: 700;
}

@media (max-width: 720px) {
  .manage-hero h1 {
    font-size: 38px;
  }

  .dataset-card__head {
    flex-direction: column;
  }
}
</style>
