<script setup lang="ts">
import ConnectionStatus from '../components/ConnectionStatus.vue';
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { mobileApi, mobileRuntimeConfig } from '../lib/api';
import { formatDateTime as demoDateTime } from '../lib/format';
import { useMvpStore } from '../stores/mvp';
import type { CurrentPatientContext, MobileJointEvent, MobileMedication, MobileReminder, RiskDirection } from '../lib/types';
import homeCardBg from '../static/pictures/home-card.jpg';

import { selectedPatient, session } from '../../../../packages/frontend/session';
import { useRecordHistory, dayKey, dayWindow, factFields, timelineRecords } from '../../../../packages/frontend/record-history';
import { useFeedbackDraft } from '../../../../packages/frontend/feedback-draft';
import { shanghaiDate, displayTime, type Feedback } from '../../../../packages/frontend/care';
import { refreshReminderNotifications } from '../../../../packages/frontend/notification-session';
const isDemo = mobileRuntimeConfig.useMock;
const history = useRecordHistory();
const revisionDraft = ref<ReturnType<typeof useFeedbackDraft> | null>(null);
const queryDate = ref(shanghaiDate());
const writable = computed(() => session.value?.role === 'CAREGIVER');
let realAlive = true, loadSequence = 0;
function formatDateTime(value: string) {
  return isDemo ? demoDateTime(value) : new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
}
function recordView(r: Feedback): FeedbackRecord {
  return { id: r.recordId, kind: r.occurrenceId ? 'reminder' : 'history', title: r.reminder?.title ?? '主动记录',
    detail: r.rawText || '未填写原文', timestamp: r.occurredAt, chip: `版本 ${r.version} · ${r.captureSource ?? r.source}`, tone: 'blue',
    status: r.confirmedFacts.medications.some(m => m.executionType === 'MISSED') ? 'missed' : 'done',
    tags: [{icon:'🧾',text:`已保存 v${r.version}`,tone:'info'},{icon:'🕒',text:`分析 ${r.analysisTask?.status ?? '暂无任务'}`,tone:'neutral'}],
    rawConversation: [{ role: '保存原文', text: r.rawText || '未填写' }],
    structuredOutput: factFields(r.confirmedFacts, r.reminder, history.medications.value),
  };
}
async function reloadReal() {
  if (revisionDraft.value?.busy) return;
  const seq = ++loadSequence;
  if (!queryDate.value) queryDate.value = shanghaiDate();
  loading.value = true; await history.load(queryDate.value, 7);
  if (!realAlive || seq !== loadSequence) return;
  error.value = history.error.value;
  feedbackRecords.value = timelineRecords(history.days.value).map(recordView);
  activeTimelineDateKey.value = queryDate.value; loading.value = false;
}
async function openReal(record: FeedbackRecord) {
  selectedRecord.value = record; revisionDraft.value = null; supplementMessage.value = '';
  const fresh = await history.open(record.id);
  if (fresh && realAlive) selectedRecord.value = recordView(fresh);
}
async function startRevision() {
  if (!selectedRecord.value || !writable.value || revisionDraft.value || history.detailLoading.value) return;
  const fresh = await history.open(selectedRecord.value.id);
  if (fresh && realAlive && selectedRecord.value?.id === fresh.recordId) {
    selectedRecord.value = recordView(fresh);
    revisionDraft.value = useFeedbackDraft({ record: fresh, medications: history.medications.value });
  }
}
async function saveRevision() {
  const draft = revisionDraft.value;
  if (!draft) return;
  const saved = await draft.save();
  if (!saved || !realAlive || revisionDraft.value !== draft) return;
  revisionDraft.value = null;
  selectedRecord.value = recordView(saved); history.detail.value = saved;
  supplementMessage.value = `修订已保存为版本 ${saved.version}；保留旧修订，分析已排队。`;
  void refreshReminderNotifications(); await reloadReal();
}
onBeforeUnmount(() => { realAlive = false; history.dispose(); });

type RecordTone = 'green' | 'blue' | 'gold' | 'coral';
type TimelineFilter = 'all' | 'missed' | 'done';
type FeedbackStatus = 'missed' | 'done';
type TagTone = 'neutral' | 'info' | 'success' | 'warning';
type RecordKind = 'history' | 'reminder';

interface QuickPreset {
  id: string;
  label: string;
  text: string;
}

interface RecordTag {
  icon: string;
  text: string;
  tone: TagTone;
}

interface DialogueLine {
  role: string;
  text: string;
}

interface StructuredField {
  icon: string;
  label: string;
  value: string;
  tone: TagTone;
}

interface FeedbackRecord {
  id: string;
  kind: RecordKind;
  title: string;
  detail: string;
  timestamp: string;
  chip: string;
  tone: RecordTone;
  status: FeedbackStatus;
  tags: RecordTag[];
  rawConversation: DialogueLine[];
  structuredOutput: StructuredField[];
  medicationName?: string;
  sourceReminderId?: string;
}

const pageTitle = '反馈记录中心';
const pageSubtitle = isDemo ? '记录页和“我的”页面共用同一份提醒数据，按提醒时间进入时间流，补录完整后才允许进入事件流。' : '按实际发生日期查看已保存原文与确认事实；修订保留历史，风险分析独立处理。';

const reminderTitleMap: Record<string, string> = {
  'Morning medication reminder': '晨间服药提醒',
  'Midday follow-up reminder': '午间追访提醒',
  'Evening medication reminder': '晚间服药提醒',
};

const quickPresets: QuickPreset[] = [
  { id: 'symptom', label: '症状反馈', text: '患者反馈服药后短暂乏力，已补充进食与饮水，15 分钟后缓解。' },
  { id: 'meal', label: '进食情况', text: '患者进食偏少，已提醒补餐并继续观察后续状态。' },
  { id: 'followup', label: '执行备注', text: '已电话回访确认，本次缺失窗口已补录完成，后续继续追踪。' },
];

const router = useRouter();
const mvpStore = isDemo ? useMvpStore() : null;

const loading = ref(true);
const error = ref('');
const patient = ref<CurrentPatientContext | null>(null);
const reminders = ref<MobileReminder[]>([]);
const medications = ref<MobileMedication[]>([]);
const feedbackRecords = ref<FeedbackRecord[]>([]);
const timelineFilter = ref<TimelineFilter>('all');
const selectedRecord = ref<FeedbackRecord | null>(null);
const supplementText = ref('');
const savingSupplement = ref(false);
const supplementMessage = ref('');
const activeTimelineDateKey = ref('');

function toDateKey(value: string | Date): string {
  if (!isDemo) return dayKey(value);
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shiftDate(base: Date, offsetDays: number): Date {
  const result = new Date(base);
  result.setDate(result.getDate() + offsetDays);
  return result;
}

function atTime(baseDate: Date, hour: number, minute: number): string {
  const result = new Date(baseDate);
  result.setHours(hour, minute, 0, 0);
  return result.toISOString();
}

function formatReminderTitle(title: string): string {
  return reminderTitleMap[title] ?? title;
}

function formatDateLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split('-');
  if (!year || !month || !day) {
    return '暂无日期';
  }
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function sortRecords(records: FeedbackRecord[]): FeedbackRecord[] {
  return [...records].sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());
}

