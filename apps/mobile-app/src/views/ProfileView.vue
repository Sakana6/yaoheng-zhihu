<script setup lang="ts">
import { Capacitor } from '@capacitor/core';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as echarts from 'echarts/core';
import { PieChart } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import type { ECharts } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useRouter } from 'vue-router';

import { mobileApi, mobileRuntimeConfig } from '../lib/api';
import { formatPatientAge, formatReviewPriority } from '../lib/format';
import type { CurrentPatientContext, MobileJointEvent, MobileMedication, MobileReminder, MobileRisk } from '../lib/types';
import { useManagementApi } from '../../../../packages/frontend/management-api';
import { useMedicationCapture } from '../../../../packages/frontend/medication-capture';
import { useAnalysisState, profileParagraphs, analysisLabels } from '../../../../packages/frontend/analysis-state';
import { displayTime } from '../../../../packages/frontend/care';
import { selectedPatient, session } from '../../../../packages/frontend/session';
import { shanghaiDate, type Plan } from '../../../../packages/frontend/care';
import type { PatientMedication } from '../../../../packages/frontend/contracts';
import { useMvpStore } from '../stores/mvp';
import feedbackIcon from '../static/optimized/feedback.webp';
import medicineIcon from '../static/optimized/medicine.webp';
import recordIcon from '../static/optimized/record.webp';
import riskIcon from '../static/optimized/risk.webp';
import homeCardBg from '../static/optimized/home-card.webp';
import patientAvatar from '../static/optimized/patient-avatar.webp';

echarts.use([PieChart, TooltipComponent, CanvasRenderer]);

type MetricTone = 'green' | 'blue' | 'gold' | 'coral';
type EditableCard = 'medication' | 'reminder';
type EditorMode = 'create' | 'edit';

interface OverviewMetric {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: MetricTone;
  icon?: string;
  route?: string;
  targetCard?: EditableCard;
}

interface ScoreBreakdownItem {
  label: string;
  score: number;
  tone: MetricTone;
}

interface PortraitResult {
  paragraphs: string[];
}

const ADMIN_PASSWORD = '123456';

const router = useRouter();
const isDemo = mobileRuntimeConfig.useMock;
const mvpStore = isDemo ? useMvpStore() : null;
const management = useManagementApi();
const capture = useMedicationCapture();
const captureTask = capture.task;
const captureBusy = capture.busy;
const captureMessage = capture.message;
const medicationImageFile = ref<File | null>(null);
const patientBirthday = ref<string | null>(null);
const analysis = useAnalysisState();
const { snapshot: analysisSnapshot, latest: latestAnalysis, error: analysisError, loading: analysisLoading } = analysis;
const realPortrait = computed(() => profileParagraphs(analysisSnapshot.value));
let analysisTimer: ReturnType<typeof setInterval> | undefined;
const saving = ref(false);
const writeAllowed = computed(() => isDemo || session.value?.role === 'CAREGIVER');
const wireMedications = ref<PatientMedication[]>([]);
const wirePlans = ref<Plan[]>([]);
const medicationVersion = ref<number | null>(null);
const planVersion = ref<number | null>(null);
const medicationDates = ref({ startDate: '', endDate: '', status: 'ACTIVE' });
const planFields = ref({ frequency: 'DAILY', reminderType: 'MEDICATION', timezone: 'Asia/Shanghai', localTime: '08:00', startDate: shanghaiDate(), endDate: '', medicationIds: [] as number[], status: 'ACTIVE' });
let alive = true, loadSequence = 0;
async function loadRealManagement() {
  const sequence = ++loadSequence;
  const [meds, plans] = await Promise.all([management.medications(true), management.plans()]);
  if (!alive || sequence !== loadSequence) return;
  wireMedications.value = meds.medications; wirePlans.value = plans;
  medications.value = meds.medications.map(m => ({ ...m, brandName: m.brandName ?? undefined }));
  reminders.value = plans.map(p => ({ reminderId: p.planId, reminderType: p.reminderType, title: p.title,
    plannedAt: `${p.startDate}T${p.localTime}:00+08:00`, status: p.status, medicationIds: p.medicationIds,
    medicationNames: p.medicationIds.map(id => meds.medications.find(m => m.id === id)?.genericName ?? '历史药品'),
    voicePrompt: '', followUpPrompt: '' }));
}
function planSchedule(item: MobileReminder) {
  if (isDemo) return formatReminderSchedule(item.plannedAt);
  const plan = wirePlans.value.find(p => p.planId === item.reminderId);
  return plan ? `${plan.frequency === 'DAILY' ? '每天' : '单次'} ${plan.localTime} · ${plan.startDate}${plan.frequency === 'DAILY' ? ` 至 ${plan.endDate || '持续'}` : ''}` : '暂无数据';
}
function isDoctorManagedPlan(item: MobileReminder): boolean {
  return !isDemo && wirePlans.value.some(p => p.planId === item.reminderId && p.managedByDoctor === true);
}
async function saveRealMedication() {
  if (saving.value || !writeAllowed.value) return;
  saving.value = true; medicationMessage.value = '';
  try {
    await management.saveMedication(editingMedicationId.value, { ...medicationDraft.value, ...medicationDates.value, ...capture.confirmation(),
      endDate: medicationDates.value.endDate || null, ...(medicationVersion.value === null ? {} : { expectedVersion: medicationVersion.value }) });
    saving.value = false; closeEditorModal(); management.resetAttempt();
    medicationMessage.value = '用药已保存，历史版本保留。';
    try { await loadRealManagement(); } catch (e) { dataSourceWarning.value = `已保存，但列表刷新失败，请刷新重试。${String(e)}`; }
  } catch (e) { medicationMessage.value = `未确认保存，草稿已保留。${String(e)}；版本冲突请关闭后刷新列表再编辑。`; }
  finally { saving.value = false; }
}
async function saveRealPlan() {
  if (saving.value || !writeAllowed.value) return;
  saving.value = true; reminderMessage.value = '';
  try {
    await management.savePlan(editingReminderId.value, { ...planFields.value, title: reminderDraft.value.title,
      endDate: planFields.value.endDate || null, ...(planVersion.value === null ? {} : { expectedVersion: planVersion.value }) });
    saving.value = false; closeEditorModal(); management.resetAttempt();
    reminderMessage.value = '提醒计划已保存，未来实例由服务端生成。';
    try { await loadRealManagement(); } catch (e) { dataSourceWarning.value = `已保存，但列表刷新失败，请刷新重试。${String(e)}`; }
  } catch (e) { reminderMessage.value = `未确认保存，草稿已保留。${String(e)}；版本冲突请关闭后刷新列表再编辑。`; }
  finally { saving.value = false; }
}

const pageTitle = '联合治疗管理';
const pageSubtitle = '围绕高血压与糖尿病联合治疗，集中管理用药安排、提醒任务和随访节奏。';
const enableOverviewModules = true;

const loading = ref(true);
const error = ref('');
const dataSourceWarning = ref('');
const patient = ref<CurrentPatientContext | null>(null);
const risk = ref<MobileRisk | null>(null);
const medications = ref<MobileMedication[]>([]);
const reminders = ref<MobileReminder[]>([]);
const jointEvents = ref<MobileJointEvent[]>([]);

const medicationManagementRef = ref<HTMLElement | null>(null);
const reminderManagementRef = ref<HTMLElement | null>(null);
const ringChartHost = ref<HTMLElement | null>(null);
let ringChart: ECharts | null = null;

const passwordModalVisible = ref(false);
const managementModalVisible = ref(false);
const editorModalVisible = ref(false);
const pendingCard = ref<EditableCard | null>(null);
const activeEditor = ref<EditableCard | null>(null);
const activeManagementCard = ref<EditableCard | null>(null);
const editorMode = ref<EditorMode>('create');
const editingMedicationId = ref<number | null>(null);
const editingReminderId = ref<string | null>(null);
const passwordInput = ref('');
const passwordError = ref('');
const medicationMessage = ref('');
const reminderMessage = ref('');
const portraitResult = ref<PortraitResult | null>(null);
const portraitLoading = ref(false);
const aiNormalizeLoading = ref<EditableCard | null>(null);
const medicationImageInput = ref<HTMLInputElement | null>(null);
const medicationCameraInput = ref<HTMLInputElement | null>(null);
const medicationImageName = ref('');
const medicationImagePreviewUrl = ref('');
const medicationRecognitionMessage = ref('');
const medicationRecognitionLoading = ref(false);

let portraitTimer: ReturnType<typeof window.setTimeout> | null = null;
let aiNormalizeTimer: ReturnType<typeof window.setTimeout> | null = null;
let medicationRecognitionTimer: ReturnType<typeof window.setTimeout> | null = null;
let pendingAdminAction: (() => void) | null = null;

const verifiedCards = ref<Record<EditableCard, boolean>>({
  medication: false,
  reminder: false,
});

const medicationDraft = ref({
  genericName: '',
  brandName: '',
  dose: '',
  frequency: 'QD',
  administrationTime: 'AFTER_BREAKFAST',
});

const reminderDraft = ref({
  title: '',
  plannedAt: '',
  medicationName: '',
  followUpPrompt: '',
});

const medicationNaturalText = ref('');
const reminderNaturalText = ref('');
const isNativeShell = computed(() => Capacitor.isNativePlatform());

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getFallbackPatient(): CurrentPatientContext {
  return {
    userId: 1,
    role: 'CAREGIVER',
    patientId: 1,
    patientName: '当前患者',
  };
}

function getFallbackRisk(): MobileRisk {
  return {
    deintensificationScore: 82,
    interactionScore: 32,
    behaviorScore: 61,
    jointEventScore: 88,
    reviewPriority: 'CLINIC_REVIEW',
    reasons: ['晨间餐药配合不稳定', '近期存在联合事件信号', '需要补齐关键反馈窗口'],
  };
}

function isReminderCompleted(item: MobileReminder): boolean {
  return item.status === 'SUCCESS' || item.status === 'DONE';
}

function getScoreLabel(score: number): string {
  if (score >= 80) return '高风险';
  if (score >= 60) return '重点观察';
  if (score >= 40) return '轻度波动';
  return '相对平稳';
}

function getTodayDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function toIsoString(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function cloneMedication(item: MobileMedication): MobileMedication {
  return { ...item };
}

function cloneReminder(item: MobileReminder): MobileReminder {
  return {
    ...item,
    medicationIds: [...item.medicationIds],
    medicationNames: [...item.medicationNames],
  };
}

function syncLocalMedications(next: MobileMedication[]): void {
  medications.value = next.map(cloneMedication);
}

function syncLocalReminders(next: MobileReminder[]): void {
  reminders.value = next.map(cloneReminder);
}

function toDateTimeLocalValue(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  const offset = parsed.getTimezoneOffset() * 60 * 1000;
  return new Date(parsed.getTime() - offset).toISOString().slice(0, 16);
}

function formatReminderSchedule(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '--';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(parsed);
}

function formatFrequencyLabel(value: string): string {
  const labels: Record<string, string> = {
    QD: '每日 1 次',
    BID: '每日 2 次',
    TID: '每日 3 次',
  };

  return labels[value] ?? value;
}

function formatAdministrationTimeLabel(value: string): string {
  const labels: Record<string, string> = {
    AFTER_BREAKFAST: '早餐后',
    AFTER_BREAKFAST_AFTER_DINNER: '早晚餐后',
    BEFORE_MEAL: '餐前',
  };

  return labels[value] ?? value;
}

function formatReminderStatusLabel(status: string): string {
  return status === 'ACTIVE' ? '启用' : status === 'PAUSED' ? '暂停' : status === 'SUCCESS' || status === 'DONE' ? '已完成' : '待执行';
}

function buildReminderMedicationPayload(name: string): Pick<MobileReminder, 'medicationIds' | 'medicationNames'> {
  const normalized = name.trim();
  if (!normalized) {
    return {
      medicationIds: [],
      medicationNames: [],
    };
  }

  const matchedMedication = medications.value.find(
    (item) => item.genericName === normalized || item.brandName === normalized,
  );

  if (!matchedMedication) {
    return {
      medicationIds: [],
      medicationNames: [normalized],
    };
  }

  return {
    medicationIds: [matchedMedication.id],
    medicationNames: [matchedMedication.genericName],
  };
}

function revokeMedicationImagePreview(): void {
  if (medicationImagePreviewUrl.value) {
    URL.revokeObjectURL(medicationImagePreviewUrl.value);
    medicationImagePreviewUrl.value = '';
  }
}

function resetMedicationImageState(): void {
  capture.reset();
  medicationImageFile.value = null;
  if (medicationRecognitionTimer) {
    window.clearTimeout(medicationRecognitionTimer);
    medicationRecognitionTimer = null;
  }

  revokeMedicationImagePreview();
  medicationImageName.value = '';
  medicationRecognitionMessage.value = '';
  medicationRecognitionLoading.value = false;

  if (medicationImageInput.value) {
    medicationImageInput.value.value = '';
  }
  if (medicationCameraInput.value) {
    medicationCameraInput.value.value = '';
  }
}

function resetMedicationDraft() {
  medicationDraft.value = {
    genericName: '',
    brandName: '',
    dose: '',
    frequency: 'QD',
    administrationTime: 'AFTER_BREAKFAST',
  };
  medicationNaturalText.value = '';
  editingMedicationId.value = null;
  resetMedicationImageState();
}

function resetReminderDraft() {
  reminderDraft.value = {
    title: '',
    plannedAt: '',
    medicationName: '',
    followUpPrompt: '',
  };
  reminderNaturalText.value = '';
  editingReminderId.value = null;
}

function closePasswordModal() {
  passwordModalVisible.value = false;
  pendingCard.value = null;
  passwordInput.value = '';
  passwordError.value = '';
  pendingAdminAction = null;
}

function closeManagementModal() {
  if (saving.value) return;
  managementModalVisible.value = false;
  activeManagementCard.value = null;
}

function closeEditorModal() {
  if (saving.value) return;
  editorModalVisible.value = false;
  activeEditor.value = null;
  aiNormalizeLoading.value = null;
  editorMode.value = 'create';
  editingMedicationId.value = null;
  editingReminderId.value = null;
  resetMedicationImageState();
}

function openEditorModal(card: EditableCard) {
  medicationMessage.value = '';
  reminderMessage.value = '';
  activeEditor.value = card;
  editorModalVisible.value = true;
}

function openManagementModal(card: EditableCard): void {
  activeManagementCard.value = card;
  managementModalVisible.value = true;
}

function openCreateEditor(card: EditableCard): void {
  if (saving.value || !writeAllowed.value) return;
  management.resetAttempt(); medicationVersion.value = null; planVersion.value = null;
  medicationDates.value = { startDate: '', endDate: '', status: 'ACTIVE' };
  planFields.value = { frequency: 'DAILY', reminderType: 'MEDICATION', timezone: 'Asia/Shanghai', localTime: '08:00', startDate: shanghaiDate(), endDate: '', medicationIds: [], status: 'ACTIVE' };
  editorMode.value = 'create';
  if (card === 'medication') {
    resetMedicationDraft();
  } else {
    resetReminderDraft();
  }
  openEditorModal(card);
}

function openMedicationEditor(item: MobileMedication): void {
  if (saving.value || !writeAllowed.value) return;
  management.resetAttempt();
  if (!isDemo) {
    const wire = wireMedications.value.find(m => m.id === item.id);
    if (!wire) return;
    medicationVersion.value = wire.version;
    medicationDates.value = { startDate: wire.startDate, endDate: wire.endDate ?? '', status: wire.status };
  }
  editorMode.value = 'edit';
  editingMedicationId.value = item.id;
  medicationDraft.value = {
    genericName: item.genericName,
    brandName: item.brandName ?? '',
    dose: item.dose,
    frequency: item.frequency,
    administrationTime: item.administrationTime,
  };
  medicationNaturalText.value = '';
  resetMedicationImageState();
  openEditorModal('medication');
}

function openReminderEditor(item: MobileReminder): void {
  if (saving.value || !writeAllowed.value || isDoctorManagedPlan(item)) return;
  management.resetAttempt();
  if (!isDemo) {
    const wire = wirePlans.value.find(p => p.planId === item.reminderId);
    if (!wire) return;
    planVersion.value = wire.version;
    planFields.value = { ...wire, endDate: wire.endDate ?? '', medicationIds: [...wire.medicationIds] };
  }
  editorMode.value = 'edit';
  editingReminderId.value = item.reminderId;
  reminderDraft.value = {
    title: item.title,
    plannedAt: toDateTimeLocalValue(item.plannedAt),
    medicationName: item.medicationNames[0] ?? '',
    followUpPrompt: item.followUpPrompt,
  };
  reminderNaturalText.value = '';
  openEditorModal('reminder');
}

function requestAdminAccess(card: EditableCard, action?: () => void) {
  medicationMessage.value = '';
  reminderMessage.value = '';
  const resolvedAction = action ?? (() => openManagementModal(card));
  if (!isDemo) { if (writeAllowed.value && !saving.value) resolvedAction(); return; }

  if (verifiedCards.value[card]) {
    resolvedAction();
    return;
  }

  pendingCard.value = card;
  pendingAdminAction = resolvedAction;
  passwordInput.value = '';
  passwordError.value = '';
  passwordModalVisible.value = true;
}

function confirmAdminPassword() {
  if (passwordInput.value !== ADMIN_PASSWORD) {
    passwordError.value = '管理员密码错误，请重试。';
    return;
  }

  if (!pendingCard.value) {
    closePasswordModal();
    return;
  }

  verifiedCards.value[pendingCard.value] = true;
  const nextAction = pendingAdminAction;
  closePasswordModal();
  nextAction?.();
}

async function submitMedicationDraft() {
  if (!isDemo) { await saveRealMedication(); return; }
  if (!medicationDraft.value.genericName.trim() || !medicationDraft.value.dose.trim()) {
    medicationMessage.value = '请至少填写药品名称和剂量。';
    return;
  }

  const medicationPayload: MobileMedication = {
    id: editingMedicationId.value ?? Date.now(),
    genericName: medicationDraft.value.genericName.trim(),
    brandName: medicationDraft.value.brandName.trim() || undefined,
    dose: medicationDraft.value.dose.trim(),
    frequency: medicationDraft.value.frequency,
    administrationTime: medicationDraft.value.administrationTime,
    startDate: getTodayDateKey(),
    status: 'ACTIVE',
  };

  if (editorMode.value === 'edit' && editingMedicationId.value !== null) {
    const existingMedication = medications.value.find((item) => item.id === editingMedicationId.value);
    const updatedMedication = mobileRuntimeConfig.useMock ? medicationPayload : await mobileApi.updateMedication(editingMedicationId.value, {
      dose: medicationPayload.dose,
      frequency: medicationPayload.frequency,
      administrationTime: medicationPayload.administrationTime,
      status: existingMedication?.status ?? medicationPayload.status,
    });
    if (mobileRuntimeConfig.useMock) mvpStore!.updateMedication({
      ...medicationPayload,
      startDate: existingMedication?.startDate ?? medicationPayload.startDate,
      status: existingMedication?.status ?? medicationPayload.status,
    });
    else {
      const index = mvpStore!.state.medications.findIndex((item) => item.id === editingMedicationId.value);
      if (index >= 0) mvpStore!.state.medications[index] = { ...mvpStore!.state.medications[index], ...updatedMedication };
    }
  } else {
    const created = mobileRuntimeConfig.useMock ? medicationPayload : await mobileApi.createMedication(medicationPayload);
    if (mobileRuntimeConfig.useMock) mvpStore!.addMedication(created);
    else mvpStore!.state.medications.push(created);
  }

  syncLocalMedications(mvpStore!.state.medications);
  syncLocalReminders(mvpStore!.state.reminders);
  medicationMessage.value = '用药安排已添加。';
  medicationMessage.value =
    editorMode.value === 'edit' ? '已更新用药安排。' : '已新增用药安排。';
  resetMedicationDraft();
  closeEditorModal();
}

async function submitReminderDraft() {
  if (!isDemo) { await saveRealPlan(); return; }
  if (!reminderDraft.value.title.trim() || !reminderDraft.value.plannedAt.trim()) {
    reminderMessage.value = '请至少填写提醒标题和提醒时间。';
    return;
  }

  const reminderLinks = buildReminderMedicationPayload(reminderDraft.value.medicationName);
  const reminderPayload: MobileReminder = {
    reminderId: editingReminderId.value ?? `rem_${Date.now()}`,
    reminderType: 'MEDICATION',
    plannedAt: toIsoString(reminderDraft.value.plannedAt),
    title: reminderDraft.value.title.trim(),
    status: 'PENDING',
    medicationIds: reminderLinks.medicationIds,
    medicationNames: reminderLinks.medicationNames,
    voicePrompt: reminderDraft.value.title.trim(),
    followUpPrompt: reminderDraft.value.followUpPrompt.trim() || '请按时完成并记录反馈。',
  };

  if (editorMode.value === 'edit' && editingReminderId.value) {
    const existingReminder = reminders.value.find((item) => item.reminderId === editingReminderId.value);
    mvpStore!.updateReminder({
      ...reminderPayload,
      status: existingReminder?.status ?? reminderPayload.status,
      reminderType: existingReminder?.reminderType ?? reminderPayload.reminderType,
    });
  } else {
    mvpStore!.addReminder(reminderPayload);
  }

  syncLocalReminders(mvpStore!.state.reminders);
  reminderMessage.value = '提醒安排已添加。';
  reminderMessage.value =
    editorMode.value === 'edit' ? '已更新提醒安排。' : '已新增提醒安排。';
  resetReminderDraft();
  closeEditorModal();
}

function deleteMedication(item: MobileMedication): void {
  if (!isDemo) { openMedicationEditor(item); medicationDates.value.status = 'STOPPED'; return; }
  if (typeof window !== 'undefined' && !window.confirm(`确认删除 ${item.genericName} 吗？`)) {
    return;
  }

  mvpStore!.deleteMedication(item.id);
  syncLocalMedications(mvpStore!.state.medications);
  syncLocalReminders(mvpStore!.state.reminders);
  medicationMessage.value = '已删除用药安排。';
}

function deleteReminder(item: MobileReminder): void {
  if (isDoctorManagedPlan(item)) return;
  if (!isDemo) { openReminderEditor(item); planFields.value.status = 'PAUSED'; return; }
  if (typeof window !== 'undefined' && !window.confirm(`确认删除 ${item.title} 吗？`)) {
    return;
  }

  mvpStore!.deleteReminder(item.reminderId);
  syncLocalReminders(mvpStore!.state.reminders);
  reminderMessage.value = '已删除提醒安排。';
}

function handleMedicationImageChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  resetMedicationImageState();

  if (!file) {
    return;
  }

  medicationImageName.value = file.name;
  medicationImageFile.value = file;
  medicationImagePreviewUrl.value = URL.createObjectURL(file);
}

