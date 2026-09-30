<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';

import { formatReviewPriority, getRiskTone } from '../lib/format';
import { useMvpStore } from '../stores/mvp';
import type { CurrentPatientContext, MobileRisk, RiskDirection } from '../lib/types';
import bannerImage from '../static/optimized/home-card.webp';
import { useRoute, useRouter } from 'vue-router';
import { mobileRuntimeConfig } from '../lib/api';
import { selectedPatient, session } from '../../../../packages/frontend/session';
import { useAnalysisState, analysisLabels, type Snapshot } from '../../../../packages/frontend/analysis-state';
import { displayTime as formatDateTime, localInput } from '../../../../packages/frontend/care';
import type { EvidenceReference } from '../../../../packages/frontend/contracts';
import { reportPreviewHtml } from '../../../../packages/frontend/report-presentation';
import { useReportState } from '../../../../packages/frontend/report-state';
import { useFollowUpState } from '../../../../packages/frontend/followup-state';
const isDemo = mobileRuntimeConfig.useMock;
const route = useRoute();
const router = useRouter();
let realAlive = true;
const analysis = useAnalysisState(true);
const { latest, snapshot, history, selectedRun, error: analysisError, historyError, selectionError, loading: analysisLoading, selectionLoading, evidenceReference, evidenceRevision, evidenceError, evidenceLoading } = analysis;
const familyReports = useReportState(computed(() => snapshot.value?.snapshotId ?? ''));
familyReports.type.value = 'FAMILY';
const followUpHistory = useFollowUpState();
async function refreshCareHistory() {
  await Promise.all([familyReports.load(), followUpHistory.load()]);
}
let analysisTimer: ReturnType<typeof setInterval> | undefined;
const runChoices = computed(() => {
  const runs = new Map<string, Snapshot>();
  for (const run of [...history.value, ...(latest.value?.snapshot ? [latest.value.snapshot as Snapshot] : [])]) runs.set(run.runId, run);
  return [...runs.values()].sort((a,b) => Date.parse(b.referenceTime)-Date.parse(a.referenceTime) || b.inputRevision-a.inputRevision || a.runId.localeCompare(b.runId));
});
function snapshotArchive(run: Snapshot): DailyRiskArchive {
  return { runId: run.runId, snapshotId: run.snapshotId, date: localInput(run.referenceTime).slice(0,10),
    riskSnapshot: run.risk ? {...run.risk, reasons: []} : null,
    events: run.jointEvents.map(event => ({ code: event.eventId, label: event.label || event.eventType,
      occurredAt: event.evidence[0]?.occurredAt ?? run.referenceTime, severity: event.severity ?? null, directions: [],
      evidenceSummary: event.eventType + ' · 引用 ' + event.evidence.length + ' 项确认事实', evidence: event.evidence })) };
}
async function chooseRun(run = selectedRun.value) { closeDay(); await analysis.choose(run); }
function openEvidence(reference: EvidenceReference) { selectedDay.value = activeArchive.value; void analysis.evidence(reference); }
watch(() => snapshot.value?.snapshotId, () => { selectedDay.value = null; });
watch(() => route.query.run, run => { if (!isDemo) void chooseRun(typeof run === 'string' ? run : ''); });
onBeforeUnmount(() => { realAlive = false; analysis.dispose(); familyReports.dispose(); followUpHistory.dispose(); clearInterval(analysisTimer); });


type MetricTheme = 'sand' | 'sage' | 'sky' | 'gold';

interface MetricCard {
  label: string;
  score: number | null;
  theme: MetricTheme;
  featured?: boolean;
}

interface DailyEventRecord {
  code: string;
  label: string;
  occurredAt: string;
  severity: number | null;
  evidence?: EvidenceReference[];
  directions: RiskDirection[];
  evidenceSummary: string;
}

interface DailyRiskArchive {
  date: string;
  riskSnapshot: MobileRisk | null;
  runId?: string; snapshotId?: string;
  events: DailyEventRecord[];
}

function shiftDate(base: Date, offsetDays: number): Date {
  const result = new Date(base);
  result.setDate(result.getDate() + offsetDays);
  return result;
}

function toDateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function atTime(baseDate: Date, hour: number, minute: number): string {
  const result = new Date(baseDate);
  result.setHours(hour, minute, 0, 0);
  return result.toISOString();
}

function formatEvidenceChain(payload: Record<string, unknown>): string {
  return JSON.stringify(payload, null, 2);
}

const pageTitle = '风险判断中心';
const pageSubtitle = isDemo ? '风险页只展示记录页同步过来的评分、事件和证据，不再追加总结性文案。' : '展示服务端已发布的复查线索与确认事实；评分不是疾病概率，不直接决定用药。';

const mvpStore = isDemo ? useMvpStore() : null;

const patient = ref<CurrentPatientContext>({
  userId: 1,
  role: 'CAREGIVER',
  patientId: 1,
  patientName: '当前患者',
});

const yesterday = shiftDate(new Date(), -1);
const twoDaysAgo = shiftDate(new Date(), -2);
const fourDaysAgo = shiftDate(new Date(), -4);

const shouldSyncTodayRisk = (() => {
  if (!isDemo || typeof window === 'undefined') {
    return false;
  }

  const enabled = window.sessionStorage.getItem('risk-view-sync-from-record') === '1';
  if (enabled) {
    window.sessionStorage.removeItem('risk-view-sync-from-record');
  }
  return enabled;
})();

const fallbackRisk: MobileRisk = {
  deintensificationScore: 82,
  interactionScore: 32,
  behaviorScore: 61,
  jointEventScore: 88,
  reviewPriority: 'CLINIC_REVIEW',
  reasons: [],
};

