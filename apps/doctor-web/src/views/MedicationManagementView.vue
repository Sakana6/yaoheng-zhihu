<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue';

import { useMock, selectedPatient } from '../../../../packages/frontend/session';
import { useDoctorData } from '../lib/doctor-data';
import InfoPanel from '../components/InfoPanel.vue';
import MetricCard from '../components/MetricCard.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { doctorApi } from '../lib/api';
import {
  formatAdministrationTime,
  formatDateTime,
  formatFrequency,
  formatMedicationSource,
  formatStatus,
} from '../lib/format';
import type { MedicationBoardItem } from '../lib/types';

const demoLoading=ref(true),demoError=ref(''),demoMedications=ref<MedicationBoardItem[]>([]);
const real=useDoctorData();
const loading=computed(()=>useMock?demoLoading.value:real.medications.loading.value);
const error=computed(()=>useMock?demoError.value:real.medications.error.value);
const medications=computed(()=>useMock?demoMedications.value:real.medications.value.value.map(m=>({...m,patientId:selectedPatient.value!.id,patientName:selectedPatient.value!.name,source:undefined,lastConfirmedAt:undefined,confirmedByUser:undefined,riskFlags:[] as string[],note:undefined})));
onBeforeUnmount(()=>real.dispose());

const metrics = computed(() => {
  if(!useMock){ const all=real.medications.value.value;return [
    {title:'当前患者药历',value:all.length,subtitle:'仅统计所选患者，不是全局药历',tone:'info' as const,progress:null},
    {title:'在用药物',value:all.filter(m=>m.status==='ACTIVE').length,subtitle:'当前患者使用中的记录',tone:'success' as const,progress:null},
    {title:'未标准化',value:all.filter(m=>m.standardizationStatus==='UNSTANDARDIZED').length,subtitle:'以服务端标准化状态为准',tone:'warning' as const,progress:null},
    {title:'单药风险评估',value:'—',subtitle:'未提供单药风险结果',tone:'neutral' as const,progress:null},
  ];}
  const all = demoMedications.value;
  const active = all.filter((item) => item.status === 'ACTIVE').length;
  const confirmed = all.filter((item) => item.confirmedByUser).length;
  const flagged = all.filter((item) => item.riskFlags.length > 0).length;
  const patientCount = new Set(all.map((item) => item.patientId)).size;

  return [
    { title: '全部记录', value: all.length, subtitle: '当前医生端已接收的全部用药列表', tone: 'info' as const, progress: 100 },
    { title: '在用药物', value: active, subtitle: '状态为使用中的记录', tone: 'success' as const, progress: all.length ? (active / all.length) * 100 : 0 },
    { title: '已确认', value: confirmed, subtitle: '患者或家属已完成确认', tone: 'warning' as const, progress: all.length ? (confirmed / all.length) * 100 : 0 },
    { title: '涉及患者', value: patientCount, subtitle: `其中 ${flagged} 条需要重点复核`, tone: 'danger' as const, progress: all.length ? (flagged / all.length) * 100 : 0 },
  ];
});

async function loadMedicationBoard() {
  if(!useMock){await real.loadMedications();return;}
  demoLoading.value = true;
  demoError.value = '';

  try {
    const response = await doctorApi.getMedicationBoard();
    demoMedications.value = response.medications;
  } catch (err) {
    demoError.value = err instanceof Error ? err.message : '加载用药列表失败';
  } finally {
    demoLoading.value = false;
  }
}

onMounted(() => {
  void loadMedicationBoard();
});
</script>

<template>
  <div class="page-stack">
    <section class="hero-banner manage-hero">
      <div>
        <p class="hero-banner__eyebrow">Medication Board</p>
        <h1>用药管理</h1><p v-if="!useMock">{{ selectedPatient?.name }} · 患者 ID {{ selectedPatient?.id }}</p><button v-if="!useMock" class="button" :disabled="loading" @click="loadMedicationBoard">刷新当前患者药历</button>
        <p class="hero-banner__lead">
          {{ useMock ? '展示医生端收到的全部药品记录。' : '仅查看当前授权患者的药历；医生端不编辑或停用药品。' }}
        </p>
      </div>
    </section>

    <section v-if="loading" class="page-state">
      <p>正在加载用药列表...</p>
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
        kicker="All Medications"
        :title="useMock ? '全部用药列表' : '当前患者用药列表'"
        subtitle="显示当前药历剂量、时序、日期与版本；缺失字段不推断。"
      >
        <p v-if="!medications.length">当前患者暂无药历。</p><div class="medication-list">
          <article v-for="item in medications" :key="item.id" class="medication-item">
            <div class="medication-item__head">
              <div>
                <p class="medication-item__patient">{{ item.patientName }} / 患者 ID {{ item.patientId }}</p>
                <h3>{{ item.genericName }}</h3>
                <p class="medication-item__brand">{{ item.brandName || '未提供商品名' }}</p>
              </div>
              <StatusBadge
                :label="formatStatus(item.status).label"
                :tone="formatStatus(item.status).tone"
              />
            </div>

            <dl class="medication-item__grid">
              <div>
                <dt>剂量</dt>
                <dd>{{ item.dose }}<span v-if="'version' in item"> · 药历版本 {{ item.version }}</span></dd>
              </div>
              <div>
                <dt>频次</dt>
                <dd>{{ formatFrequency(item.frequency) }}</dd>
              </div>
              <div>
                <dt>服药时序</dt>
                <dd>{{ formatAdministrationTime(item.administrationTime) }}</dd>
              </div>
              <div>
                <dt>数据来源</dt>
                <dd>{{ item.source ? formatMedicationSource(item.source) : '未提供' }}</dd>
              </div>
              <div>
                <dt>{{ useMock ? '最近确认' : '起止日期' }}</dt>
                <dd>{{ useMock ? formatDateTime(item.lastConfirmedAt) : item.startDate + ' 至 ' + (item.endDate || '未设置结束') }}</dd>
              </div>
              <div>
                <dt>确认状态</dt>
                <dd>{{ item.confirmedByUser == null ? '未提供' : item.confirmedByUser ? '已确认' : '待确认' }}</dd>
              </div>
            </dl>

            <div v-if="item.riskFlags.length" class="medication-item__flags">
              <span v-for="flag in item.riskFlags" :key="flag" class="tag">{{ flag }}</span>
            </div>

            <p v-if="item.note" class="medication-item__note">{{ item.note }}</p>
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

.medication-list {
  display: grid;
  gap: 16px;
}

.medication-item {
  display: grid;
  gap: 16px;
  padding: 20px;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(220, 230, 239, 0.92);
}

.medication-item__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.medication-item__patient,
.medication-item__brand,
.medication-item__note {
  margin: 0;
  color: var(--ink-soft);
}

.medication-item__patient {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #178494;
}

.medication-item h3 {
  margin: 8px 0 6px;
  font-size: 24px;
  color: var(--ink-strong);
}

.medication-item__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin: 0;
}

.medication-item__grid dt {
  margin: 0 0 6px;
  font-size: 13px;
  color: var(--ink-muted);
}

.medication-item__grid dd {
  margin: 0;
  font-weight: 700;
  color: var(--ink-strong);
}

.medication-item__flags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.medication-item__note {
  line-height: 1.7;
}

@media (max-width: 900px) {
  .medication-item__grid {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 720px) {
  .manage-hero h1 {
    font-size: 38px;
  }

  .medication-item__head,
  .medication-item__grid {
    grid-template-columns: 1fr;
    flex-direction: column;
  }
}
</style>