function openMedicationImagePicker(source: 'gallery' | 'camera'): void {
  const target = source === 'camera' ? medicationCameraInput.value : medicationImageInput.value;
  target?.click();
}

function recognizeMedicationImage(): void {
  if (!isDemo) {
    if (editingMedicationId.value !== null) { medicationRecognitionMessage.value = '已有药历请直接修订字段；采集用于新增药历。'; return; }
    if (!medicationImageFile.value) { medicationRecognitionMessage.value = '请先选择 PNG/JPEG 图片。'; return; }
    medicationRecognitionMessage.value = '';
    void capture.recognize(medicationImageFile.value); return;
  }
  if (!medicationImageName.value) {
    medicationRecognitionMessage.value = '请先上传药品图片，再点击识别。';
    return;
  }

  medicationRecognitionLoading.value = true;
  medicationRecognitionMessage.value = '';

  if (medicationRecognitionTimer) {
    window.clearTimeout(medicationRecognitionTimer);
  }

  medicationRecognitionTimer = window.setTimeout(() => {
    medicationDraft.value = {
      ...medicationDraft.value,
      genericName: '格列本脲',
      brandName: '',
    };
    medicationRecognitionMessage.value = '识别结果已固定为格列本脲，请补充剂量后保存。';
    medicationRecognitionLoading.value = false;
    medicationRecognitionTimer = null;
  }, 600);
}

function simulateAiNormalize(card: EditableCard) {
  if (!isDemo) {
    if (card !== 'medication' || editingMedicationId.value !== null) { (card === 'medication' ? medicationMessage : reminderMessage).value = '请人工核对原有字段；药名候选用于新增药历。'; return; }
    void capture.normalize(medicationNaturalText.value); return;
  }
  aiNormalizeLoading.value = card;
  if (aiNormalizeTimer) {
    window.clearTimeout(aiNormalizeTimer);
  }

  aiNormalizeTimer = window.setTimeout(() => {
    if (card === 'medication') {
      medicationDraft.value = {
        genericName: '缬沙坦',
        brandName: '代文',
        dose: '80mg',
        frequency: 'QD',
        administrationTime: 'AFTER_BREAKFAST',
      };
    } else {
      const planned = new Date();
      planned.setHours(8, 30, 0, 0);
    }

    aiNormalizeLoading.value = null;
  }, 900);
}

const resolvedPatient = computed(() => patient.value ?? getFallbackPatient());
const resolvedRisk = computed(() => isDemo ? risk.value ?? getFallbackRisk() : analysisSnapshot.value?.risk ? {...analysisSnapshot.value.risk,reasons:[]} : null);
const patientName = computed(() => resolvedPatient.value.patientName || '当前患者');
const completedReminderCount = computed(() => reminders.value.filter(isReminderCompleted).length);
const reminderTotalCount = computed(() => isDemo ? reminders.value.length || Math.max(medications.value.length, 1) : reminders.value.length);
const pendingReminderCount = computed(() => Math.max(reminderTotalCount.value - completedReminderCount.value, 0));
const feedbackCount = computed(() => completedReminderCount.value);
const eventCount = computed(() => jointEvents.value.length);

const overallScore = computed(() => {
  if (!isDemo) return 0;
  const currentRisk = resolvedRisk.value!;
  const weighted =
    currentRisk.deintensificationScore * 0.26 +
    currentRisk.interactionScore * 0.16 +
    currentRisk.behaviorScore * 0.24 +
    currentRisk.jointEventScore * 0.34;
  return clamp(Math.round(weighted), 0, 100);
});

const priorityMeta = computed(() => resolvedRisk.value ? formatReviewPriority(resolvedRisk.value.reviewPriority) : { label: analysisSnapshot.value ? '资料不足' : '暂无结果', tone: 'neutral' });
const patientAge = computed(() => isDemo ? '72' : formatPatientAge(patientBirthday.value, shanghaiDate()));
const patientBaseTags = computed(() => isDemo ? ['高血压', '糖尿病', '联合治疗'] : ['用药与提醒管理']);
const patientIntro = computed(() => {
  return `当前页面只保留两病联合治疗相关管理能力，用于统一维护降压药、降糖药、复测提醒和症状回访。`;
});

const overviewMetrics = computed<OverviewMetric[]>(() => [
  { id: 'medication', label: '今日用药', value: `${completedReminderCount.value}/${reminderTotalCount.value}`, detail: '点击查看药历', tone: 'green', route: '/medications' },
  { id: 'event', label: '事件数', value: String(eventCount.value), detail: '点击查看风险事件', tone: 'coral', route: '/joint-events' },
  { id: 'feedback', label: '反馈数', value: String(feedbackCount.value), detail: '点击查看反馈记录', tone: 'blue', route: '/records' },
  { id: 'risk', label: '风险等级', value: getScoreLabel(overallScore.value), detail: '点击查看风险判断', tone: 'gold', route: '/risk' },
]);

const quickAccessMetrics = computed<OverviewMetric[]>(() => [
  {
    id: 'medication',
    label: '用药管理',
    value: String(medications.value.length),
    detail: medications.value.length ? `已管理 ${medications.value.length} 项` : '点击下滑到用药管理',
    tone: 'green',
    icon: medicineIcon,
    route: '/medications',
  },
  {
    id: 'reminder',
    label: '提醒管理',
    value: String(reminders.value.length),
    detail: pendingReminderCount.value ? `${pendingReminderCount.value} 项待执行` : '点击下滑到提醒管理',
    tone: 'blue',
    icon: feedbackIcon,
    route: '/home',
  },
  {
    id: 'feedback',
    label: '反馈记录',
    value: String(feedbackCount.value),
    detail: '点击查看反馈记录页',
    tone: 'coral',
    icon: recordIcon,
    route: '/records',
  },
  {
    id: 'risk',
    label: isDemo ? '风险总分' : '风险评分',
    value: String(overallScore.value),
    detail: priorityMeta.value.label,
    tone: 'gold',
    icon: riskIcon,
    route: '/risk',
  },
]);

const scoreBreakdown = computed<ScoreBreakdownItem[]>(() => !resolvedRisk.value ? [] : [
  { label: '过强化风险', score: resolvedRisk.value.deintensificationScore, tone: 'coral' },
  { label: '联用风险', score: resolvedRisk.value.interactionScore, tone: 'blue' },
  { label: '行为波动', score: resolvedRisk.value.behaviorScore, tone: 'gold' },
  { label: '联合事件', score: resolvedRisk.value.jointEventScore, tone: 'green' },
]);

const editorTitle = computed(() => (activeEditor.value === 'medication' ? '新增用药安排' : '新增提醒安排'));

const editorDialogTitle = computed(() => {
  if (activeEditor.value === 'medication') {
    return editorMode.value === 'edit' ? '编辑用药安排' : '新增用药安排';
  }

  return editorMode.value === 'edit' ? '编辑提醒安排' : '新增提醒安排';
});

const editorDialogSubmitLabel = computed(() => {
  if (activeEditor.value === 'medication') {
    return editorMode.value === 'edit' ? '保存修改' : '保存用药';
  }

  return editorMode.value === 'edit' ? '保存修改' : '保存提醒';
});

const managementDialogTitle = computed(() =>
  activeManagementCard.value === 'medication' ? '用药管理' : '提醒管理',
);

