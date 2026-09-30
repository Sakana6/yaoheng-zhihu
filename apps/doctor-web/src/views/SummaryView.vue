<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter, RouterLink } from 'vue-router';

import InfoPanel from '../components/InfoPanel.vue';
import MetricCard from '../components/MetricCard.vue';
import StatusBadge from '../components/StatusBadge.vue';
import TimelineEventCard from '../components/TimelineEventCard.vue';
import { doctorApi } from '../lib/api';
import {
  buildReviewSuggestions,
  calculateAge,
  formatDateTime,
  formatDiseaseTag,
  formatReviewPriority,
  formatStatus,
  getMetricMeta,
  getRiskLevel,
} from '../lib/format';
import type {
  JointEvent,
  PatientMedication,
  PatientProfile,
  ReportDownload,
  ReportTask,
  RiskLatest,
} from '../lib/types';

const route = useRoute();
const demoLoading = ref(true);
const demoError = ref('');
const demoProfile = ref<PatientProfile | null>(null);
const demoMedications = ref<PatientMedication[]>([]);
const demoJointEvents = ref<JointEvent[]>([]);
const demoRisk = ref<RiskLatest | null>(null);
const demoReport = ref<ReportTask | null>(null);
const demoDownload = ref<ReportDownload | null>(null);

const patientId = computed(() => {
  const routeId = Number(route.params.patientId);
  return useMock && (!Number.isSafeInteger(routeId) || routeId <= 0) ? 1 : routeId;
});

const demoAge = computed(() => calculateAge(demoProfile.value?.birthday));
const demoPriorityMeta = computed(() =>
  demoRisk.value ? formatReviewPriority(demoRisk.value.reviewPriority) : null,
);
const demoReportStatus = computed(() => formatStatus(demoReport.value?.status));

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

const demoSummaryParagraphs = computed(() => {
  if (!demoProfile.value || !demoRisk.value || !demoPriorityMeta.value) {
    return [];
  }

  const paragraphs = [
    `${demoProfile.value.name}${demoAge.value ? `，${demoAge.value} 岁` : ''}，当前以“${demoPriorityMeta.value.label}”为主，建议围绕四类风险分数和联合事件证据完成本次复核。`,
    ...demoRisk.value.reasons,
  ];

  if (demoJointEvents.value[0]) {
    paragraphs.push(
      `最近一次联合事件为“${demoJointEvents.value[0].eventLabel || demoJointEvents.value[0].eventType}”，事件严重度 ${demoJointEvents.value[0].severity}，证据链已在下方完整展开。`,
    );
  }

  return paragraphs;
});

const demoActionSuggestions = computed(() =>
  demoRisk.value ? buildReviewSuggestions(demoRisk.value, demoJointEvents.value) : [],
);

function printSummary() { window.print(); }

function openDownloadUrl() {
  if (demoDownload.value?.downloadUrl) {
    window.open(demoDownload.value.downloadUrl, '_blank', 'noopener');
  }
}

async function loadSummary() {
  demoLoading.value = true;
  demoError.value = '';

  try {
    const reportId = await doctorApi.ensureReportTask(patientId.value);
    const [profileData, medicationData, jointEventData, riskData, reportData] = await Promise.all([
      doctorApi.getProfile(patientId.value),
      doctorApi.getMedications(patientId.value),
      doctorApi.getJointEvents(patientId.value),
      doctorApi.getRisk(patientId.value),
      doctorApi.getReport(patientId.value, reportId),
    ]);

    // 报告下载地址依赖报告状态就绪，顺序请求可避免偶发 HTTP 400。
    const downloadData = await doctorApi.getReportDownload(patientId.value, reportData.reportId);

    demoProfile.value = profileData;
    demoMedications.value = medicationData.medications;
    demoJointEvents.value = jointEventData.jointEvents;
    demoRisk.value = riskData;
    demoReport.value = reportData;
    demoDownload.value = downloadData;
  } catch (err) {
    demoError.value = err instanceof Error ? err.message : '请求失败';
  } finally {
    demoLoading.value = false;
  }
}

if (useMock) watch(patientId, loadSummary, { immediate: true });

