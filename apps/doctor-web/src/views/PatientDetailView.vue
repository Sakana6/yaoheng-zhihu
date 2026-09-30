<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { RouterLink, useRoute } from 'vue-router';

import { useMock, selectedPatient } from '../../../../packages/frontend/session';
import { useAnalysisState, analysisLabels } from '../../../../packages/frontend/analysis-state';
import { shanghaiDate, localInput, displayTime } from '../../../../packages/frontend/care';
import { useDoctorData } from '../lib/doctor-data';
import InfoPanel from '../components/InfoPanel.vue';
import MetricCard from '../components/MetricCard.vue';
import StatusBadge from '../components/StatusBadge.vue';
import TimelineEventCard from '../components/TimelineEventCard.vue';
import { doctorApi } from '../lib/api';
import {
  buildReviewSuggestions,
  calculateAge,
  formatAdministrationTime,
  formatDate,
  formatDigitalAbility,
  formatDiseaseTag,
  formatEventCategory,
  formatFrequency,
  formatGender,
  formatLivingStatus,
  formatStatus,
  formatTime,
  formatReviewPriority,
  getMetricMeta,
  getRiskLevel,
} from '../lib/format';
import type {
  DailyPatientEvent,
  JointEvent,
  PatientMedication,
  PatientProfile,
  RiskLatest,
} from '../lib/types';

const route = useRoute();
const demoLoading = ref(true);
const demoTimelineLoading = ref(false);
const demoError = ref('');
const demoProfile = ref<PatientProfile | null>(null);
const demoMedications = ref<PatientMedication[]>([]);
const demoJointEvents = ref<JointEvent[]>([]);
const demoDailyEvents = ref<DailyPatientEvent[]>([]);
const demoRisk = ref<RiskLatest | null>(null);
const selectedEventDate = ref('');

const patientId = computed(() => {
  const routeId = Number(route.params.patientId);
  return useMock ? Number.isNaN(routeId) || routeId <= 0 ? 1 : routeId : routeId;
});

const demoAge = computed(() => calculateAge(demoProfile.value?.birthday));
const demoPriorityMeta = computed(() =>
  demoRisk.value ? formatReviewPriority(demoRisk.value.reviewPriority) : null,
);

const demoRiskCards = computed(() => {
  if (!demoRisk.value) {
    return [];
  }

  return ([
    { key: 'deintensificationScore', score: demoRisk.value.deintensificationScore },
    { key: 'interactionScore', score: demoRisk.value.interactionScore },
    { key: 'behaviorScore', score: demoRisk.value.behaviorScore },
    { key: 'jointEventScore', score: demoRisk.value.jointEventScore },
  ] as const).map(({ key, score }) => ({
    ...getMetricMeta(key),
    score,
    level: getRiskLevel(score),
  }));
});

const demoSuggestions = computed(() =>
  demoRisk.value ? buildReviewSuggestions(demoRisk.value, demoJointEvents.value) : [],
);

const demoEventDates = computed(() =>
  [...new Set(demoJointEvents.value.map((item) => item.eventDate).filter(Boolean) as string[])],
);

const demoVisibleJointEvents = computed(() => {
  if (!selectedEventDate.value) {
    return demoJointEvents.value;
  }

  return demoJointEvents.value.filter((item) => item.eventDate === selectedEventDate.value);
});

async function loadDailyEvents(date: string) {
  if (!date) {
    demoDailyEvents.value = [];
    return;
  }

  demoTimelineLoading.value = true;

  try {
    const response = await doctorApi.getDailyEvents(patientId.value, date);
    demoDailyEvents.value = response.events;
  } catch (err) {
    demoError.value = err instanceof Error ? err.message : '加载当日事件失败';
  } finally {
    demoTimelineLoading.value = false;
  }
}