const ringOption = computed(() => ({
  animationDuration: 420,
  tooltip: {
    trigger: 'item',
    backgroundColor: 'rgba(28, 45, 66, 0.92)',
    borderWidth: 0,
    textStyle: { color: '#eef5ff' },
    formatter: ({ name, value }: { name: string; value: number }) => `${name}: ${value}`,
  },
  series: [
    {
      type: 'pie',
      radius: ['70%', '88%'],
      center: ['50%', '44%'],
      label: {
        show: true,
        position: 'center',
        formatter: `{score|${overallScore.value}}`,
        rich: {
          score: {
            fontSize: 34,
            fontWeight: 800,
            color: '#255b49',
            lineHeight: 38,
          },
          name: {
            fontSize: 12,
            color: '#7f8ca0',
            lineHeight: 18,
          },
        },
      },
      labelLine: { show: false },
      data: [
        {
          value: overallScore.value,
          name: '综合评分',
          itemStyle: {
            color: overallScore.value >= 80 ? '#d98261' : overallScore.value >= 60 ? '#d0a33f' : '#5c9d7c',
          },
        },
        {
          value: Math.max(100 - overallScore.value, 0),
          name: '剩余区间',
          itemStyle: { color: 'rgba(183, 198, 210, 0.28)' },
        },
      ],
    },
  ],
}));

function generatePortraitSummary() {
  if (!isDemo) { void analysis.load(); return; }
  portraitResult.value = null;
  portraitLoading.value = true;

  if (portraitTimer) {
    window.clearTimeout(portraitTimer);
  }

  portraitTimer = window.setTimeout(() => {
    portraitLoading.value = false;
    portraitResult.value = {
      paragraphs: ['上周“过强化风险”过高', '用户正常情况血压偏低，已根据人物特征更改评分准则'],
    };
  }, 1500);
}