import { useMock, selectedPatient } from '../../../../packages/frontend/session';
import { useAnalysisState, analysisLabels } from '../../../../packages/frontend/analysis-state';
import { useReportState } from '../../../../packages/frontend/report-state';
import { useFollowUpState } from '../../../../packages/frontend/followup-state';
import { useDoctorData } from '../lib/doctor-data';
const router=useRouter(), data=useDoctorData(), analysis=useAnalysisState(true);
const {snapshot,history,selectedRun,selectionError,historyError,evidenceRecord,evidenceRevision,evidenceError,evidenceLoading}=analysis;
const snapshotId=computed(()=>snapshot.value?.snapshotId??'');
const artifact=useReportState(snapshotId);
const {report:realReport,type:reportType,html:reportHtml,error:reportError,busy:reportBusy}=artifact;
const reviewState=useFollowUpState();
const {decision,comment,reason,historical,busy:reviewBusy,error:reviewError,notice:reviewNotice}=reviewState;
const reviewOpen=ref(false),routeError=ref(''),realReady=ref(false);
const profile=computed(()=>useMock?demoProfile.value:data.profile.value.value);
const loading=computed(()=>useMock?demoLoading.value:!realReady.value);
const error=computed(()=>useMock?demoError.value:data.profile.error.value);
const age=computed(()=>calculateAge(profile.value?.birthday));
const medications=computed(()=>useMock?demoMedications.value:(snapshot.value?.medications??[]) as PatientMedication[]);
const risk=computed(()=>useMock?demoRisk.value:snapshot.value?.risk);
const reportStatus=computed(()=>useMock?demoReportStatus.value:{label:analysisLabels[realReport.value?.status??'']??'尚未生成',tone:'info' as const});
const priorityMeta=computed(()=>useMock?demoPriorityMeta.value:risk.value?formatReviewPriority(risk.value.reviewPriority):null);
const riskCards=computed(()=>useMock?demoRiskCards.value:([
  'deintensificationScore','interactionScore','behaviorScore','jointEventScore'
] as const).map(key=>{const score=snapshot.value?.risk?.[key];return {...getMetricMeta(key),score:score??'—',progress:score,level:score==null?{label:'资料不足',tone:'neutral' as const}:getRiskLevel(score)};}));
const jointEvents=computed(()=>useMock?demoJointEvents.value:[]);
const summaryParagraphs=computed(()=>useMock?demoSummaryParagraphs.value:snapshot.value?[
  ...snapshot.value.jointEvents.map(e=>e.label||e.eventType),
  ...(snapshot.value.missingFields.length?['缺失资料：'+snapshot.value.missingFields.join('、')]:[]),
  ...(!snapshot.value.jointEvents.length?['所选快照暂无联合事件，仍需结合资料充分性判断。']:[])
]:['尚无成功快照，不生成判断。']);
const actionSuggestions=computed(()=>useMock?demoActionSuggestions.value:reviewState.reviews.value.filter(r=>r.snapshotId===snapshotId.value).map(r=>r.comment));
let alive=true;
async function chooseSnapshot(){reviewOpen.value=false;routeError.value='';await analysis.choose();const query={...route.query};delete query.snapshotId;delete query.runId;if(selectedRun.value)query.runId=selectedRun.value;await router.replace({query});}
async function applyRoute(){if(useMock)return;routeError.value='';const run=typeof route.query.runId==='string'?route.query.runId:'';const wanted=typeof route.query.snapshotId==='string'?route.query.snapshotId:'';
 if(wanted){const item=history.value.find(s=>s.snapshotId===wanted);if(!item||(run&&item.runId!==run)){routeError.value='请求的报告快照不属于当前患者或运行不匹配。';await analysis.choose('');snapshot.value=null;return;}await analysis.choose(item.runId);}
 else if(run!==selectedRun.value)await analysis.choose(run);
}
async function refreshReal(){await Promise.all([analysis.load(),artifact.load()]);if(alive)await applyRoute();}
async function openReview(){await reviewState.load();if(!alive||!snapshot.value)return;reviewState.runId.value=snapshot.value.runId;historical.value=false;reviewOpen.value=true;}
async function saveReview(){if(await reviewState.review())reviewOpen.value=false;}
watch(snapshotId,()=>{reviewOpen.value=false;});
watch(()=>[route.query.runId,route.query.snapshotId],()=>{if(alive&&realReady.value&&!useMock)void applyRoute();});
onMounted(async()=>{if(useMock)return;await Promise.all([data.loadProfile(),analysis.load(),artifact.load(),reviewState.load()]);if(alive){await applyRoute();realReady.value=true;}});
onBeforeUnmount(()=>{alive=false;data.dispose();analysis.dispose();artifact.dispose();reviewState.dispose();});
</script>