function getRecordTone(status: FeedbackStatus): string {
  return status === 'done' ? 'success' : 'warning';
}

function buildStatusTags(status: FeedbackStatus, medicationName: string | undefined, timeLabel: string): RecordTag[] {
  return [
    {
      icon: status === 'done' ? '✅' : '⚠️',
      text: status === 'done' ? '已完成记录' : '待补录反馈',
      tone: status === 'done' ? 'success' : 'warning',
    },
    {
      icon: '🕒',
      text: timeLabel,
      tone: 'info',
    },
    {
      icon: '💊',
      text: medicationName ?? '综合反馈',
      tone: 'neutral',
    },
  ];
}

function buildStructuredOutput(
  summary: string,
  status: FeedbackStatus,
  medicationName: string | undefined,
  nextAction: string,
): StructuredField[] {
  return [
    {
      icon: status === 'done' ? '✅' : '⚠️',
      label: '处理状态',
      value: status === 'done' ? '已完成闭环' : '存在待补录缺口',
      tone: status === 'done' ? 'success' : 'warning',
    },
    {
      icon: '🧾',
      label: '结构化结论',
      value: summary,
      tone: 'info',
    },
    {
      icon: '💊',
      label: '关联药物',
      value: medicationName ?? '综合随访',
      tone: 'neutral',
    },
    {
      icon: '📌',
      label: '建议动作',
      value: nextAction,
      tone: 'info',
    },
  ];
}

function getReminderStatus(reminder: MobileReminder): FeedbackStatus {
  return reminder.status === 'SUCCESS' || reminder.status === 'DONE' ? 'done' : 'missed';
}

function buildHistoryRecords(reminderList: MobileReminder[], medicationList: MobileMedication[]): FeedbackRecord[] {
  const yesterday = shiftDate(new Date(), -1);
  const medicationPool =
    medicationList.length > 0 ? medicationList.map((item) => item.genericName) : ['缬沙坦', '阿托伐他汀', '二甲双胍'];
  const reminderPool = reminderList.length
    ? reminderList.map((item, index) => ({
        title: formatReminderTitle(item.title),
        medicationName: item.medicationNames[0] ?? medicationPool[index] ?? medicationPool[0],
      }))
    : [
        { title: '晨间服药提醒', medicationName: medicationPool[0] },
        { title: '午间追访提醒', medicationName: medicationPool[1] ?? medicationPool[0] },
        { title: '晚间服药提醒', medicationName: medicationPool[2] ?? medicationPool[0] },
      ];

  return [
    {
      id: 'history-yesterday-morning',
      kind: 'history',
      title: reminderPool[0]?.title ?? '晨间服药提醒',
      detail: '昨日晨间反馈显示患者早餐不足，补餐后状态缓解，整体闭环完整。',
      timestamp: atTime(yesterday, 8, 15),
      chip: '晨间回访',
      tone: 'green',
      status: 'done',
      medicationName: reminderPool[0]?.medicationName ?? medicationPool[0],
      tags: buildStatusTags('done', reminderPool[0]?.medicationName ?? medicationPool[0], '昨日 08:15'),
      rawConversation: [
        { role: '系统提醒', text: '请确认晨间服药后是否出现不适，以及早餐摄入情况。' },
        { role: '患者', text: '药已按时服用，早餐吃得比较少，刚才有一点头晕。' },
        { role: '护理员', text: '已提醒先补充早餐和温水，20 分钟后再次确认状态。' },
      ],
      structuredOutput: buildStructuredOutput(
        '晨间服药后出现短暂不适，已通过补餐和观察完成闭环。',
        'done',
        reminderPool[0]?.medicationName ?? medicationPool[0],
        '维持早餐后服药节奏，继续观察今日同时间段状态。',
      ),
    },
    {
      id: 'history-yesterday-midday',
      kind: 'history',
      title: reminderPool[1]?.title ?? '午间追访提醒',
      detail: '昨日午间窗口一度反馈缺失，后续已通过电话补录完成。',
      timestamp: atTime(yesterday, 14, 10),
      chip: '午间补录',
      tone: 'coral',
      status: 'missed',
      medicationName: reminderPool[1]?.medicationName ?? medicationPool[1] ?? medicationPool[0],
      tags: buildStatusTags('missed', reminderPool[1]?.medicationName ?? medicationPool[1] ?? medicationPool[0], '昨日 14:10'),
      rawConversation: [
        { role: '系统提醒', text: '请补充午间状态、进食与服药执行情况。' },
        { role: '系统', text: '当前窗口暂未收到反馈，已标记为待补录。' },
        { role: 'AI', text: '建议优先补齐该时段，避免时间流断档。' },
      ],
      structuredOutput: buildStructuredOutput(
        '午间反馈存在缺口，后续需要人工补齐以恢复完整时间流。',
        'missed',
        reminderPool[1]?.medicationName ?? medicationPool[1] ?? medicationPool[0],
        '优先补录午间状态与进食情况，再继续晚间追踪。',
      ),
    },
    {
      id: 'history-yesterday-evening',
      kind: 'history',
      title: reminderPool[2]?.title ?? '晚间服药提醒',
      detail: '昨日晚间记录完整，患者按时服药且无新增不适。',
      timestamp: atTime(yesterday, 20, 5),
      chip: '晚间回访',
      tone: 'blue',
      status: 'done',
      medicationName: reminderPool[2]?.medicationName ?? medicationPool[2] ?? medicationPool[0],
      tags: buildStatusTags('done', reminderPool[2]?.medicationName ?? medicationPool[2] ?? medicationPool[0], '昨日 20:05'),
      rawConversation: [
        { role: '系统提醒', text: '请确认晚间服药、晚餐与睡前状态。' },
        { role: '患者', text: '晚饭和药都按时完成，今晚没有明显不适。' },
        { role: '护理员', text: '已记录晚间状态稳定，闭环完成。' },
      ],
      structuredOutput: buildStructuredOutput(
        '晚间执行正常，无新增异常，时间流记录完整。',
        'done',
        reminderPool[2]?.medicationName ?? medicationPool[2] ?? medicationPool[0],
        '继续保持当前随访节奏。',
      ),
    },
  ];
}

function buildReminderRecord(reminder: MobileReminder, existing?: FeedbackRecord): FeedbackRecord {
  const status = getReminderStatus(reminder);
  const title = formatReminderTitle(reminder.title);
  const medicationName = reminder.medicationNames[0] ?? existing?.medicationName;
  const timeLabel = formatDateTime(reminder.plannedAt);
  const defaultDetail = reminder.followUpPrompt?.trim() || `请在 ${timeLabel} 前后补充 ${title} 的执行情况。`;

  return {
    id: `reminder-${reminder.reminderId}`,
    kind: 'reminder',
    sourceReminderId: reminder.reminderId,
    title,
    detail: existing?.detail ?? defaultDetail,
    timestamp: reminder.plannedAt,
    chip: medicationName ?? title,
    tone: status === 'done' ? 'green' : 'coral',
    status,
    tags: buildStatusTags(status, medicationName, timeLabel),
    rawConversation:
      existing?.rawConversation ??
      [
        { role: '我的页面', text: `新增提醒：${title}` },
        { role: '系统', text: `提醒时间：${timeLabel}` },
        { role: '系统', text: reminder.followUpPrompt?.trim() || '等待护理员补充本次提醒的执行反馈。' },
      ],
    structuredOutput:
      existing?.structuredOutput ??
      buildStructuredOutput(
        status === 'done' ? `${title} 已完成记录，可进入后续事件判断。` : `${title} 尚未完成记录。`,
        status,
        medicationName,
        status === 'done' ? '保持当前记录节奏。' : '补齐本条提醒反馈后，才能生成事件流。',
      ),
    medicationName,
  };
}