async function loadPatientDetail() {
  demoLoading.value = true;
  demoError.value = '';

  try {
    const [profileData, medicationData, jointEventData, riskData] = await Promise.all([
      doctorApi.getProfile(patientId.value),
      doctorApi.getMedications(patientId.value),
      doctorApi.getJointEvents(patientId.value),
      doctorApi.getRisk(patientId.value),
    ]);

    demoProfile.value = profileData;
    demoMedications.value = medicationData.medications;
    demoJointEvents.value = jointEventData.jointEvents;
    demoRisk.value = riskData;

    const defaultDate = jointEventData.jointEvents[0]?.eventDate ?? '';
    if (defaultDate !== selectedEventDate.value) {
      selectedEventDate.value = defaultDate;
    } else if (defaultDate) {
      await loadDailyEvents(defaultDate);
    }
  } catch (err) {
    demoError.value = err instanceof Error ? err.message : '请求失败';
  } finally {
    demoLoading.value = false;
  }
}

if(useMock) watch(patientId, loadPatientDetail, { immediate: true });
if(useMock) watch(selectedEventDate, (date) => {
  void loadDailyEvents(date);
});

const real=useDoctorData(), analysis=useAnalysisState();
const {snapshot,latest,error:analysisError,evidenceReference,evidenceRevision,evidenceError,evidenceLoading}=analysis;
const profile=computed<PatientProfile|null>(()=>useMock?demoProfile.value:real.profile.value.value ?? {id:selectedPatient.value!.id,name:selectedPatient.value!.name,gender:'',birthday:'',livingStatus:'',digitalAbilityLevel:''});
const medications=computed(()=>useMock?demoMedications.value:real.medications.value.value);
const risk=computed(()=>useMock?demoRisk.value:snapshot.value?.risk?{...snapshot.value.risk,reasons:snapshot.value.jointEvents.map(e=>e.label)}:null);
const loading=computed(()=>useMock?demoLoading.value:false),error=computed(()=>useMock?demoError.value:'');
const timelineLoading=computed(()=>useMock?demoTimelineLoading.value:real.timeline.loading.value);
const age=computed(()=>calculateAge(profile.value?.birthday));
const priorityMeta=computed(()=>risk.value?formatReviewPriority(risk.value.reviewPriority):null);
const suggestions=computed(()=>useMock?demoSuggestions.value:[]);
const riskCards=computed(()=>useMock?demoRiskCards.value:([
  'deintensificationScore','interactionScore','behaviorScore','jointEventScore'
] as const).map(key=>{const score=snapshot.value?.risk?.[key]??null;return {...getMetricMeta(key),score,level:score===null?{label:'暂无评分',tone:'neutral' as const}:getRiskLevel(score)};}));
const jointEvents=computed(()=>useMock?demoJointEvents.value:(snapshot.value?.jointEvents??[]).map(e=>({
  eventId:e.eventId,eventType:e.eventType,eventLabel:e.label,eventDate:localInput(e.evidence[0]?.occurredAt??snapshot.value!.referenceTime).slice(0,10),
  severity:e.severity??null,riskDirections:[],evidence:Object.fromEntries(e.evidence.map((r,i)=>['确认事实'+(i+1),r.sourceId+' / '+r.revisionId+' / '+r.fieldPath])),
  timeWindowStart:e.window?.start,timeWindowEnd:e.window?.end,
})));
const eventDates=computed(()=>useMock?demoEventDates.value:[...new Set([shanghaiDate(),...jointEvents.value.map(e=>e.eventDate!)])]);
const visibleJointEvents=computed(()=>useMock?demoVisibleJointEvents.value:jointEvents.value.filter(e=>e.eventDate===selectedEventDate.value));
const dailyEvents=computed(()=>useMock?demoDailyEvents.value:real.timeline.value.value.map(r=>({id:r.recordId,occurredAt:r.occurredAt,category:'CONFIRMED_RECORD',title:'确认记录 · 版本 '+r.version,detail:r.rawText||'结构化确认事实',source:r.captureSource??r.source,status:'RECORDED',relatedMedication:'',indicator:'修订 '+r.revisionId})));
let active=true,timer:ReturnType<typeof setInterval>|undefined;
async function refreshDetail(){await Promise.all([real.loadProfile(),real.loadMedications(),analysis.load(),real.loadTimeline(selectedEventDate.value)]);}
if(!useMock)watch(selectedEventDate,date=>{if(date)void real.loadTimeline(date);});
onMounted(()=>{if(!useMock){selectedEventDate.value=shanghaiDate();void Promise.all([real.loadProfile(),real.loadMedications(),analysis.load()]);timer=setInterval(()=>{if(active&&document.visibilityState==='visible')void analysis.load();},5000);}});
onBeforeUnmount(()=>{active=false;clearInterval(timer);real.dispose();analysis.dispose();});
</script>