<template>
  <div class="page-stack">
    <section v-if="loading" class="page-state">
      <p>正在读取医生摘要视图…</p>
    </section>

    <section v-else-if="useMock && error" class="page-state page-state--error">
      <p>{{ error }}</p>
    </section>

    <template v-else>
      <section class="summary-toolbar">
        <div>
          <p class="summary-toolbar__eyebrow">Doctor Summary</p>
          <h1>打印友好的医生复查摘要</h1>
          <p>
            按所选分析快照核对报告、用药和证据。报告下载为 HTML，可在浏览器打印。
          </p>
        </div>

        <div class="summary-toolbar__actions">
          <button v-if="useMock" type="button" class="button button--primary" @click="printSummary">
            打印 / 导出 PDF
          </button>
          <button v-if="useMock" type="button" class="button button--ghost" @click="openDownloadUrl">
            打开后端下载地址
          </button>
          <template v-if="!useMock">
            <button class="button button--ghost" :disabled="!reportHtml || reportBusy" @click="artifact.download">下载 HTML</button>
            <button class="button button--ghost" :disabled="!snapshot || reviewBusy" @click="openReview">追加医生复核</button>
          </template>
        </div>
      </section>
      <section class="summary-layout">
        <InfoPanel
          kicker="Summary Paper"
          title="复查结论"
          subtitle="正文采用高可读性的摘要纸风格，优先呈现医生判断、重点发现和建议动作。"
        >
          <template #actions>
            <StatusBadge :label="reportStatus.label" :tone="reportStatus.tone" />
          </template>

          <div class="summary-paper">
            <header class="summary-paper__header">
              <div>
                <h3>{{ profile?.name ?? selectedPatient?.name }}</h3>
                <p>
                  {{ age ? `${age} 岁` : '年龄未提供' }} ·
                  {{ (profile?.diseaseTags ?? []).map(formatDiseaseTag).join(' / ') || '疾病标签未提供' }}
                </p>
              </div>
              <div>
                <p>{{useMock?'生成时间':'快照参考时间'}}</p>
                <strong>{{ formatDateTime(useMock?demoReport?.generatedAt:snapshot?.referenceTime) }}</strong>
              </div>
            </header>

            <section class="summary-paper__section">
              <h4>复查判断</h4>
              <div class="summary-paper__priority">
                <StatusBadge
                  v-if="priorityMeta"
                  :label="priorityMeta.label"
                  :tone="priorityMeta.tone"
                />
                <p>{{useMock?priorityMeta?.summary:'复查优先级来自所选成功快照；评分不是疾病概率，也不是医生诊断。'}}</p>
              </div>
            </section>

            <section class="summary-paper__section">
              <h4>重点发现</h4>
              <ul class="summary-paper__bullets">
                <li v-for="text in summaryParagraphs" :key="text">{{ text }}</li>
              </ul>
            </section>

            <section class="summary-paper__section">
              <h4>建议动作</h4>
              <p v-if="!useMock">{{reviewError || (actionSuggestions.length?'以下为该快照已保存的医生复核意见。':'当前快照尚无医生复核意见。')}}</p>
              <ul class="summary-paper__bullets">
                <li v-for="item in actionSuggestions" :key="item">{{ item }}</li>
              </ul>
            </section>
            <section v-if="!useMock" class="summary-paper__section">
              <h4>服务端报告正文</h4>
              <iframe v-if="reportHtml" title="服务端报告预览" class="report-preview" sandbox="" :srcdoc="reportHtml" referrerpolicy="no-referrer"></iframe>
              <p v-else>{{realReport?.status==='SUCCESS'?'报告已就绪，点击预览后可下载同一产物。':realReport?.status==='FAILED'?'报告生成失败，请重试。':'尚无可预览的成功报告；生成后请刷新状态。'}}</p>
            </section>
          </div>
        </InfoPanel>

        <div class="summary-side">
          <InfoPanel
            kicker="Export"
            title="导出状态"
            subtitle="仅成功且校验通过的报告可预览、下载。"
          >
      <div v-if="!useMock" class="summary-controls">
        <label>分析快照<select v-model="selectedRun" @change="chooseSnapshot"><option value="">最新成功快照</option><option v-for="run in history" :key="run.runId" :value="run.runId">输入 {{run.inputRevision}} · {{run.snapshotId}}</option></select></label>
        <label>报告类型<select v-model="reportType"><option value="DOCTOR">医生复查摘要</option><option value="FAMILY">家属照护记录</option></select></label>
        <p v-if="snapshot">当前快照 {{snapshot.snapshotId}} · 输入 {{snapshot.inputRevision}} · {{analysisLabels[snapshot.dataStatus] ?? snapshot.dataStatus}}</p>
        <p v-else>尚无可用分析快照。请先在手机端保存资料并等待分析完成。</p>
        <p v-if="error" role="alert">{{error}} <button class="button button--ghost" @click="data.loadProfile">重试患者资料</button></p>
        <p v-if="routeError || selectionError || analysis.error.value || historyError || reportError" role="alert">{{routeError || selectionError || analysis.error.value || historyError || reportError}}</p><p v-if="reviewNotice" role="status">{{reviewNotice}}</p>
        <div class="summary-toolbar__actions"><button class="button button--ghost" @click="refreshReal">刷新报告状态</button><button class="button button--primary" :disabled="!snapshot || reportBusy || (!!realReport && realReport.status !== 'FAILED')" @click="artifact.generate">{{realReport?.status==='FAILED'?'重试报告':'生成报告'}}</button><button class="button button--ghost" :disabled="reportBusy || realReport?.status!=='SUCCESS'" @click="artifact.preview">预览报告</button><RouterLink class="button button--ghost" to="/follow-ups">随访管理</RouterLink></div>
      </div>
            <div class="export-meta">
              <div><span>报告编号</span><strong>{{useMock?demoReport?.reportId:realReport?.reportId ?? '尚未生成'}}</strong></div>
              <div><span>快照编号</span><strong>{{snapshot?.snapshotId ?? '—'}}</strong></div>
              <div><span>模板版本</span><strong>{{realReport?.templateVersion ?? '—'}}</strong></div>
              <div><span>校验摘要</span><strong class="artifact-id">{{realReport?.checksum ?? '—'}}</strong></div>
              <div v-if="realReport?.errorCode"><span>失败原因</span><strong>{{realReport.errorCode}}</strong></div>
            </div>
          </InfoPanel>

          <InfoPanel
            kicker="Regimen"
            :title="useMock?'当前药历摘要':'所选快照药历'"
            subtitle="药历摘要放在侧栏，医生在摘要页也能顺手完成用药核对。"
          >
            <ul class="regimen-list">
              <li v-for="item in medications" :key="item.id">
                <strong>{{ item.genericName }}</strong>
                <span>{{ item.dose }} · {{ item.frequency }}</span>
              </li>
            </ul>
          </InfoPanel>
        </div>
      </section>

      <section class="metric-grid">
        <MetricCard
          v-for="item in riskCards"
          :key="item.title"
          :title="item.title"
          :value="item.score"
          :subtitle="item.subtitle"
          :tone="item.level.tone"
          :progress="typeof item.score === 'number' ? item.score : undefined"
        >
          <template #badge>
            <StatusBadge :label="item.level.label" :tone="item.level.tone" />
          </template>
        </MetricCard>
      </section>

      <InfoPanel
        kicker="Evidence Chain"
        title="联合事件证据链"
        subtitle="保留所选快照的时间窗及来源修订，供医生核对。"
      >
        <div v-if="useMock" class="timeline-stack">
          <TimelineEventCard
            v-for="event in jointEvents"
            :key="`${event.eventType}-${event.timeWindowStart}`"
            :event="event"
          />
        </div>
        <div v-else class="timeline-stack">
          <p v-if="!snapshot?.jointEvents.length">所选快照暂无联合事件；不代表资料充分或风险正常。</p>
          <article v-for="event in snapshot?.jointEvents" :key="event.eventId" class="summary-paper__section"><h4>{{event.label || event.eventType}}</h4><p>{{event.window?.start}} — {{event.window?.end}}</p><button v-for="e in event.evidence" :key="e.revisionId+e.fieldPath" class="button button--ghost" @click="analysis.evidence(e)">查看来源修订 {{e.revisionId}} · {{e.fieldPath}}</button></article>
          <p v-if="evidenceLoading">正在读取证据…</p><p role="alert">{{evidenceError}}</p><pre v-if="evidenceRecord">{{evidenceRevision}}</pre>
        </div>
      </InfoPanel>
      <div v-if="reviewOpen" class="review-overlay" role="dialog" aria-modal="true" aria-label="追加医生复核">
        <form class="review-dialog" @submit.prevent="saveReview"><h2>追加医生复核</h2><p>复核快照 {{snapshot?.snapshotId}}；意见不改变机器评分和处方。</p>
          <fieldset :disabled="reviewBusy"><label>复核结论<select v-model="decision"><option value="REVIEWED">已复核</option><option value="NEEDS_MORE_DATA">需补资料</option><option value="DISAGREED">有异议</option></select></label>
          <label>复核意见<textarea v-model="comment" required maxlength="2000" /></label><label>理由<input v-model="reason" required maxlength="1000" /></label>
          <label><input v-model="historical" type="checkbox" />明确复核历史快照（不代表最新结果）</label><p role="alert">{{reviewError}}</p>
          <button class="button button--primary">保存复核</button><button type="button" class="button button--ghost" @click="reviewOpen=false">关闭</button></fieldset>
        </form>
      </div>
    </template>
  </div>