async function loadPage() {
  if (!isDemo) {
    loading.value = true; error.value = ''; dataSourceWarning.value = '';
    patient.value = { userId: session.value!.userId, role: session.value!.role, patientId: selectedPatient.value!.id, patientName: selectedPatient.value!.name };
    // Basic identity failure must not block the medication/reminder workspace.
    patientBirthday.value = null;
    void management.profile().then(profile => { if (alive) patientBirthday.value = profile.birthday; }).catch(() => {});
    try { await loadRealManagement(); } catch (e) { if (alive) error.value = `管理数据读取失败，请重试。${String(e)}`; }
    finally { if (alive) loading.value = false; }
    return;
  }
  loading.value = true;
  error.value = '';
  dataSourceWarning.value = '';

  try {
    const [patientRes, riskRes, medicationRes, reminderRes, jointEventRes] = await Promise.allSettled([
      mobileApi.getCurrentPatient(),
      mobileApi.getRiskLatest(),
      mobileApi.getMedications(),
      mobileApi.getTodayReminders(),
      mobileApi.getJointEvents(),
    ]);

    const loadedMedications = medicationRes.status === 'fulfilled' ? medicationRes.value.medications : [];
    const loadedReminders = reminderRes.status === 'fulfilled' ? reminderRes.value.reminders : [];

    patient.value = patientRes.status === 'fulfilled' ? patientRes.value : getFallbackPatient();
    risk.value = mvpStore!.state.risk ?? (riskRes.status === 'fulfilled' ? riskRes.value : getFallbackRisk());
    medications.value = mvpStore!.state.medications.length ? mvpStore!.state.medications : loadedMedications;
    reminders.value = mvpStore!.state.reminders.length ? mvpStore!.state.reminders : loadedReminders;
    jointEvents.value = mvpStore!.state.jointEvents.length
      ? mvpStore!.state.jointEvents
      : jointEventRes.status === 'fulfilled'
        ? jointEventRes.value.jointEvents
        : [];

    if (!mvpStore!.state.medications.length && loadedMedications.length) {
      mvpStore!.syncMedicationData(loadedMedications, loadedReminders);
    }

    const failedCount = [patientRes, riskRes, medicationRes, reminderRes, jointEventRes].filter((item) => item.status === 'rejected').length;
    if (failedCount > 0) {
      dataSourceWarning.value = failedCount === 5
        ? '服务端暂不可用，当前显示本地合成数据；保存操作仍需服务端恢复后进行。'
        : `部分服务端数据暂不可用，当前已显示可用数据（${failedCount} 项请求失败）。`;
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : '联合治疗管理页面加载失败';
  } finally {
    loading.value = false;
  }
}

function renderRingChart() {
  if (!isDemo) return;
  if (loading.value || error.value || !ringChartHost.value) return;
  if (!ringChart) ringChart = echarts.init(ringChartHost.value);
  ringChart.setOption(ringOption.value, true);
}

function resizeChart() {
  ringChart?.resize();
}

function scrollToManagement(card: EditableCard): void {
  const target = card === 'medication' ? medicationManagementRef.value : reminderManagementRef.value;
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function handleQuickAccess(item: OverviewMetric): void {
  if (item.targetCard) {
    requestAdminAccess(item.targetCard, () => openManagementModal(item.targetCard as EditableCard));
    return;
  }

  if (item.route) {
    void router.push(item.route);
  }
}

onMounted(async () => {
  if (!isDemo) { void analysis.load(); analysisTimer=setInterval(() => { if (document.visibilityState==='visible') void analysis.load(); },5000); }
  window.addEventListener('resize', resizeChart);
  await loadPage();
});

onBeforeUnmount(() => {
  alive = false; loadSequence++; analysis.dispose(); clearInterval(analysisTimer);
  window.removeEventListener('resize', resizeChart);
  ringChart?.dispose();
  ringChart = null;
  if (portraitTimer) {
    window.clearTimeout(portraitTimer);
  }
  if (aiNormalizeTimer) {
    window.clearTimeout(aiNormalizeTimer);
  }
  if (medicationRecognitionTimer) {
    window.clearTimeout(medicationRecognitionTimer);
  }
  revokeMedicationImagePreview();
});

watch([loading, error], async () => {
  await nextTick();
  renderRingChart();
});

watch(overallScore, async () => {
  await nextTick();
  renderRingChart();
});

if (isDemo) watch(
  () => mvpStore!.state.medications,
  (next) => {
    syncLocalMedications(next);
  },
  { deep: true },
);

if (isDemo) watch(
  () => mvpStore!.state.reminders,
  (next) => {
    syncLocalReminders(next);
  },
  { deep: true },
);
</script>

<template>
  <div class="mobile-page profile-page">
    <section v-if="loading" class="glass-section loading-panel">
      <p>正在加载联合治疗管理数据...</p>
    </section>

    <section v-else-if="error" class="glass-section loading-panel">
      <p role="alert">{{ error }}</p><button class="mini-button" @click="loadPage">重新读取</button>
    </section>

    <template v-else>
      <p v-if="dataSourceWarning" class="data-source-warning" role="status">{{ dataSourceWarning }}</p>
      <section class="hero-panel">
        <div class="hero-top">
          <div class="hero-profile-card">
            <img width="76" height="76" decoding="async" class="hero-avatar" :src="patientAvatar" :alt="isDemo ? '患者头像' : '照护主题插画'" />

            <div class="hero-meta">
              <div class="hero-title-row">
                <div class="hero-name-row">
                  <h1 class="patient-name">{{ patientName }}</h1>
                  <span class="patient-age">{{ patientAge }}</span>
                </div>

                <div class="hero-chip-row">
                  <span v-for="tag in patientBaseTags" :key="tag" class="patient-badge">{{ tag }}</span>
                </div>
              </div>
            </div>

            <p class="patient-subtitle hero-summary">{{ patientIntro }}</p>
          </div>
        </div>

        <div class="detail-strip">
          <div class="detail-item detail-item--green">
            <span class="detail-dot"></span>
            <span>{{ isDemo ? `今日用药 ${completedReminderCount}/${reminderTotalCount}` : `药历 ${medications.length} 项` }}</span>
          </div>
          <div class="detail-item detail-item--orange">
            <span class="detail-dot"></span>
            <span>联合风险优先级 {{ priorityMeta.label }}</span>
          </div>
          <div class="detail-item detail-item--blue">
            <span class="detail-dot"></span>
            <span>{{ isDemo ? `联合事件 ${eventCount} / 待执行提醒 ${pendingReminderCount}` : `提醒计划 ${reminders.length} 项` }}</span>
          </div>
        </div>
      </section>

      <section v-if="enableOverviewModules" class="overview-split">
        <article class="overview-left-card" :style="{ backgroundImage: `linear-gradient(145deg, rgba(92, 133, 196, 0.42), rgba(58, 96, 164, 0.48)), url(${homeCardBg})` }">
          <div class="overview-panel-head">
            <p class="section-eyebrow section-eyebrow--light">快捷工作台</p>
            <h2 class="section-title section-title--light">高频入口</h2>
          </div>

          <div class="overview-metrics">
            <button
              v-for="item in quickAccessMetrics"
              :key="item.id"
              type="button"
              :class="['overview-metric', `overview-metric--${item.tone}`]"
              @click="handleQuickAccess(item)"
            >
              <div class="overview-metric__icon-wrap">
                <img width="40" height="40" decoding="async" class="overview-metric__icon" :src="item.icon" :alt="item.label" />
                <span class="overview-metric__label">{{ item.label }}</span>
              </div>
            </button>
          </div>
        </article>

        <article class="overview-right-card">
          <div class="overview-panel-head overview-panel-head--right">
            <p class="section-eyebrow">{{ isDemo ? '活跃度' : '已发布分析' }}</p>
            <h2 class="section-title">评分概述</h2>
          </div>

          <div v-if="isDemo" ref="ringChartHost" class="ring-chart-host"></div><div v-else class="ring-chart-host management-empty">{{ analysisSnapshot?.risk ? '综合评分未提供；分项见下方' : analysisSnapshot ? '资料不足，未生成评分' : '暂无评分数据' }}</div>

          <div class="score-panel">
            <span class="score-panel__eyebrow">综合判断</span>
            <p>{{ isDemo ? `${getScoreLabel(overallScore)} · ${priorityMeta.label}` : priorityMeta.label }}</p>
          </div>

          <template v-if="!isDemo"><p v-if="analysisError" role="alert">{{ analysisError }}</p><button type="button" class="action-card__button" :disabled="analysisLoading" @click="analysis.load">刷新分析</button><p v-if="latestAnalysis?.pendingTask" class="section-note">任务：{{ analysisLabels[latestAnalysis.pendingTask.status] }}</p></template>
          <div class="score-breakdown">
            <div v-for="item in scoreBreakdown" :key="item.label" class="score-breakdown__item">
              <div class="score-breakdown__top">
                <span>{{ item.label }}</span>
                <strong :class="`score-breakdown__value score-breakdown__value--${item.tone}`">{{ item.score }}</strong>
              </div>
              <div class="score-breakdown__track">
                <div :class="`score-breakdown__bar score-breakdown__bar--${item.tone}`" :style="{ width: `${item.score}%` }"></div>
              </div>
            </div>
          </div>
        </article>
      </section>

      <section v-if="enableOverviewModules" class="action-grid action-grid--legacy">
        <article class="action-card action-card--green">
          <div class="action-card__copy">
            <p class="section-eyebrow">添加用药</p>
            <h3>新增用药安排</h3>
            <p class="action-card__detail">登录家属账号后，在原弹窗中录入并确认保存。</p>
            <span class="action-card__helper">
              {{ medications.length ? `当前已管理 ${medications.length} 种药物` : '当前还没有完整药历' }}
            </span>
            <p v-if="medicationMessage" class="inline-message">{{ medicationMessage }}</p>
          </div>
          <button type="button" class="action-card__button" @click="requestAdminAccess('medication')">增加</button>
        </article>

        <article class="action-card action-card--blue">
          <div class="action-card__copy">
            <p class="section-eyebrow">添加提醒</p>
            <h3>新增提醒安排</h3>
            <p class="action-card__detail">登录家属账号后，在原弹窗中录入并确认保存。</p>
            <span class="action-card__helper">
              {{ isDemo ? (pendingReminderCount > 0 ? `当前仍有 ${pendingReminderCount} 个提醒待完成` : '当前提醒执行相对稳定') : `当前管理 ${reminders.length} 个计划` }}
            </span>
            <p v-if="reminderMessage" class="inline-message">{{ reminderMessage }}</p>
          </div>
          <button type="button" class="action-card__button" @click="requestAdminAccess('reminder')">增加</button>
        </article>
      </section>

      <section class="management-grid">
        <article ref="medicationManagementRef" class="action-card action-card--green management-card">
          <div class="action-card__head">
            <div class="action-card__copy">
              <p class="section-eyebrow">用药管理</p>
              <h3>管理用药安排</h3>
              <p class="action-card__detail">与药历页保持同一份数据，可在这里新增、编辑和停用；历史记录保留。</p>
            </div>
            <button type="button" class="action-card__button" @click="requestAdminAccess('medication', () => openCreateEditor('medication'))">新增</button>
          </div>

          <button v-if="!isDemo" class="mini-button mini-button--ghost" :disabled="saving" @click="loadPage">刷新管理数据</button>
          <span class="action-card__helper">
            {{ medications.length ? `当前已管理 ${medications.length} 项用药` : '当前还没有用药安排' }}
          </span>

          <div class="management-list">
            <article v-for="item in medications" :key="item.id" class="management-item">
              <div class="management-item__copy">
                <strong>{{ item.genericName }}</strong>
                <p>{{ item.brandName ? `${item.brandName} · ${item.dose}` : item.dose }}</p>
                <p>{{ formatFrequencyLabel(item.frequency) }} · {{ formatAdministrationTimeLabel(item.administrationTime) }}</p>
              <p v-if="!isDemo">{{ item.status === 'ACTIVE' ? '有效' : item.status === 'STOPPED' ? '已停用' : '已归档' }} · 版本 {{ wireMedications.find(m => m.id === item.id)?.version }}</p>
              </div>
              <div class="management-item__actions">
                <button type="button" class="mini-button mini-button--ghost" @click="requestAdminAccess('medication', () => openMedicationEditor(item))">编辑</button>
                <button type="button" class="mini-button mini-button--danger" @click="requestAdminAccess('medication', () => deleteMedication(item))">{{ isDemo ? '删除' : '停用' }}</button>
              </div>
            </article>

            <div v-if="!medications.length" class="management-empty">暂无用药安排</div>
          </div>

          <p v-if="medicationMessage" class="inline-message">{{ medicationMessage }}</p>
        </article>

        <article ref="reminderManagementRef" class="action-card action-card--blue management-card">
          <div class="action-card__head">
            <div class="action-card__copy">
              <p class="section-eyebrow">提醒管理</p>
              <h3>管理提醒安排</h3>
              <p class="action-card__detail">和首页提醒列表、记录页反馈入口共用同一批提醒数据。</p>
            </div>
            <button type="button" class="action-card__button" @click="requestAdminAccess('reminder', () => openCreateEditor('reminder'))">新增</button>
          </div>

          <span class="action-card__helper">
            {{ isDemo ? (pendingReminderCount > 0 ? `当前仍有 ${pendingReminderCount} 项待执行` : '当前提醒执行相对稳定') : '管理计划；实例执行情况请查看首页' }}
          </span>

          <div class="management-list">
            <article v-for="item in reminders" :key="item.reminderId" class="management-item">
              <div class="management-item__copy">
                <strong>{{ item.title }}</strong>
                <p>{{ item.medicationNames.length ? item.medicationNames.join(' / ') : '未关联药物' }}</p>
                <p>{{ planSchedule(item) }} · {{ formatReminderStatusLabel(item.status) }}</p>
              </div>
              <p v-if="isDoctorManagedPlan(item)" class="section-note">医生管理的随访计划；请在首页回复，详情见风险页随访历史。</p>
              <div v-else class="management-item__actions">
                <button type="button" class="mini-button mini-button--ghost" @click="requestAdminAccess('reminder', () => openReminderEditor(item))">编辑</button>
                <button type="button" class="mini-button mini-button--danger" @click="requestAdminAccess('reminder', () => deleteReminder(item))">{{ isDemo ? '删除' : '暂停' }}</button>
              </div>
            </article>

            <div v-if="!reminders.length" class="management-empty">暂无提醒安排</div>
          </div>

          <p v-if="reminderMessage" class="inline-message">{{ reminderMessage }}</p>
        </article>
      </section>

      <section v-if="enableOverviewModules" class="glass-section portrait-panel">
        <div class="portrait-head">
          <div class="section-copy">
            <p class="section-eyebrow">用户画像</p>
            <h2 class="section-title">{{ isDemo ? '根据用户一周信息总结画像' : '近14天确认事实画像' }}</h2>
          </div>
          <button type="button" class="action-card__button" :disabled="!isDemo && analysisLoading" @click="generatePortraitSummary">{{ isDemo ? '生成用户画像' : '刷新用户画像' }}</button>
        </div>

        <template v-if="!isDemo">
          <p v-if="analysisSnapshot" class="section-note">运行 {{ analysisSnapshot.runId }} · 快照 {{ analysisSnapshot.snapshotId }} · 截至 {{ displayTime(analysisSnapshot.referenceTime) }} · 输入版本 {{ analysisSnapshot.inputRevision }} / 当前 {{ latestAnalysis?.inputRevision }}</p>
          <p v-if="analysisSnapshot && analysisSnapshot.inputRevision !== latestAnalysis?.inputRevision" class="section-note">这是历史输入的分析画像，最新记录等待分析。</p>
          <p v-if="analysisError" role="alert">{{ analysisError }}</p>
          <div v-if="realPortrait.length" class="portrait-list"><article v-for="item in realPortrait" :key="item" class="portrait-item"><p>{{ item }}</p></article></div>
          <div v-else class="portrait-empty"><strong>暂无已发布画像</strong><p>请先保存确认事实，等待分析完成。</p></div>
        </template>
        <template v-else-if="portraitLoading">
          <div class="portrait-empty">
            <strong>正在评估</strong>
            <p>正在根据用户一周信息评估风险与评分准则，请稍候。</p>
          </div>
        </template>

        <template v-else-if="portraitResult">
          <div class="portrait-list">
            <article v-for="item in portraitResult.paragraphs" :key="item" class="portrait-item">
              <p>{{ item }}</p>
            </article>
          </div>
        </template>

        <div v-else class="portrait-empty">
          <strong>画像尚未生成</strong>
          <p>真实画像尚未接入此区块；不会用模拟评语代替真实结果。</p>
        </div>
      </section>
    </template>

    <div v-if="passwordModalVisible" class="modal-mask" @click="closePasswordModal">
      <div class="modal-card" @click.stop>
        <div class="modal-head">
          <div>
            <h4>管理员验证</h4>
            <p>输入管理员密码后，才能新增提醒或用药安排。</p>
          </div>
          <button type="button" class="close-btn" @click="closePasswordModal">关闭</button>
        </div>

        <label class="field-block">
          <span class="field-label">管理员密码</span>
          <input v-model="passwordInput" type="password" class="input-surface" placeholder="请输入密码" />
        </label>

        <p v-if="passwordError" class="inline-message inline-message--error">{{ passwordError }}</p>

        <div class="inline-form__actions">
          <button type="button" class="mini-button" @click="confirmAdminPassword">确认</button>
        </div>
      </div>
    </div>

    <div v-if="managementModalVisible" class="modal-mask" @click="closeManagementModal">
      <div class="modal-card modal-card--editor" @click.stop>
        <div class="modal-head">
          <div>
            <h4>{{ managementDialogTitle }}</h4>
            <p>在弹窗里统一新增、编辑和管理当前项；历史记录保留。</p>
          </div>
          <button type="button" class="close-btn" @click="closeManagementModal">关闭</button>
        </div>

        <div class="inline-form__actions">
          <button v-if="!isDemo" type="button" class="mini-button mini-button--ghost" :disabled="saving" @click="loadPage">刷新管理数据</button>
          <button
            v-if="activeManagementCard"
            type="button"
            class="mini-button"
            @click="openCreateEditor(activeManagementCard)"
          >
            新增
          </button>
        </div>

        <div v-if="activeManagementCard === 'medication'" class="management-list management-list--modal">
          <article v-for="item in medications" :key="item.id" class="management-item">
            <div class="management-item__copy">
              <strong>{{ item.genericName }}</strong>
              <p>{{ item.brandName ? `${item.brandName} · ${item.dose}` : item.dose }}</p>
              <p>{{ formatFrequencyLabel(item.frequency) }} · {{ formatAdministrationTimeLabel(item.administrationTime) }}</p>
              <p v-if="!isDemo">{{ item.status === 'ACTIVE' ? '有效' : item.status === 'STOPPED' ? '已停用' : '已归档' }} · 版本 {{ wireMedications.find(m => m.id === item.id)?.version }}</p>
            </div>
            <div class="management-item__actions">
              <button type="button" class="mini-button mini-button--ghost" @click="openMedicationEditor(item)">编辑</button>
              <button type="button" class="mini-button mini-button--danger" @click="deleteMedication(item)">{{ isDemo ? '删除' : '停用' }}</button>
            </div>
          </article>

          <div v-if="!medications.length" class="management-empty">暂无用药安排</div>
        </div>

        <div v-else-if="activeManagementCard === 'reminder'" class="management-list management-list--modal">
          <article v-for="item in reminders" :key="item.reminderId" class="management-item">
            <div class="management-item__copy">
              <strong>{{ item.title }}</strong>
              <p>{{ item.medicationNames.length ? item.medicationNames.join(' / ') : '未关联药物' }}</p>
              <p>{{ planSchedule(item) }} · {{ formatReminderStatusLabel(item.status) }}</p>
            </div>
            <p v-if="isDoctorManagedPlan(item)" class="section-note">医生管理的随访计划；请在首页回复，详情见风险页随访历史。</p>
            <div v-else class="management-item__actions">
              <button type="button" class="mini-button mini-button--ghost" @click="openReminderEditor(item)">编辑</button>
              <button type="button" class="mini-button mini-button--danger" @click="deleteReminder(item)">{{ isDemo ? '删除' : '暂停' }}</button>
            </div>
          </article>

          <div v-if="!reminders.length" class="management-empty">暂无提醒安排</div>
        </div>
      </div>
    </div>

    <div v-if="editorModalVisible" class="modal-mask" @click="closeEditorModal">
      <div class="modal-card modal-card--editor" @click.stop>
        <div class="modal-head">
          <div>
            <h4>{{ editorDialogTitle }}</h4>
            <p>通过验证后在当前页面完成录入，不跳转其他页面。</p>
          </div>
          <button type="button" class="close-btn" @click="closeEditorModal">关闭</button>
        </div>

        <form v-if="activeEditor === 'medication'" class="inline-form inline-form--modal" @submit.prevent="submitMedicationDraft">
          <fieldset :disabled="saving || !writeAllowed" class="editor-fields">
          <label class="field-block">
            <span class="field-label">自然语言录入</span>
            <textarea
              v-model="medicationNaturalText"
              class="input-surface input-surface--textarea"
              placeholder="例如：早餐后吃一片代文 80mg，每天一次"
            />
          </label>

          <div class="inline-form__actions">
            <button type="button" class="mini-button mini-button--ghost" @click="simulateAiNormalize('medication')">
              {{ aiNormalizeLoading === 'medication' || captureBusy ? 'AI 标准化中...' : 'AI 标准化' }}
            </button>
          </div>

          <label class="field-block">
            <span class="field-label">上传药品图片</span>
            <div v-if="isNativeShell" class="inline-form__actions">
              <button type="button" class="mini-button mini-button--ghost" @click="openMedicationImagePicker('camera')">
                拍照上传
              </button>
              <button type="button" class="mini-button mini-button--ghost" @click="openMedicationImagePicker('gallery')">
                相册选择
              </button>
            </div>
            <input
              v-if="!isNativeShell"
              ref="medicationImageInput"
              type="file"
              accept="image/*"
              class="input-surface input-surface--file"
              @change="handleMedicationImageChange"
            />
            <template v-else>
              <input
                ref="medicationImageInput"
                type="file"
                accept="image/*"
                class="visually-hidden-input"
                @change="handleMedicationImageChange"
              />
              <input
                ref="medicationCameraInput"
                type="file"
                accept="image/*"
                capture="environment"
                class="visually-hidden-input"
                @change="handleMedicationImageChange"
              />
              <span class="field-hint">Android 内可直接拍照或从相册选择药品图片。</span>
            </template>
          </label>

          <div v-if="medicationImageName" class="image-upload-panel">
            <div class="image-upload-panel__meta">
              <strong>{{ medicationImageName }}</strong>
              <button type="button" class="mini-button mini-button--ghost" @click="recognizeMedicationImage">
                {{ medicationRecognitionLoading || captureBusy ? '识别中...' : '识别' }}
              </button>
            </div>
            <img
              v-if="medicationImagePreviewUrl"
              :src="medicationImagePreviewUrl"
              alt="药品上传预览"
              class="image-upload-panel__preview"
            />
          </div>

          <p v-if="medicationRecognitionMessage" class="inline-message">{{ medicationRecognitionMessage }}</p>
          <template v-if="!isDemo">
            <p v-if="captureMessage" class="inline-message" role="status" aria-live="polite">{{ captureMessage }}</p>
            <div v-if="captureBusy || captureTask" class="inline-form__actions">
              <button v-if="captureBusy || captureTask?.status === 'RUNNING' || captureTask?.status === 'PENDING'" type="button" class="mini-button mini-button--ghost" @click="capture.cancel()">取消采集</button>
              <button v-if="captureTask?.status === 'CANDIDATE_READY'" type="button" class="mini-button mini-button--ghost" :disabled="captureBusy" @click="capture.reject()">拒绝候选，手工填写</button>
            </div>
            <div v-if="captureTask?.status === 'CANDIDATE_READY'" class="image-upload-panel">
              <p class="field-hint">{{ captureTask.result?.rawText }} · {{ captureTask.result?.dictionaryVersion }}{{ captureTask.result?.engine === 'SYNTHETIC_REPLAY' ? ' · 合成回放' : '' }}</p>
              <div v-for="candidate in captureTask.result?.candidates" :key="candidate.code" class="field-block">
                <button type="button" class="mini-button mini-button--ghost" @click="medicationDraft = { ...medicationDraft, ...capture.select(candidate) }">选择 {{ candidate.genericName }} {{ candidate.brandName }}</button>
                <span class="field-hint">{{ candidate.strength }} · {{ candidate.method }} · {{ candidate.confidenceLevel }} · {{ candidate.explanation }}</span>
              </div>
            </div>
          </template>

          <label class="field-block">
            <span class="field-label">药品名称</span>
            <input v-model="medicationDraft.genericName" class="input-surface" placeholder="例如 二甲双胍片" />
          </label>

          <label class="field-block">
            <span class="field-label">商品名</span>
            <input v-model="medicationDraft.brandName" class="input-surface" placeholder="可选" />
          </label>

          <div class="field-row">
            <label class="field-block">
              <span class="field-label">剂量</span>
              <input v-model="medicationDraft.dose" class="input-surface" placeholder="例如 0.5g" />
            </label>

            <label class="field-block">
              <span class="field-label">频次</span>
              <select v-model="medicationDraft.frequency" class="input-surface">
                <option v-if="!['QD','BID','TID'].includes(medicationDraft.frequency)" :value="medicationDraft.frequency">{{ medicationDraft.frequency }}</option>
                <option value="QD">每日 1 次</option>
                <option value="BID">每日 2 次</option>
                <option value="TID">每日 3 次</option>
              </select>
            </label>
          </div>

          <label class="field-block">
            <span class="field-label">服药时点</span>
            <select v-model="medicationDraft.administrationTime" class="input-surface">
              <option v-if="!['AFTER_BREAKFAST','AFTER_BREAKFAST_AFTER_DINNER','BEFORE_MEAL'].includes(medicationDraft.administrationTime)" :value="medicationDraft.administrationTime">{{ medicationDraft.administrationTime }}</option>
              <option value="AFTER_BREAKFAST">早餐后</option>
              <option value="AFTER_BREAKFAST_AFTER_DINNER">早餐后 / 晚餐后</option>
              <option value="BEFORE_MEAL">餐前</option>
            </select>
          </label>

          <template v-if="!isDemo">
            <div class="field-row">
              <label class="field-block"><span class="field-label">开始日期（请确认）</span><input v-model="medicationDates.startDate" type="date" required class="input-surface" /></label>
              <label class="field-block"><span class="field-label">结束日期（可选）</span><input v-model="medicationDates.endDate" type="date" :min="medicationDates.startDate" class="input-surface" /></label>
            </div>
            <label class="field-block"><span class="field-label">药历状态</span><select v-model="medicationDates.status" class="input-surface"><option value="ACTIVE">有效</option><option value="STOPPED">停用</option><option value="ARCHIVED">归档</option></select></label>
            <p class="field-hint">{{ medicationVersion === null ? '新增药品不会自动创建提醒。' : `当前版本 ${medicationVersion}；停用/归档保留历史记录。` }}</p>
          </template>
          <p v-if="medicationMessage" role="alert" class="inline-message">{{ medicationMessage }}</p>
          <div class="inline-form__actions">
            <button type="submit" class="mini-button">{{ saving ? '保存中…' : editorDialogSubmitLabel }}</button>
          </div>
          </fieldset>
        </form>

        <form v-else-if="activeEditor === 'reminder'" class="inline-form inline-form--modal" @submit.prevent="submitReminderDraft">
          <fieldset :disabled="saving || !writeAllowed" class="editor-fields">
          <label class="field-block">
            <span class="field-label">自然语言录入</span>
            <textarea
              v-model="reminderNaturalText"
              class="input-surface input-surface--textarea"
              placeholder="例如：明早 8 点提醒患者早餐后服用代文，并观察头晕情况"
            />
          </label>

          <div class="inline-form__actions">
            <button type="button" class="mini-button mini-button--ghost" @click="simulateAiNormalize('reminder')">
              {{ aiNormalizeLoading === 'reminder' ? 'AI 标准化中...' : 'AI 标准化' }}
            </button>
          </div>

          <label class="field-block">
            <span class="field-label">提醒标题</span>
            <input v-model="reminderDraft.title" class="input-surface" placeholder="例如 晚间服药提醒" />
          </label>

          <label v-if="isDemo" class="field-block">
            <span class="field-label">提醒时间</span>
            <input v-model="reminderDraft.plannedAt" type="datetime-local" class="input-surface" />
          </label>

          <label v-if="isDemo" class="field-block">
            <span class="field-label">关联药物</span>
            <input v-model="reminderDraft.medicationName" class="input-surface" placeholder="可选" />
          </label>

          <label v-if="isDemo" class="field-block">
            <span class="field-label">补充说明</span>
            <textarea
              v-model="reminderDraft.followUpPrompt"
              class="input-surface input-surface--textarea"
              placeholder="例如 如有不适请立即反馈"
            />
          </label>

          <template v-if="!isDemo">
            <div class="field-row">
              <label class="field-block"><span class="field-label">计划频次</span><select v-model="planFields.frequency" class="input-surface"><option value="DAILY">每天</option><option value="ONCE">单次</option></select></label>
              <label class="field-block"><span class="field-label">提醒类型</span><select v-model="planFields.reminderType" class="input-surface"><option value="MEDICATION">用药</option><option value="BP">血压测量</option><option value="BG">血糖测量</option><option value="FOLLOW_UP">日常回访</option></select></label>
            </div>
            <label class="field-block"><span class="field-label">提醒时间（北京时间）</span><input v-model="planFields.localTime" type="time" required class="input-surface" /></label>
            <div class="field-row">
              <label class="field-block"><span class="field-label">计划开始日期</span><input v-model="planFields.startDate" type="date" required class="input-surface" /></label>
              <label class="field-block"><span class="field-label">计划结束日期（可选）</span><input v-model="planFields.endDate" type="date" :min="planFields.startDate" class="input-surface" /></label>
            </div>
            <fieldset class="field-block"><legend class="field-label">关联药品（用药提醒必选）</legend><label v-for="m in wireMedications.filter(m => m.status === 'ACTIVE' || planFields.medicationIds.includes(m.id))" :key="m.id"><input v-model="planFields.medicationIds" type="checkbox" :value="m.id" /> {{ m.genericName }} · {{ m.dose }}{{ m.status !== 'ACTIVE' ? '（已停用）' : '' }}</label></fieldset>
            <label class="field-block"><span class="field-label">计划状态</span><select v-model="planFields.status" class="input-surface"><option value="ACTIVE">启用</option><option value="PAUSED">暂停</option></select></label>
            <p class="field-hint">{{ planVersion === null ? '保存后由服务端生成提醒实例。' : `当前计划版本 ${planVersion}；暂停不会删除已发生的记录。` }}</p>
          </template>
          <p v-if="reminderMessage" role="alert" class="inline-message">{{ reminderMessage }}</p>
          <div class="inline-form__actions">
            <button type="submit" class="mini-button">{{ saving ? '保存中…' : editorDialogSubmitLabel }}</button>
          </div>
          </fieldset>
        </form>
      </div>
    </div>
    <slot name="page-footer" />
  </div>
</template>

<style scoped>
.editor-fields { border: 0; padding: 0; margin: 0; min-width: 0; display: grid; gap: 14px; }
button:disabled { opacity: .55; cursor: not-allowed; }
.profile-page {
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

.profile-page::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, rgba(241, 249, 255, 0.58) 0%, rgba(220, 237, 247, 0.42) 38%, rgba(200, 224, 238, 0.14) 68%, rgba(255, 255, 255, 0) 100%);
  pointer-events: none;
  z-index: 0;
}

.profile-page > * {
  position: relative;
  z-index: 1;
}

.glass-section {
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 20px;
  box-shadow: 0 8px 32px rgba(100, 150, 180, 0.15);
  margin-bottom: 16px;
  overflow: hidden;
}

.loading-panel {
  padding: 28px 16px;
  text-align: center;
  color: #4f697b;
}

.data-source-warning {
  margin: 12px 16px 0;
  padding: 10px 14px;
  border: 1px solid rgba(189, 140, 55, 0.32);
  border-radius: 12px;
  background: rgba(255, 248, 225, 0.86);
  color: #785d2b;
  font-size: 13px;
  line-height: 1.5;
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
}

.hero-copy,
.section-copy,
.overview-panel-head {
  display: grid;
  gap: 6px;
}

.hero-profile-card {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  grid-template-areas:
    'avatar meta'
    'summary summary';
  align-items: center;
  column-gap: 16px;
  row-gap: 10px;
  width: min(560px, 100%);
}

.hero-copy {
  max-width: none;
  gap: 12px;
}

.hero-meta {
  grid-area: meta;
  min-width: 0;
}

.hero-summary {
  grid-area: summary;
}

.hero-title-row {
  display: grid;
  gap: 8px;
}

.hero-name-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.hero-chip-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.hero-avatar {
  grid-area: avatar;
  width: 92px;
  height: 92px;
  border-radius: 999px;
  object-fit: cover;
  box-shadow: 0 10px 24px rgba(42, 77, 113, 0.16);
  border: 3px solid rgba(255, 255, 255, 0.82);
}

.patient-badge {
  margin: 0;
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.74);
  border: 1px solid rgba(132, 156, 174, 0.28);
  font-size: 11px;
  font-weight: 700;
  color: #5f7283;
}