function syncTimelineRecords(reminderList: MobileReminder[], medicationList: MobileMedication[]) {
  const existingMap = new Map(feedbackRecords.value.map((item) => [item.id, item]));
  const historyRecords = buildHistoryRecords(reminderList, medicationList).map(
    (record) => existingMap.get(record.id) ?? record,
  );
  const reminderRecords = reminderList.map((item) =>
    buildReminderRecord(item, existingMap.get(`reminder-${item.reminderId}`)),
  );
  feedbackRecords.value = sortRecords([...historyRecords, ...reminderRecords]);

  if (selectedRecord.value) {
    selectedRecord.value = feedbackRecords.value.find((item) => item.id === selectedRecord.value?.id) ?? null;
  }
}

async function loadPage() {
  if (!isDemo) { await reloadReal(); return; }
  try {
    const [patientRes, reminderRes, medicationRes] = await Promise.allSettled([
      mobileApi.getCurrentPatient(),
      mobileApi.getTodayReminders(),
      mobileApi.getMedications(),
    ]);

    const loadedMedications = medicationRes.status === 'fulfilled' ? medicationRes.value.medications : [];
    const loadedReminders = reminderRes.status === 'fulfilled' ? reminderRes.value.reminders : [];

    patient.value =
      patientRes.status === 'fulfilled'
        ? patientRes.value
        : {
            userId: 1,
            role: 'CAREGIVER',
            patientId: 1,
            patientName: '演示患者',
          };

    if (!mvpStore!.state.medications.length && loadedMedications.length) {
      mvpStore!.syncMedicationData(loadedMedications, loadedReminders);
    }

    medications.value = mvpStore!.state.medications.length ? [...mvpStore!.state.medications] : loadedMedications;
    reminders.value = mvpStore!.state.reminders.length ? [...mvpStore!.state.reminders] : loadedReminders;
    syncTimelineRecords(reminders.value, medications.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : '记录页面加载失败';
  } finally {
    loading.value = false;
  }
}

function setTimelineFilter(next: TimelineFilter) {
  timelineFilter.value = next;
}

function openRecord(record: FeedbackRecord) {
  if (!isDemo) { void openReal(record); return; }
  selectedRecord.value = record;
  supplementText.value = '';
  supplementMessage.value = '';
}

function closeRecord() {
  if (revisionDraft.value?.busy) return;
  history.close(); revisionDraft.value = null;
  selectedRecord.value = null;
  supplementText.value = '';
  supplementMessage.value = '';
}

function applyPreset(preset: QuickPreset) {
  supplementText.value = preset.text;
}

function buildSupplementTags(record: FeedbackRecord): RecordTag[] {
  return [
    { icon: '✅', text: '已补录完成', tone: 'success' },
    { icon: '🕒', text: formatDateTime(new Date().toISOString()), tone: 'info' },
    { icon: '💊', text: record.medicationName ?? record.chip, tone: 'neutral' },
  ];
}

function upsertStructuredOutput(
  fields: StructuredField[],
  nextFields: StructuredField[],
): StructuredField[] {
  const fieldMap = new Map(fields.map((field) => [field.label, field]));

  nextFields.forEach((field) => {
    fieldMap.set(field.label, field);
  });

  return Array.from(fieldMap.values());
}

async function saveSupplement() {
  if (!isDemo) return;
  if (!selectedRecord.value || !supplementText.value.trim()) {
    supplementMessage.value = '请先填写补录内容。';
    return;
  }

  savingSupplement.value = true;
  supplementMessage.value = '';

  try {
    const currentRecord = selectedRecord.value;
    const supplement = supplementText.value.trim();

    feedbackRecords.value = sortRecords(
      feedbackRecords.value.map((item) =>
        item.id === currentRecord.id
          ? {
              ...item,
              detail: `${item.detail} 已补录：${supplement}`,
              tone: 'green',
              status: 'done',
              tags: buildSupplementTags(item),
              rawConversation: [...item.rawConversation, { role: '护理员补录', text: supplement }],
              structuredOutput: upsertStructuredOutput(item.structuredOutput, [
                { icon: '✅', label: '处理状态', value: '补录后已闭环', tone: 'success' },
                { icon: '📝', label: '补录备注', value: supplement, tone: 'info' },
                { icon: '📌', label: '后续动作', value: '已直接回写原事件，不再生成新的补录节点。', tone: 'info' },
              ]),
            }
          : item,
      ),
    );

    if (currentRecord.sourceReminderId) {
      mvpStore!.updateReminderStatus(currentRecord.sourceReminderId, 'DONE');
    }

    supplementMessage.value = '补录内容已保存。';
    selectedRecord.value = feedbackRecords.value.find((item) => item.id === currentRecord.id) ?? null;
    supplementText.value = '';
  } finally {
    savingSupplement.value = false;
  }
}

function goToOlderDate() {
  if (!isDemo) { queryDate.value = dayWindow(activeTimelineDateKey.value, 2)[0]; void reloadReal(); return; }
  if (!canViewOlderDate.value) {
    return;
  }

  activeTimelineDateKey.value = availableDateKeys.value[activeDateIndex.value + 1];
}

function goToNewerDate() {
  if (!isDemo) { if (activeTimelineDateKey.value >= shanghaiDate()) return; queryDate.value = new Date(Date.parse(activeTimelineDateKey.value + 'T00:00:00Z') + 86400000).toISOString().slice(0,10); void reloadReal(); return; }
  if (!canViewNewerDate.value) {
    return;
  }

  activeTimelineDateKey.value = availableDateKeys.value[activeDateIndex.value - 1];
}

function goToJointEvents() {
  if (!isDemo) { void router.push('/risk'); return; }
  if (!canEnterJointEvents.value) {
    return;
  }

  mvpStore!.setJointEvents(todayJointEvents.value);
  if (!mvpStore!.state.recordSeeded) {
    mvpStore!.seedMvpRecord();
  }
  if (!mvpStore!.state.inquiryCompleted) {
    mvpStore!.completeInquiry();
  }
  mvpStore!.generateRisk();
  if (typeof window !== 'undefined') {
    window.sessionStorage.setItem('risk-view-sync-from-record', '1');
  }

  void router.push('/risk');
}

onMounted(loadPage);

if (isDemo) watch(
  () => mvpStore!.state.reminders,
  (next) => {
    reminders.value = next.map((item) => ({ ...item }));
    syncTimelineRecords(reminders.value, medications.value);
  },
  { deep: true },
);

if (isDemo) watch(
  () => mvpStore!.state.medications,
  (next) => {
    medications.value = next.map((item) => ({ ...item }));
    syncTimelineRecords(reminders.value, medications.value);
  },
  { deep: true },
);

const patientName = computed(() => isDemo ? patient.value?.patientName ?? '演示患者' : selectedPatient.value?.name ?? '当前患者');
const todayKey = computed(() => toDateKey(new Date()));
const yesterdayKey = computed(() => toDateKey(shiftDate(new Date(), -1)));

const dateBuckets = computed(() => {
  const buckets = new Map<string, FeedbackRecord[]>();

  for (const record of feedbackRecords.value) {
    const key = toDateKey(record.timestamp);
    const items = buckets.get(key) ?? [];
    items.push(record);
    buckets.set(key, items);
  }

  return buckets;
});

const availableDateKeys = computed(() =>
  (isDemo ? Array.from(dateBuckets.value.keys()) : history.days.value.map(d => d.date)).sort((left, right) => new Date(right).getTime() - new Date(left).getTime()),
);

watch(
  availableDateKeys,
  (keys) => {
    if (!keys.length) {
      activeTimelineDateKey.value = todayKey.value;
      return;
    }

    if (!activeTimelineDateKey.value || !keys.includes(activeTimelineDateKey.value)) {
      activeTimelineDateKey.value = keys.includes(todayKey.value) ? todayKey.value : keys[0];
    }
  },
  { immediate: true },
);

const activeDateIndex = computed(() => availableDateKeys.value.indexOf(activeTimelineDateKey.value));
const canViewOlderDate = computed(() => !isDemo || (activeDateIndex.value >= 0 && activeDateIndex.value < availableDateKeys.value.length - 1));
const canViewNewerDate = computed(() => isDemo ? activeDateIndex.value > 0 : activeTimelineDateKey.value < shanghaiDate());
const timelineDateLabel = computed(() => formatDateLabel(activeTimelineDateKey.value));

const yesterdaySummaryDateKey = computed(() => {
  if (!isDemo) return activeTimelineDateKey.value;
  if (availableDateKeys.value.includes(yesterdayKey.value)) {
    return yesterdayKey.value;
  }
  return availableDateKeys.value[1] ?? availableDateKeys.value[0] ?? yesterdayKey.value;
});

const yesterdaySummaryLabel = computed(() => formatDateLabel(yesterdaySummaryDateKey.value));
const activeTimelineRecords = computed(() => dateBuckets.value.get(activeTimelineDateKey.value) ?? []);

const filteredTimelineRecords = computed(() => {
  if (timelineFilter.value === 'all') {
    return activeTimelineRecords.value;
  }
  return activeTimelineRecords.value.filter((item) => item.status === timelineFilter.value);
});

const yesterdayRecords = computed(() => dateBuckets.value.get(yesterdaySummaryDateKey.value) ?? []);
const yesterdayDoneCount = computed(() => yesterdayRecords.value.filter((item) => item.status === 'done').length);
const yesterdayMissedCount = computed(() => yesterdayRecords.value.filter((item) => item.status === 'missed').length);

const todayRecords = computed(() =>
  feedbackRecords.value.filter((item) => toDateKey(item.timestamp) === todayKey.value),
);
const todayReminderRecords = computed(() =>
  feedbackRecords.value.filter((item) => item.kind === 'reminder' && toDateKey(item.timestamp) === todayKey.value),
);
function buildEventSearchText(record: FeedbackRecord): string {
  return [
    record.title,
    record.detail,
    record.chip,
    record.medicationName ?? '',
    ...record.tags.map((item) => item.text),
    ...record.rawConversation.map((item) => `${item.role} ${item.text}`),
    ...record.structuredOutput.map((item) => `${item.label} ${item.value}`),
  ]
    .join(' ')
    .toLowerCase();
}

function inferRiskDirections(record: FeedbackRecord): RiskDirection[] {
  const directions = new Set<RiskDirection>();
  const text = buildEventSearchText(record);

  if (
    ['格列本脲', '降糖', '低血糖', '头晕', '乏力', '出汗', '手抖', '血糖偏低'].some((keyword) => text.includes(keyword))
  ) {
    directions.add('DEINTENSIFICATION');
  }

  if (['缬沙坦', '联合', '联用', '同时', '多药'].some((keyword) => text.includes(keyword))) {
    directions.add('INTERACTION');
  }

  if (record.status === 'missed' || ['补录', '缺失', '延后', '待补录', '补服', '错位', '时间'].some((keyword) => text.includes(keyword))) {
    directions.add('TEMPORAL_BEHAVIOR');
  }

  if (!directions.size) {
    directions.add('JOINT_EVENT');
  }

  return Array.from(directions);
}

function buildEventSeverity(record: FeedbackRecord): number {
  const text = buildEventSearchText(record);

  if (['格列本脲', '低血糖', '头晕', '乏力', '出汗', '血糖偏低'].some((keyword) => text.includes(keyword))) {
    return 90;
  }
  if (record.status === 'missed') {
    return 72;
  }
  return 64;
}

function buildEventEvidence(record: FeedbackRecord): Record<string, unknown> {
  return {
    sourceKind: record.kind,
    status: record.status,
    medication: record.medicationName ?? record.chip,
    summary: record.detail,
    tags: record.tags.map((item) => item.text),
    dialogue: record.rawConversation.map((item) => `${item.role}: ${item.text}`),
    structured: record.structuredOutput.map((item) => ({
      label: item.label,
      value: item.value,
    })),
  };
}

function buildEventWindowEnd(timestamp: string): string {
  const base = new Date(timestamp);
  if (Number.isNaN(base.getTime())) {
    return timestamp;
  }
  return new Date(base.getTime() + 5 * 60 * 1000).toISOString();
}

const todayJointEvents = computed<MobileJointEvent[]>(() => !isDemo ? [] : [...todayRecords.value]
    .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime())
    .map((record, index) => ({
      eventType: `REC${String(index + 1).padStart(3, '0')}`,
      eventLabel: record.title,
      eventDate: todayKey.value,
      timeWindowStart: record.timestamp,
      timeWindowEnd: buildEventWindowEnd(record.timestamp),
      severity: buildEventSeverity(record),
      evidence: buildEventEvidence(record),
      riskDirections: inferRiskDirections(record),
    })),
);
const existingJointEventCount = computed(() => todayJointEvents.value.length);
const completedTodayReminderCount = computed(() => todayReminderRecords.value.filter((item) => item.status === 'done').length);
const pendingTodayReminderCount = computed(() => todayReminderRecords.value.filter((item) => item.status !== 'done').length);
const canEnterJointEvents = computed(
  () => !isDemo || (todayReminderRecords.value.length > 0 && pendingTodayReminderCount.value === 0),
);