<template>
  <div class="page-stack">
    <section v-if="loading" class="page-state">
      <p>正在加载患者详情...</p>
    </section>

    <section v-else-if="error" class="page-state page-state--error">
      <p>{{ error }}</p>
    </section>

    <template v-else-if="profile">
      <section class="hero-banner detail-hero">
        <div class="detail-hero__copy">
          <p class="hero-banner__eyebrow">Patient Detail</p>
          <h1>{{ profile.name }}</h1><template v-if="!useMock"><p v-if="real.profile.error.value" role="alert">{{ real.profile.error.value }}</p><button class="button" @click="refreshDetail">刷新患者详情</button></template>
          <p class="hero-banner__lead">
            患者管理页聚合画像、风险快照、当前药历和联合事件链，并支持查看当天确认记录。
          </p>

          <div class="detail-hero__facts">
            <span>{{ age ? `${age} 岁` : '年龄未提供' }}</span>
            <span>{{ formatGender(profile.gender) }}</span>
            <span>{{ formatLivingStatus(profile.livingStatus) }}</span>
            <span>{{ formatDigitalAbility(profile.digitalAbilityLevel) }}</span>
            <span>建档于 {{ formatDate(profile.createdAt) }}</span>
          </div>

          <div class="tag-list">
            <span
              v-for="tag in profile.diseaseTags ?? []"
              :key="tag"
              class="tag"
            >
              {{ formatDiseaseTag(tag) }}
            </span>
          </div>
        </div>

        <div class="detail-hero__side">
          <div class="detail-hero__priority">
            <p class="detail-hero__side-kicker">复核判断</p>
            <StatusBadge
              v-if="priorityMeta"
              :label="priorityMeta.label"
              :tone="priorityMeta.tone"
            />
            <p>{{ useMock ? priorityMeta?.summary : snapshot ? snapshot.risk ? '复查优先级来自已发布快照；评分不是疾病概率。' : '资料不足，未生成评分。' : '尚无成功分析快照。' }}</p>

            <div class="detail-hero__reason-box">
              <span>当前首要原因</span>
              <strong>{{ risk?.reasons[0] || (useMock ? '暂无原因' : '请查看快照资料状态与确认事实') }}</strong>
            </div>

            <RouterLink :to="`/patients/${profile.id}/summary`" class="button button--primary">
              查看医生摘要
            </RouterLink>
          </div>
        </div>
      </section>

      <section class="metric-grid">
        <MetricCard
          v-for="item in riskCards"
          :key="item.title"
          :title="item.title"
          :value="item.score ?? '—'"
          :subtitle="item.subtitle"
          :tone="item.level.tone"
          :progress="item.score"
        >
          <template #badge>
            <StatusBadge :label="item.level.label" :tone="item.level.tone" />
          </template>
        </MetricCard>
      </section>

      <section class="content-grid">
        <InfoPanel
          kicker="Clinical Signals"
          title="本次复核重点"
          subtitle="先看医生最关心的判断依据与建议动作，再进入用药与事件核对。"
        >
          <template v-if="!useMock"><p v-if="analysisError" role="alert">{{ analysisError }}</p><p v-if="latest?.pendingTask">分析任务：{{ analysisLabels[latest.pendingTask.status] }}</p><p v-if="snapshot">运行 {{ snapshot.runId }} · 快照 {{ snapshot.snapshotId }} · 输入版本 {{ snapshot.inputRevision }} / 当前 {{ latest?.inputRevision }}</p><p v-if="snapshot && snapshot.inputRevision !== latest?.inputRevision">这是历史输入结果，最新记录等待分析。</p><p v-if="snapshot">{{ analysisLabels[snapshot.dataStatus] }} · 缺失项：{{ snapshot.missingFields.join('、') || '已评估范围内无缺失项' }}</p><p v-else>尚无已发布分析结果。</p><p>自动用药建议未提供，请依据原始证据复核。</p><button class="button" @click="analysis.load">刷新分析</button></template>
          <ul class="signal-bullets">
            <li v-for="reason in risk?.reasons ?? []" :key="reason">{{ reason }}</li>
          </ul>

          <div class="suggestion-grid">
            <article v-for="item in suggestions" :key="item" class="suggestion-card">
              <strong>建议动作</strong>
              <p>{{ item }}</p>
            </article>
          </div>
        </InfoPanel>

        <InfoPanel
          kicker="Medication Snapshot"
          title="当前药历"
          subtitle="保留当前患者的全部用药信息，便于和联合事件做交叉核对。"
        >
          <template v-if="!useMock"><p v-if="real.medications.error.value" role="alert">{{ real.medications.error.value }}</p><p v-if="real.medications.loading.value">正在读取药历…</p><button class="button" @click="real.loadMedications">刷新药历</button><p v-if="!medications.length && !real.medications.loading.value && !real.medications.error.value">暂无药历。</p></template>
          <div class="medication-grid">
            <article
              v-for="item in medications"
              :key="item.id"
              class="medication-card"
            >
              <div class="medication-card__head">
                <div>
                  <h3>{{ item.genericName }}</h3>
                  <p>{{ item.brandName || '未提供商品名' }}</p>
                </div>
                <StatusBadge
                  :label="formatStatus(item.status).label"
                  :tone="formatStatus(item.status).tone"
                />
              </div>

              <dl class="medication-card__detail">
                <div>
                  <dt>剂量</dt>
                  <dd>{{ item.dose }}<span v-if="'version' in item"> · 版本 {{ item.version }}</span></dd>
                </div>
                <div>
                  <dt>频次</dt>
                  <dd>{{ formatFrequency(item.frequency) }}</dd>
                </div>
                <div>
                  <dt>时序</dt>
                  <dd>{{ formatAdministrationTime(item.administrationTime) }}</dd>
                </div>
                <div>
                  <dt>起始日期</dt>
                  <dd>{{ formatDate(item.startDate) }}</dd>
                </div>
              </dl>
            </article>
          </div>
        </InfoPanel>
      </section>

      <InfoPanel
        kicker="Joint Events"
        title="联合事件链与当日确认记录"
        subtitle="左侧展示快照中的联合事件，右侧读取所选日期的确认记录，便于回溯原始事实。"
      >
        <div class="event-date-bar"><label v-if="!useMock">记录日期（北京时间）<input type="date" v-model="selectedEventDate" /></label>
          <button
            v-for="date in eventDates"
            :key="date"
            type="button"
            class="event-date-chip"
            :class="{ 'is-active': selectedEventDate === date }"
            @click="selectedEventDate = date"
          >
            {{ formatDate(date) }}
          </button>
        </div>

        <div class="event-bridge">
          <div class="timeline-stack">
            <p v-if="!useMock && !visibleJointEvents.length">{{ snapshot ? '该日期暂无联合事件线索。' : '尚无成功分析快照，不能判断该日期是否存在联合事件。' }}</p>
            <TimelineEventCard
              v-for="event in visibleJointEvents"
              :key="'eventId' in event ? String(event.eventId) : event.eventType"
              :event="event"
            />
          </div>

          <div class="daily-events-panel"><p v-if="!useMock && real.timeline.error.value" role="alert">{{ real.timeline.error.value }}</p><button v-if="!useMock" class="button" @click="real.loadTimeline(selectedEventDate)">刷新记录</button>
            <header class="daily-events-panel__head">
              <div>
                <p>当日确认记录</p>
                <strong>{{ selectedEventDate ? formatDate(selectedEventDate) : '未选择日期' }}</strong>
              </div>
              <StatusBadge
                :label="!useMock && real.timeline.error.value ? '记录读取失败' : timelineLoading ? '正在读取' : `${dailyEvents.length} 条记录`"
                tone="info"
              />
            </header>

            <div v-if="timelineLoading" class="daily-events-panel__state">
              正在加载当日事件...
            </div>

            <div v-else-if="!dailyEvents.length && (useMock || !real.timeline.error.value)" class="daily-events-panel__state">
              当日没有可展示的事件。
            </div>

            <div v-else class="daily-event-list">
              <article v-for="item in dailyEvents" :key="item.id" class="daily-event-card">
                <div class="daily-event-card__time">
                  <span>{{ formatTime(item.occurredAt) }}</span>
                  <StatusBadge
                    :label="formatStatus(item.status).label"
                    :tone="formatStatus(item.status).tone"
                  />
                </div>

                <div class="daily-event-card__title-row">
                  <strong>{{ item.title }}</strong>
                  <span class="tag tag--soft">{{ useMock ? formatEventCategory(item.category) : '确认记录' }}</span>
                </div>

                <p>{{ item.detail }}</p>

                <div class="daily-event-card__meta">
                  <span>来源：{{ item.source }}</span>
                  <span v-if="item.relatedMedication">关联药物：{{ item.relatedMedication }}</span>
                  <span v-if="item.indicator">{{ item.indicator }}</span>
                </div>
              </article>
            </div>
          </div>
        </div>
      </InfoPanel>
      <InfoPanel v-if="!useMock && snapshot" title="分析证据来源" subtitle="按分析时的修订读取，不以最新修订替代。">
        <button v-for="e in snapshot.evidence" :key="e.sourceId+e.revisionId+e.fieldPath" class="button" @click="analysis.evidence(e)">{{ e.fieldPath }} · {{ displayTime(e.occurredAt) }}</button>
        <section v-if="evidenceReference"><p>{{ evidenceReference.sourceId }} · {{ evidenceReference.revisionId }}</p><p v-if="evidenceLoading">正在读取指定修订…</p><p v-if="evidenceError" role="alert">{{ evidenceError }}</p><template v-if="evidenceRevision"><p>版本 {{ evidenceRevision.version }} · {{ evidenceRevision.changeReason }}</p><p>{{ evidenceRevision.rawText }}</p><pre>{{ JSON.stringify(evidenceRevision.confirmedFacts,null,2) }}</pre></template><button class="button" @click="analysis.closeEvidence">关闭证据</button></section>
      </InfoPanel>
    </template>
  </div>