.patient-name {
  margin: 0;
  font-size: 34px;
  font-weight: 900;
  line-height: 1;
  letter-spacing: -0.02em;
  color: #173f46;
}

.patient-age {
  font-size: 30px;
  line-height: 1;
  font-weight: 900;
  color: #ffffff;
  text-shadow: 0 4px 10px rgba(55, 87, 127, 0.2);
}

.patient-subtitle,
.section-note {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: rgba(31, 54, 70, 0.76);
}

.detail-strip {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 0 20px;
}

.detail-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
  color: #375268;
  font-size: 13px;
}

.detail-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: currentColor;
  box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.42);
}

.detail-item--green {
  color: #3f8a61;
}

.detail-item--orange {
  color: #db7a39;
}

.detail-item--blue {
  color: #5c7f98;
}

.section-eyebrow {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #6e88a0;
}

.section-eyebrow--light {
  color: rgba(241, 247, 255, 0.82);
}

.section-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #294a67;
}

.section-title--light {
  color: #f7fbff;
}

.overview-split {
  display: flex;
  align-items: stretch;
  gap: 14px;
  margin-bottom: 16px;
  width: 100%;
  min-width: 0;
}

.overview-left-card,
.overview-right-card {
  position: relative;
  overflow: hidden;
  border-radius: 28px;
  box-shadow: 0 18px 34px rgba(32, 61, 108, 0.16);
}