const jointEventStatusLabel = computed(() => {
  if (!isDemo) return '查看服务端分析';
  if (!todayReminderRecords.value.length) {
    return '暂无今日提醒';
  }
  if (canEnterJointEvents.value) {
    return '可进入事件流';
  }
  return `待补录 ${pendingTodayReminderCount.value} 条`;
});

const jointEventHint = computed(() => {
  if (!isDemo) return '保存后自动排队分析，可随时查看风险页中的结果及资料缺口。';
  if (!todayReminderRecords.value.length) {
    return '先在“我的”页面添加提醒，记录页会按提醒时间同步展示。';
  }
  if (!canEnterJointEvents.value) {
    return `今日共 ${todayReminderRecords.value.length} 条提醒，仍有 ${pendingTodayReminderCount.value} 条未补录，当前不能生成事件流。`;
  }
  return `今日 ${completedTodayReminderCount.value} 条提醒已全部完成，进入后会渲染你提供的 ${existingJointEventCount.value || '对应'} 条事件流，并统一输出“过强化治疗”。`;
});

const yesterdayAiSummary = computed(() => {
  if (!isDemo) return { title: `已保存 ${yesterdayRecords.value.length} 条记录`,
    subtitle: `${yesterdaySummaryLabel.value} 的真实反馈`, sentence: '仅统计已保存记录，不将已保存等同于已服药或风险正常。',
    metrics: [`含明确漏服 ${yesterdayMissedCount.value} 条`, '查看详情可追溯修订', '分析结果请查看风险页'] };

  const titles = yesterdayRecords.value.slice(0, 2).map((item) => item.title);

  if (!yesterdayRecords.value.length) {
    return {
      title: '昨日暂无完整时间流',
      subtitle: '建议先补齐关键反馈，再继续推进今天的记录闭环。',
      sentence: '当前缺少完整的昨日样本，建议优先回补关键时段记录，避免后续事件判断失真。',
      metrics: ['待补齐历史样本', '继续补录关键症状', 'AI 分析等待更多上下文'],
    };
  }

  return {
    title: `${yesterdayDoneCount.value} 条完成 · ${yesterdayMissedCount.value} 条缺口`,
    subtitle: `${yesterdaySummaryLabel.value} 的反馈时间流总结`,
    sentence:
      yesterdayMissedCount.value > 0
        ? `昨日共识别 ${yesterdayRecords.value.length} 条反馈，其中 ${yesterdayMissedCount.value} 条存在遗漏，建议今天优先补齐对应窗口。`
        : `昨日共识别 ${yesterdayRecords.value.length} 条反馈，整体节奏稳定，可继续保持当前随访频率。`,
    metrics: [
      `已完成 ${yesterdayDoneCount.value} 条`,
      `缺失 ${yesterdayMissedCount.value} 条`,
      titles.length ? `重点节点 ${titles.join(' / ')}` : '暂无重点节点',
    ],
  };
});
</script>

