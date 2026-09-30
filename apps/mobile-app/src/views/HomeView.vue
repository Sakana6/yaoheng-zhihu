<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

import { mobileApi, mobileRuntimeConfig } from '../lib/api';
import { scheduleTodayReminderNotifications, speakText } from '../lib/device';
import { formatStatus } from '../lib/format';
import type { MobileReminder } from '../lib/types';
import { useMvpStore } from '../stores/mvp';
import cardBg from '../static/pictures/card-bg.png';

import { useRouter } from 'vue-router';
import { selectedPatient, session, sessionEpoch } from '../../../../packages/frontend/session';
import { useHomeCare } from '../../../../packages/frontend/home-care';
import { useFeedbackDraft } from '../../../../packages/frontend/feedback-draft';
import FeedbackCapturePanel from '../components/FeedbackCapturePanel.vue';
import type { CaptureTask } from '../../../../packages/frontend/capture-api';
import { localInput } from '../../../../packages/frontend/care';
import { displayTime, statusLabel, type Occurrence, type FollowUp } from '../../../../packages/frontend/care';
import { followUpLabels } from '../../../../packages/frontend/followup-state';
import { notificationHint } from '../../../../packages/frontend/notifications';
import { remindersAllowed, reminderNotificationError, enableReminderNotifications, refreshReminderNotifications } from '../../../../packages/frontend/notification-session';

const isDemo = mobileRuntimeConfig.useMock;
const router = useRouter();
const home = useHomeCare();
const { occurrences, followupError, latest, loading: realLoading, error: realError, analysisError, medicationError, summary: analysisSummary, skipBusy, skipError } = home;
const writable = computed(() => session.value?.role === 'CAREGIVER');
const realDraft = ref<ReturnType<typeof useFeedbackDraft> | null>(null);
const realTarget = ref<Occurrence | null>(null);
const skipTarget = ref<Occurrence | null>(null), skipReason = ref(''), savedMessage = ref('');
let realAlive = true, realTimer: ReturnType<typeof setInterval> | undefined;
const realFollowUp=ref<FollowUp|null>(null),openingFollowUp=ref(false);
let replySequence=0;
async function beginFeedback(o?: Occurrence) {
  if (!writable.value || realDraft.value?.busy || skipBusy.value) return;
  if (realDraft.value || openingFollowUp.value) return; // Keep an open draft until explicitly closed or saved.
  if (o?.followUpId) {
    const seq=++replySequence,epoch=sessionEpoch.value;openingFollowUp.value=true;savedMessage.value='';
    try{const task=await home.readFollowUp(o.followUpId);if(!realAlive||seq!==replySequence||epoch!==sessionEpoch.value)return;
      realFollowUp.value=task;realTarget.value=task.reminder;realDraft.value=reactive(useFeedbackDraft({occurrence:task.reminder,followUp:task,medications:home.medications.value}));
    }catch(e){if(realAlive&&seq===replySequence&&epoch===sessionEpoch.value)savedMessage.value=String(e);}
    finally{if(realAlive&&seq===replySequence)openingFollowUp.value=false;}return;
  }
  if (o && o.executionStatus !== 'PENDING') return;
  if (!o && medicationError.value) return;
  realTarget.value = o ?? null;
  realDraft.value = reactive(useFeedbackDraft({ occurrence: o, medications: home.medications.value }));
  savedMessage.value = '';
}
function closeRealFeedback() { if (!realDraft.value?.busy) { realDraft.value = null; realTarget.value = null; realFollowUp.value=null;replySequence++; } }
function applyFeedbackCapture(task:CaptureTask) {
  const draft=realDraft.value;if(!draft||draft.busy||task.status!=='CANDIDATE_READY'||!['VOICE','DEVICE'].includes(task.kind))return;
  if(draft.capture&&draft.capture.taskId!==task.taskId)return;
  if(task.kind==='VOICE')draft.rawText=task.result?.text??'';
  else {
    if(realTarget.value||!task.result?.proposedFacts)return;
    draft.facts=JSON.parse(JSON.stringify(task.result.proposedFacts));
    for(const group of ['glucose','bloodPressure'] as const)for(const fact of draft.facts[group])fact.occurredAt=localInput(fact.occurredAt);
    draft.time=localInput(task.result.observedAt!);draft.rawText='设备回放测量，已人工核对';draft.symptomState='unknown';
  }
  draft.capture={taskId:task.taskId,version:task.version,kind:task.kind as 'VOICE'|'DEVICE'};draft.reviewed=false;
}
async function saveRealFeedback() {
  const draft = realDraft.value;
  if (!draft) return;
  const saved = await draft.save();
  if (!saved || !realAlive || realDraft.value !== draft) return;
  realDraft.value = null; realTarget.value = null; realFollowUp.value=null;
  savedMessage.value = `反馈已保存（版本 ${saved.version}），分析任务已入队；未出结果前不判断风险。`;
  void refreshReminderNotifications();
  await home.load();
}
async function submitSkip() {
  if (!skipTarget.value) return;
  if (await home.skip(skipTarget.value, skipReason.value)) {
    if (!realAlive) return;
    skipTarget.value = null; savedMessage.value = '已跳过，未记作已服药。'; await home.load();
  }
}
function beginSkip(o: Occurrence) { if (!skipBusy.value) { skipTarget.value=o; skipReason.value=''; skipError.value=''; } }
async function speakReal(o: Occurrence) {
  try { await speakText(`${o.title}，计划时间${displayTime(o.plannedAt)}。请填写实际反馈。`); }
  catch { savedMessage.value = '语音播报暂不可用，请查看文字提醒。'; }
}
type RiskTone = 'critical' | 'warning' | 'muted';
type ReminderTone = RiskTone | 'neutral' | 'success';

interface RiskEvent {
  time: string;
  kind: string;
  title: string;
  subject: string;
  signal: string;
  action: string;
  level: string;
  tone: RiskTone;
}

interface ReminderItem {
  icon: string;
  time: string;
  title: string;
  detail: string;
  status: string;
  hint: string;
  tone: ReminderTone;
}

interface InteractiveReminderItem extends ReminderItem {
  reminderId: string;
  source: MobileReminder;
}

type VoiceSessionStatus = 'prompting' | 'awaiting-feedback' | 'followup' | 'completed';
type VoiceEntryTone = 'system' | 'patient' | 'success';

interface VoiceEntry {
  role: string;
  text: string;
  tone: VoiceEntryTone;
}

interface ReminderVoiceSession {
  reminderId: string;
  title: string;
  time: string;
  promptText: string;
  status: VoiceSessionStatus;
  firstQuestionPlayed: boolean;
  followupAsked: boolean;
  entries: VoiceEntry[];
}

const pageTitle = '两病联合治疗看板';
const pageSubtitle = '聚焦高血压与糖尿病的联合干预，只保留风险复核、用药执行和随访提醒。';
const patientLabel = computed(() => isDemo ? '高血压 + 糖尿病' : selectedPatient.value?.name ?? '当前患者');
const autoRotateMs = 4200;
const showAncillaryPanels = false;

const fallbackRiskEvents: RiskEvent[] = [
  {
    time: '08:35',
    kind: '漏服',
    title: '早间降压药未按时服用',
    subject: '氯沙坦 50mg',
    signal: '建议先电话核实并补服',
    action: '立即跟进',
    level: '高紧急',
    tone: 'critical',
  },
  {
    time: '11:42',
    kind: '漏测',
    title: '午前血压复测缺失',
    subject: '血压监测',
    signal: '建议安排补测并回填数值',
    action: '去补测',
    level: '中紧急',
    tone: 'warning',
  },
  {
    time: '14:26',
    kind: '没有反馈',
    title: '午后随访问询未收到回复',
    subject: '症状回访',
    signal: '建议改为人工电话回访',
    action: '发起回访',
    level: '待回访',
    tone: 'muted',
  },
];

const fallbackReminders: ReminderItem[] = [
  {
    icon: '⚠️',
    time: '08:00',
    title: '早间服药确认',
    detail: '核对是否已补服降压药，并补记漏服原因。',
    status: '待处理',
    hint: '优先处理',
    tone: 'critical',
  },
  {
    icon: '🩺',
    time: '11:30',
    title: '血压补测',
    detail: '补录上午血压，确认是否仍高于基线。',
    status: '需补测',
    hint: '缺少监测值',
    tone: 'warning',
  },
  {
    icon: '📞',
    time: '14:00',
    title: '午后症状反馈',
    detail: '继续联系患者，确认头晕与乏力是否缓解。',
    status: '待回访',
    hint: '两轮未回复',
    tone: 'muted',
  },
  {
    icon: '💊',
    time: '18:30',
    title: '晚间用药提醒',
    detail: '确认晚餐后 30 分钟内完成服药。',
    status: '今日安排',
    hint: '常规提醒',
    tone: 'neutral',
  },
  {
    icon: '🌙',
    time: '21:00',
    title: '睡前状态复核',
    detail: '查看夜间血压、心率及睡前主诉。',
    status: '待执行',
    hint: '夜间观察',
    tone: 'success',
  },
];