.overview-left-card {
  flex: 0 0 calc((100% - 14px) * 0.6);
  width: calc((100% - 14px) * 0.6);
  max-width: calc((100% - 14px) * 0.6);
  min-width: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  padding: 18px;
  background-color: #6e93c8;
  background-position: center;
  background-size: cover;
  background-repeat: no-repeat;
}

.overview-left-card > *,
.overview-right-card > * {
  position: relative;
  z-index: 1;
}

.overview-right-card {
  flex: 0 0 calc((100% - 14px) * 0.4);
  width: calc((100% - 14px) * 0.4);
  max-width: calc((100% - 14px) * 0.4);
  min-width: 0;
  display: grid;
  align-content: start;
  gap: 10px;
  padding: 16px 16px;
  background: rgba(255, 255, 255, 0.86);
  box-shadow: 0 10px 22px rgba(23, 53, 106, 0.12);
}

.overview-panel-head--right {
  justify-items: center;
  text-align: center;
}

.overview-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-auto-rows: minmax(126px, auto);
  gap: 10px;
  align-content: start;
}

.overview-metric {
  display: flex;
  align-items: stretch;
  padding: 12px;
  min-height: 126px;
  border-radius: 15px;
  border: 1px solid rgba(255, 255, 255, 0.24);
  color: #f6fbff;
  text-align: left;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease;
  opacity: 0.96;
}

.overview-metric:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 18px rgba(24, 53, 98, 0.16);
}

.overview-metric--green {
  background: linear-gradient(135deg, rgba(78, 146, 111, 0.62) 0%, rgba(40, 95, 74, 0.76) 100%);
}

.overview-metric--blue {
  background: linear-gradient(135deg, rgba(77, 132, 205, 0.62) 0%, rgba(52, 85, 145, 0.78) 100%);
}

.overview-metric--gold {
  background: linear-gradient(135deg, rgba(205, 167, 71, 0.66) 0%, rgba(147, 110, 34, 0.78) 100%);
}

.overview-metric--coral {
  background: linear-gradient(135deg, rgba(211, 123, 98, 0.66) 0%, rgba(160, 84, 67, 0.8) 100%);
}

.overview-metric strong {
  font-size: 18px;
  line-height: 1.1;
  word-break: break-word;
}

.overview-metric__icon-wrap {
  display: grid;
  flex: 1;
  grid-template-rows: auto minmax(0, 1fr);
  align-content: stretch;
  align-items: start;
  width: 100%;
  gap: 10px;
  min-height: 0;
}

.overview-metric__icon {
  width: 53px;
  height: 74px;
  object-fit: contain;
  flex: 0 0 auto;
  max-width: 100%;
}

.overview-metric p,
.overview-metric__label {
  margin: 0;
  color: rgba(246, 251, 255, 0.88);
}

.overview-metric__label {
  display: block;
  align-self: end;
  margin-top: auto;
  width: 100%;
  font-size: 18px;
  line-height: 1.08;
  font-weight: 800;
  letter-spacing: 0.01em;
  word-break: break-word;
}

.overview-metric p {
  font-size: 11px;
  line-height: 1.4;
  word-break: break-word;
}

.ring-chart-host {
  width: 148px;
  height: 148px;
  margin: 0 auto;
}

.score-panel {
  display: grid;
  gap: 4px;
  text-align: center;
}

.score-panel__eyebrow {
  font-size: 12px;
  font-weight: 700;
  color: #7e8fa3;
}

.score-panel p {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: #607688;
}

.score-breakdown {
  display: grid;
  gap: 8px;
}

.score-breakdown__item {
  display: grid;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 12px;
  background: rgba(95, 126, 151, 0.08);
  font-size: 12px;
  color: #5b7184;
  min-width: 0;
}

.score-breakdown__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.score-breakdown__top span {
  min-width: 0;
  flex: 1 1 auto;
  word-break: break-word;
}

.score-breakdown__value {
  font-size: 14px;
  font-weight: 800;
}

.score-breakdown__value--green {
  color: #2f7c55;
}

.score-breakdown__value--blue {
  color: #376eb0;
}

.score-breakdown__value--gold {
  color: #9a7625;
}

.score-breakdown__value--coral {
  color: #b15949;
}

.score-breakdown__track {
  width: 100%;
  height: 8px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(95, 126, 151, 0.14);
}

.score-breakdown__bar {
  height: 100%;
  border-radius: inherit;
}