<template>
  <div class="mobile-page record-page">
    <section v-if="loading" class="glass-section loading-panel">
      <ConnectionStatus label="正在读取反馈记录" :completed="history.completedDays.value" :total="history.totalDays.value" />
    </section>

    <section v-else-if="error" class="glass-section loading-panel">
      <p>{{ error }}</p><button v-if="!isDemo" class="tag-pill" @click="reloadReal">重试读取</button>
    </section>

    <template v-else>
      <section class="hero-panel">
        <div class="hero-top">
          <div class="hero-copy">
            <div class="hero-title-row">
              <h1 class="patient-name">{{ pageTitle }}</h1>
              <p class="patient-badge">{{ patientName }}</p>
            </div>
            <p class="patient-subtitle">{{ pageSubtitle }}</p>
          </div>
        </div>
      </section>

      <section class="summary-card">
        <img class="summary-card__bg" :src="homeCardBg" alt="" />
        <div class="summary-card__content">
          <div class="summary-card__top">
            <div class="summary-card__heading">
              <h2>{{ yesterdayMissedCount > 0 ? '⚠️ ' : '✅ ' }}{{ yesterdayAiSummary.title }}</h2>
              <p>{{ yesterdayAiSummary.subtitle }}</p>
            </div>
            <span class="summary-card__date">{{ yesterdaySummaryLabel }}</span>
          </div>

          <div class="summary-card__body">
            <p class="summary-card__sentence">{{ yesterdayAiSummary.sentence }}</p>
            <div class="summary-card__metrics">
              <span v-for="metric in yesterdayAiSummary.metrics" :key="metric" class="summary-card__metric">
                {{ metric }}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section class="glass-section timeline-panel">
        <div class="section-header">
          <div class="section-copy">
            <p class="section-eyebrow">{{ isDemo ? "提醒时间流" : "反馈时间流" }}</p>
            <h2 class="section-title">🕒 记录列表</h2>
            <p class="section-note">{{ isDemo ? timelineDateLabel + " 的记录来自提醒列表" : "按北京时间的事件日期分组；可翻日查看已保存记录。" }}</p>
            <div v-if="!isDemo" class="record-date-toolbar"><label class="record-date-field"><span>查看日期</span><input v-model="queryDate" type="date" :max="shanghaiDate()" @change="reloadReal" /></label>
            <button class="tag-pill" :disabled="loading" @click="reloadReal">刷新记录</button></div>
          </div>

          <div class="section-actions section-actions--timeline" :class="{ 'section-actions--real': !isDemo }">
            <div class="tab-group">
              <button :class="['tag-pill', { active: timelineFilter === 'all' }]" @click="setTimelineFilter('all')">全部</button>
              <button :class="['tag-pill', { active: timelineFilter === 'missed' }]" @click="setTimelineFilter('missed')">{{ isDemo ? "未完成" : "含漏服" }}</button>
              <button :class="['tag-pill', { active: timelineFilter === 'done' }]" @click="setTimelineFilter('done')">{{ isDemo ? "已完成" : "其他记录" }}</button>
            </div>

            <div class="date-switcher">
              <button class="date-nav" :disabled="!canViewOlderDate" @click="goToOlderDate">‹</button>
              <div class="date-switcher__label">
                <span>当前日期</span>
                <strong>{{ timelineDateLabel }}</strong>
              </div>
              <button class="date-nav" :disabled="!canViewNewerDate" @click="goToNewerDate">›</button>
            </div>
          </div>
        </div>

        <div class="stream-list">
          <article
            v-for="record in filteredTimelineRecords"
            :key="record.id"
            class="stream-item"
            :class="`stream-item--${record.tone}`"
            @click="openRecord(record)"
          >
            <div class="stream-head">
              <div class="stream-copy">
                <strong>{{ record.title }}</strong>
                <p>{{ record.detail }}</p>
              </div>
              <span class="stream-time">{{ formatDateTime(record.timestamp) }}</span>
            </div>

            <div class="stream-tag-row">
              <span
                v-for="tag in record.tags"
                :key="`${record.id}-${tag.icon}-${tag.text}`"
                :class="`stream-tag stream-tag--${tag.tone}`"
              >
                <span>{{ tag.icon }}</span>
                <span>{{ tag.text }}</span>
              </span>
            </div>
          </article>

          <div v-if="!filteredTimelineRecords.length" class="empty-state">当前日期下暂无同步记录。</div>
        </div>
      </section>

      <section class="glass-section joint-entry-panel">
        <div class="section-header">
          <div class="section-copy">
            <p class="section-eyebrow">事件流入口</p>
            <h2 class="section-title">{{ isDemo ? '记录完整后再进入事件流' : '分析与证据入口' }}</h2>
            <p class="section-note">{{ jointEventHint }}</p>
          </div>

          <div class="joint-entry-panel__actions">
            <span class="status-chip" :class="canEnterJointEvents ? 'status-chip--success' : 'status-chip--warning'">
              {{ jointEventStatusLabel }}
            </span>
            <button class="action-button action-button--secondary" :disabled="!canEnterJointEvents" @click="goToJointEvents">
              {{ canEnterJointEvents ? '✅ 进入风险页' : '⚠️ 进入风险页' }}
            </button>
          </div>
        </div>
      </section>
    </template>

    <div v-if="selectedRecord" class="modal-mask" @click="closeRecord">
      <div class="modal-card" @click.stop>
        <div class="modal-head">
          <div>
            <h4>{{ selectedRecord.title }}</h4>
            <p>{{ formatDateTime(selectedRecord.timestamp) }}</p>
          </div>
          <button class="close-btn" :disabled="revisionDraft?.busy" @click="closeRecord">关闭</button>
        </div>

        <div class="record-detail-card">
          <div class="record-detail-row">
            <span>状态</span>
            <strong :class="`status-chip status-chip--${getRecordTone(selectedRecord.status)}`">
              {{ isDemo ? (selectedRecord.status === 'done' ? '已完成反馈' : '待补录反馈') : '已保存（执行情况见确认事实）' }}
            </strong>
          </div>
          <div class="record-detail-row">
            <span>主标签</span>
            <strong>{{ selectedRecord.chip }}</strong>
          </div>
          <div class="record-detail-row record-detail-row--stack">
            <span>摘要</span>
            <p>{{ selectedRecord.detail }}</p>
          </div>
        </div>

        <section class="detail-section">
          <div class="detail-section__head">
            <h5>{{ isDemo ? "原始对话" : "保存原文" }}</h5>
            <span>{{ isDemo ? "记录采集过程" : "保留原始描述" }}</span>
          </div>
          <div class="dialogue-list">
            <article v-for="line in selectedRecord.rawConversation" :key="`${selectedRecord.id}-${line.role}-${line.text}`" class="dialogue-item">
              <span class="dialogue-role">{{ line.role }}</span>
              <p>{{ line.text }}</p>
            </article>
          </div>
        </section>

        <section class="detail-section">
          <div class="detail-section__head">
            <h5>{{ isDemo ? "AI 标准输出" : "人工确认事实" }}</h5>
            <span>结构化结果</span>
          </div>
          <div class="structured-list">
            <article
              v-for="field in selectedRecord.structuredOutput"
              :key="`${selectedRecord.id}-${field.label}`"
              :class="`structured-item structured-item--${field.tone}`"
            >
              <span>{{ field.icon }} {{ field.label }}</span>
              <strong>{{ field.value }}</strong>
            </article>
          </div>
        </section>

        <template v-if="!isDemo">
          <p v-if="history.detailLoading.value" role="status">正在读取最新修订…</p>
          <p v-if="history.detailError.value" role="alert">{{ history.detailError.value }}<button class="tag-pill" @click="openReal(selectedRecord)">重试详情</button></p>
          <section v-if="history.detail.value" class="detail-section">
            <div class="detail-section__head"><h5>来源与修订历史</h5></div>
            <p class="section-note">记录 {{ history.detail.value.recordId }} · 修订 {{ history.detail.value.revisionId }} · 来源 {{ history.detail.value.source }}</p>
            <p class="section-note">关联实例 {{ history.detail.value.occurrenceId ?? '无（主动记录）' }} · 随访 {{ history.detail.value.followUpId ?? '无' }}</p>
            <details v-for="revision in history.detail.value.revisions" :key="revision.revisionId" class="dialogue-item">
              <summary>版本 {{ revision.version }} · {{ displayTime(revision.recordedAt) }}</summary>
              <p>发生时间：{{ displayTime(revision.occurredAt) }} · 来源：{{ revision.source }}</p><p>{{ revision.revisionId }} · 原因：{{ revision.changeReason || '首次保存' }}</p><p>{{ revision.rawText || '未填写原文' }}</p>
              <p v-for="field in factFields(revision.confirmedFacts, history.detail.value.reminder, history.medications.value)" :key="field.label">{{ field.label }}：{{ field.value }}</p>
            </details>
          </section>
          <button v-if="writable && history.detail.value && !revisionDraft" class="action-button action-button--secondary" @click="startRevision">补录 / 修订反馈</button>
          <div v-if="revisionDraft" class="real-revision-form"><form @submit.prevent="saveRevision"><fieldset :disabled="revisionDraft.busy"><legend>修订反馈</legend>

  <p>只填写实际确认的信息；未填写保持未知。所有时间为北京时间。</p>
  <label>事件时间<input v-model="revisionDraft.time" type="datetime-local" step="1" required /></label><label>原始描述<textarea v-model="revisionDraft.rawText" maxlength="10000" rows="3" /></label>
  <h3>分药品确认</h3><div v-for="(m,i) in revisionDraft.facts.medications" :key="i" class="fact-row"><label>药品<select v-model="m.medicationId" required><option v-for="c in revisionDraft.choices" :key="c.id" :value="c.id">{{c.genericName}}</option></select></label><label>执行情况<select v-model="m.executionType"><option value="UNKNOWN">未知</option><option value="TAKEN">已服</option><option value="MISSED">漏服</option><option value="MAKEUP">补服</option></select></label><label>执行时间<input v-model="m.occurredAt" type="datetime-local" step="1" required /></label><button type="button" @click="revisionDraft.facts.medications.splice(i,1)">移除药品事实</button></div>
  <button v-if="revisionDraft.choices.length" type="button" @click="revisionDraft.facts.medications.push({medicationId:revisionDraft.choices[0].id,executionType:'UNKNOWN',occurredAt:revisionDraft.time})">添加药品执行</button>
  <label>症状确认<select v-model="revisionDraft.symptomState"><option value="unknown">尚未记录</option><option value="none">明确无症状</option><option value="present">有症状</option></select></label>
  <div v-if="revisionDraft.symptomState==='present'"><div v-for="(s,i) in revisionDraft.facts.symptoms" :key="i" class="fact-row"><label>症状<input v-model="s.code" required maxlength="64" /></label><label>程度（0–5）<input v-model.number="s.severity" type="number" min="0" max="5" required /></label><label>症状时间<input v-model="s.occurredAt" type="datetime-local" step="1" required /></label><button type="button" @click="revisionDraft.facts.symptoms.splice(i,1)">移除症状</button></div><button type="button" @click="revisionDraft.add('symptoms')">添加症状</button></div>
  <h3>实际测量与进食</h3>
  <div v-for="(g,i) in revisionDraft.facts.glucose" :key="i" class="fact-row"><label>血糖（mmol/L）<input v-model.number="g.value" type="number" step="0.1" min="0.1" max="99" required /></label><label>血糖测量时间<input v-model="g.occurredAt" type="datetime-local" step="1" required /></label><button type="button" @click="revisionDraft.facts.glucose.splice(i,1)">移除血糖</button></div>
  <div v-for="(b,i) in revisionDraft.facts.bloodPressure" :key="i" class="fact-row"><label>收缩压（mmHg）<input v-model.number="b.systolic" type="number" min="30" max="300" required /></label><label>舒张压（mmHg）<input v-model.number="b.diastolic" type="number" min="20" max="200" required /></label><label>血压测量时间<input v-model="b.occurredAt" type="datetime-local" step="1" required /></label><button type="button" @click="revisionDraft.facts.bloodPressure.splice(i,1)">移除血压</button></div>
  <div v-for="(m,i) in revisionDraft.facts.meals" :key="i" class="fact-row"><label>餐次<select v-model="m.mealType"><option value="UNKNOWN">未知</option><option value="BREAKFAST">早餐</option><option value="LUNCH">午餐</option><option value="DINNER">晚餐</option><option value="SNACK">加餐</option></select></label><label>进食量<select v-model="m.intakeLevel"><option value="UNKNOWN">未知</option><option value="NORMAL">正常</option><option value="INSUFFICIENT">不足</option><option value="SKIPPED">未进食</option></select></label><label>进食时间<input v-model="m.occurredAt" type="datetime-local" step="1" required /></label><button type="button" @click="revisionDraft.facts.meals.splice(i,1)">移除进食</button></div>
  <div class="toolbar"><button type="button" @click="revisionDraft.add('glucose')">添加血糖</button><button type="button" @click="revisionDraft.add('bloodPressure')">添加血压</button><button type="button" @click="revisionDraft.add('meals')">添加进食</button></div>
  <label class="feedback-confirmation"><input v-model="revisionDraft.reviewed" type="checkbox" />我已核对原文与以上字段；如有差异，以确认字段为准，原文保留。</label>

  <label>修改原因<input v-model="revisionDraft.reason" required maxlength="500" /></label><p role="alert">{{revisionDraft.error}}</p><button>{{revisionDraft.busy?'保存中…':'确认保存反馈'}}</button> <button type="button" @click="closeRecord">关闭</button>
 </fieldset></form></div>
          <p v-if="supplementMessage" class="inline-message inline-message--success">{{ supplementMessage }}</p>
        </template>
        <template v-else>
        <div class="preset-row">
          <button v-for="preset in quickPresets" :key="preset.id" class="tag-pill" @click="applyPreset(preset)">
            {{ preset.label }}
          </button>
        </div>

        <div class="field-block">
          <label class="field-label" for="record-supplement">补录反馈</label>
          <textarea
            id="record-supplement"
            v-model="supplementText"
            class="input-surface input-surface--textarea"
            placeholder="补充本次反馈详情、患者原话或处理结果"
          />
        </div>

        <p v-if="supplementMessage" class="inline-message inline-message--success">{{ supplementMessage }}</p>

        <div class="action-row">
          <button class="action-button action-button--secondary" :disabled="savingSupplement || !supplementText.trim()" @click="saveSupplement">
            {{ savingSupplement ? '保存中...' : selectedRecord.status === 'missed' ? '补录反馈' : '追加备注' }}
          </button>
          <button class="action-button action-button--ghost" @click="closeRecord">关闭</button>
        </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.section-actions--timeline.section-actions--real { flex-wrap: wrap; justify-content: flex-start; max-width: 100%; }