</template>

<style scoped>
.summary-layout :deep(.info-panel), .summary-layout :deep(.info-panel__body) { align-content:start; min-width:0; }
.summary-layout :deep(.info-panel__actions) { flex:0 0 auto; }
.summary-side { align-content:start; min-width:0; }

.summary-controls { display:grid; grid-template-columns:minmax(0,1fr); gap:12px; margin-bottom:18px; min-width:0; }
.summary-controls p { margin:0; overflow-wrap:anywhere; }
.summary-controls label { display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
.summary-controls select { max-width:100%; min-width:0; }
.summary-controls > * { min-width:0; }
.summary-paper__priority :deep(.status-badge) { flex-shrink:0; }
.report-preview { width:100%; min-height:560px; border:0; background:white; }
.artifact-id, .export-meta strong { overflow-wrap:anywhere; min-width:0; }
.timeline-stack pre { white-space:pre-wrap; overflow-wrap:anywhere; }
.review-overlay { position:fixed; inset:0; z-index:100; display:grid; place-items:center; padding:20px; background:rgba(25,50,68,.35); }
.review-dialog { width:min(620px,100%); max-height:85vh; overflow:auto; border-radius:24px; padding:24px; background:#f7fbff; }
.review-dialog fieldset { border:0; display:grid; gap:14px; min-width:0; }
.review-dialog label { display:grid; gap:8px; }
.review-dialog input,.review-dialog textarea,.summary-controls select,.review-dialog select { padding:10px; border:1px solid #dce6ef; border-radius:10px; }

.summary-toolbar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  padding: 6px 6px 0;
}

.summary-toolbar__eyebrow {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent-cyan-strong);
}

.summary-toolbar h1 {
  margin: 0 0 12px;
  font-size: 46px;
  line-height: 0.98;
  color: var(--ink-strong);
  letter-spacing: -0.04em;
}

.summary-toolbar p {
  margin: 0;
  max-width: 820px;
  color: var(--ink-soft);
  line-height: 1.8;
}

.summary-toolbar__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.summary-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.18fr) minmax(320px, 0.82fr);
  gap: 24px;
}