.score-breakdown__bar--green {
  background: linear-gradient(90deg, #58a075 0%, #2f7c55 100%);
}

.score-breakdown__bar--blue {
  background: linear-gradient(90deg, #6aa4e6 0%, #376eb0 100%);
}

.score-breakdown__bar--gold {
  background: linear-gradient(90deg, #dbbe63 0%, #9a7625 100%);
}

.score-breakdown__bar--coral {
  background: linear-gradient(90deg, #e79a7c 0%, #b15949 100%);
}

.action-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 16px;
}

.action-grid--legacy {
  display: grid;
}

.action-grid--legacy .action-card__button {
  font-size: 0;
}

.action-grid--legacy .action-card__button::after {
  content: '管理';
  font-size: 14px;
}

.management-grid {
  display: none;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 16px;
}

.action-card {
  display: grid;
  gap: 14px;
  padding: 16px;
  border-radius: 24px;
  border: 1px solid rgba(255, 255, 255, 0.48);
  box-shadow: 0 10px 26px rgba(57, 87, 118, 0.12);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.action-card--green {
  background: radial-gradient(circle at top right, rgba(255, 255, 255, 0.26), transparent 32%), linear-gradient(135deg, rgba(87, 162, 134, 0.22) 0%, rgba(241, 250, 246, 0.86) 100%);
}

.action-card--blue {
  background: radial-gradient(circle at top right, rgba(255, 255, 255, 0.28), transparent 32%), linear-gradient(135deg, rgba(117, 157, 219, 0.2) 0%, rgba(244, 248, 255, 0.9) 100%);
}

.action-card__copy {
  display: grid;
  gap: 8px;
}

.action-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.action-card h3 {
  margin: 0;
  font-size: 16px;
  line-height: 1.08;
  color: #294a67;
}

.action-card__detail,
.action-card__helper,
.field-label,
.field-hint {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: #587284;
}

.field-hint {
  font-size: 12px;
}

.action-card__helper {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  width: fit-content;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.7);
  font-size: 12px;
  font-weight: 700;
}

.action-card__button,
.mini-button,
.close-btn {
  width: fit-content;
  min-height: 42px;
  padding: 0 16px;
  border: 0;
  border-radius: 14px;
  background: linear-gradient(135deg, #1d5961 0%, #2c838a 100%);
  color: #f5fbfa;
  font-weight: 700;
  cursor: pointer;
}

.mini-button--ghost {
  background: rgba(29, 89, 97, 0.12);
  color: #1d5961;
}

.mini-button--danger {
  background: rgba(177, 89, 73, 0.12);
  color: #9f4a3d;
}

.management-card {
  align-content: start;
}

.management-list {
  display: grid;
  gap: 10px;
}

.management-list--modal {
  max-height: 56vh;
  overflow-y: auto;
  padding-right: 4px;
}

.management-item {
  display: grid;
  gap: 10px;
  padding: 14px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.62);
  border: 1px solid rgba(255, 255, 255, 0.8);
}

.management-item__copy {
  display: grid;
  gap: 4px;
}

.management-item__copy strong {
  font-size: 15px;
  color: #28455d;
}

.management-item__copy p {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: #627b8d;
}

.management-item__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.management-empty {
  padding: 18px 14px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.5);
  color: #64808a;
  font-size: 13px;
  text-align: center;
}

.inline-form {
  display: grid;
  gap: 10px;
}

.inline-form--modal {
  padding-top: 4px;
}

.field-block {
  display: grid;
  gap: 6px;
}

.field-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.input-surface {
  width: 100%;
  min-height: 42px;
  padding: 0 12px;
  border: 1px solid rgba(31, 80, 85, 0.12);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.92);
  color: #173339;
}

.input-surface--textarea {
  min-height: 90px;
  padding: 12px;
  resize: vertical;
}

.input-surface--file {
  padding: 10px 12px;
}

.visually-hidden-input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.inline-message {
  margin: 0;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(41, 122, 101, 0.12);
  color: #246753;
  font-size: 12px;
  font-weight: 700;
}

.inline-message--error {
  background: rgba(217, 104, 84, 0.14);
  color: #a04639;
}

.inline-form__actions {
  display: flex;
  justify-content: flex-start;
  gap: 8px;
  flex-wrap: wrap;
}

.image-upload-panel {
  display: grid;
  gap: 10px;
  padding: 12px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.56);
  border: 1px solid rgba(31, 80, 85, 0.1);
}

.image-upload-panel__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.image-upload-panel__meta strong {
  color: #294a67;
  font-size: 13px;
  word-break: break-all;
}

.image-upload-panel__preview {
  width: 100%;
  max-height: 200px;
  object-fit: contain;
  border-radius: 14px;
  background: rgba(232, 241, 247, 0.72);
}

.portrait-panel {
  padding: 18px;
}

.portrait-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.portrait-empty {
  display: grid;
  gap: 8px;
  margin-top: 14px;
  padding: 18px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.46);
  color: #5d7486;
}

.portrait-empty strong {
  font-size: 18px;
  color: #294a67;
}

.portrait-empty p {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
}

.portrait-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}

.portrait-tag {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(87, 129, 168, 0.1);
  color: #49657a;
  font-size: 12px;
  font-weight: 700;
}

.portrait-list {
  display: grid;
  gap: 10px;
  margin-top: 16px;
}

.portrait-item {
  padding: 14px 16px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.46);
}

.portrait-item p {
  margin: 0;
  font-size: 14px;
  line-height: 1.8;
  color: #516975;
}

.modal-mask {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(88, 112, 126, 0.28);
  backdrop-filter: blur(4px);
}

.modal-card {
  width: min(420px, 100%);
  max-height: calc(100dvh - 32px);
  overflow-y: auto;
  overscroll-behavior: contain;
  display: grid;
  gap: 14px;
  padding: 18px;
  border-radius: 22px;
  background: rgba(248, 252, 251, 0.98);
  box-shadow: 0 20px 42px rgba(69, 96, 86, 0.22);
}

.modal-card--editor {
  width: min(520px, 100%);
}

.modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.modal-head > button {
  flex-shrink: 0;
  white-space: nowrap;
}

.modal-head h4 {
  margin: 0;
  font-size: 18px;
  color: #294a67;
}

.modal-head p {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: #5d7177;
}

@media (max-width: 640px) {
  .profile-page {
    padding: 10px 12px calc(var(--bottom-nav-height) + env(safe-area-inset-bottom, 0px));
  }

  .hero-panel {
    padding: 30px 0 0;
  }

  .hero-top {
    padding: 30px 14px 12px;
  }

  .detail-strip {
    padding: 0 14px;
  }

  .patient-name {
    font-size: 28px;
  }

  .hero-profile-card {
    grid-template-columns: 76px minmax(0, 1fr);
    gap: 10px;
  }

  .hero-avatar {
    width: 76px;
    height: 76px;
  }

  .patient-age {
    font-size: 24px;
  }

  .patient-subtitle,
  .section-note,
  .portrait-item p,
  .portrait-empty p {
    font-size: 13px;
  }

  .overview-card__content {
    grid-template-columns: minmax(0, 1fr) 132px;
    gap: 10px;
    padding: 14px;
  }

  .overview-metrics,
  .management-grid,
  .field-row {
    gap: 8px;
  }

  .overview-split {
    gap: 8px;
  }

  .overview-left-card {
    flex: 0 0 calc((100% - 8px) * 0.6);
    width: calc((100% - 8px) * 0.6);
    max-width: calc((100% - 8px) * 0.6);
    padding: 12px;
    gap: 8px;
  }

  .overview-right-card {
    flex: 0 0 calc((100% - 8px) * 0.4);
    width: calc((100% - 8px) * 0.4);
    max-width: calc((100% - 8px) * 0.4);
    padding: 12px 10px;
  }

  .overview-panel-head,
  .overview-panel-head--right {
    gap: 4px;
  }

  .ring-chart-host {
    width: 104px;
    height: 104px;
  }

  .overview-metric {
    padding: 10px;
    min-height: 112px;
  }

  .overview-metric__icon-wrap {
    gap: 8px;
  }

  .overview-metric__icon {
    width: 44px;
    height: 60px;
  }

  .overview-metric__label,
  .score-panel__eyebrow,
  .score-panel p,
  .score-breakdown__item,
  .score-breakdown__value {
    font-size: 10px;
  }

  .overview-metric__label {
    font-size: 14px;
    line-height: 1.15;
  }

  .score-breakdown__item {
    padding: 6px 8px;
    gap: 4px;
  }

  .action-card {
    padding: 14px;
  }

  .action-card h3 {
    font-size: 16px;
  }

  .portrait-head {
    flex-direction: column;
    align-items: flex-start;
  }

  .management-grid {
    grid-template-columns: 1fr;
  }

  .action-card__head {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>

<style scoped>
/* Compact the existing header and the two original overview cards. */
.profile-page .hero-panel { padding-top: 12px; }
.profile-page .hero-top { padding: 12px 8px 10px; }
.profile-page .overview-split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; gap: 10px; }
.profile-page :is(.overview-left-card, .overview-right-card) { width: auto; max-width: none; min-width: 0; padding: 12px; gap: 8px; border-radius: 22px; }
.profile-page .overview-left-card { grid-template-rows: auto auto; }
.profile-page .overview-metrics { grid-auto-rows: auto; gap: 8px; }
.profile-page .overview-metric { min-height: 78px; padding: 8px; }
.profile-page .overview-metric__icon-wrap { grid-template-rows: 36px auto; gap: 6px; align-content: start; }
.profile-page .overview-metric__icon { width: 32px; height: 36px; }
.profile-page .overview-metric__label { font-size: 12px; line-height: 1.4; }
.profile-page .ring-chart-host.management-empty { width: auto; height: auto; min-height: 0; padding: 8px; font-size: 12px; line-height: 1.6; background: #f0f5f8; border-radius: 12px; }
.profile-page .score-panel { gap: 2px; }
.profile-page .score-breakdown { gap: 6px; }
.profile-page .score-breakdown__item { padding: 6px; }
.profile-page .score-breakdown__top { gap: 4px; }
.profile-page .score-breakdown__track { height: 5px; }
.profile-page .overview-right-card .action-card__button { padding: 7px 10px; min-height: 32px; font-size: 12px; }
.profile-page .overview-right-card .section-note { font-size: 11px; }
</style>