const mvpStore = isDemo ? useMvpStore() : null;
const reminderSource = ref<MobileReminder[]>([]);
const reminderVoiceQuestions = [
  '血压计设备已连接，已读取血压数据，正在分析血压水平',
  '收缩压在90-139内，舒张压在60-89内，血压水平正常，请继续保持良好生活习惯。',
];
const firstVoiceQuestion = reminderVoiceQuestions[0];
const secondVoiceQuestion = reminderVoiceQuestions[1];
const activeVoiceSession = ref<ReminderVoiceSession | null>(null);
const voiceFlowBusy = ref(false);
const reminderAnnouncementWindowMs = 60 * 1000;
const reminderTimerHandles = new Map<string, ReturnType<typeof window.setTimeout>>();
const announcedReminderIds = new Set<string>();

function isValidDate(value?: string | null): boolean {
  return !!value && !Number.isNaN(new Date(value).getTime());
}

function toDate(value?: string | null): Date | null {
  return isValidDate(value) ? new Date(value as string) : null;
}

function toDateKey(value?: string | null): string {
  const date = toDate(value);
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatClock(value?: string | null): string {
  const date = toDate(value);
  if (!date) return '--:--';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function cloneReminders(reminders: MobileReminder[]): MobileReminder[] {
  return reminders.map((item) => ({
    ...item,
    medicationIds: [...item.medicationIds],
    medicationNames: [...item.medicationNames],
  }));
}

function sortReminders(reminders: MobileReminder[]): MobileReminder[] {
  return [...reminders].sort((left, right) => {
    const leftTime = toDate(left.plannedAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const rightTime = toDate(right.plannedAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return leftTime - rightTime;
  });
}

function normalizeText(reminder: MobileReminder): string {
  return [
    reminder.title,
    reminder.followUpPrompt,
    reminder.voicePrompt,
    reminder.medicationNames.join(' '),
    reminder.reminderType,
  ]
    .join(' ')
    .toLowerCase();
}

function isCompleted(status?: string): boolean {
  return status === 'SUCCESS' || status === 'DONE';
}

function isPending(status?: string): boolean {
  return !isCompleted(status) && status !== 'FAILED';
}

function isOverdue(reminder: MobileReminder): boolean {
  const plannedAt = toDate(reminder.plannedAt);
  return !!plannedAt && isPending(reminder.status) && plannedAt.getTime() < Date.now();
}

function isCriticalReminder(reminder: MobileReminder): boolean {
  const text = normalizeText(reminder);
  return (
    isOverdue(reminder) ||
    [
      '头晕',
      '不适',
      '症状',
      '血糖',
      '血压',
      '复测',
      '补测',
      '补录',
      'follow-up',
      'follow up',
      'symptom',
      'glucose',
      'blood pressure',
      'bp',
      'bg',
    ].some((keyword) => text.includes(keyword))
  );
}

function isWarningReminder(reminder: MobileReminder): boolean {
  if (isCriticalReminder(reminder)) {
    return false;
  }

  const plannedAt = toDate(reminder.plannedAt);
  if (!plannedAt) {
    return false;
  }

  const diffMs = plannedAt.getTime() - Date.now();
  return isPending(reminder.status) && diffMs <= 2 * 60 * 60 * 1000;
}

function getRiskTone(reminder: MobileReminder): RiskTone {
  if (reminder.status === 'FAILED') return 'critical';
  if (isCriticalReminder(reminder)) return 'critical';
  if (isWarningReminder(reminder)) return 'warning';
  return 'muted';
}

function getReminderTone(reminder: MobileReminder): ReminderTone {
  if (isCompleted(reminder.status)) return 'success';
  if (reminder.status === 'FAILED') return 'critical';
  if (isCriticalReminder(reminder)) return 'critical';
  if (isWarningReminder(reminder)) return 'warning';
  return 'neutral';
}

function getReminderIcon(tone: ReminderTone): string {
  if (tone === 'critical') return '⚠️';
  if (tone === 'warning') return '⏰';
  if (tone === 'success') return '✅';
  return '💊';
}

function getReminderHint(reminder: MobileReminder, tone: ReminderTone): string {
  if (isCompleted(reminder.status)) return '已完成';
  if (reminder.status === 'FAILED') return '处理异常';
  if (tone === 'critical') return '优先处理';
  if (tone === 'warning') return '注意跟进';
  return '常规提醒';
}

function getRiskKind(reminder: MobileReminder, tone: RiskTone): string {
  if (isCompleted(reminder.status)) return '已处理';
  if (tone === 'critical') return '高风险提醒';
  if (tone === 'warning') return '待跟进提醒';
  return '提醒安排';
}

function getRiskLevel(tone: RiskTone): string {
  if (tone === 'critical') return '高优先级';
  if (tone === 'warning') return '中优先级';
  return '待确认';
}

function getRiskAction(reminder: MobileReminder): string {
  if (isCompleted(reminder.status)) return '查看记录';
  if (isCriticalReminder(reminder)) return '立即处理';
  return '去确认';
}

function getRiskSignal(reminder: MobileReminder): string {
  const detail = reminder.followUpPrompt?.trim() || reminder.voicePrompt?.trim();
  if (detail) return detail;
  if (reminder.medicationNames.length) return `关联药物：${reminder.medicationNames.join('、')}`;
  return '请按提醒安排完成本次跟进。';
}

function getRiskSubject(reminder: MobileReminder): string {
  return reminder.medicationNames.length ? reminder.medicationNames.join('、') : reminder.reminderType;
}

function getReminderDetail(reminder: MobileReminder): string {
  const detail = reminder.followUpPrompt?.trim() || reminder.voicePrompt?.trim();
  if (detail) return detail;
  if (reminder.medicationNames.length) return `关联药物：${reminder.medicationNames.join('、')}`;
  return '等待补充本次提醒的执行说明。';
}

function getReminderPriority(reminder: MobileReminder): number {
  if (isCompleted(reminder.status)) return 1;
  if (isCriticalReminder(reminder)) return 4;
  if (isWarningReminder(reminder)) return 3;
  return 2;
}

function isActiveRiskReminder(reminder: MobileReminder): boolean {
  return !isCompleted(reminder.status) && getRiskTone(reminder) !== 'muted';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function getReminderPromptText(reminder: MobileReminder): string {
  return reminder.title?.trim() || reminder.voicePrompt?.trim() || reminder.followUpPrompt?.trim() || firstVoiceQuestion;
}

function ensureVoiceSession(reminder: MobileReminder): ReminderVoiceSession {
  if (activeVoiceSession.value?.reminderId === reminder.reminderId) {
    return activeVoiceSession.value;
  }

  const session: ReminderVoiceSession = {
    reminderId: reminder.reminderId,
    title: reminder.title,
    time: formatClock(reminder.plannedAt),
    promptText: getReminderPromptText(reminder),
    status: 'awaiting-feedback',
    firstQuestionPlayed: false,
    followupAsked: false,
    entries: [{ role: '系统提醒', text: getReminderPromptText(reminder), tone: 'system' }],
  };

  activeVoiceSession.value = session;
  return session;
}

function pushVoiceEntry(session: ReminderVoiceSession, role: string, text: string, tone: VoiceEntryTone): void {
  const exists = session.entries.some((item) => item.role === role && item.text === text);
  if (!exists) {
    session.entries.push({ role, text, tone });
  }
}

function closeVoiceSession(): void {
  if (voiceFlowBusy.value) {
    return;
  }

  activeVoiceSession.value = null;
}

function openVoiceReminder(reminder: MobileReminder): void {
  ensureVoiceSession(reminder);
}

function updateReminderStatusLocal(reminderId: string, status: string): void {
  if (!isDemo) return;
  reminderSource.value = reminderSource.value.map((item) =>
    item.reminderId === reminderId
      ? {
          ...item,
          status,
        }
      : item,
  );
}

async function triggerVoiceReminder(reminder: MobileReminder): Promise<void> {
  if (!isPending(reminder.status)) {
    return;
  }

  const session = ensureVoiceSession(reminder);
  session.status = 'prompting';
  announcedReminderIds.add(reminder.reminderId);
  pushVoiceEntry(session, '系统提醒', session.promptText, 'system');

  try {
    await speakText(session.promptText);
  } catch {
    // Ignore speech failures and keep the text reminder visible.
  }

  if (activeVoiceSession.value?.reminderId === reminder.reminderId && session.status === 'prompting') {
    session.status = 'awaiting-feedback';
  }
}

async function markReminderComplete(reminder: MobileReminder): Promise<void> {
  if (!isDemo) return;
  if (voiceFlowBusy.value || isCompleted(reminder.status)) {
    return;
  }

  if (!announcedReminderIds.has(reminder.reminderId)) {
    await triggerVoiceReminder(reminder);
    await sleep(240);
  } else {
    ensureVoiceSession(reminder);
  }

  const session = ensureVoiceSession(reminder);

  if (!session.firstQuestionPlayed) {
    session.promptText = firstVoiceQuestion;
    session.status = 'prompting';
    pushVoiceEntry(session, '系统提问', firstVoiceQuestion, 'system');

    try {
      await speakText(firstVoiceQuestion);
    } catch {
      // Keep the scripted demo flow moving.
    }

    session.firstQuestionPlayed = true;
    session.status = 'awaiting-feedback';
    return;
  }

  if (!session.followupAsked) {
    voiceFlowBusy.value = true;
    try {
      session.followupAsked = true;
      session.promptText = secondVoiceQuestion;
      session.status = 'followup';
      pushVoiceEntry(session, '系统追问', secondVoiceQuestion, 'system');

      try {
        await speakText(secondVoiceQuestion);
      } catch {
        // Keep the scripted demo flow moving.
      }

      await sleep(320);
      pushVoiceEntry(session, '系统', '血压结果已播报，本次提醒结束。', 'success');
      session.status = 'completed';
      updateReminderStatusLocal(reminder.reminderId, 'DONE');
      mvpStore!.updateReminderStatus(reminder.reminderId, 'DONE');

      try {
        await mobileApi.ackReminder(reminder.reminderId);
      } catch {
        // The local demo state is already updated.
      }
    } finally {
      voiceFlowBusy.value = false;
    }
  }
}

function clearReminderTimers(): void {
  for (const handle of reminderTimerHandles.values()) {
    window.clearTimeout(handle);
  }
  reminderTimerHandles.clear();
}

function scheduleVoiceReminders(reminders: MobileReminder[]): void {
  if (typeof window === 'undefined') {
    return;
  }

  clearReminderTimers();
  const now = Date.now();

  for (const reminder of reminders) {
    if (!isPending(reminder.status)) {
      continue;
    }

    const plannedAt = toDate(reminder.plannedAt);
    if (!plannedAt) {
      continue;
    }

    const delayMs = plannedAt.getTime() - now;
    if (delayMs <= 0) {
      if (!announcedReminderIds.has(reminder.reminderId) && Math.abs(delayMs) <= reminderAnnouncementWindowMs) {
        void triggerVoiceReminder(reminder);
      }
      continue;
    }

    const handle = window.setTimeout(() => {
      reminderTimerHandles.delete(reminder.reminderId);
      void triggerVoiceReminder(reminder);
    }, delayMs);

    reminderTimerHandles.set(reminder.reminderId, handle);
  }
}

async function loadReminderSource() {
  if (mvpStore!.state.reminders.length) {
    reminderSource.value = cloneReminders(mvpStore!.state.reminders);
    return;
  }

  try {
    const response = await mobileApi.getTodayReminders();
    reminderSource.value = cloneReminders(response.reminders);
  } catch {
    reminderSource.value = [];
  }
}

const sortedReminderSource = computed(() => sortReminders(reminderSource.value));
const displayReminderSource = computed(() => {
  if (!sortedReminderSource.value.length) {
    return [];
  }

  const todayKey = toDateKey(new Date().toISOString());
  const todayReminders = sortedReminderSource.value.filter((item) => toDateKey(item.plannedAt) === todayKey);
  return todayReminders.length ? todayReminders : sortedReminderSource.value;
});

const reminders = computed<ReminderItem[]>(() => {
  if (!displayReminderSource.value.length) {
    return fallbackReminders;
  }

  return displayReminderSource.value.map((item) => {
    const tone = getReminderTone(item);
    const statusMeta = formatStatus(item.status);
    return {
      icon: getReminderIcon(tone),
      time: formatClock(item.plannedAt),
      title: item.title,
      detail: getReminderDetail(item),
      status: isOverdue(item) && isPending(item.status) ? '待处理' : statusMeta.label,
      hint: getReminderHint(item, tone),
      tone,
    };
  });
});

const interactiveReminders = computed<InteractiveReminderItem[]>(() =>
  displayReminderSource.value.map((item) => {
    const tone = getReminderTone(item);
    const statusMeta = formatStatus(item.status);
    return {
      reminderId: item.reminderId,
      icon: getReminderIcon(tone),
      time: formatClock(item.plannedAt),
      title: item.title,
      detail: getReminderDetail(item),
      status: isOverdue(item) && isPending(item.status) ? '待处理' : statusMeta.label,
      hint: getReminderHint(item, tone),
      tone,
      source: item,
    };
  }),
);

const activeVoiceReminder = computed(() =>
  activeVoiceSession.value
    ? displayReminderSource.value.find((item) => item.reminderId === activeVoiceSession.value?.reminderId) ?? null
    : null,
);

const activeVoiceStatusText = computed(() => {
  if (!activeVoiceSession.value) {
    return '';
  }

  if (activeVoiceSession.value.status === 'prompting') return '语音提醒播报中';
  if (!activeVoiceSession.value.firstQuestionPlayed) return '等待点击已完成';
  if (activeVoiceSession.value.status === 'followup') return '第二句话播报中';
  if (activeVoiceSession.value.status === 'completed') return '本次反馈已完成';
  return '等待再次点击已完成';
});

const riskEvents = computed<RiskEvent[]>(() => {
  if (!isDemo) return (latest.value?.snapshot?.jointEvents ?? []).map(event => ({
    time: event.evidence[0] ? formatClock(event.evidence[0].occurredAt) : '—',
    kind: event.eventType, title: ('label' in event && typeof event.label === 'string') ? event.label : event.eventType, subject: '已发布分析快照',
    signal: `证据 ${event.evidence.length} 项`, action: '查看证据', level: '复查线索', tone: 'muted',
  }));
  return [...displayReminderSource.value]
    .filter((item) => isActiveRiskReminder(item))
    .sort((left, right) => {
      const priorityDiff = getReminderPriority(right) - getReminderPriority(left);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      const leftTime = toDate(left.plannedAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const rightTime = toDate(right.plannedAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime;
    })
    .map((item) => {
      const tone = getRiskTone(item);
      return {
        time: formatClock(item.plannedAt),
        kind: getRiskKind(item, tone),
        title: item.title,
        subject: getRiskSubject(item),
        signal: getRiskSignal(item),
        action: getRiskAction(item),
        level: getRiskLevel(tone),
        tone,
      };
    });
});

const hasRiskEvents = computed(() => riskEvents.value.length > 0);

const activeRiskIndex = ref(0);
const activeRisk = computed(() => riskEvents.value[activeRiskIndex.value] ?? riskEvents.value[0]);

let riskTimer: ReturnType<typeof window.setInterval> | null = null;

function stopRiskAutoplay() {
  if (riskTimer !== null) {
    window.clearInterval(riskTimer);
    riskTimer = null;
  }
}

function startRiskAutoplay() {
  stopRiskAutoplay();
  if (typeof window === 'undefined' || riskEvents.value.length < 2) {
    return;
  }
  riskTimer = window.setInterval(() => {
    activeRiskIndex.value = (activeRiskIndex.value + 1) % riskEvents.value.length;
  }, autoRotateMs);
}

function goToPrevRisk() {
  if (!riskEvents.value.length) return;
  activeRiskIndex.value = (activeRiskIndex.value - 1 + riskEvents.value.length) % riskEvents.value.length;
  startRiskAutoplay();
}

function goToNextRisk() {
  if (!riskEvents.value.length) return;
  activeRiskIndex.value = (activeRiskIndex.value + 1) % riskEvents.value.length;
  startRiskAutoplay();
}

function setActiveRisk(index: number) {
  if (!riskEvents.value.length) return;
  activeRiskIndex.value = index;
  startRiskAutoplay();
}

onMounted(() => {
  if (isDemo) void loadReminderSource();
  else {
    void home.load();
    realTimer = setInterval(() => { if (document.visibilityState === 'visible' && !realDraft.value && !skipTarget.value) void home.load(); }, 15000);
  }
  startRiskAutoplay();
});

if (isDemo) watch(
  () => mvpStore!.state.reminders,
  (next) => {
    reminderSource.value = cloneReminders(next);
  },
  { deep: true },
);

if (isDemo) watch(
  displayReminderSource,
  (next) => {
    void scheduleTodayReminderNotifications(next);
    scheduleVoiceReminders(next);
  },
  { deep: true, immediate: true },
);

watch(
  riskEvents,
  (next) => {
    if (!next.length) {
      activeRiskIndex.value = 0;
      stopRiskAutoplay();
      return;
    }

    if (activeRiskIndex.value >= next.length) {
      activeRiskIndex.value = 0;
    }

    startRiskAutoplay();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  replySequence++;
  realAlive = false; home.dispose(); clearInterval(realTimer);
  stopRiskAutoplay();
  clearReminderTimers();
});
</script>

<template>
  <div class="mobile-page home-page" :class="{ 'home-page--real': !isDemo }">
    <section class="hero-panel">
      <div class="hero-top">
        <div class="hero-copy">
          <div class="hero-title-row">
            <p class="patient-name">{{ pageTitle }}</p>
            <p class="patient-badge">{{ patientLabel }}</p>
          </div>
          <p class="patient-subtitle">{{ pageSubtitle }}</p>
        </div>
      </div>
    </section>

    <section class="glass-section risk-carousel-section">
      <img class="risk-carousel-bg" :src="cardBg" alt="" />
      <div class="risk-carousel-overlay"></div>

      <div class="section-header">
        <div class="section-copy">
          <p class="section-eyebrow">联合治疗预警</p>
          <h2 class="section-title">今日重点干预</h2>
          <p class="section-note">只展示与高血压、糖尿病联合治疗相关的漏服、漏测和异常反馈。</p>
        </div>

        <div v-if="hasRiskEvents" class="carousel-controls">
          <button type="button" class="carousel-button" aria-label="上一条风险事件" @click="goToPrevRisk">←</button>
          <span class="carousel-count">{{ activeRiskIndex + 1 }} / {{ riskEvents.length }}</span>
          <button type="button" class="carousel-button" aria-label="下一条风险事件" @click="goToNextRisk">→</button>
        </div>
      </div>

      <div
        v-if="hasRiskEvents"
        class="risk-strip-shell"
        :class="`risk-strip-shell--${activeRisk.tone}`"
        @mouseenter="stopRiskAutoplay"
        @mouseleave="startRiskAutoplay"
      >
        <div class="risk-strip-viewport" aria-live="polite">
          <div class="risk-strip-track" :style="{ transform: `translateX(-${activeRiskIndex * 100}%)` }">
            <article
              v-for="(item, index) in riskEvents"
              :key="`${item.time}-${item.title}`"
              class="risk-strip"
              :class="`risk-strip--${item.tone}`"
            >
              <div class="risk-strip-leading">
                <div class="risk-strip-summary">
                  <div class="risk-strip-head">
                    <span class="risk-strip-kind">{{ item.kind }}</span>
                    <span class="risk-strip-time">{{ item.time }}</span>
                  </div>
                  <strong class="risk-strip-title">{{ item.title }}</strong>
                  <p class="risk-strip-meta">{{ item.subject }} · {{ item.signal }}</p>
                </div>
              </div>

              <div class="risk-strip-side">
                <span class="risk-level-chip">{{ item.level }}</span>
                <button
                  type="button"
                  class="risk-action-button"
                  :aria-label="`处理第 ${index + 1} 条风险事件`"
                  @click="!isDemo && router.push({path:'/risk',query:{run:latest?.snapshot?.runId}})"
                >
                  {{ item.action }}
                </button>
              </div>
            </article>
          </div>
        </div>
      </div>

      <div v-else class="risk-strip-shell risk-strip-shell--muted risk-empty-state">
        <div class="risk-strip risk-strip--muted">
          <div class="risk-strip-leading">
            <div class="risk-strip-summary">
              <div class="risk-strip-head">
                <span class="risk-strip-kind">流程状态</span>
                <span class="risk-strip-time">今日</span>
              </div>
              <strong class="risk-strip-title">{{ isDemo ? '当前暂无联合治疗风险' : analysisSummary }}</strong>
              <p class="risk-strip-meta">{{ isDemo ? '继续跟进血压、血糖和症状反馈' : '记录可继续保存；缺少结果不代表风险正常。' }}</p>
            </div>
          </div>
        </div>
      </div>

      <div v-if="!isDemo" class="analysis-status-panel">
        <p v-if="analysisError" role="alert">{{ analysisError }}</p>
        <p v-if="latest?.snapshot" class="section-note">运行 {{ latest.snapshot.runId }} · 快照 {{ latest.snapshot.snapshotId }} · 输入版本 {{ latest.snapshot.inputRevision }} / 当前 {{ latest.inputRevision }}</p>
        <p v-if="latest?.snapshot && latest.snapshot.inputRevision !== latest.inputRevision" class="section-note">已有结果对应历史输入，最新记录等待分析。</p>
        <p v-if="latest?.pendingTask" class="section-note">分析任务：{{ ({PENDING:'待处理',RUNNING:'处理中',SUCCESS:'成功',FAILED:'失败'})[latest.pendingTask.status] }}</p>
        <button v-if="latest?.pendingTask?.status==='FAILED' && writable" class="ghost-button" :disabled="home.analysis.busy.value" @click="home.analysis.retry">重试分析</button>
        <p v-if="latest?.snapshot && !latest.snapshot.risk" class="section-note">资料不足，未生成评分。</p>
        <p v-if="latest?.snapshot?.risk" class="section-note">治疗强度 {{ latest.snapshot.risk.deintensificationScore }} · 联用 {{ latest.snapshot.risk.interactionScore }} · 执行行为 {{ latest.snapshot.risk.behaviorScore }} · 联合事件 {{ latest.snapshot.risk.jointEventScore }}</p>
      </div>
      <div v-if="hasRiskEvents && riskEvents.length > 1" class="carousel-dots">
        <button
          v-for="(_, index) in riskEvents"
          :key="index"
          type="button"
          class="carousel-dot"
          :class="{ active: index === activeRiskIndex }"
          :aria-label="`查看第 ${index + 1} 条风险事件`"
          @click="setActiveRisk(index)"
        ></button>
      </div>
    </section>

    <section class="glass-section reminders-section">
      <div class="section-header">
        <div class="section-copy">
          <p class="section-eyebrow">{{isDemo?'今日联合任务':'用药与随访任务'}}</p>
          <h2 class="section-title">用药与随访提醒</h2>
          <p class="section-note">仅保留降压、降糖、复测和症状回访任务，避免无关信息干扰。</p>
        </div>
      </div>

      <template v-if="!isDemo">
        <div class="reminder-actions">
          <button class="reminder-action" :disabled="realLoading" @click="home.load()">刷新首页</button>
          <button v-if="writable" class="reminder-action" :disabled="!!medicationError" @click="beginFeedback()">主动记录</button>
        </div>
        <p v-if="realError" role="alert">{{ realError }}</p>
        <p v-if="medicationError" role="alert">{{ medicationError }}</p>
        <p v-if="savedMessage" role="status">{{ savedMessage }}</p>
        <details v-if="writable" class="notification-settings"><summary>提醒通知 · {{ remindersAllowed ? '已允许' : '未允许' }}</summary><p>{{ notificationHint }}</p><button class="reminder-action" @click="enableReminderNotifications">开启通知</button></details>
        <p v-if="reminderNotificationError" role="alert">{{ reminderNotificationError }}</p>
      </template>
      <div class="reminder-list">
        <template v-if="!isDemo">
          <p v-if="followupError" role="alert">{{followupError}}</p><p v-if="openingFollowUp">正在读取随访版本…</p>
          <p v-if="realLoading && !occurrences.length">正在读取提醒…</p>
          <p v-else-if="!occurrences.length && !realError">暂无今日提醒或待回复随访，请在管理页设置计划。</p>
          <article v-for="o in occurrences" :key="o.occurrenceId" class="reminder-item" :class="o.executionStatus === 'DONE' ? 'reminder-item--success' : 'reminder-item--neutral'">
            <div class="reminder-icon-wrap"><span class="reminder-icon">{{ o.executionStatus === 'DONE' ? '✅' : '⏰' }}</span></div>
            <div class="reminder-body">
              <div class="reminder-body__top"><strong>{{ o.title }}</strong><span class="reminder-status">{{ statusLabel(o.displayStatus) }}</span></div>
              <p v-for="m in o.medications" :key="m.medicationId">{{ m.genericName }} · {{ m.dose }}</p>
              <div class="reminder-meta"><span class="reminder-meta-pill">{{ displayTime(o.plannedAt) }}</span><span class="reminder-meta-pill">计划版本 {{ o.planVersion }}</span></div>
              <p v-if="o.skipReason">跳过原因：{{ o.skipReason }}</p>
              <details><summary>来源信息</summary><small>实例 {{ o.occurrenceId }}</small></details>
              <div class="reminder-actions">
                <button class="reminder-action" @click="speakReal(o)">播报提醒</button>
                <button v-if="writable && o.executionStatus === 'PENDING'" class="reminder-action reminder-action--primary" @click="beginFeedback(o)">{{ o.followUpId ? '回复医生随访' : '填写反馈' }}</button>
                <button v-if="writable && o.executionStatus === 'PENDING' && !o.followUpId" class="reminder-action" @click="beginSkip(o)">跳过</button>
              </div>
            </div>
          </article>
        </template>
        <template v-else-if="interactiveReminders.length">
          <article
            v-for="item in interactiveReminders"
            :key="item.reminderId"
            class="reminder-item"
            :class="`reminder-item--${item.tone}`"
          >
            <div class="reminder-icon-wrap">
              <span class="reminder-icon">{{ item.icon }}</span>
            </div>

            <div class="reminder-body">
              <div class="reminder-body__top">
                <strong>{{ item.title }}</strong>
                <span class="reminder-status" :class="`reminder-status--${item.tone}`">{{ item.status }}</span>
              </div>
              <p>{{ item.detail }}</p>
              <div class="reminder-meta">
                <span class="reminder-meta-pill">计划 {{ item.time }}</span>
                <span class="reminder-meta-pill">{{ item.hint }}</span>
              </div>
              <div class="reminder-actions">
                <button type="button" class="reminder-action reminder-action--primary" @click="openVoiceReminder(item.source)">
                  播报提醒
                </button>
                <button
                  type="button"
                  class="reminder-action reminder-action--primary"
                  :disabled="voiceFlowBusy || item.source.status === 'DONE' || item.source.status === 'SUCCESS'"
                  @click="markReminderComplete(item.source)"
                >
                  {{
                    item.source.status === 'DONE' || item.source.status === 'SUCCESS'
                      ? '已反馈'
                      : voiceFlowBusy && activeVoiceSession?.reminderId === item.reminderId
                          ? '处理中...'
                        : activeVoiceSession?.reminderId === item.reminderId && activeVoiceSession.firstQuestionPlayed
                          ? '已完成'
                          : '已完成'
                  }}
                </button>
              </div>
            </div>
          </article>
        </template>

        <template v-else>
          <article
            v-for="item in reminders"
            :key="`${item.time}-${item.title}`"
            class="reminder-item"
            :class="`reminder-item--${item.tone}`"
          >
          <div class="reminder-icon-wrap">
            <span class="reminder-icon">{{ item.icon }}</span>
          </div>

          <div class="reminder-body">
            <div class="reminder-body__top">
              <strong>{{ item.title }}</strong>
              <span class="reminder-status" :class="`reminder-status--${item.tone}`">{{ item.status }}</span>
            </div>
            <p>{{ item.detail }}</p>
            <div class="reminder-meta">
              <span class="reminder-meta-pill">🕒 {{ item.time }}</span>
              <span class="reminder-meta-pill">{{ item.hint }}</span>
            </div>
          </div>
          </article>
        </template>
      </div>
    </section>

    <div v-if="isDemo && activeVoiceSession" class="voice-reminder-backdrop" @click.self="closeVoiceSession">
      <section class="voice-reminder-sheet">
        <div class="voice-reminder-head">
          <div class="voice-reminder-copy">
            <span class="voice-reminder-eyebrow">语音提醒</span>
            <strong>{{ activeVoiceSession.title }}</strong>
            <p>{{ activeVoiceSession.time }} · 文字与语音同步提醒</p>
          </div>
          <button
            type="button"
            class="voice-reminder-close"
            :disabled="voiceFlowBusy"
            @click="closeVoiceSession"
          >
            关闭
          </button>
        </div>

        <div class="voice-reminder-card">
          <span class="voice-reminder-chip">{{ activeVoiceStatusText }}</span>
          <p>{{ activeVoiceSession.promptText }}</p>
        </div>

        <div class="voice-reminder-script">
          <article
            v-for="(entry, index) in activeVoiceSession.entries"
            :key="`${entry.role}-${index}`"
            class="voice-reminder-entry"
            :class="`voice-reminder-entry--${entry.tone}`"
          >
            <span class="voice-reminder-role">{{ entry.role }}</span>
            <p>{{ entry.text }}</p>
          </article>
        </div>

        <div
          class="voice-reminder-recorder"
          :class="{ 'voice-reminder-recorder--recording': ['prompting', 'followup'].includes(activeVoiceSession.status) }"
        >
          <div class="voice-reminder-wave">
            <span></span>
            <span></span>
            <span></span>
            <span></span>
          </div>
          <p>{{ activeVoiceStatusText }}</p>
        </div>

        <div class="voice-reminder-actions">
          <button
            type="button"
            class="reminder-action reminder-action--secondary"
            :disabled="voiceFlowBusy || !activeVoiceReminder"
            @click="activeVoiceReminder && triggerVoiceReminder(activeVoiceReminder)"
          >
            再播报一次
          </button>
          <button
            type="button"
            class="reminder-action reminder-action--primary"
            :disabled="
              voiceFlowBusy
              || !activeVoiceReminder
              || activeVoiceSession.status === 'completed'
            "
            @click="
              activeVoiceReminder
                && markReminderComplete(activeVoiceReminder)
            "
          >
            {{
              activeVoiceSession.status === 'completed'
                ? '已反馈完成'
                : !activeVoiceSession.firstQuestionPlayed
                  ? '已完成'
                  : '已完成'
            }}
          </button>
        </div>
      </section>
    </div>

    <div v-if="!isDemo && realDraft" class="voice-reminder-backdrop" @click.self="closeRealFeedback">
      <section class="voice-reminder-sheet real-feedback-sheet">
        <div class="voice-reminder-head"><div class="voice-reminder-copy"><span class="voice-reminder-eyebrow">人工确认反馈</span><strong>{{ realTarget?.title ?? '主动记录' }}</strong><p>播报不会完成任务，请核对实际发生的信息。</p></div><button class="voice-reminder-close" :disabled="realDraft.busy" @click="closeRealFeedback">关闭</button></div>

 <p v-if="realFollowUp">医生随访：{{realFollowUp.instruction}} · 所需资料：{{realFollowUp.requiredFields.map(f=>followUpLabels[f]??f).join('、')}} · 版本 {{realFollowUp.version}}</p>
 <form @submit.prevent="saveRealFeedback"><fieldset :disabled="realDraft.busy"><legend>{{ realTarget ? '完成提醒反馈' : '主动记录' }}</legend>

  <p>只填写实际确认的信息；未填写保持未知。所有时间为北京时间。</p>
  <label>事件时间<input v-model="realDraft.time" type="datetime-local" step="1" required /></label><label>原始描述<textarea v-model="realDraft.rawText" maxlength="10000" rows="3" /></label>
  <FeedbackCapturePanel :locked="realDraft.busy" :device-allowed="!realTarget" :applied-id="realDraft.capture?.taskId" @apply="applyFeedbackCapture" />
  <h3>分药品确认</h3><div v-for="(m,i) in realDraft.facts.medications" :key="i" class="fact-row"><label>药品<select v-model="m.medicationId" required><option v-for="c in realDraft.choices" :key="c.id" :value="c.id">{{c.genericName}}</option></select></label><label>执行情况<select v-model="m.executionType"><option value="UNKNOWN">未知</option><option value="TAKEN">已服</option><option value="MISSED">漏服</option><option value="MAKEUP">补服</option></select></label><label>执行时间<input v-model="m.occurredAt" type="datetime-local" step="1" required /></label><button type="button" @click="realDraft.facts.medications.splice(i,1)">移除药品事实</button></div>
  <button v-if="realDraft.choices.length" type="button" @click="realDraft.facts.medications.push({medicationId:realDraft.choices[0].id,executionType:'UNKNOWN',occurredAt:realDraft.time})">添加药品执行</button>
  <label>症状确认<select v-model="realDraft.symptomState"><option value="unknown">尚未记录</option><option value="none">明确无症状</option><option value="present">有症状</option></select></label>
  <div v-if="realDraft.symptomState==='present'"><div v-for="(s,i) in realDraft.facts.symptoms" :key="i" class="fact-row"><label>症状<input v-model="s.code" required maxlength="64" /></label><label>程度（0–5）<input v-model.number="s.severity" type="number" min="0" max="5" required /></label><label>症状时间<input v-model="s.occurredAt" type="datetime-local" step="1" required /></label><button type="button" @click="realDraft.facts.symptoms.splice(i,1)">移除症状</button></div><button type="button" @click="realDraft.add('symptoms')">添加症状</button></div>
  <h3>实际测量与进食</h3>
  <div v-for="(g,i) in realDraft.facts.glucose" :key="i" class="fact-row"><label>血糖（mmol/L）<input v-model.number="g.value" type="number" step="0.1" min="0.1" max="99" required /></label><label>血糖测量时间<input v-model="g.occurredAt" type="datetime-local" step="1" required /></label><button type="button" @click="realDraft.facts.glucose.splice(i,1)">移除血糖</button></div>
  <div v-for="(b,i) in realDraft.facts.bloodPressure" :key="i" class="fact-row"><label>收缩压（mmHg）<input v-model.number="b.systolic" type="number" min="30" max="300" required /></label><label>舒张压（mmHg）<input v-model.number="b.diastolic" type="number" min="20" max="200" required /></label><label>血压测量时间<input v-model="b.occurredAt" type="datetime-local" step="1" required /></label><button type="button" @click="realDraft.facts.bloodPressure.splice(i,1)">移除血压</button></div>
  <div v-for="(m,i) in realDraft.facts.meals" :key="i" class="fact-row"><label>餐次<select v-model="m.mealType"><option value="UNKNOWN">未知</option><option value="BREAKFAST">早餐</option><option value="LUNCH">午餐</option><option value="DINNER">晚餐</option><option value="SNACK">加餐</option></select></label><label>进食量<select v-model="m.intakeLevel"><option value="UNKNOWN">未知</option><option value="NORMAL">正常</option><option value="INSUFFICIENT">不足</option><option value="SKIPPED">未进食</option></select></label><label>进食时间<input v-model="m.occurredAt" type="datetime-local" step="1" required /></label><button type="button" @click="realDraft.facts.meals.splice(i,1)">移除进食</button></div>
  <div class="toolbar"><button type="button" @click="realDraft.add('glucose')">添加血糖</button><button type="button" @click="realDraft.add('bloodPressure')">添加血压</button><button type="button" @click="realDraft.add('meals')">添加进食</button></div>
  <label class="feedback-confirmation"><input v-model="realDraft.reviewed" type="checkbox" />我已核对原文与以上字段；如有差异，以确认字段为准，原文保留。</label>

  <p role="alert">{{realDraft.error}}</p><button>{{realDraft.busy?'保存中…':'确认保存反馈'}}</button> <button type="button" @click="closeRealFeedback">关闭</button>
 </fieldset></form>

      </section>
    </div>
    <div v-if="!isDemo && skipTarget" class="voice-reminder-backdrop" @click.self="!skipBusy && (skipTarget=null)">
      <section class="voice-reminder-sheet real-feedback-sheet"><form @submit.prevent="submitSkip"><fieldset :disabled="skipBusy"><legend>跳过：{{ skipTarget.title }}</legend><p>跳过不代表已服药或漏服。</p><label>跳过原因<input v-model="skipReason" required maxlength="500" /></label><p role="alert">{{ skipError }}</p><div class="voice-reminder-actions"><button class="reminder-action" type="submit">确认跳过</button><button class="reminder-action" type="button" @click="skipTarget=null">关闭</button></div></fieldset></form></section>
    </div>

    <div v-if="showAncillaryPanels" class="bottom-grid">
      <section class="glass-section bottom-card">
        <div class="section-header section-header--compact">
          <h2 class="section-title">康复进度</h2>
          <div class="dots-indicator">
            <span></span><span></span><span></span>
          </div>
        </div>
        <div class="recovery-content">
          <div class="circular-chart">
            <svg viewBox="0 0 36 36" class="circular-svg">
              <path class="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
              <path class="circle-path" stroke-dasharray="84, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
              <text x="18" y="20.35" class="percentage">84</text>
              <text x="18" y="26" class="stars">***</text>
            </svg>
          </div>
          <div class="recovery-stats">
            <span class="stat-label">康复得分</span>
            <span class="stat-value text-green">良好</span>
            <div class="progress-bar">
              <div class="progress-fill" style="width: 90%"></div>
            </div>
            <div class="stat-bottom">
              <span>90%</span>
              <span class="diamonds">* * *</span>
            </div>
          </div>
        </div>
      </section>

      <section class="glass-section bottom-card">
        <div class="section-header section-header--compact">
          <h2 class="section-title">设备状况</h2>
          <div class="dots-indicator">
            <span></span><span></span><span></span>
          </div>
        </div>
        <div class="device-content">
          <div class="device-top">
            <div class="device-icon">
              <div class="watch-shape">+</div>
            </div>
            <div class="device-status">
              <span class="stat-label">已同步并监测中</span>
              <span class="stat-value text-dark">78 次/分</span>
              <div class="dash-line"></div>
            </div>
          </div>
          <div class="device-bottom">
            <div class="device-item">
              <span class="stat-label"><span class="check">+</span> 血氧仪</span>
              <span class="stat-value text-green">98% <small>SpO2</small></span>
            </div>
            <div class="device-item">
              <span class="stat-label">血压计</span>
              <span class="stat-value text-dark">142/90 <small>mmHg</small></span>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.real-feedback-sheet fieldset { border: 0; min-width: 0; padding: 0; }
.real-feedback-sheet label { display: grid; gap: 6px; margin: 12px 0; }
.real-feedback-sheet input, .real-feedback-sheet select, .real-feedback-sheet textarea { max-width: 100%; width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid #afc8c0; border-radius: 12px; font: inherit; }
.real-feedback-sheet input[type=checkbox] { width: auto; justify-self: start; }
.real-feedback-sheet button { padding: 10px 14px; border: 1px solid #afc8c0; border-radius: 12px; background: #e8f3ef; color: #234039; }
.real-feedback-sheet .fact-row { padding: 12px; margin: 12px 0; background: rgba(255,255,255,.65); border-radius: 14px; }
.home-page [role=alert] { color: #a42e2e; overflow-wrap: anywhere; }
.home-page small, .home-page .section-note { overflow-wrap: anywhere; }
.home-page button:disabled { opacity: .55; cursor: not-allowed; }

.home-page {
  --text-dark: #1f3646;
  --text-muted: #5e7a8c;
  background-image: url('../static/pictures/ChatGPT Image 2026年4月12日 18_24_00.png');
  background-color: #edf4fa;
  background-size: 100% auto;
  background-position: center top;
  background-repeat: no-repeat;
  background-attachment: fixed;
  min-height: 100dvh;
  padding: 15px 16px calc(var(--bottom-nav-height) + var(--bottom-nav-gap) + env(safe-area-inset-bottom, 0px));
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  color: var(--text-dark);
  position: relative;
  width: 100%;
  max-width: 100%;
  overflow-x: hidden;
}

.home-page::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    linear-gradient(90deg, rgba(241, 249, 255, 0.58) 0%, rgba(220, 237, 247, 0.42) 38%, rgba(200, 224, 238, 0.14) 68%, rgba(255, 255, 255, 0) 100%);
  pointer-events: none;
  z-index: 0;
}

.home-page > * {
  position: relative;
  z-index: 1;
}

.hero-panel {
  margin-bottom: 14px;
  padding: 48px 0 0;
}

.hero-top {
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  padding: 38px 20px 14px;
  border-radius: 30px 30px 0 0;
  position: relative;
  z-index: 1;
}

.hero-top::before {
  content: none;
}

.hero-copy {
  display: grid;
  gap: 12px;
  max-width: 380px;
}

.hero-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.section-eyebrow {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #6e88a0;
}

.section-title,
.patient-name {
  margin: 0;
  color: #294a67;
  font-size: 15px;
}

.patient-name {
  font-size: 34px;
  font-weight: 900;
  line-height: 1.02;
  letter-spacing: -0.02em;
  color: #173f46;
  text-align: left;
}

.patient-badge {
  margin: 0;
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 14px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(29, 80, 72, 0.12) 0%, rgba(45, 138, 103, 0.22) 100%);
  border: 1px solid rgba(45, 138, 103, 0.16);
  font-size: 13px;
  font-weight: 700;
  color: #205f56;
}

.patient-subtitle,
.section-note {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: rgba(31, 54, 70, 0.72);
  text-align: left;
  max-width: 34ch;
}

.glass-section {
  background: rgba(255, 255, 255, 0.56);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 24px;
  box-shadow: 0 8px 32px rgba(100, 150, 180, 0.15);
  margin-bottom: 14px;
  overflow: hidden;
}

.risk-carousel-section,
.reminders-section {
  padding: 18px 16px 16px;
}

.risk-carousel-section {
  position: relative;
}

.risk-carousel-section > * {
  position: relative;
  z-index: 1;
}

.risk-carousel-bg,
.risk-carousel-overlay {
  position: absolute;
  inset: 0;
}

.risk-carousel-bg {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.risk-carousel-overlay {
  background:
    linear-gradient(135deg, rgba(234, 243, 249, 0.74) 0%, rgba(245, 250, 255, 0.56) 42%, rgba(255, 255, 255, 0.34) 100%),
    linear-gradient(90deg, rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0.04));
}

.section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.section-header--compact {
  align-items: center;
  padding: 16px 16px 10px;
  margin-bottom: 0;
}

.section-copy {
  display: grid;
  gap: 6px;
}

.section-title {
  font-size: 16px;
  font-weight: 800;
}

.carousel-controls {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.carousel-button {
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  color: #32505e;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.carousel-button:hover,
.risk-action-button:hover,
.carousel-dot:hover {
  transform: translateY(-1px);
}

.carousel-count {
  min-width: 54px;
  text-align: center;
  font-size: 13px;
  font-weight: 700;
  color: #5f7787;
}

.risk-strip-shell {
  --accent: #537a95;
  position: relative;
  min-height: 126px;
  border-radius: 28px;
  overflow: hidden;
  background: linear-gradient(135deg, rgba(251, 246, 239, 0.78) 0%, rgba(247, 241, 231, 0.72) 100%);
  border: 1px solid rgba(255, 255, 255, 0.58);
  box-shadow: 0 16px 28px rgba(120, 143, 155, 0.12);
}

.risk-strip-shell--critical {
  --accent: #cf5a4f;
}

.risk-strip-shell--warning {
  --accent: #c58c1d;
}

.risk-strip-shell--muted {
  --accent: #537a95;
}

.risk-strip-shell::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.18) 0%, rgba(255, 248, 239, 0.03) 100%);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.14);
  pointer-events: none;
}

.risk-strip-shell::after {
  content: '';
  position: absolute;
  left: 0;
  top: 14px;
  bottom: 14px;
  width: 4px;
  border-radius: 999px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 72%, white) 0%, color-mix(in srgb, var(--accent) 28%, white) 100%);
  opacity: 0.72;
  pointer-events: none;
}

.risk-empty-state {
  display: flex;
  align-items: center;
}

.risk-empty-state .risk-strip {
  grid-template-columns: 1fr;
  min-height: 126px;
}

.risk-empty-state .risk-strip-summary {
  gap: 8px;
}

.risk-strip-viewport {
  position: relative;
  z-index: 1;
  overflow: hidden;
}

.risk-strip-track {
  display: flex;
  width: 100%;
  transition: transform 0.45s ease;
}

.risk-strip {
  flex: 0 0 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  min-height: 126px;
  padding: 18px 18px 18px 22px;
}

.risk-strip-leading {
  display: flex;
  align-items: center;
  min-width: 0;
}

.risk-strip-summary {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.risk-strip-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.risk-strip-kind,
.risk-strip-time {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
}

.risk-strip-kind {
  background: rgba(255, 255, 255, 0.88);
  color: var(--accent);
}

.risk-strip-time {
  color: #7f8fa0;
  background: rgba(255, 255, 255, 0.56);
}

.risk-strip-title {
  display: block;
  font-size: 16px;
  line-height: 1.2;
  color: #31526d;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.risk-strip-meta {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: #6f8292;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.risk-strip-side {
  display: grid;
  justify-items: end;
  gap: 10px;
}

.risk-level-chip {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.82);
  color: var(--accent);
  font-size: 12px;
  font-weight: 800;
}

.risk-action-button {
  min-height: 38px;
  padding: 0 16px;
  border: none;
  border-radius: 14px;
  background: color-mix(in srgb, var(--accent) 86%, white);
  color: #fffdf9;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 8px 14px rgba(145, 123, 96, 0.14);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.carousel-dots {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 14px;
}

.carousel-dot {
  width: 9px;
  height: 9px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: rgba(92, 127, 152, 0.24);
  cursor: pointer;
}

.carousel-dot.active {
  width: 24px;
  background: #4f738d;
}

.reminder-list {
  display: grid;
  gap: 12px;
}

.reminder-item {
  --accent: #78906f;
  position: relative;
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  gap: 12px;
  padding: 14px;
  border-radius: 22px;
  background: rgba(255, 251, 245, 0.84);
  border: 1px solid rgba(255, 255, 255, 0.88);
  box-shadow: 0 8px 20px rgba(90, 114, 126, 0.08);
}

.reminder-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 14px;
  bottom: 14px;
  width: 4px;
  border-radius: 999px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 72%, white) 0%, color-mix(in srgb, var(--accent) 28%, white) 100%);
  opacity: 0.72;
}

.reminder-item--critical {
  --accent: #d55f4c;
}

.reminder-item--warning {
  --accent: #c48d1d;
}

.reminder-item--muted {
  --accent: #537a95;
}

.reminder-item--neutral {
  --accent: #78906f;
}

.reminder-item--success {
  --accent: #2b8b67;
}

.reminder-icon-wrap {
  display: flex;
  align-items: flex-start;
  justify-content: center;
}

.reminder-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--accent) 16%, white);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.72);
  font-size: 18px;
}