.summary-side {
  display: grid;
  gap: 24px;
}

.summary-paper {
  display: grid;
  gap: 22px;
}

.summary-paper__header,
.summary-paper__priority,
.export-meta div {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.summary-paper__header {
  padding-bottom: 18px;
  border-bottom: 1px solid rgba(18, 64, 70, 0.1);
}

.summary-paper__header h3 {
  margin: 0 0 8px;
  font-size: 28px;
  color: var(--ink-strong);
}

.summary-paper__header p,
.summary-paper__priority p {
  margin: 0;
  color: var(--ink-soft);
  line-height: 1.7;
}

.summary-paper__header strong,
.export-meta strong {
  color: var(--ink-strong);
}

.summary-paper__section {
  display: grid;
  gap: 12px;
}

.summary-paper__section h4 {
  margin: 0;
  font-size: 18px;
  color: var(--ink-strong);
}

.summary-paper__bullets {
  display: grid;
  gap: 10px;
  margin: 0;
  padding-left: 20px;
  color: var(--ink-strong);
  line-height: 1.8;
}

.summary-paper__bullets li::marker {
  color: var(--accent-cyan-strong);
}

.export-meta {
  display: grid;
  gap: 14px;
}

.export-meta span {
  color: var(--ink-muted);
  font-size: 13px;
}

.export-meta a {
  word-break: break-all;
  color: var(--accent-cyan-strong);
}

.regimen-list {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.regimen-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 18px;
  background: rgba(18, 64, 70, 0.05);
  border: 1px solid rgba(31, 80, 85, 0.04);
}

.regimen-list strong {
  color: var(--ink-strong);
}

.regimen-list span {
  color: var(--ink-soft);
}

.timeline-stack {
  display: grid;
  gap: 16px;
}

@media (max-width: 1120px) {
  .summary-toolbar {
    flex-direction: column;
    align-items: flex-start;
  }

  .summary-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .summary-toolbar h1 {
    font-size: 38px;
  }

  .summary-paper__header,
  .summary-paper__priority,
  .export-meta div,
  .regimen-list li {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