const fallbackArchives: DailyRiskArchive[] = [
  {
    date: toDateKey(yesterday),
    riskSnapshot: {
      deintensificationScore: 82,
      interactionScore: 32,
      behaviorScore: 61,
      jointEventScore: 88,
      reviewPriority: 'CLINIC_REVIEW',
      reasons: [],
    },
    events: [
      {
        code: 'JE001',
        label: '早餐摄入不足后继续服用降糖药',
        occurredAt: atTime(yesterday, 8, 12),
        severity: 88,
        directions: ['DEINTENSIFICATION', 'JOINT_EVENT'],
        evidenceSummary: formatEvidenceChain({
          meal: '早餐摄入不足',
          medication: '按原方案继续服用降糖药',
          symptoms: ['头晕', '出汗'],
          glucose: '3.8 mmol/L',
        }),
      },
      {
        code: 'JE009',
        label: '餐药时间错位后出现不适反馈',
        occurredAt: atTime(yesterday, 9, 5),
        severity: 67,
        directions: ['TEMPORAL_BEHAVIOR'],
        evidenceSummary: formatEvidenceChain({
          sequence: ['先服药', '后补餐'],
          symptomWindow: '服药后 1 小时内出现不适',
          observation: '提示餐药错位参与驱动',
        }),
      },
    ],
  },
  {
    date: toDateKey(twoDaysAgo),
    riskSnapshot: {
      deintensificationScore: 49,
      interactionScore: 72,
      behaviorScore: 78,
      jointEventScore: 55,
      reviewPriority: 'RETEST_SOON',
      reasons: [],
    },
    events: [
      {
        code: 'JE003',
        label: '多药并用后补服，指标出现波动',
        occurredAt: atTime(twoDaysAgo, 14, 20),
        severity: 72,
        directions: ['INTERACTION', 'TEMPORAL_BEHAVIOR'],
        evidenceSummary: formatEvidenceChain({
          medications: ['降压药', '降糖药'],
          adherence: '午后补服',
          observation: '收缩压波动明显',
        }),
      },
      {
        code: 'JE008',
        label: '关键记录连续缺失',
        occurredAt: atTime(twoDaysAgo, 19, 30),
        severity: 58,
        directions: ['TEMPORAL_BEHAVIOR'],
        evidenceSummary: formatEvidenceChain({
          missingWindows: ['午间', '晚间'],
          impact: '增加时序判断不确定性',
        }),
      },
    ],
  },
  {
    date: toDateKey(fourDaysAgo),
    riskSnapshot: {
      deintensificationScore: 84,
      interactionScore: 38,
      behaviorScore: 59,
      jointEventScore: 81,
      reviewPriority: 'CLINIC_REVIEW',
      reasons: [],
    },
    events: [
      {
        code: 'JE002',
        label: '降压药后低压与头晕站立不稳',
        occurredAt: atTime(fourDaysAgo, 6, 45),
        severity: 84,
        directions: ['DEINTENSIFICATION', 'JOINT_EVENT'],
        evidenceSummary: formatEvidenceChain({
          bloodPressure: '96/58 mmHg',
          symptoms: ['头晕', '站立不稳'],
          window: '晨起服药后',
        }),
      },
      {
        code: 'JE004',
        label: '夜间服药后次晨不适',
        occurredAt: atTime(fourDaysAgo, 7, 10),
        severity: 69,
        directions: ['TEMPORAL_BEHAVIOR'],
        evidenceSummary: formatEvidenceChain({
          sequence: ['夜间服药', '次晨不适持续'],
          observation: '异常集中在次晨窗口',
        }),
      },
    ],
  },
];

const archives = ref<DailyRiskArchive[]>(isDemo ? fallbackArchives : []);
const activeDayIndex = ref(0);
const selectedDay = ref<DailyRiskArchive | null>(null);
const isRecordDrivenMode = ref(false);

const activeArchive = computed<DailyRiskArchive>(() => isDemo ? archives.value[activeDayIndex.value] ?? archives.value[0] : snapshot.value ? snapshotArchive(snapshot.value) : {date:'',riskSnapshot:null,events:[]});
const activeRisk = computed(() => isDemo ? activeArchive.value?.riskSnapshot ?? fallbackRisk : activeArchive.value.riskSnapshot);
const priorityMeta = computed(() => activeRisk.value ? formatReviewPriority(activeRisk.value.reviewPriority) : {label: snapshot.value ? '资料不足' : '暂无结果',tone:'neutral'});
const currentRunIndex = computed(() => runChoices.value.findIndex(run => run.runId === snapshot.value?.runId));
const canViewOlderDate = computed(() => isDemo ? activeDayIndex.value < archives.value.length - 1 : currentRunIndex.value >= 0 && currentRunIndex.value < runChoices.value.length - 1);
const canViewNewerDate = computed(() => isDemo ? activeDayIndex.value > 0 : currentRunIndex.value > 0);
const summaryTitle = computed(() => (isRecordDrivenMode.value ? '记录页同步风险' : '联合风险判断'));
const summaryNote = computed(() => !isDemo ? !snapshot.value ? '尚无成功分析快照，不能据此判断风险正常。' : !snapshot.value.risk ? '资料不足，未生成风险评分。' : '当前所选快照的联合事件与复查线索。' :
  isRecordDrivenMode.value
    ? '当前只展示记录页传入的风险评分、事件和证据，不追加总结、推断和理由。'
    : '当前为历史归档数据，用于查看风险评分与事件证据。',
);
const activeArchiveNote = computed(() =>
  `${activeArchive.value.events.length} 条事件${isRecordDrivenMode.value ? ' · 来自记录页同步' : ''}`,
);