</template>

<style scoped>
.page-stack p, .page-stack pre { overflow-wrap: anywhere; }
.page-stack pre { white-space: pre-wrap; }
.page-stack [role=alert] { color: #a42e2e; }
.detail-hero__copy > .button { justify-self: start; }
.page-stack :deep(dd) { overflow-wrap: anywhere; }
.detail-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(300px, 360px);
  gap: 24px;
  align-items: stretch;
}

.detail-hero__copy {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 16px;
}

.detail-hero__copy h1 {
  margin: 0;
  font-size: 52px;
  line-height: 0.94;
  color: var(--ink-strong);
  letter-spacing: -0.04em;
}

.detail-hero__facts {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  color: var(--ink-soft);
}

.detail-hero__side {
  display: flex;
}

.detail-hero__priority {
  display: grid;
  align-content: start;
  gap: 14px;
  width: 100%;
  padding: 24px;
  border-radius: 26px;
  background:
    radial-gradient(circle at top right, rgba(255, 255, 255, 0.46), transparent 26%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.82) 0%, rgba(243, 249, 252, 0.88) 100%);
  border: 1px solid rgba(255, 255, 255, 0.65);
  box-shadow: 0 12px 28px rgba(57, 95, 118, 0.08);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}

.detail-hero__side-kicker {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #188796;
}