.reminder-body {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.reminder-body__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.reminder-body strong {
  font-size: 14px;
  color: #28455c;
}

.reminder-body p {
  margin: 0;
  font-size: 12px;
  line-height: 1.65;
  color: #637b8d;
}

.reminder-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.reminder-meta-pill,
.reminder-status {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.reminder-meta-pill {
  background: rgba(237, 244, 249, 0.92);
  color: #587083;
}

.reminder-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 2px;
}

.reminder-list .reminder-actions .reminder-action:first-child {
  font-size: 0;
}

.reminder-list .reminder-actions .reminder-action:first-child::after {
  content: '打开提醒';
  font-size: 12px;
}

.reminder-list .reminder-actions .reminder-action:last-child {
  display: none;
}

.home-page--real .reminder-list .reminder-action:first-child { font-size: 12px; }
.home-page--real .reminder-list .reminder-action:first-child::after { content: none; }
.home-page--real .reminder-list .reminder-action:last-child { display: inline-block; }
.home-page--real .real-feedback-sheet { max-height: calc(100dvh - var(--bottom-nav-height) - var(--bottom-nav-gap) - 48px - env(safe-area-inset-bottom, 0px)); overflow-y: auto; }

.reminder-action {
  min-height: 36px;
  padding: 0 14px;
  border: none;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.reminder-action:hover {
  transform: translateY(-1px);
}

.reminder-action:disabled {
  opacity: 0.58;
  cursor: not-allowed;
  transform: none;
}

.reminder-action--primary {
  background: linear-gradient(135deg, #214d68 0%, #2e698b 100%);
  color: #ffffff;
  box-shadow: 0 10px 18px rgba(33, 77, 104, 0.24);
}

.reminder-action--secondary {
  background: #edf4fa;
  color: #23475f;
  box-shadow: inset 0 0 0 1px rgba(61, 102, 128, 0.18);
}

.reminder-status {
  flex: 0 0 auto;
  background: rgba(255, 255, 255, 0.92);
}

.reminder-status--critical {
  color: #c54d3e;
  background: rgba(255, 238, 235, 0.96);
}

.reminder-status--warning {
  color: #a17314;
  background: rgba(255, 246, 223, 0.96);
}

.reminder-status--muted {
  color: #476c85;
  background: rgba(232, 243, 250, 0.96);
}

.reminder-status--neutral {
  color: #61745b;
  background: rgba(242, 246, 239, 0.96);
}

.reminder-status--success {
  color: #237457;
  background: rgba(233, 247, 240, 0.96);
}

.voice-reminder-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 20px 16px calc(var(--bottom-nav-height) + var(--bottom-nav-gap) + 18px + env(safe-area-inset-bottom, 0px));
  background:
    linear-gradient(180deg, rgba(16, 30, 40, 0.14) 0%, rgba(16, 30, 40, 0.34) 100%);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.voice-reminder-sheet {
  width: min(100%, 560px);
  display: grid;
  gap: 14px;
  padding: 18px;
  position: relative;
  overflow: hidden;
  border-radius: 28px;
  background:
    linear-gradient(180deg, rgba(227, 239, 247, 0.99) 0%, rgba(208, 227, 238, 0.98) 100%);
  border: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 24px 48px rgba(24, 47, 60, 0.28);
  animation: voice-sheet-in 0.22s ease;
}

.voice-reminder-sheet::before {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 88px;
  background: linear-gradient(135deg, rgba(60, 110, 138, 0.18) 0%, rgba(255, 255, 255, 0.02) 100%);
  pointer-events: none;
}

.voice-reminder-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.voice-reminder-copy {
  display: grid;
  gap: 4px;
}

.voice-reminder-eyebrow {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #648297;
}

.voice-reminder-copy strong {
  color: #27465d;
  font-size: 18px;
}

.voice-reminder-copy p,
.voice-reminder-entry p,
.voice-reminder-recorder p {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: #617b8c;
}

.voice-reminder-close {
  min-height: 34px;
  padding: 0 12px;
  border: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  color: #18384a;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px rgba(45, 86, 108, 0.14);
}

.voice-reminder-card,
.voice-reminder-recorder {
  display: grid;
  gap: 8px;
  padding: 14px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.74);
  border: 1px solid rgba(255, 255, 255, 0.92);
}

.voice-reminder-card p {
  margin: 0;
  font-size: 15px;
  line-height: 1.7;
  color: #29465d;
}

.voice-reminder-chip {
  width: fit-content;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(32, 79, 104, 0.12);
  color: #173b50;
  font-size: 12px;
  font-weight: 700;
}

.voice-reminder-script {
  display: grid;
  gap: 8px;
  max-height: 240px;
  overflow: auto;
  padding-right: 2px;
}

.voice-reminder-entry {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(221, 234, 242, 0.96);
}

.voice-reminder-entry--patient {
  background: rgba(223, 241, 234, 0.98);
}

.voice-reminder-entry--success {
  background: rgba(219, 241, 231, 0.98);
}

.voice-reminder-role {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: #698496;
}

.voice-reminder-wave {
  display: flex;
  align-items: flex-end;
  gap: 5px;
  height: 24px;
}

.voice-reminder-wave span {
  width: 4px;
  height: 10px;
  border-radius: 999px;
  background: #6d8da0;
}

.voice-reminder-recorder--recording .voice-reminder-wave span {
  animation: voice-wave 0.9s ease-in-out infinite;
}

.voice-reminder-recorder--recording .voice-reminder-wave span:nth-child(2) {
  animation-delay: 0.12s;
}

.voice-reminder-recorder--recording .voice-reminder-wave span:nth-child(3) {
  animation-delay: 0.24s;
}

.voice-reminder-recorder--recording .voice-reminder-wave span:nth-child(4) {
  animation-delay: 0.36s;
}

.voice-reminder-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.dots-indicator {
  display: flex;
  gap: 4px;
}

.dots-indicator span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #b0c4d0;
}

.bottom-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.bottom-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.recovery-content {
  padding: 0 12px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.circular-chart {
  width: 60px;
  height: 60px;
}

.circular-svg {
  display: block;
  max-width: 100%;
}

.circle-bg {
  fill: none;
  stroke: rgba(255, 255, 255, 0.8);
  stroke-width: 3.5;
}

.circle-path {
  fill: none;
  stroke: #f1c40f;
  stroke-width: 3.5;
  stroke-linecap: round;
}

.percentage {
  font-size: 12px;
  font-weight: bold;
  text-anchor: middle;
  fill: #1a2a30;
}

.stars {
  font-size: 4px;
  text-anchor: middle;
  fill: #e8a62c;
}

.recovery-stats {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.text-green {
  color: #356b5b;
  font-weight: 600;
}

.text-dark {
  color: #1a2a30;
  font-weight: 600;
}

.progress-bar {
  height: 6px;
  background: rgba(255, 255, 255, 0.6);
  border-radius: 3px;
  margin: 6px 0;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: #a8cfb4;
  border-radius: 3px;
}

.stat-bottom {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 600;
  color: #1a2a30;
}

.diamonds {
  color: #a8cfb4;
  font-size: 8px;
  letter-spacing: 2px;
}

.device-content {
  padding: 0 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.device-top {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.device-icon {
  width: 40px;
  height: 40px;
  background: #395b70;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.watch-shape {
  color: white;
  font-size: 20px;
  font-weight: bold;
}

.device-status {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.dash-line {
  height: 3px;
  background: repeating-linear-gradient(to right, #a8cfb4 0, #a8cfb4 5px, transparent 5px, transparent 8px);
  margin-top: 4px;
  width: 100%;
}

.device-bottom {
  display: flex;
  gap: 8px;
  min-width: 0;
}

.device-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.check {
  color: #a8cfb4;
  font-size: 10px;
}

.device-item small {
  font-weight: normal;
  color: #6e8490;
}

.stat-label {
  font-size: 11px;
  color: #556b78;
  margin-bottom: 2px;
}

.stat-value {
  font-size: 14px;
}

@media (max-width: 720px) {
  .hero-panel {
    padding: 30px 0 0;
  }

  .hero-top {
    padding: 30px 14px 12px;
  }

  .patient-name {
    font-size: 28px;
  }

  .patient-badge {
    min-height: 32px;
    padding: 0 12px;
    font-size: 12px;
  }

  .patient-subtitle,
  .section-note {
    font-size: 13px;
  }

  .risk-carousel-section,
  .reminders-section {
    padding: 14px 12px 12px;
  }

  .risk-strip {
    grid-template-columns: 1fr;
    align-items: flex-start;
    padding: 16px;
  }

  .risk-strip-side {
    width: 100%;
    grid-auto-flow: column;
    justify-content: space-between;
    align-items: center;
  }

  .risk-strip-title,
  .risk-strip-meta {
    white-space: normal;
  }

  .reminder-body__top {
    flex-direction: column;
    align-items: flex-start;
  }

  .voice-reminder-sheet {
    padding: 16px;
  }

  .bottom-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 420px) {
  .home-page {
    padding-inline: 12px;
  }

  .patient-name {
    font-size: 28px;
  }

  .section-title {
    font-size: 16px;
  }

  .carousel-controls {
    width: 100%;
    justify-content: space-between;
  }

  .risk-strip-shell {
    min-height: 150px;
  }

  .risk-strip {
    min-height: 150px;
  }

  .risk-strip-leading {
    align-items: flex-start;
  }

  .risk-strip-side {
    grid-auto-flow: row;
    justify-content: start;
    justify-items: start;
  }

  .reminder-item {
    grid-template-columns: 1fr;
  }

  .reminder-icon-wrap {
    justify-content: flex-start;
  }

  .voice-reminder-backdrop {
    padding-inline: 12px;
  }

  .voice-reminder-head {
    flex-direction: column;
  }

  .voice-reminder-actions .reminder-action {
    flex: 1 1 160px;
  }

  .bottom-grid {
    gap: 10px;
  }

  .recovery-content,
  .device-content {
    padding-inline: 10px;
  }

  .device-bottom {
    gap: 6px;
  }

  .stat-label {
    font-size: 10px;
  }

  .stat-value {
    font-size: 13px;
  }
}

@keyframes voice-wave {
  0%,
  100% {
    transform: scaleY(0.4);
    opacity: 0.55;
  }

  50% {
    transform: scaleY(1);
    opacity: 1;
  }
}

@keyframes voice-sheet-in {
  from {
    opacity: 0;
    transform: translateY(18px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>

<style scoped>
.home-page--real .analysis-status-panel { display: grid; gap: 8px; margin-top: 16px; padding: 14px; border: 1px solid #dbe8e8; border-radius: 16px; background: rgba(240,247,247,.8); }
.home-page--real .analysis-status-panel p { margin: 0; font-size: 12px; line-height: 1.75; color: #587183; overflow-wrap: anywhere; }
.home-page--real .analysis-status-panel button { justify-self: start; }
.home-page--real .notification-settings { margin: 12px 0; padding: 12px 14px; border-radius: 14px; background: #f0f6f5; font-size: 13px; line-height: 1.7; color: #526f79; }
.home-page--real summary { cursor: pointer; font-size: 12px; font-weight: 600; color: #426b78; }
.home-page--real details[open] > summary { margin-bottom: 8px; }
.home-page--real .reminder-item { grid-template-columns: 40px minmax(0,1fr); align-items: start; gap: 10px; }
.home-page--real .reminder-icon { width: 36px; height: 36px; font-size: 22px; }
.home-page--real .reminder-body__top { flex-direction: row; flex-wrap: wrap; align-items: center; align-content: start; gap: 6px; }
.home-page--real .reminder-body__top strong { flex: 1 1 120px; min-width: 0; overflow-wrap: anywhere; line-height: 1.6; }
.home-page--real .reminder-status { flex-shrink: 0; background: #edf4f4; color: #456875; }
.home-page--real .reminder-body details { padding-top: 4px; }
.home-page--real .reminder-body small { display: block; font-size: 11px; line-height: 1.65; color: #6b8090; }
.home-page--real .reminder-actions button { white-space: normal; line-height: 1.5; min-height: 36px; }
.home-page--real [role=alert]:not(:empty) { color: #aa4343; font-size: 13px; line-height: 1.7; }
.home-page--real .reminders-section > [role=status] { color: #327065; font-size: 13px; line-height: 1.7; }
</style>
<style scoped src="../styles/feedback-form.css"></style>