const metricCards = computed<MetricCard[]>(() => [
  {
    label: '药物联用风险',
    score: activeRisk.value?.interactionScore ?? null,
    theme: 'sand',
  },
  {
    label: '时序行为风险',
    score: activeRisk.value?.behaviorScore ?? null,
    theme: 'sage',
  },
  {
    label: '联合事件风险',
    score: activeRisk.value?.jointEventScore ?? null,
    theme: 'sky',
  },
  {
    label: '过强化治疗风险',
    score: activeRisk.value?.deintensificationScore ?? null,
    theme: 'gold',
    featured: true,
  },
]);

const modalSummaryFields = computed(() => !isDemo ? [
  {label: '运行',value: snapshot.value?.runId ?? '—'},
  {label: '算法版本',value: snapshot.value?.algorithmVersion ?? '—'},
  {label: '复查优先级',value: priorityMeta.value.label},
  {label: '资料状态',value: analysisLabels[snapshot.value?.dataStatus ?? ''] ?? '—'},
] : [
  { label: '识别事件', value: 'JE001+JE003' },
  { label: '主风险方向', value: '过度治疗+耦合时间风险' },
  { label: '复查优先级', value: '立即复诊' },
  { label: '置信度', value: '93%' },
]);

function riskLevel(score: number | null): string {
  if (score === null) return '暂无评分';
  if (score >= 80) return '高';
  if (score >= 60) return '中高';
  if (score >= 40) return '中';
  return '低';
}