.section-actions--real .tab-group { flex: 0 0 auto; }
.section-actions--real .tag-pill { white-space: nowrap; }
.real-revision-form fieldset { border: 0; padding: 0; min-width: 0; }
.real-revision-form label { display: grid; gap: 6px; margin: 12px 0; }
.real-revision-form input, .real-revision-form select, .real-revision-form textarea { width: 100%; max-width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid #afc8c0; border-radius: 12px; font: inherit; }
.real-revision-form input[type=checkbox] { width: auto; justify-self: start; }
.real-revision-form button { padding: 10px 14px; border: 1px solid #afc8c0; border-radius: 12px; background: #e8f3ef; color: #234039; }
.real-revision-form .fact-row { padding: 12px; margin: 12px 0; background: rgba(255,255,255,.65); border-radius: 14px; }
.record-page [role=alert] { color: #a42e2e; }
.record-page .modal-card p { overflow-wrap: anywhere; }

.record-page {
  --text-dark: #1f3646;
  --text-muted: #5e7a8c;
  background-image: url('../static/pictures/ChatGPT Image 2026年4月12日 18_24_00.png');
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

.record-page::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    linear-gradient(90deg, rgba(241, 249, 255, 0.58) 0%, rgba(220, 237, 247, 0.42) 38%, rgba(200, 224, 238, 0.14) 68%, rgba(255, 255, 255, 0) 100%);
  pointer-events: none;
  z-index: 0;
}

.record-page > * {
  position: relative;
  z-index: 1;
}

.glass-section,
.summary-card {
  background: rgba(255, 255, 255, 0.58);
  backdrop-filter: blur(9px);
  -webkit-backdrop-filter: blur(9px);
  border: 1px solid rgba(255, 255, 255, 0.48);
  border-radius: 24px;
  box-shadow: 0 10px 30px rgba(72, 110, 140, 0.12);
  margin-bottom: 14px;
  overflow: hidden;
}

.loading-panel {
  padding: 24px 18px;
  text-align: center;
  color: #516975;
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
  font-size: 34px;
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

.patient-subtitle {
  margin: 0;
  max-width: 760px;
  font-size: 14px;
  color: var(--text-muted);
  line-height: 1.7;
}

.summary-card {
  position: relative;
}

.summary-card__bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.16;
}

.summary-card__content {
  position: relative;
  padding: 20px 18px;
}

.summary-card__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
}

.summary-card__heading h2 {
  margin: 0;
  font-size: 16px;
  color: #27465e;
}

.summary-card__heading p {
  margin: 8px 0 0;
  color: #5d7484;
}

.summary-card__date {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.7);
  color: #41637b;
  font-size: 12px;
  font-weight: 700;
}

.summary-card__body {
  margin-top: 16px;
  display: grid;
  gap: 14px;
}

.summary-card__sentence {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: #35556b;
}

.summary-card__metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.summary-card__metric {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.68);
  color: #4f697d;
  font-size: 12px;
  font-weight: 700;
}