.detail-hero__priority p:last-of-type {
  margin: 0;
  color: var(--ink-soft);
  line-height: 1.75;
}

.detail-hero__reason-box {
  display: grid;
  gap: 8px;
  padding: 16px 18px;
  border-radius: 20px;
  background: rgba(18, 64, 70, 0.05);
  border: 1px solid rgba(31, 80, 85, 0.05);
}

.detail-hero__reason-box span {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.detail-hero__reason-box strong {
  line-height: 1.7;
  color: var(--ink-strong);
}

.content-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
  gap: 24px;
}

.signal-bullets {
  display: grid;
  gap: 12px;
  margin: 0;
  padding-left: 20px;
  color: var(--ink-strong);
  line-height: 1.8;
}

.suggestion-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
}

.suggestion-card {
  padding: 18px;
  border-radius: 20px;
  background: rgba(18, 64, 70, 0.05);
  border: 1px solid rgba(31, 80, 85, 0.04);
}

.suggestion-card strong {
  display: block;
  margin-bottom: 8px;
  color: var(--ink-strong);
}

.suggestion-card p {
  margin: 0;
  color: var(--ink-soft);
  line-height: 1.7;
}

.medication-grid {
  display: grid;
  gap: 14px;
}

.medication-card {
  display: grid;
  gap: 16px;
  padding: 20px;
  border-radius: 22px;
  background:
    radial-gradient(circle at top right, rgba(255, 255, 255, 0.36), transparent 26%),
    linear-gradient(180deg, rgba(246, 250, 249, 0.96) 0%, rgba(255, 255, 255, 0.92) 100%);
  border: 1px solid rgba(255, 255, 255, 0.74);
  box-shadow: 0 10px 22px rgba(57, 95, 118, 0.06);
}