function formatArchiveDate(value: string): string {
  if (!value) return '暂无分析日期';
  const date = new Date(`${value}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

function formatDirection(direction: RiskDirection): string {
  const labels: Record<RiskDirection, string> = {
    DEINTENSIFICATION: '过强化治疗风险',
    INTERACTION: '药物联用风险',
    TEMPORAL_BEHAVIOR: '时序行为风险',
    JOINT_EVENT: '联合事件风险',
  };

  return labels[direction];
}

function goToOlderDate(): void {
  if (!isDemo) { if (canViewOlderDate.value) void chooseRun(runChoices.value[currentRunIndex.value+1].runId); return; }
  if (canViewOlderDate.value) {
    activeDayIndex.value += 1;
  }
}

function goToNewerDate(): void {
  if (!isDemo) { if (canViewNewerDate.value) void chooseRun(runChoices.value[currentRunIndex.value-1].runId); return; }
  if (canViewNewerDate.value) {
    activeDayIndex.value -= 1;
  }
}

function openDay(): void {
  selectedDay.value = activeArchive.value;
}

function closeDay(): void {
  analysis.closeEvidence();
  selectedDay.value = null;
}

function buildTodayRiskArchive(): DailyRiskArchive | null {
  if (!mvpStore!.state.risk || !mvpStore!.state.jointEvents.length) {
    return null;
  }

  const eventDate = mvpStore!.state.jointEvents[0].eventDate ?? toDateKey(new Date());

  return {
    date: eventDate,
    riskSnapshot: {
      ...mvpStore!.state.risk,
      reasons: [],
    },
    events: mvpStore!.state.jointEvents.map((item) => ({
      code: item.eventType,
      label: item.eventLabel ?? item.eventType,
      occurredAt: item.timeWindowStart ?? new Date().toISOString(),
      severity: item.severity,
      directions: item.riskDirections,
      evidenceSummary: formatEvidenceChain(item.evidence),
    })),
  };
}

function upsertTodayRiskArchive(openModal = false): DailyRiskArchive | null {
  const todayArchive = buildTodayRiskArchive();
  if (!todayArchive) {
    return null;
  }

  isRecordDrivenMode.value = true;
  archives.value = [todayArchive];
  activeDayIndex.value = 0;

  if (openModal) {
    selectedDay.value = todayArchive;
  } else if (selectedDay.value) {
    selectedDay.value = todayArchive;
  }

  return todayArchive;
}

onMounted(async () => {
  if (!isDemo) { await Promise.all([analysis.load(), refreshCareHistory()]); if (!realAlive) return; if (typeof route.query.run === 'string') await chooseRun(route.query.run); if (!realAlive) return; analysisTimer = setInterval(() => { if (document.visibilityState === 'visible') void analysis.load(); },5000); return; }
  if (shouldSyncTodayRisk) {
    upsertTodayRiskArchive(true);
    return;
  }

  upsertTodayRiskArchive();
});

if (isDemo) watch(
  () => [mvpStore!.state.risk, mvpStore!.state.jointEvents] as const,
  () => {
    if (mvpStore!.state.risk && mvpStore!.state.jointEvents.length) {
      upsertTodayRiskArchive(Boolean(selectedDay.value));
    }
  },
  { deep: true },
);
</script>

<template>
  <div class="mobile-page risk-page" :class="{ 'risk-page--real': !isDemo }">
    <section class="hero-panel">
      <div class="hero-top">
        <div class="hero-copy">
          <div class="hero-title-row">
            <h1 class="patient-name">{{ pageTitle }}</h1>
            <p class="patient-badge">{{ isDemo ? patient.patientName : selectedPatient?.name ?? '当前患者' }}</p>
          </div>
          <p class="patient-subtitle">{{ pageSubtitle }}</p>
        </div>
      </div>
    </section>

    <section class="summary-card">
      <img class="summary-card__bg" :src="bannerImage" alt="" />
      <div class="summary-card__content">
        <div class="summary-card__top">
          <div class="summary-card__heading">
            <h2>{{ summaryTitle }}</h2>
            <p>{{ summaryNote }}</p>
          </div>
          <span :class="`status-chip status-chip--${priorityMeta.tone}`">{{ priorityMeta.label }}</span>
        </div>

        <div class="summary-card__body">
          <div class="metrics-row">
            <article
              v-for="item in metricCards"
              :key="item.label"
              class="metric-item"
              :class="[`metric-item--${item.theme}`, { 'metric-item--featured': item.featured }]"
            >
              <div class="metric-item__copy">
                <p>{{ item.label }}</p>
              </div>
              <div class="metric-item__meta">
                <strong>{{ item.score ?? '—' }}</strong>
                <em>{{ riskLevel(item.score) }}</em>
              </div>
            </article>
          </div>
        </div>
      </div>
    </section>

    <section class="glass-section timeline-panel">
      <div class="section-header">
        <div class="section-copy">
          <p class="section-eyebrow">{{ isDemo ? '按日查看' : '按分析运行查看（北京时间）' }}</p>
          <h2 class="section-title">{{ formatArchiveDate(activeArchive.date) }}</h2>
          <p class="section-note">{{ activeArchiveNote }}</p>
          <div v-if="!isDemo" class="analysis-status-panel">
            <p v-if="analysisError || selectionError" role="alert">{{ analysisError || selectionError }}</p><p v-if="historyError" role="alert">{{ historyError }}</p>
            <p v-if="analysisLoading || selectionLoading" role="status">正在读取分析…</p>
            <details v-if="snapshot"><summary>分析来源与资料状态</summary><p class="section-note">运行 {{ snapshot.runId }} · 快照 {{ snapshot.snapshotId }} · 输入版本 {{ snapshot.inputRevision }} / 当前 {{ latest?.inputRevision }} · {{ snapshot.algorithmVersion }}</p><p class="section-note">{{ analysisLabels[snapshot.dataStatus] }} · 缺失项：{{ snapshot.missingFields.join('、') || '已评估范围内无缺失项' }}</p></details>
            <p v-if="snapshot && snapshot.inputRevision !== latest?.inputRevision" class="section-note">这是历史输入的分析结果，不能代表最新记录。</p>
            <p v-if="latest?.pendingTask" class="section-note">最新任务：{{ analysisLabels[latest.pendingTask.status] }} · {{ latest.pendingTask.errorCode }} <button v-if="latest.pendingTask.status==='FAILED' && session?.role==='CAREGIVER'" class="action-button action-button--ghost" :disabled="analysis.busy.value" @click="analysis.retry">重试分析</button></p>
            <p v-if="!snapshot" class="section-note">尚无可显示的分析快照。没有结果不表示风险正常。</p>
            <p v-else-if="!snapshot.risk" class="section-note">资料不足，未生成风险评分。</p>
            <label class="section-note analysis-history-field">分析历史<select v-model="selectedRun" @change="chooseRun()"><option value="">最新已发布快照</option><option v-for="run in runChoices" :key="run.runId" :value="run.runId">{{ formatDateTime(run.referenceTime) }} · 输入{{ run.inputRevision }} · {{ run.runId }}</option></select></label>
            <button class="action-button action-button--ghost" @click="analysis.load">刷新分析</button>
          </div>
        </div>

        <div class="section-actions">
          <div class="date-switcher">
            <button class="date-nav" :disabled="!canViewOlderDate" @click="goToOlderDate">←</button>
            <button class="date-nav" :disabled="!canViewNewerDate" @click="goToNewerDate">→</button>
          </div>
          <button class="action-button action-button--ghost" :disabled="!isDemo && !snapshot" @click="openDay">查看当天全部事件</button>
        </div>
      </div>

      <div class="stream-list">
        <article
          v-for="event in activeArchive.events"
          :key="`${activeArchive.date}-${event.code}-${event.occurredAt}`"
          class="stream-item"
          :class="`stream-item--${event.severity == null ? 'neutral' : getRiskTone(event.severity)}`"
        >
          <div class="stream-head">
            <div class="stream-copy">
              <p class="event-item__code">{{ event.code }}</p>
              <strong>{{ event.label }}</strong>
            </div>
            <span class="stream-time">{{ formatDateTime(event.occurredAt) }}</span>
          </div>

          <pre class="stream-evidence">{{ event.evidenceSummary }}</pre>
          <button v-for="e in event.evidence" :key="e.sourceId+e.revisionId+e.fieldPath" class="action-button action-button--ghost evidence-button" @click="openEvidence(e)">{{ e.fieldPath }} · {{ formatDateTime(e.occurredAt) }}</button>

          <div class="stream-tag-row">
            <span
              v-for="direction in event.directions"
              :key="`${event.code}-${direction}`"
              class="stream-tag"
            >
              {{ formatDirection(direction) }}
            </span>
          </div>
        </article>
        <p v-if="!isDemo && snapshot && !activeArchive.events.length" class="section-note">当前规则未发现联合事件，仍需结合资料充分性判断。</p>
        <details v-if="!isDemo && snapshot" class="rule-facts-panel"><summary>规则评估与实际事实</summary><p v-for="rule in snapshot.evaluations" :key="rule.ruleId">{{ rule.ruleId }} · {{ analysisLabels[rule.status] }} · {{ rule.missingFields.join('、') }}</p><article v-for="fact in snapshot.timeline" :key="fact.evidence.revisionId+fact.evidence.fieldPath"><p>{{ fact.type }} · {{ formatDateTime(fact.time) }}</p><pre class="stream-evidence">{{ JSON.stringify(fact.payload,null,2) }}</pre><button class="action-button action-button--ghost" @click="openEvidence(fact.evidence)">查看原记录与指定修订</button></article></details>
      </div>
    </section>

    <section v-if="!isDemo" class="glass-section timeline-panel care-history-panel">
      <h2 class="section-title">复核随访与报告</h2>
      <p class="section-note">在首页回复医生随访；报告对应当前选择的分析快照。</p>
      <button class="action-button action-button--ghost" @click="refreshCareHistory">刷新随访与报告</button>
      <p v-if="followUpHistory.error.value" role="alert">{{ followUpHistory.error.value }}</p>
      <details :open="route.query.workspace === 'followups'">
        <summary>查看随访与复核历史</summary>
        <p v-if="!followUpHistory.followups.value.length" class="section-note">暂无随访任务。</p>
        <article v-for="task in followUpHistory.followups.value" :key="task.followUpId" class="stream-item">
          <strong>{{ followUpHistory.labels[task.status] }} · {{ task.requiredFields.map(field => followUpHistory.labels[field] ?? field).join('、') }}</strong>
          <p class="section-note">{{ task.instruction }} · 截止 {{ formatDateTime(task.dueAt) }} · 版本 {{ task.version }}</p>
          <details><summary>随访来源</summary><p class="section-note">随访 {{ task.followUpId }} · 来源复核 {{ task.sourceReviewId }} · 快照 {{ task.snapshotId }}</p><p v-if="task.completedRecordId" class="section-note">完成记录 {{ task.completedRecordId }}</p></details>
          <button v-if="task.status === 'PENDING'" class="action-button action-button--ghost" @click="router.push('/home')">前往首页回复随访</button>
        </article>
        <h3>复核历史</h3><p v-if="!followUpHistory.reviews.value.length" class="section-note">暂无复核意见。</p>
        <article v-for="review in followUpHistory.reviews.value" :key="review.reviewId" class="stream-item">
          <strong>{{ followUpHistory.labels[review.status] }}{{ review.historical ? ' · 历史快照' : '' }}</strong>
          <p class="section-note">{{ review.comment }} · 理由：{{ review.reason }}</p>
          <details><summary>复核来源</summary><p class="section-note">{{ review.reviewId }} · {{ review.snapshotId }}</p></details>
        </article>
      </details>
      <h3>家属报告</h3>
      <p v-if="familyReports.error.value" role="alert">{{ familyReports.error.value }}</p>
      <p v-if="!familyReports.report.value" class="section-note">当前快照尚无家属报告，请由医生端生成。</p>
      <template v-else>
        <p class="section-note">{{ analysisLabels[familyReports.report.value.status] ?? familyReports.report.value.status }} · {{ familyReports.report.value.errorCode }}</p>
        <button v-if="familyReports.report.value.status === 'SUCCESS'" class="action-button action-button--ghost" :disabled="familyReports.busy.value" @click="familyReports.preview">预览家属报告</button>
        <button v-if="familyReports.html.value" class="action-button action-button--ghost" @click="familyReports.download">下载 HTML 报告</button>
        <iframe v-if="familyReports.html.value" class="family-report-preview" title="家属报告预览" sandbox="" :srcdoc="reportPreviewHtml(familyReports.html.value)" />
      </template>
    </section>
    <div v-if="selectedDay" class="modal-mask" @click="closeDay">
      <div class="modal-card" @click.stop>
        <div class="modal-head">
          <div class="modal-head__copy">
            <h4>风险链条识别结果</h4>
            <div class="modal-summary-grid">
              <div
                v-for="item in modalSummaryFields"
                :key="item.label"
                class="modal-summary-item"
              >
                <span>{{ item.label }}</span>
                <strong>{{ item.value }}</strong>
              </div>
            </div>
            <p>{{ formatArchiveDate(selectedDay.date) }} · {{ selectedDay.events.length }} 条同步事件</p>
          </div>
          <button class="close-btn" @click="closeDay">关闭</button>
        </div>

        <section v-if="!isDemo && evidenceReference" class="event-item">
          <h4>分析引用的原始证据</h4><p class="section-note">{{ evidenceReference.sourceId }} · {{ evidenceReference.revisionId }} · {{ evidenceReference.fieldPath }}</p>
          <p v-if="evidenceLoading" role="status">正在读取指定修订…</p><p v-if="evidenceError" role="alert">{{ evidenceError }}</p>
          <button v-if="evidenceError" class="action-button action-button--ghost" @click="analysis.evidence(evidenceReference)">重试证据</button>
          <template v-if="evidenceRevision"><p>版本 {{ evidenceRevision.version }} · {{ formatDateTime(evidenceRevision.occurredAt) }} · {{ evidenceRevision.changeReason }}</p><p>{{ evidenceRevision.rawText }}</p><pre class="event-item__summary">{{ JSON.stringify(evidenceRevision.confirmedFacts,null,2) }}</pre></template>
          <button class="action-button action-button--ghost" @click="analysis.closeEvidence">关闭来源记录</button>
        </section>
        <div class="event-list">
          <article
            v-for="event in selectedDay.events"
            :key="`${selectedDay.date}-${event.code}-${event.occurredAt}`"
            class="event-item"
          >
            <div class="event-item__top">
              <div>
                <p class="event-item__code">{{ event.code }}</p>
                <strong>{{ event.label }}</strong>
              </div>
              <span :class="`severity-pill severity-pill--${event.severity == null ? 'neutral' : getRiskTone(event.severity)}`">{{ event.severity ?? '复查线索' }}</span>
            </div>

            <p class="event-item__time">{{ formatDateTime(event.occurredAt) }}</p>
            <pre class="event-item__summary">{{ event.evidenceSummary }}</pre>
            <button v-for="e in event.evidence" :key="e.sourceId+e.revisionId+e.fieldPath" class="action-button action-button--ghost evidence-button" @click="analysis.evidence(e)">{{ e.fieldPath }} · {{ formatDateTime(e.occurredAt) }}</button>

            <div class="stream-tag-row">
              <span
                v-for="direction in event.directions"
                :key="`${event.code}-${direction}-modal`"
                class="stream-tag"
              >
                {{ formatDirection(direction) }}
              </span>
            </div>
          </article>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.family-report-preview { width: 100%; height: 420px; border: 1px solid #afc8c0; border-radius: 16px; margin-top: 12px; }
.risk-page select { max-width: 100%; width: 100%; padding: 8px; border: 1px solid #afc8c0; border-radius: 12px; background: rgba(255,255,255,.7); color: inherit; }
.risk-page .section-copy { min-width: 0; }
.risk-page .section-note, .risk-page .modal-card p { overflow-wrap: anywhere; }
.risk-page .evidence-button { display: block; max-width: 100%; margin: 6px 0; white-space: normal; overflow-wrap: anywhere; }
.risk-page [role=alert] { color: #a42e2e; }
.risk-page {
  --text-dark: #1f3646;
  --text-muted: #5e7a8c;
  background-image: url('../static/optimized/page-background.webp');
  background-color: #edf4fa;
  background-size: 100% auto;
  background-position: center top;
  background-repeat: no-repeat;
  background-attachment: fixed;
  min-height: 100dvh;
  padding: 12px 16px calc(var(--bottom-nav-height) + env(safe-area-inset-bottom, 0px));
  color: var(--text-dark);
  position: relative;
  overflow-x: hidden;
}

.risk-page::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    linear-gradient(90deg, rgba(241, 249, 255, 0.58) 0%, rgba(220, 237, 247, 0.42) 38%, rgba(200, 224, 238, 0.14) 68%, rgba(255, 255, 255, 0) 100%);
  pointer-events: none;
  z-index: 0;
}

.risk-page > * {
  position: relative;
  z-index: 1;
}

.hero-panel {
  padding: 8px 0 0;
}

.hero-top {
  padding: 28px 6px 14px;
}

.hero-copy {
  display: grid;
  gap: 10px;
}

.hero-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.patient-name {
  margin: 0;
  font-size: 28px;
  line-height: 1.05;
  letter-spacing: -0.03em;
}

.patient-badge {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  background: rgba(26, 84, 118, 0.1);
  color: #2c5f7e;
  font-size: 13px;
  font-weight: 700;
}

.patient-subtitle,
.section-note {
  margin: 0;
  max-width: 760px;
  font-size: 14px;
  color: var(--text-muted);
  line-height: 1.7;
}

.summary-card {
  position: relative;
  margin-bottom: 14px;
  padding: 16px;
  border-radius: 28px;
  overflow: hidden;
  box-shadow: 0 18px 34px rgba(32, 61, 108, 0.18);
  background:
    radial-gradient(circle at 18% 16%, rgba(255, 255, 255, 0.28), transparent 30%),
    linear-gradient(145deg, rgba(82, 126, 176, 0.44) 0%, rgba(112, 154, 201, 0.5) 42%, rgba(67, 105, 154, 0.58) 100%);
}

.summary-card__bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.58;
  pointer-events: none;
}

.summary-card::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    linear-gradient(135deg, rgba(225, 239, 252, 0.26) 0%, rgba(146, 181, 220, 0.14) 42%, rgba(77, 117, 173, 0.22) 100%),
    linear-gradient(135deg, rgba(238, 246, 255, 0.18), rgba(71, 110, 164, 0.12));
}

.summary-card__content {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 14px;
}

.summary-card__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.summary-card__heading {
  display: grid;
  gap: 4px;
}

.summary-card__heading h2 {
  margin: 0;
  font-size: 16px;
  line-height: 1.15;
  color: #f8fbff;
  font-weight: 800;
}

.summary-card__heading p {
  margin: 0;
  color: rgba(247, 247, 241, 0.86);
  font-size: 12px;
  line-height: 1.5;
}

.summary-card__body {
  padding: 14px;
  border-radius: 20px;
  background: rgba(244, 249, 255, 0.9);
  border: 1px solid rgba(222, 235, 249, 0.92);
  box-shadow: 0 14px 28px rgba(41, 78, 129, 0.1);
}

.metrics-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  width: 100%;
}

.metric-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 72px;
  padding: 10px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.66);
  min-width: 0;
  overflow: hidden;
}

.metric-item--sand {
  background: rgba(251, 246, 238, 0.92);
  color: #674a32;
}

.metric-item--sage {
  background: rgba(239, 248, 242, 0.94);
  color: #28594d;
}

.metric-item--sky {
  background: rgba(239, 245, 255, 0.94);
  color: #355887;
}

.metric-item--gold,
.metric-item--featured {
  background: linear-gradient(135deg, rgba(194, 156, 63, 0.9) 0%, rgba(215, 181, 98, 0.96) 100%);
  color: #fffaf0;
  box-shadow: 0 10px 20px rgba(176, 129, 21, 0.18);
}

.metric-item__copy {
  display: grid;
  min-width: 0;
}

.metric-item__copy p {
  margin: 0;
  font-size: 11px;
  line-height: 1.35;
  font-weight: 700;
}

.metric-item__meta {
  display: grid;
  justify-items: end;
  gap: 2px;
  flex-shrink: 0;
}

.metric-item strong {
  font-size: 20px;
  line-height: 1;
}

.metric-item__meta em {
  font-size: 10px;
  font-weight: 700;
  opacity: 0.88;
  font-style: normal;
}

.glass-section {
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 24px;
  box-shadow: 0 8px 32px rgba(100, 150, 180, 0.15);
  margin-bottom: 14px;
  overflow: hidden;
}

.timeline-panel {
  padding: 18px 16px;
}

.section-header {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 12px;
  align-items: start;
}

.section-copy {
  display: grid;
  gap: 8px;
}

.section-eyebrow {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #6e88a0;
}

.section-title {
  margin: 0;
  font-size: 16px;
  line-height: 1.15;
  color: #1d4057;
}

.section-actions {
  display: grid;
  gap: 10px;
  justify-items: end;
}

.date-switcher,
.action-button--ghost,
.date-nav,
.stream-item,
.event-item {
  box-shadow: 0 8px 20px rgba(70, 106, 133, 0.06);
}

.date-switcher {
  display: inline-grid;
  grid-auto-flow: column;
  gap: 8px;
  padding: 4px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.62);
  border: 1px solid rgba(207, 223, 236, 0.82);
}

.date-nav {
  min-width: 38px;
  min-height: 38px;
  border-radius: 12px;
  background: rgba(18, 64, 70, 0.08);
  color: #1b5963;
  font-size: 18px;
  font-weight: 700;
}

.date-nav:disabled {
  opacity: 0.4;
  cursor: default;
}

.action-button {
  min-height: 38px;
  padding: 0 14px;
  border-radius: 14px;
  font-weight: 700;
}

.action-button--ghost {
  background: rgba(18, 64, 70, 0.08);
  color: #1b5963;
  border: 1px solid rgba(27, 89, 99, 0.08);
}

.stream-list,
.event-list {
  display: grid;
  gap: 12px;
  margin-top: 18px;
}

.stream-item,
.event-item {
  position: relative;
  display: grid;
  gap: 10px;
  padding: 15px 15px 15px 18px;
  border-radius: 20px;
  background: rgba(248, 251, 255, 0.88);
  border: 1px solid rgba(214, 229, 243, 0.88);
}

.stream-item::before,
.event-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 14px;
  bottom: 14px;
  width: 4px;
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(37, 103, 120, 0.9) 0%, rgba(111, 173, 186, 0.55) 100%);
}

.stream-item--danger {
  background: rgba(255, 248, 244, 0.92);
}

.stream-item--warning {
  background: rgba(255, 250, 240, 0.92);
}

.stream-item--info {
  background: rgba(247, 250, 255, 0.92);
}

.stream-item--danger::before {
  background: linear-gradient(180deg, rgba(182, 86, 63, 0.92) 0%, rgba(231, 176, 152, 0.58) 100%);
}

.stream-item--warning::before {
  background: linear-gradient(180deg, rgba(185, 132, 32, 0.92) 0%, rgba(230, 205, 145, 0.58) 100%);
}

.stream-item--info::before {
  background: linear-gradient(180deg, rgba(72, 123, 196, 0.9) 0%, rgba(170, 201, 238, 0.6) 100%);
}

.stream-head,
.event-item__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.stream-copy strong,
.event-item strong {
  font-size: 14px;
  color: #264660;
}

.stream-time {
  flex-shrink: 0;
  color: #7792aa;
  font-size: 12px;
  font-weight: 700;
}

.stream-evidence,
.event-item__summary {
  margin: 0;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(196, 214, 226, 0.9);
  color: #4d677a;
  font-size: 12px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: Consolas, 'Courier New', monospace;
}

.event-item__time {
  margin: 0;
  color: #5d7188;
  line-height: 1.65;
  font-size: 12px;
}

.stream-tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.stream-tag {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 11px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  background: rgba(255, 255, 255, 0.78);
  color: #315b61;
  border: 1px solid rgba(196, 214, 226, 0.9);
}

.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.status-chip::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: currentColor;
}

.status-chip--success {
  color: #216850;
  background: rgba(33, 104, 80, 0.12);
}

.status-chip--info {
  color: #255f8f;
  background: rgba(37, 95, 143, 0.1);
}

.status-chip--warning {
  color: #975f00;
  background: rgba(245, 158, 11, 0.15);
}

.status-chip--danger {
  color: #a33631;
  background: rgba(163, 54, 49, 0.14);
}

.modal-mask {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 20px 16px calc(var(--bottom-nav-height) + 14px);
  background: rgba(18, 34, 53, 0.42);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.modal-card {
  width: min(100%, 480px);
  max-height: calc(100dvh - 150px);
  overflow-y: auto;
  display: grid;
  gap: 16px;
  padding: 18px;
  border-radius: 28px;
  background: #f9fbff;
  box-shadow: 0 18px 44px rgba(23, 52, 78, 0.28);
}

.modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.modal-head__copy {
  flex: 1;
  min-width: 0;
}

.modal-head h4 {
  margin: 0;
  font-size: 16px;
  line-height: 1.5;
  color: #1a415c;
}

.modal-summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 12px;
}

.modal-summary-item {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 16px;
  background: linear-gradient(180deg, #eef6ff 0%, #e4f0ff 100%);
}

.modal-summary-item span {
  font-size: 12px;
  line-height: 1.4;
  color: #5d7188;
}

.modal-summary-item strong {
  font-size: 14px;
  line-height: 1.5;
  color: #12384f;
}

.modal-head p {
  margin: 6px 0 0;
  color: #5d7188;
  line-height: 1.6;
  font-size: 13px;
}

.close-btn {
  min-height: 38px;
  padding: 0 14px;
  border-radius: 14px;
  background: rgba(18, 64, 70, 0.08);
  color: #1b5963;
  font-weight: 700;
}

.event-item__code {
  margin: 0 0 4px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #7690a7;
}

.severity-pill {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 0 11px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.severity-pill--success {
  background: rgba(33, 104, 80, 0.12);
  color: #216850;
}

.severity-pill--info {
  background: rgba(13, 102, 112, 0.12);
  color: #0d6670;
}

.severity-pill--warning {
  background: rgba(245, 158, 11, 0.15);
  color: #975f00;
}

.severity-pill--danger {
  background: rgba(163, 54, 49, 0.14);
  color: #a33631;
}

@media (max-width: 420px) {
  .patient-name {
    font-size: 24px;
  }

  .summary-card__top,
  .section-header,
  .modal-head,
  .stream-head,
  .event-item__top {
    display: grid;
    grid-template-columns: 1fr;
  }

  .section-actions {
    justify-items: start;
  }

  .modal-summary-grid {
    grid-template-columns: 1fr;
  }

  .metric-item {
    min-height: 68px;
    padding: 8px;
    gap: 8px;
  }

  .metric-item strong {
    font-size: 17px;
  }

  .metric-item__copy p {
    font-size: 10px;
  }

  .metric-item__meta em {
    font-size: 9px;
  }
}
</style>

<style scoped>
.risk-page--real .timeline-panel .section-header { grid-template-columns: minmax(0, 1fr); align-items: start; }
.risk-page--real .timeline-panel .section-copy { min-width: 0; }
.risk-page--real .section-actions { display: flex; flex-wrap: wrap; justify-content: flex-start; gap: 8px; max-width: 100%; }
.risk-page--real .analysis-status-panel { display: grid; gap: 12px; margin-top: 14px; min-width: 0; }
.risk-page--real .analysis-status-panel > button { justify-self: start; }
.risk-page--real .analysis-history-field { display: grid; gap: 8px; width: 100%; font-weight: 600; }
.risk-page--real select { min-width: 0; box-sizing: border-box; font: inherit; font-size: 13px; min-height: 42px; }
.risk-page--real details { min-width: 0; padding: 12px 14px; background: rgba(239,246,250,.85); border: 1px solid #dae6ed; border-radius: 14px; color: #526f83; font-size: 13px; line-height: 1.7; }
.risk-page--real summary { cursor: pointer; color: #315b75; font-weight: 700; overflow-wrap: anywhere; }
.risk-page--real details[open] > summary { margin-bottom: 12px; }
.risk-page--real details p { margin: 8px 0; font-size: 13px; line-height: 1.75; overflow-wrap: anywhere; }
.risk-page--real .rule-facts-panel > article { margin-top: 12px; padding-top: 12px; border-top: 1px solid #d7e3eb; min-width: 0; }
.risk-page--real .rule-facts-panel button { margin-top: 10px; }
.risk-page--real .care-history-panel { display: grid; gap: 14px; }
.risk-page--real .care-history-panel > button { justify-self: start; }
.risk-page--real .care-history-panel h3 { margin: 8px 0 0; font-size: 15px; color: #294f69; }
.risk-page--real .care-history-panel details > .stream-item { margin-top: 12px; }
.risk-page--real :is(.stream-item, .event-item, .stream-copy, .modal-card) { min-width: 0; overflow-wrap: anywhere; }
.risk-page--real :is(.stream-head, .event-item__top) { flex-wrap: wrap; gap: 6px 12px; }
.risk-page--real .stream-copy { min-width: 0; }
.risk-page--real .stream-time { max-width: 100%; line-height: 1.6; }
.risk-page--real .event-item h4 { margin: 0; font-size: 15px; line-height: 1.6; color: #264660; }
.risk-page--real .event-item > p { margin: 0; font-size: 13px; line-height: 1.75; color: #597487; }
.risk-page--real pre { min-width: 0; max-width: 100%; box-sizing: border-box; overflow-wrap: anywhere; }
.risk-page--real .action-button { white-space: normal; line-height: 1.6; max-width: 100%; }
.risk-page--real :is(button, select, summary):focus-visible { outline: 2px solid #4a879e; outline-offset: 3px; }
.risk-page--real .family-report-preview { box-sizing: border-box; }
.risk-page--real [role=status] { margin: 0; font-size: 13px; color: #526f83; }
</style>

<style scoped>
.risk-page .metrics-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.risk-page .metric-item { display: grid; grid-template-columns: minmax(0, 1fr); align-content: start; gap: 8px; }
.risk-page .metric-item__copy, .risk-page .metric-item__meta { min-width: 0; }
.risk-page .metric-item__copy p { font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.risk-page .metric-item__meta { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px; }
.risk-page .metric-item__meta em { font-size: 11px; }
.risk-page--real .care-history-panel { grid-template-columns: minmax(0, 1fr); }
.risk-page--real :is(.care-history-panel, .rule-facts-panel, .analysis-status-panel) > * { min-width: 0; max-width: 100%; }
.risk-page--real .family-report-preview { display: block; width: 100%; min-width: 0; height: 520px; background: #fff; }
@media(min-width: 600px) { .risk-page .metrics-row { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
</style>