.timeline-panel,
.joint-entry-panel {
  padding: 18px 16px;
}

.section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.section-copy {
  display: grid;
  gap: 6px;
}

.section-eyebrow {
  margin: 0;
  color: #7790a2;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.section-title {
  margin: 0;
  font-size: 16px;
  color: #28455d;
}

.section-note {
  margin: 0;
  max-width: 720px;
  color: #60798b;
  line-height: 1.7;
}

.section-actions,
.joint-entry-panel__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.section-actions--timeline {
  flex-wrap: nowrap;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
}

.section-actions--timeline::-webkit-scrollbar {
  display: none;
}

.tab-group {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 8px;
}

.section-actions--timeline .tab-group {
  flex-wrap: nowrap;
}

.tag-pill,
.date-nav,
.close-btn {
  border: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.58);
  color: #466272;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tag-pill,
.close-btn {
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 700;
}

.tag-pill.active {
  background: rgba(222, 237, 229, 0.96);
  color: #245845;
  box-shadow: inset 0 0 0 1px rgba(132, 168, 149, 0.4);
}

.date-switcher {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.date-nav {
  width: 34px;
  height: 34px;
  padding: 0;
  font-size: 18px;
  font-weight: 700;
}

.date-nav:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.date-switcher__label {
  min-width: 132px;
  display: grid;
  gap: 2px;
  padding: 9px 14px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.74);
  border: 1px solid rgba(255, 255, 255, 0.8);
  text-align: center;
}

.date-switcher__label span {
  font-size: 11px;
  color: #6e88a0;
}