.medication-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.medication-card__head h3 {
  margin: 0 0 6px;
  color: var(--ink-strong);
}

.medication-card__head p {
  margin: 0;
  color: var(--ink-soft);
}

.medication-card__detail {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 18px;
  margin: 0;
}

.medication-card__detail dt {
  margin: 0 0 6px;
  font-size: 13px;
  color: var(--ink-muted);
}

.medication-card__detail dd {
  margin: 0;
  font-weight: 700;
  color: var(--ink-strong);
}

.event-date-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.event-date-chip {
  min-height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(215, 225, 237, 0.92);
  color: #647890;
  font-weight: 700;
}

.event-date-chip.is-active {
  color: #ffffff;
  background: linear-gradient(135deg, #5b84f8, #4568dd);
  border-color: transparent;
}

.event-bridge {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 0.92fr);
  gap: 18px;
  align-items: start;
}

.timeline-stack,
.daily-event-list {
  display: grid;
  gap: 16px;
}

.daily-events-panel {
  display: grid;
  gap: 14px;
  padding: 20px;
  border-radius: 24px;
  background: rgba(248, 251, 255, 0.72);
  border: 1px solid rgba(218, 229, 240, 0.9);
}

.daily-events-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.daily-events-panel__head p {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #178494;
}

.daily-events-panel__head strong {
  color: var(--ink-strong);
  font-size: 18px;
}

.daily-events-panel__state {
  display: grid;
  place-items: center;
  min-height: 140px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.72);
  color: var(--ink-soft);
}

.daily-event-card {
  display: grid;
  gap: 12px;
  padding: 16px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid rgba(223, 231, 240, 0.92);
}

.daily-event-card__time,
.daily-event-card__title-row,
.daily-event-card__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.daily-event-card__time span {
  color: #607691;
  font-weight: 700;
}

.daily-event-card__title-row strong {
  color: var(--ink-strong);
  font-size: 16px;
}

.daily-event-card p {
  margin: 0;
  color: var(--ink-soft);
  line-height: 1.7;
}

.daily-event-card__meta {
  color: #7a8ca4;
  font-size: 13px;
}

@media (max-width: 1120px) {
  .detail-hero,
  .content-grid,
  .event-bridge {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .detail-hero__copy h1 {
    font-size: 40px;
  }

  .medication-card__head,
  .detail-hero__facts {
    flex-direction: column;
  }

  .medication-card__detail {
    grid-template-columns: 1fr;
  }
}
</style>