.date-switcher__label strong {
  font-size: 13px;
  color: #2d4960;
}

.stream-list {
  display: grid;
  gap: 10px;
  margin-top: 14px;
}

.stream-item {
  padding: 15px 14px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.58);
  border: 1px solid rgba(255, 255, 255, 0.7);
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.stream-item:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 22px rgba(77, 106, 96, 0.12);
}

.stream-item--green {
  box-shadow: inset 4px 0 0 #72ad87;
}

.stream-item--blue {
  box-shadow: inset 4px 0 0 #6f9ad7;
}

.stream-item--gold {
  box-shadow: inset 4px 0 0 #d4a04f;
}

.stream-item--coral {
  box-shadow: inset 4px 0 0 #dd8465;
}

.stream-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.stream-copy {
  display: grid;
  gap: 6px;
}

.stream-copy strong {
  font-size: 14px;
  color: #2d4960;
}

.stream-copy p {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: #61798c;
}

.stream-time {
  flex: 0 0 auto;
  font-size: 12px;
  font-weight: 700;
  color: #6d8598;
}

.stream-tag-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  overflow-x: auto;
  scrollbar-width: none;
  white-space: nowrap;
}

.stream-tag-row::-webkit-scrollbar {
  display: none;
}

.stream-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  min-width: max-content;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.stream-tag--neutral {
  color: #50646d;
  background: rgba(80, 100, 109, 0.1);
}

.stream-tag--info {
  color: #255f8f;
  background: rgba(37, 95, 143, 0.1);
}

.stream-tag--success {
  color: #216850;
  background: rgba(33, 104, 80, 0.12);
}

.stream-tag--warning {
  color: #975f00;
  background: rgba(245, 158, 11, 0.16);
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

.status-chip--warning {
  color: #975f00;
  background: rgba(245, 158, 11, 0.15);
}

.empty-state {
  padding: 20px 16px;
  text-align: center;
  color: #67827c;
  font-size: 13px;
}

.modal-mask {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: rgba(56, 73, 83, 0.28);
  backdrop-filter: blur(4px);
  display: grid;
  place-items: center;
  padding: 16px;
}

.modal-card {
  width: min(720px, 100%);
  max-height: 78vh;
  overflow: auto;
  border-radius: 22px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  background: rgba(248, 252, 251, 0.98);
  box-shadow: 0 22px 44px rgba(69, 96, 86, 0.22);
  padding: 18px;
}

.modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.modal-head h4 {
  margin: 0;
  font-size: 18px;
  color: #294a67;
}

.modal-head p {
  margin: 6px 0 0;
  font-size: 12px;
  color: #5d7177;
}

.record-detail-card {
  display: grid;
  gap: 10px;
  margin-top: 14px;
}

.record-detail-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(245, 249, 248, 0.92);
}

.record-detail-row span {
  font-size: 12px;
  color: #647a76;
}

.record-detail-row strong {
  font-size: 13px;
  color: #294a67;
}

.record-detail-row--stack {
  display: grid;
  gap: 8px;
}

.record-detail-row--stack p {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: #516975;
}

.detail-section {
  display: grid;
  gap: 10px;
  margin-top: 14px;
}

.detail-section__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.detail-section__head h5 {
  margin: 0;
  font-size: 15px;
  color: #264a58;
}

.detail-section__head span {
  font-size: 12px;
  color: #68807f;
}

.dialogue-list,
.structured-list {
  display: grid;
  gap: 10px;
}

.dialogue-item,
.structured-item {
  display: grid;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(28, 78, 94, 0.08);
}

.dialogue-role {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  width: fit-content;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(28, 78, 94, 0.08);
  color: #44687b;
  font-size: 12px;
  font-weight: 700;
}

.dialogue-item p {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: #4b646f;
}

.structured-item span {
  font-size: 12px;
  color: #5c7277;
}

.structured-item strong {
  font-size: 13px;
  line-height: 1.7;
  color: #294a67;
}

.structured-item--success {
  background: rgba(239, 248, 243, 0.94);
}

.structured-item--warning {
  background: rgba(255, 247, 232, 0.94);
}

.structured-item--info {
  background: rgba(242, 248, 255, 0.94);
}

.structured-item--neutral {
  background: rgba(248, 250, 251, 0.94);
}

.preset-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.field-block {
  display: grid;
  gap: 8px;
  margin-top: 14px;
}

.field-label {
  font-size: 13px;
  font-weight: 700;
  color: #244f55;
}

.input-surface {
  width: 100%;
  border: 1px solid rgba(31, 80, 85, 0.1);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.94);
  color: #173339;
}

.input-surface--textarea {
  min-height: 120px;
  padding: 14px 16px;
  resize: vertical;
}

.inline-message {
  padding: 12px 14px;
  border-radius: 14px;
  font-size: 13px;
  font-weight: 700;
}

.inline-message--success {
  margin-top: 12px;
  background: rgba(33, 104, 80, 0.12);
  color: #216850;
}

.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 14px;
}

.action-button {
  min-height: 46px;
  padding: 0 18px;
  border-radius: 16px;
  border: 0;
  cursor: pointer;
  font-weight: 700;
  transition: opacity 0.2s ease;
}

.action-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.action-button--secondary {
  background: linear-gradient(135deg, #1d5961 0%, #2c838a 100%);
  color: #f5fbfa;
}

.action-button--ghost {
  background: rgba(18, 64, 70, 0.08);
  color: #1b5963;
}

@media (max-width: 640px) {
  .record-page {
    padding: 10px 12px calc(var(--bottom-nav-height) + env(safe-area-inset-bottom, 0px));
  }

  .patient-name {
    font-size: 28px;
  }

  .section-header,
  .stream-head,
  .modal-head,
  .detail-section__head,
  .record-detail-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .date-switcher {
    justify-content: space-between;
  }

  .date-switcher__label {
    min-width: 0;
  }
}
</style>

<style scoped>
.record-date-toolbar { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; margin-top: 14px; }
.record-date-field { flex: 1 1 170px; min-width: 0; display: grid; gap: 7px; color: #527484; font-size: 13px; font-weight: 600; }
.record-date-field input { width: 100%; min-width: 0; max-width: 100%; box-sizing: border-box; padding: 10px 12px; min-height: 42px; border: 1px solid #c4dcd8; border-radius: 13px; background: rgba(255,255,255,.86); color: #234e5e; font: inherit; color-scheme: light; }
.record-date-toolbar .tag-pill { min-height: 42px; padding: 10px 16px; }
.record-date-field input:focus-visible { outline: 2px solid #488e88; outline-offset: 2px; }
.detail-section details.dialogue-item { display: block; min-width: 0; padding: 14px; margin-top: 10px; background: #edf5f3; border: 1px solid #d6e5df; border-radius: 16px; }
.detail-section details.dialogue-item summary { color: #285e66; font-size: 13px; font-weight: 700; line-height: 1.6; cursor: pointer; }
.detail-section details.dialogue-item p { margin: 9px 0 0; color: #55717a; font-size: 13px; line-height: 1.75; overflow-wrap: anywhere; }
.record-page .detail-section .section-note { padding: 10px 12px; background: rgba(238,245,247,.8); border-radius: 12px; font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
</style>

<style scoped src="../styles/feedback-form.css"></style>
