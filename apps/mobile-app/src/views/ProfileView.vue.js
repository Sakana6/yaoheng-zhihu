import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as echarts from 'echarts/core';
import { PieChart } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { useRouter } from 'vue-router';
import { mobileApi } from '../lib/api';
import { formatReviewPriority } from '../lib/format';
import { useMvpStore } from '../stores/mvp';
import feedbackIcon from '../static/icon/feedback.png';
import medicineIcon from '../static/icon/medicine.png';
import recordIcon from '../static/icon/record.png';
import riskIcon from '../static/icon/risk.png';
import homeCardBg from '../static/pictures/home-card.jpg';
import patientAvatar from '../static/pictures/温暖微笑的老人肖像.png';
echarts.use([PieChart, TooltipComponent, CanvasRenderer]);
const ADMIN_PASSWORD = '123456';
const router = useRouter();
const mvpStore = useMvpStore();
const pageTitle = '联合治疗管理';
const pageSubtitle = '围绕高血压与糖尿病联合治疗，集中管理用药安排、提醒任务和随访节奏。';
const enableOverviewModules = true;
const loading = ref(true);
const error = ref('');
const patient = ref(null);
const risk = ref(null);
const medications = ref([]);
const reminders = ref([]);
const jointEvents = ref([]);
const medicationManagementRef = ref(null);
const reminderManagementRef = ref(null);
const ringChartHost = ref(null);
let ringChart = null;
const passwordModalVisible = ref(false);
const managementModalVisible = ref(false);
const editorModalVisible = ref(false);
const pendingCard = ref(null);
const activeEditor = ref(null);
const activeManagementCard = ref(null);
const editorMode = ref('create');
const editingMedicationId = ref(null);
const editingReminderId = ref(null);
const passwordInput = ref('');
const passwordError = ref('');
const medicationMessage = ref('');
const reminderMessage = ref('');
const portraitResult = ref(null);
const portraitLoading = ref(false);
const aiNormalizeLoading = ref(null);
let portraitTimer = null;
let aiNormalizeTimer = null;
let pendingAdminAction = null;
const verifiedCards = ref({
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
function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}
function getFallbackPatient() {
    return {
        userId: 1,
        role: 'CAREGIVER',
        patientId: 1,
        patientName: '当前患者',
    };
}
function getFallbackRisk() {
    return {
        deintensificationScore: 82,
        interactionScore: 32,
        behaviorScore: 61,
        jointEventScore: 88,
        reviewPriority: 'CLINIC_REVIEW',
        reasons: ['晨间餐药配合不稳定', '近期存在联合事件信号', '需要补齐关键反馈窗口'],
    };
}
function isReminderCompleted(item) {
    return item.status === 'SUCCESS' || item.status === 'DONE';
}
function getScoreLabel(score) {
    if (score >= 80)
        return '高风险';
    if (score >= 60)
        return '重点观察';
    if (score >= 40)
        return '轻度波动';
    return '相对平稳';
}
function getTodayDateKey() {
    return new Date().toISOString().slice(0, 10);
}
function toIsoString(value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}
function cloneMedication(item) {
    return { ...item };
}
function cloneReminder(item) {
    return {
        ...item,
        medicationIds: [...item.medicationIds],
        medicationNames: [...item.medicationNames],
    };
}
function syncLocalMedications(next) {
    medications.value = next.map(cloneMedication);
}
function syncLocalReminders(next) {
    reminders.value = next.map(cloneReminder);
}
function toDateTimeLocalValue(value) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return '';
    }
    const offset = parsed.getTimezoneOffset() * 60 * 1000;
    return new Date(parsed.getTime() - offset).toISOString().slice(0, 16);
}
function formatReminderSchedule(value) {
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
function formatFrequencyLabel(value) {
    const labels = {
        QD: '每日 1 次',
        BID: '每日 2 次',
        TID: '每日 3 次',
    };
    return labels[value] ?? value;
}
function formatAdministrationTimeLabel(value) {
    const labels = {
        AFTER_BREAKFAST: '早餐后',
        AFTER_BREAKFAST_AFTER_DINNER: '早晚餐后',
        BEFORE_MEAL: '餐前',
    };
    return labels[value] ?? value;
}
function formatReminderStatusLabel(status) {
    return status === 'SUCCESS' || status === 'DONE' ? '已完成' : '待执行';
}
function buildReminderMedicationPayload(name) {
    const normalized = name.trim();
    if (!normalized) {
        return {
            medicationIds: [],
            medicationNames: [],
        };
    }
    const matchedMedication = medications.value.find((item) => item.genericName === normalized || item.brandName === normalized);
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
    managementModalVisible.value = false;
    activeManagementCard.value = null;
}
function closeEditorModal() {
    editorModalVisible.value = false;
    activeEditor.value = null;
    aiNormalizeLoading.value = null;
    editorMode.value = 'create';
    editingMedicationId.value = null;
    editingReminderId.value = null;
}
function openEditorModal(card) {
    activeEditor.value = card;
    editorModalVisible.value = true;
}
function openManagementModal(card) {
    activeManagementCard.value = card;
    managementModalVisible.value = true;
}
function openCreateEditor(card) {
    editorMode.value = 'create';
    if (card === 'medication') {
        resetMedicationDraft();
    }
    else {
        resetReminderDraft();
    }
    openEditorModal(card);
}
function openMedicationEditor(item) {
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
    openEditorModal('medication');
}
function openReminderEditor(item) {
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
function requestAdminAccess(card, action) {
    medicationMessage.value = '';
    reminderMessage.value = '';
    const resolvedAction = action ?? (() => openManagementModal(card));
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
function submitMedicationDraft() {
    if (!medicationDraft.value.genericName.trim() || !medicationDraft.value.dose.trim()) {
        medicationMessage.value = '请至少填写药品名称和剂量。';
        return;
    }
    const medicationPayload = {
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
        mvpStore.updateMedication({
            ...medicationPayload,
            startDate: existingMedication?.startDate ?? medicationPayload.startDate,
            status: existingMedication?.status ?? medicationPayload.status,
        });
    }
    else {
        mvpStore.addMedication(medicationPayload);
    }
    syncLocalMedications(mvpStore.state.medications);
    syncLocalReminders(mvpStore.state.reminders);
    medicationMessage.value = '用药安排已添加。';
    medicationMessage.value =
        editorMode.value === 'edit' ? '已更新用药安排。' : '已新增用药安排。';
    resetMedicationDraft();
    closeEditorModal();
}
function submitReminderDraft() {
    if (!reminderDraft.value.title.trim() || !reminderDraft.value.plannedAt.trim()) {
        reminderMessage.value = '请至少填写提醒标题和提醒时间。';
        return;
    }
    const reminderLinks = buildReminderMedicationPayload(reminderDraft.value.medicationName);
    const reminderPayload = {
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
        mvpStore.updateReminder({
            ...reminderPayload,
            status: existingReminder?.status ?? reminderPayload.status,
            reminderType: existingReminder?.reminderType ?? reminderPayload.reminderType,
        });
    }
    else {
        mvpStore.addReminder(reminderPayload);
    }
    syncLocalReminders(mvpStore.state.reminders);
    reminderMessage.value = '提醒安排已添加。';
    reminderMessage.value =
        editorMode.value === 'edit' ? '已更新提醒安排。' : '已新增提醒安排。';
    resetReminderDraft();
    closeEditorModal();
}
function deleteMedication(item) {
    if (typeof window !== 'undefined' && !window.confirm(`确认删除 ${item.genericName} 吗？`)) {
        return;
    }
    mvpStore.deleteMedication(item.id);
    syncLocalMedications(mvpStore.state.medications);
    syncLocalReminders(mvpStore.state.reminders);
    medicationMessage.value = '已删除用药安排。';
}
function deleteReminder(item) {
    if (typeof window !== 'undefined' && !window.confirm(`确认删除 ${item.title} 吗？`)) {
        return;
    }
    mvpStore.deleteReminder(item.reminderId);
    syncLocalReminders(mvpStore.state.reminders);
    reminderMessage.value = '已删除提醒安排。';
}
function simulateAiNormalize(card) {
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
        }
        else {
            const planned = new Date();
            planned.setHours(8, 30, 0, 0);
            reminderDraft.value = {
                title: '早餐后服药提醒',
                plannedAt: planned.toISOString().slice(0, 16),
                medicationName: '缬沙坦',
                followUpPrompt: '如有头晕或乏力，请及时反馈。',
            };
        }
        aiNormalizeLoading.value = null;
    }, 900);
}
const resolvedPatient = computed(() => patient.value ?? getFallbackPatient());
const resolvedRisk = computed(() => risk.value ?? getFallbackRisk());
const patientName = computed(() => resolvedPatient.value.patientName || '当前患者');
const completedReminderCount = computed(() => reminders.value.filter(isReminderCompleted).length);
const reminderTotalCount = computed(() => reminders.value.length || Math.max(medications.value.length, 1));
const pendingReminderCount = computed(() => Math.max(reminderTotalCount.value - completedReminderCount.value, 0));
const feedbackCount = computed(() => completedReminderCount.value);
const eventCount = computed(() => jointEvents.value.length);
const overallScore = computed(() => {
    const currentRisk = resolvedRisk.value;
    const weighted = currentRisk.deintensificationScore * 0.26 +
        currentRisk.interactionScore * 0.16 +
        currentRisk.behaviorScore * 0.24 +
        currentRisk.jointEventScore * 0.34;
    return clamp(Math.round(weighted), 0, 100);
});
const priorityMeta = computed(() => formatReviewPriority(resolvedRisk.value.reviewPriority));
const patientAge = computed(() => 72);
const patientBaseTags = computed(() => ['高血压', '糖尿病', '联合治疗']);
const patientIntro = computed(() => {
    return `当前页面只保留两病联合治疗相关管理能力，用于统一维护降压药、降糖药、复测提醒和症状回访。`;
});
const overviewMetrics = computed(() => [
    { id: 'medication', label: '今日用药', value: `${completedReminderCount.value}/${reminderTotalCount.value}`, detail: '点击查看药历', tone: 'green', route: '/medications' },
    { id: 'event', label: '事件数', value: String(eventCount.value), detail: '点击查看风险事件', tone: 'coral', route: '/joint-events' },
    { id: 'feedback', label: '反馈数', value: String(feedbackCount.value), detail: '点击查看反馈记录', tone: 'blue', route: '/records' },
    { id: 'risk', label: '风险等级', value: getScoreLabel(overallScore.value), detail: '点击查看风险判断', tone: 'gold', route: '/risk' },
]);
const quickAccessMetrics = computed(() => [
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
        label: '风险总分',
        value: String(overallScore.value),
        detail: priorityMeta.value.label,
        tone: 'gold',
        icon: riskIcon,
        route: '/risk',
    },
]);
const scoreBreakdown = computed(() => [
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
const managementDialogTitle = computed(() => activeManagementCard.value === 'medication' ? '用药管理' : '提醒管理');
const ringOption = computed(() => ({
    animationDuration: 420,
    tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(28, 45, 66, 0.92)',
        borderWidth: 0,
        textStyle: { color: '#eef5ff' },
        formatter: ({ name, value }) => `${name}: ${value}`,
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
    loading.value = true;
    error.value = '';
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
        risk.value = mvpStore.state.risk ?? (riskRes.status === 'fulfilled' ? riskRes.value : getFallbackRisk());
        medications.value = mvpStore.state.medications.length ? mvpStore.state.medications : loadedMedications;
        reminders.value = mvpStore.state.reminders.length ? mvpStore.state.reminders : loadedReminders;
        jointEvents.value = mvpStore.state.jointEvents.length
            ? mvpStore.state.jointEvents
            : jointEventRes.status === 'fulfilled'
                ? jointEventRes.value.jointEvents
                : [];
        if (!mvpStore.state.medications.length && loadedMedications.length) {
            mvpStore.syncMedicationData(loadedMedications, loadedReminders);
        }
        const failedCount = [patientRes, riskRes, medicationRes, reminderRes, jointEventRes].filter((item) => item.status === 'rejected').length;
        if (failedCount === 5) {
            error.value = '联合治疗管理页面加载失败';
        }
    }
    catch (err) {
        error.value = err instanceof Error ? err.message : '联合治疗管理页面加载失败';
    }
    finally {
        loading.value = false;
    }
}
function renderRingChart() {
    if (loading.value || error.value || !ringChartHost.value)
        return;
    if (!ringChart)
        ringChart = echarts.init(ringChartHost.value);
    ringChart.setOption(ringOption.value, true);
}
function resizeChart() {
    ringChart?.resize();
}
function scrollToManagement(card) {
    const target = card === 'medication' ? medicationManagementRef.value : reminderManagementRef.value;
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function handleQuickAccess(item) {
    if (item.targetCard) {
        requestAdminAccess(item.targetCard, () => openManagementModal(item.targetCard));
        return;
    }
    if (item.route) {
        void router.push(item.route);
    }
}
onMounted(async () => {
    window.addEventListener('resize', resizeChart);
    await loadPage();
});
onBeforeUnmount(() => {
    window.removeEventListener('resize', resizeChart);
    ringChart?.dispose();
    ringChart = null;
    if (portraitTimer) {
        window.clearTimeout(portraitTimer);
    }
    if (aiNormalizeTimer) {
        window.clearTimeout(aiNormalizeTimer);
    }
});
watch([loading, error], async () => {
    await nextTick();
    renderRingChart();
});
watch(overallScore, async () => {
    await nextTick();
    renderRingChart();
});
watch(() => mvpStore.state.medications, (next) => {
    syncLocalMedications(next);
}, { deep: true });
watch(() => mvpStore.state.reminders, (next) => {
    syncLocalReminders(next);
}, { deep: true });
const __VLS_ctx = {
    ...{},
    ...{},
};
let __VLS_components;
let __VLS_intrinsics;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['profile-page']} */ ;
/** @type {__VLS_StyleScopedClasses['profile-page']} */ ;
/** @type {__VLS_StyleScopedClasses['hero-copy']} */ ;
/** @type {__VLS_StyleScopedClasses['overview-left-card']} */ ;
/** @type {__VLS_StyleScopedClasses['overview-left-card']} */ ;
/** @type {__VLS_StyleScopedClasses['overview-right-card']} */ ;
/** @type {__VLS_StyleScopedClasses['overview-right-card']} */ ;
/** @type {__VLS_StyleScopedClasses['overview-metric']} */ ;
/** @type {__VLS_StyleScopedClasses['overview-metric']} */ ;
/** @type {__VLS_StyleScopedClasses['overview-metric']} */ ;
/** @type {__VLS_StyleScopedClasses['overview-metric__label']} */ ;
/** @type {__VLS_StyleScopedClasses['overview-metric']} */ ;
/** @type {__VLS_StyleScopedClasses['score-panel']} */ ;
/** @type {__VLS_StyleScopedClasses['score-breakdown__top']} */ ;
/** @type {__VLS_StyleScopedClasses['action-grid--legacy']} */ ;
/** @type {__VLS_StyleScopedClasses['action-grid--legacy']} */ ;
/** @type {__VLS_StyleScopedClasses['action-card__button']} */ ;
/** @type {__VLS_StyleScopedClasses['action-card']} */ ;
/** @type {__VLS_StyleScopedClasses['action-card__helper']} */ ;
/** @type {__VLS_StyleScopedClasses['action-card__button']} */ ;
/** @type {__VLS_StyleScopedClasses['management-item__copy']} */ ;
/** @type {__VLS_StyleScopedClasses['management-item__copy']} */ ;
/** @type {__VLS_StyleScopedClasses['portrait-empty']} */ ;
/** @type {__VLS_StyleScopedClasses['portrait-empty']} */ ;
/** @type {__VLS_StyleScopedClasses['portrait-item']} */ ;
/** @type {__VLS_StyleScopedClasses['modal-head']} */ ;
/** @type {__VLS_StyleScopedClasses['modal-head']} */ ;
/** @type {__VLS_StyleScopedClasses['profile-page']} */ ;
/** @type {__VLS_StyleScopedClasses['hero-panel']} */ ;
/** @type {__VLS_StyleScopedClasses['hero-top']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-strip']} */ ;
/** @type {__VLS_StyleScopedClasses['patient-name']} */ ;
/** @type {__VLS_StyleScopedClasses['hero-profile-card']} */ ;
/** @type {__VLS_StyleScopedClasses['hero-avatar']} */ ;
/** @type {__VLS_StyleScopedClasses['patient-age']} */ ;
/** @type {__VLS_StyleScopedClasses['patient-subtitle']} */ ;
/** @type {__VLS_StyleScopedClasses['section-note']} */ ;
/** @type {__VLS_StyleScopedClasses['portrait-item']} */ ;
/** @type {__VLS_StyleScopedClasses['portrait-empty']} */ ;
/** @type {__VLS_StyleScopedClasses['overview-metrics']} */ ;
/** @type {__VLS_StyleScopedClasses['management-grid']} */ ;
/** @type {__VLS_StyleScopedClasses['field-row']} */ ;
/** @type {__VLS_StyleScopedClasses['overview-split']} */ ;
/** @type {__VLS_StyleScopedClasses['overview-left-card']} */ ;
/** @type {__VLS_StyleScopedClasses['overview-right-card']} */ ;
/** @type {__VLS_StyleScopedClasses['overview-panel-head']} */ ;
/** @type {__VLS_StyleScopedClasses['overview-panel-head--right']} */ ;
/** @type {__VLS_StyleScopedClasses['ring-chart-host']} */ ;
/** @type {__VLS_StyleScopedClasses['overview-metric']} */ ;
/** @type {__VLS_StyleScopedClasses['overview-metric__icon-wrap']} */ ;
/** @type {__VLS_StyleScopedClasses['overview-metric__icon']} */ ;
/** @type {__VLS_StyleScopedClasses['overview-metric__label']} */ ;
/** @type {__VLS_StyleScopedClasses['score-panel__eyebrow']} */ ;
/** @type {__VLS_StyleScopedClasses['score-panel']} */ ;
/** @type {__VLS_StyleScopedClasses['score-breakdown__item']} */ ;
/** @type {__VLS_StyleScopedClasses['score-breakdown__value']} */ ;
/** @type {__VLS_StyleScopedClasses['overview-metric__label']} */ ;
/** @type {__VLS_StyleScopedClasses['score-breakdown__item']} */ ;
/** @type {__VLS_StyleScopedClasses['action-card']} */ ;
/** @type {__VLS_StyleScopedClasses['action-card']} */ ;
/** @type {__VLS_StyleScopedClasses['portrait-head']} */ ;
/** @type {__VLS_StyleScopedClasses['management-grid']} */ ;
/** @type {__VLS_StyleScopedClasses['action-card__head']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "mobile-page profile-page" },
});
/** @type {__VLS_StyleScopedClasses['mobile-page']} */ ;
/** @type {__VLS_StyleScopedClasses['profile-page']} */ ;
if (__VLS_ctx.loading) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "glass-section loading-panel" },
    });
    /** @type {__VLS_StyleScopedClasses['glass-section']} */ ;
    /** @type {__VLS_StyleScopedClasses['loading-panel']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
}
else if (__VLS_ctx.error) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "glass-section loading-panel" },
    });
    /** @type {__VLS_StyleScopedClasses['glass-section']} */ ;
    /** @type {__VLS_StyleScopedClasses['loading-panel']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    (__VLS_ctx.error);
}
else {
    __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "hero-panel" },
    });
    /** @type {__VLS_StyleScopedClasses['hero-panel']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "hero-top" },
    });
    /** @type {__VLS_StyleScopedClasses['hero-top']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "hero-profile-card" },
    });
    /** @type {__VLS_StyleScopedClasses['hero-profile-card']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.img)({
        ...{ class: "hero-avatar" },
        src: (__VLS_ctx.patientAvatar),
        alt: "患者头像",
    });
    /** @type {__VLS_StyleScopedClasses['hero-avatar']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "hero-meta" },
    });
    /** @type {__VLS_StyleScopedClasses['hero-meta']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "hero-title-row" },
    });
    /** @type {__VLS_StyleScopedClasses['hero-title-row']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "hero-name-row" },
    });
    /** @type {__VLS_StyleScopedClasses['hero-name-row']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.h1, __VLS_intrinsics.h1)({
        ...{ class: "patient-name" },
    });
    /** @type {__VLS_StyleScopedClasses['patient-name']} */ ;
    (__VLS_ctx.patientName);
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "patient-age" },
    });
    /** @type {__VLS_StyleScopedClasses['patient-age']} */ ;
    (__VLS_ctx.patientAge);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "hero-chip-row" },
    });
    /** @type {__VLS_StyleScopedClasses['hero-chip-row']} */ ;
    for (const [tag] of __VLS_vFor((__VLS_ctx.patientBaseTags))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            key: (tag),
            ...{ class: "patient-badge" },
        });
        /** @type {__VLS_StyleScopedClasses['patient-badge']} */ ;
        (tag);
        // @ts-ignore
        [loading, error, error, patientAvatar, patientName, patientAge, patientBaseTags,];
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
        ...{ class: "patient-subtitle hero-summary" },
    });
    /** @type {__VLS_StyleScopedClasses['patient-subtitle']} */ ;
    /** @type {__VLS_StyleScopedClasses['hero-summary']} */ ;
    (__VLS_ctx.patientIntro);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "detail-strip" },
    });
    /** @type {__VLS_StyleScopedClasses['detail-strip']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "detail-item detail-item--green" },
    });
    /** @type {__VLS_StyleScopedClasses['detail-item']} */ ;
    /** @type {__VLS_StyleScopedClasses['detail-item--green']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "detail-dot" },
    });
    /** @type {__VLS_StyleScopedClasses['detail-dot']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    (__VLS_ctx.completedReminderCount);
    (__VLS_ctx.reminderTotalCount);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "detail-item detail-item--orange" },
    });
    /** @type {__VLS_StyleScopedClasses['detail-item']} */ ;
    /** @type {__VLS_StyleScopedClasses['detail-item--orange']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "detail-dot" },
    });
    /** @type {__VLS_StyleScopedClasses['detail-dot']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    (__VLS_ctx.priorityMeta.label);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "detail-item detail-item--blue" },
    });
    /** @type {__VLS_StyleScopedClasses['detail-item']} */ ;
    /** @type {__VLS_StyleScopedClasses['detail-item--blue']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "detail-dot" },
    });
    /** @type {__VLS_StyleScopedClasses['detail-dot']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    (__VLS_ctx.eventCount);
    (__VLS_ctx.pendingReminderCount);
    if (__VLS_ctx.enableOverviewModules) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "overview-split" },
        });
        /** @type {__VLS_StyleScopedClasses['overview-split']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
            ...{ class: "overview-left-card" },
            ...{ style: ({ backgroundImage: `linear-gradient(145deg, rgba(92, 133, 196, 0.42), rgba(58, 96, 164, 0.48)), url(${__VLS_ctx.homeCardBg})` }) },
        });
        /** @type {__VLS_StyleScopedClasses['overview-left-card']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "overview-panel-head" },
        });
        /** @type {__VLS_StyleScopedClasses['overview-panel-head']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "section-eyebrow section-eyebrow--light" },
        });
        /** @type {__VLS_StyleScopedClasses['section-eyebrow']} */ ;
        /** @type {__VLS_StyleScopedClasses['section-eyebrow--light']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({
            ...{ class: "section-title section-title--light" },
        });
        /** @type {__VLS_StyleScopedClasses['section-title']} */ ;
        /** @type {__VLS_StyleScopedClasses['section-title--light']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "overview-metrics" },
        });
        /** @type {__VLS_StyleScopedClasses['overview-metrics']} */ ;
        for (const [item] of __VLS_vFor((__VLS_ctx.quickAccessMetrics))) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (...[$event]) => {
                        if (!!(__VLS_ctx.loading))
                            return;
                        if (!!(__VLS_ctx.error))
                            return;
                        if (!(__VLS_ctx.enableOverviewModules))
                            return;
                        __VLS_ctx.handleQuickAccess(item);
                        // @ts-ignore
                        [patientIntro, completedReminderCount, reminderTotalCount, priorityMeta, eventCount, pendingReminderCount, enableOverviewModules, homeCardBg, quickAccessMetrics, handleQuickAccess,];
                    } },
                key: (item.id),
                type: "button",
                ...{ class: (['overview-metric', `overview-metric--${item.tone}`]) },
            });
            /** @type {__VLS_StyleScopedClasses['overview-metric']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "overview-metric__icon-wrap" },
            });
            /** @type {__VLS_StyleScopedClasses['overview-metric__icon-wrap']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.img)({
                ...{ class: "overview-metric__icon" },
                src: (item.icon),
                alt: (item.label),
            });
            /** @type {__VLS_StyleScopedClasses['overview-metric__icon']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: "overview-metric__label" },
            });
            /** @type {__VLS_StyleScopedClasses['overview-metric__label']} */ ;
            (item.label);
            // @ts-ignore
            [];
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
            ...{ class: "overview-right-card" },
        });
        /** @type {__VLS_StyleScopedClasses['overview-right-card']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "overview-panel-head overview-panel-head--right" },
        });
        /** @type {__VLS_StyleScopedClasses['overview-panel-head']} */ ;
        /** @type {__VLS_StyleScopedClasses['overview-panel-head--right']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "section-eyebrow" },
        });
        /** @type {__VLS_StyleScopedClasses['section-eyebrow']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({
            ...{ class: "section-title" },
        });
        /** @type {__VLS_StyleScopedClasses['section-title']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ref: "ringChartHost",
            ...{ class: "ring-chart-host" },
        });
        /** @type {__VLS_StyleScopedClasses['ring-chart-host']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "score-panel" },
        });
        /** @type {__VLS_StyleScopedClasses['score-panel']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "score-panel__eyebrow" },
        });
        /** @type {__VLS_StyleScopedClasses['score-panel__eyebrow']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (__VLS_ctx.getScoreLabel(__VLS_ctx.overallScore));
        (__VLS_ctx.priorityMeta.label);
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "score-breakdown" },
        });
        /** @type {__VLS_StyleScopedClasses['score-breakdown']} */ ;
        for (const [item] of __VLS_vFor((__VLS_ctx.scoreBreakdown))) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                key: (item.label),
                ...{ class: "score-breakdown__item" },
            });
            /** @type {__VLS_StyleScopedClasses['score-breakdown__item']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "score-breakdown__top" },
            });
            /** @type {__VLS_StyleScopedClasses['score-breakdown__top']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            (item.label);
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({
                ...{ class: (`score-breakdown__value score-breakdown__value--${item.tone}`) },
            });
            (item.score);
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "score-breakdown__track" },
            });
            /** @type {__VLS_StyleScopedClasses['score-breakdown__track']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: (`score-breakdown__bar score-breakdown__bar--${item.tone}`) },
                ...{ style: ({ width: `${item.score}%` }) },
            });
            // @ts-ignore
            [priorityMeta, getScoreLabel, overallScore, scoreBreakdown,];
        }
    }
    if (__VLS_ctx.enableOverviewModules) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "action-grid action-grid--legacy" },
        });
        /** @type {__VLS_StyleScopedClasses['action-grid']} */ ;
        /** @type {__VLS_StyleScopedClasses['action-grid--legacy']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
            ...{ class: "action-card action-card--green" },
        });
        /** @type {__VLS_StyleScopedClasses['action-card']} */ ;
        /** @type {__VLS_StyleScopedClasses['action-card--green']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "action-card__copy" },
        });
        /** @type {__VLS_StyleScopedClasses['action-card__copy']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "section-eyebrow" },
        });
        /** @type {__VLS_StyleScopedClasses['section-eyebrow']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "action-card__detail" },
        });
        /** @type {__VLS_StyleScopedClasses['action-card__detail']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "action-card__helper" },
        });
        /** @type {__VLS_StyleScopedClasses['action-card__helper']} */ ;
        (__VLS_ctx.medications.length ? `当前已管理 ${__VLS_ctx.medications.length} 种药物` : '当前还没有完整药历');
        if (__VLS_ctx.medicationMessage) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
                ...{ class: "inline-message" },
            });
            /** @type {__VLS_StyleScopedClasses['inline-message']} */ ;
            (__VLS_ctx.medicationMessage);
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.loading))
                        return;
                    if (!!(__VLS_ctx.error))
                        return;
                    if (!(__VLS_ctx.enableOverviewModules))
                        return;
                    __VLS_ctx.requestAdminAccess('medication');
                    // @ts-ignore
                    [enableOverviewModules, medications, medications, medicationMessage, medicationMessage, requestAdminAccess,];
                } },
            type: "button",
            ...{ class: "action-card__button" },
        });
        /** @type {__VLS_StyleScopedClasses['action-card__button']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
            ...{ class: "action-card action-card--blue" },
        });
        /** @type {__VLS_StyleScopedClasses['action-card']} */ ;
        /** @type {__VLS_StyleScopedClasses['action-card--blue']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "action-card__copy" },
        });
        /** @type {__VLS_StyleScopedClasses['action-card__copy']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "section-eyebrow" },
        });
        /** @type {__VLS_StyleScopedClasses['section-eyebrow']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "action-card__detail" },
        });
        /** @type {__VLS_StyleScopedClasses['action-card__detail']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "action-card__helper" },
        });
        /** @type {__VLS_StyleScopedClasses['action-card__helper']} */ ;
        (__VLS_ctx.pendingReminderCount > 0 ? `当前仍有 ${__VLS_ctx.pendingReminderCount} 个提醒待完成` : '当前提醒执行相对稳定');
        if (__VLS_ctx.reminderMessage) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
                ...{ class: "inline-message" },
            });
            /** @type {__VLS_StyleScopedClasses['inline-message']} */ ;
            (__VLS_ctx.reminderMessage);
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.loading))
                        return;
                    if (!!(__VLS_ctx.error))
                        return;
                    if (!(__VLS_ctx.enableOverviewModules))
                        return;
                    __VLS_ctx.requestAdminAccess('reminder');
                    // @ts-ignore
                    [pendingReminderCount, pendingReminderCount, requestAdminAccess, reminderMessage, reminderMessage,];
                } },
            type: "button",
            ...{ class: "action-card__button" },
        });
        /** @type {__VLS_StyleScopedClasses['action-card__button']} */ ;
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "management-grid" },
    });
    /** @type {__VLS_StyleScopedClasses['management-grid']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
        ref: "medicationManagementRef",
        ...{ class: "action-card action-card--green management-card" },
    });
    /** @type {__VLS_StyleScopedClasses['action-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['action-card--green']} */ ;
    /** @type {__VLS_StyleScopedClasses['management-card']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "action-card__head" },
    });
    /** @type {__VLS_StyleScopedClasses['action-card__head']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "action-card__copy" },
    });
    /** @type {__VLS_StyleScopedClasses['action-card__copy']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
        ...{ class: "section-eyebrow" },
    });
    /** @type {__VLS_StyleScopedClasses['section-eyebrow']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
        ...{ class: "action-card__detail" },
    });
    /** @type {__VLS_StyleScopedClasses['action-card__detail']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!!(__VLS_ctx.loading))
                    return;
                if (!!(__VLS_ctx.error))
                    return;
                __VLS_ctx.requestAdminAccess('medication', () => __VLS_ctx.openCreateEditor('medication'));
                // @ts-ignore
                [requestAdminAccess, openCreateEditor,];
            } },
        type: "button",
        ...{ class: "action-card__button" },
    });
    /** @type {__VLS_StyleScopedClasses['action-card__button']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "action-card__helper" },
    });
    /** @type {__VLS_StyleScopedClasses['action-card__helper']} */ ;
    (__VLS_ctx.medications.length ? `当前已管理 ${__VLS_ctx.medications.length} 项用药` : '当前还没有用药安排');
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "management-list" },
    });
    /** @type {__VLS_StyleScopedClasses['management-list']} */ ;
    for (const [item] of __VLS_vFor((__VLS_ctx.medications))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
            key: (item.id),
            ...{ class: "management-item" },
        });
        /** @type {__VLS_StyleScopedClasses['management-item']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "management-item__copy" },
        });
        /** @type {__VLS_StyleScopedClasses['management-item__copy']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        (item.genericName);
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (item.brandName ? `${item.brandName} · ${item.dose}` : item.dose);
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (__VLS_ctx.formatFrequencyLabel(item.frequency));
        (__VLS_ctx.formatAdministrationTimeLabel(item.administrationTime));
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "management-item__actions" },
        });
        /** @type {__VLS_StyleScopedClasses['management-item__actions']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.loading))
                        return;
                    if (!!(__VLS_ctx.error))
                        return;
                    __VLS_ctx.requestAdminAccess('medication', () => __VLS_ctx.openMedicationEditor(item));
                    // @ts-ignore
                    [medications, medications, medications, requestAdminAccess, formatFrequencyLabel, formatAdministrationTimeLabel, openMedicationEditor,];
                } },
            type: "button",
            ...{ class: "mini-button mini-button--ghost" },
        });
        /** @type {__VLS_StyleScopedClasses['mini-button']} */ ;
        /** @type {__VLS_StyleScopedClasses['mini-button--ghost']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.loading))
                        return;
                    if (!!(__VLS_ctx.error))
                        return;
                    __VLS_ctx.requestAdminAccess('medication', () => __VLS_ctx.deleteMedication(item));
                    // @ts-ignore
                    [requestAdminAccess, deleteMedication,];
                } },
            type: "button",
            ...{ class: "mini-button mini-button--danger" },
        });
        /** @type {__VLS_StyleScopedClasses['mini-button']} */ ;
        /** @type {__VLS_StyleScopedClasses['mini-button--danger']} */ ;
        // @ts-ignore
        [];
    }
    if (!__VLS_ctx.medications.length) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "management-empty" },
        });
        /** @type {__VLS_StyleScopedClasses['management-empty']} */ ;
    }
    if (__VLS_ctx.medicationMessage) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "inline-message" },
        });
        /** @type {__VLS_StyleScopedClasses['inline-message']} */ ;
        (__VLS_ctx.medicationMessage);
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
        ref: "reminderManagementRef",
        ...{ class: "action-card action-card--blue management-card" },
    });
    /** @type {__VLS_StyleScopedClasses['action-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['action-card--blue']} */ ;
    /** @type {__VLS_StyleScopedClasses['management-card']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "action-card__head" },
    });
    /** @type {__VLS_StyleScopedClasses['action-card__head']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "action-card__copy" },
    });
    /** @type {__VLS_StyleScopedClasses['action-card__copy']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
        ...{ class: "section-eyebrow" },
    });
    /** @type {__VLS_StyleScopedClasses['section-eyebrow']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
        ...{ class: "action-card__detail" },
    });
    /** @type {__VLS_StyleScopedClasses['action-card__detail']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!!(__VLS_ctx.loading))
                    return;
                if (!!(__VLS_ctx.error))
                    return;
                __VLS_ctx.requestAdminAccess('reminder', () => __VLS_ctx.openCreateEditor('reminder'));
                // @ts-ignore
                [medications, medicationMessage, medicationMessage, requestAdminAccess, openCreateEditor,];
            } },
        type: "button",
        ...{ class: "action-card__button" },
    });
    /** @type {__VLS_StyleScopedClasses['action-card__button']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "action-card__helper" },
    });
    /** @type {__VLS_StyleScopedClasses['action-card__helper']} */ ;
    (__VLS_ctx.pendingReminderCount > 0 ? `当前仍有 ${__VLS_ctx.pendingReminderCount} 项待执行` : '当前提醒执行相对稳定');
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "management-list" },
    });
    /** @type {__VLS_StyleScopedClasses['management-list']} */ ;
    for (const [item] of __VLS_vFor((__VLS_ctx.reminders))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
            key: (item.reminderId),
            ...{ class: "management-item" },
        });
        /** @type {__VLS_StyleScopedClasses['management-item']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "management-item__copy" },
        });
        /** @type {__VLS_StyleScopedClasses['management-item__copy']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        (item.title);
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (item.medicationNames.length ? item.medicationNames.join(' / ') : '未关联药物');
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (__VLS_ctx.formatReminderSchedule(item.plannedAt));
        (__VLS_ctx.formatReminderStatusLabel(item.status));
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "management-item__actions" },
        });
        /** @type {__VLS_StyleScopedClasses['management-item__actions']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.loading))
                        return;
                    if (!!(__VLS_ctx.error))
                        return;
                    __VLS_ctx.requestAdminAccess('reminder', () => __VLS_ctx.openReminderEditor(item));
                    // @ts-ignore
                    [pendingReminderCount, pendingReminderCount, requestAdminAccess, reminders, formatReminderSchedule, formatReminderStatusLabel, openReminderEditor,];
                } },
            type: "button",
            ...{ class: "mini-button mini-button--ghost" },
        });
        /** @type {__VLS_StyleScopedClasses['mini-button']} */ ;
        /** @type {__VLS_StyleScopedClasses['mini-button--ghost']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.loading))
                        return;
                    if (!!(__VLS_ctx.error))
                        return;
                    __VLS_ctx.requestAdminAccess('reminder', () => __VLS_ctx.deleteReminder(item));
                    // @ts-ignore
                    [requestAdminAccess, deleteReminder,];
                } },
            type: "button",
            ...{ class: "mini-button mini-button--danger" },
        });
        /** @type {__VLS_StyleScopedClasses['mini-button']} */ ;
        /** @type {__VLS_StyleScopedClasses['mini-button--danger']} */ ;
        // @ts-ignore
        [];
    }
    if (!__VLS_ctx.reminders.length) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "management-empty" },
        });
        /** @type {__VLS_StyleScopedClasses['management-empty']} */ ;
    }
    if (__VLS_ctx.reminderMessage) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "inline-message" },
        });
        /** @type {__VLS_StyleScopedClasses['inline-message']} */ ;
        (__VLS_ctx.reminderMessage);
    }
    if (__VLS_ctx.enableOverviewModules) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "glass-section portrait-panel" },
        });
        /** @type {__VLS_StyleScopedClasses['glass-section']} */ ;
        /** @type {__VLS_StyleScopedClasses['portrait-panel']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "portrait-head" },
        });
        /** @type {__VLS_StyleScopedClasses['portrait-head']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "section-copy" },
        });
        /** @type {__VLS_StyleScopedClasses['section-copy']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "section-eyebrow" },
        });
        /** @type {__VLS_StyleScopedClasses['section-eyebrow']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({
            ...{ class: "section-title" },
        });
        /** @type {__VLS_StyleScopedClasses['section-title']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (__VLS_ctx.generatePortraitSummary) },
            type: "button",
            ...{ class: "action-card__button" },
        });
        /** @type {__VLS_StyleScopedClasses['action-card__button']} */ ;
        if (__VLS_ctx.portraitLoading) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "portrait-empty" },
            });
            /** @type {__VLS_StyleScopedClasses['portrait-empty']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        }
        else if (__VLS_ctx.portraitResult) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "portrait-list" },
            });
            /** @type {__VLS_StyleScopedClasses['portrait-list']} */ ;
            for (const [item] of __VLS_vFor((__VLS_ctx.portraitResult.paragraphs))) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
                    key: (item),
                    ...{ class: "portrait-item" },
                });
                /** @type {__VLS_StyleScopedClasses['portrait-item']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
                (item);
                // @ts-ignore
                [enableOverviewModules, reminderMessage, reminderMessage, reminders, generatePortraitSummary, portraitLoading, portraitResult, portraitResult,];
            }
        }
        else {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "portrait-empty" },
            });
            /** @type {__VLS_StyleScopedClasses['portrait-empty']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        }
    }
}
if (__VLS_ctx.passwordModalVisible) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ onClick: (__VLS_ctx.closePasswordModal) },
        ...{ class: "modal-mask" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-mask']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ onClick: () => { } },
        ...{ class: "modal-card" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-card']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "modal-head" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-head']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.h4, __VLS_intrinsics.h4)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (__VLS_ctx.closePasswordModal) },
        type: "button",
        ...{ class: "close-btn" },
    });
    /** @type {__VLS_StyleScopedClasses['close-btn']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
        ...{ class: "field-block" },
    });
    /** @type {__VLS_StyleScopedClasses['field-block']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "field-label" },
    });
    /** @type {__VLS_StyleScopedClasses['field-label']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
        type: "password",
        ...{ class: "input-surface" },
        placeholder: "请输入密码",
    });
    (__VLS_ctx.passwordInput);
    /** @type {__VLS_StyleScopedClasses['input-surface']} */ ;
    if (__VLS_ctx.passwordError) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "inline-message inline-message--error" },
        });
        /** @type {__VLS_StyleScopedClasses['inline-message']} */ ;
        /** @type {__VLS_StyleScopedClasses['inline-message--error']} */ ;
        (__VLS_ctx.passwordError);
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "inline-form__actions" },
    });
    /** @type {__VLS_StyleScopedClasses['inline-form__actions']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (__VLS_ctx.confirmAdminPassword) },
        type: "button",
        ...{ class: "mini-button" },
    });
    /** @type {__VLS_StyleScopedClasses['mini-button']} */ ;
}
if (__VLS_ctx.managementModalVisible) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ onClick: (__VLS_ctx.closeManagementModal) },
        ...{ class: "modal-mask" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-mask']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ onClick: () => { } },
        ...{ class: "modal-card modal-card--editor" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['modal-card--editor']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "modal-head" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-head']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.h4, __VLS_intrinsics.h4)({});
    (__VLS_ctx.managementDialogTitle);
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (__VLS_ctx.closeManagementModal) },
        type: "button",
        ...{ class: "close-btn" },
    });
    /** @type {__VLS_StyleScopedClasses['close-btn']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "inline-form__actions" },
    });
    /** @type {__VLS_StyleScopedClasses['inline-form__actions']} */ ;
    if (__VLS_ctx.activeManagementCard) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    if (!(__VLS_ctx.managementModalVisible))
                        return;
                    if (!(__VLS_ctx.activeManagementCard))
                        return;
                    __VLS_ctx.openCreateEditor(__VLS_ctx.activeManagementCard);
                    // @ts-ignore
                    [openCreateEditor, passwordModalVisible, closePasswordModal, closePasswordModal, passwordInput, passwordError, passwordError, confirmAdminPassword, managementModalVisible, closeManagementModal, closeManagementModal, managementDialogTitle, activeManagementCard, activeManagementCard,];
                } },
            type: "button",
            ...{ class: "mini-button" },
        });
        /** @type {__VLS_StyleScopedClasses['mini-button']} */ ;
    }
    if (__VLS_ctx.activeManagementCard === 'medication') {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "management-list management-list--modal" },
        });
        /** @type {__VLS_StyleScopedClasses['management-list']} */ ;
        /** @type {__VLS_StyleScopedClasses['management-list--modal']} */ ;
        for (const [item] of __VLS_vFor((__VLS_ctx.medications))) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
                key: (item.id),
                ...{ class: "management-item" },
            });
            /** @type {__VLS_StyleScopedClasses['management-item']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "management-item__copy" },
            });
            /** @type {__VLS_StyleScopedClasses['management-item__copy']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
            (item.genericName);
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
            (item.brandName ? `${item.brandName} · ${item.dose}` : item.dose);
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
            (__VLS_ctx.formatFrequencyLabel(item.frequency));
            (__VLS_ctx.formatAdministrationTimeLabel(item.administrationTime));
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "management-item__actions" },
            });
            /** @type {__VLS_StyleScopedClasses['management-item__actions']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (...[$event]) => {
                        if (!(__VLS_ctx.managementModalVisible))
                            return;
                        if (!(__VLS_ctx.activeManagementCard === 'medication'))
                            return;
                        __VLS_ctx.openMedicationEditor(item);
                        // @ts-ignore
                        [medications, formatFrequencyLabel, formatAdministrationTimeLabel, openMedicationEditor, activeManagementCard,];
                    } },
                type: "button",
                ...{ class: "mini-button mini-button--ghost" },
            });
            /** @type {__VLS_StyleScopedClasses['mini-button']} */ ;
            /** @type {__VLS_StyleScopedClasses['mini-button--ghost']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (...[$event]) => {
                        if (!(__VLS_ctx.managementModalVisible))
                            return;
                        if (!(__VLS_ctx.activeManagementCard === 'medication'))
                            return;
                        __VLS_ctx.deleteMedication(item);
                        // @ts-ignore
                        [deleteMedication,];
                    } },
                type: "button",
                ...{ class: "mini-button mini-button--danger" },
            });
            /** @type {__VLS_StyleScopedClasses['mini-button']} */ ;
            /** @type {__VLS_StyleScopedClasses['mini-button--danger']} */ ;
            // @ts-ignore
            [];
        }
        if (!__VLS_ctx.medications.length) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "management-empty" },
            });
            /** @type {__VLS_StyleScopedClasses['management-empty']} */ ;
        }
    }
    else if (__VLS_ctx.activeManagementCard === 'reminder') {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "management-list management-list--modal" },
        });
        /** @type {__VLS_StyleScopedClasses['management-list']} */ ;
        /** @type {__VLS_StyleScopedClasses['management-list--modal']} */ ;
        for (const [item] of __VLS_vFor((__VLS_ctx.reminders))) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
                key: (item.reminderId),
                ...{ class: "management-item" },
            });
            /** @type {__VLS_StyleScopedClasses['management-item']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "management-item__copy" },
            });
            /** @type {__VLS_StyleScopedClasses['management-item__copy']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
            (item.title);
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
            (item.medicationNames.length ? item.medicationNames.join(' / ') : '未关联药物');
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
            (__VLS_ctx.formatReminderSchedule(item.plannedAt));
            (__VLS_ctx.formatReminderStatusLabel(item.status));
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "management-item__actions" },
            });
            /** @type {__VLS_StyleScopedClasses['management-item__actions']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (...[$event]) => {
                        if (!(__VLS_ctx.managementModalVisible))
                            return;
                        if (!!(__VLS_ctx.activeManagementCard === 'medication'))
                            return;
                        if (!(__VLS_ctx.activeManagementCard === 'reminder'))
                            return;
                        __VLS_ctx.openReminderEditor(item);
                        // @ts-ignore
                        [medications, reminders, formatReminderSchedule, formatReminderStatusLabel, openReminderEditor, activeManagementCard,];
                    } },
                type: "button",
                ...{ class: "mini-button mini-button--ghost" },
            });
            /** @type {__VLS_StyleScopedClasses['mini-button']} */ ;
            /** @type {__VLS_StyleScopedClasses['mini-button--ghost']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (...[$event]) => {
                        if (!(__VLS_ctx.managementModalVisible))
                            return;
                        if (!!(__VLS_ctx.activeManagementCard === 'medication'))
                            return;
                        if (!(__VLS_ctx.activeManagementCard === 'reminder'))
                            return;
                        __VLS_ctx.deleteReminder(item);
                        // @ts-ignore
                        [deleteReminder,];
                    } },
                type: "button",
                ...{ class: "mini-button mini-button--danger" },
            });
            /** @type {__VLS_StyleScopedClasses['mini-button']} */ ;
            /** @type {__VLS_StyleScopedClasses['mini-button--danger']} */ ;
            // @ts-ignore
            [];
        }
        if (!__VLS_ctx.reminders.length) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "management-empty" },
            });
            /** @type {__VLS_StyleScopedClasses['management-empty']} */ ;
        }
    }
}
if (__VLS_ctx.editorModalVisible) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ onClick: (__VLS_ctx.closeEditorModal) },
        ...{ class: "modal-mask" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-mask']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ onClick: () => { } },
        ...{ class: "modal-card modal-card--editor" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['modal-card--editor']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "modal-head" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-head']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.h4, __VLS_intrinsics.h4)({});
    (__VLS_ctx.editorDialogTitle);
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (__VLS_ctx.closeEditorModal) },
        type: "button",
        ...{ class: "close-btn" },
    });
    /** @type {__VLS_StyleScopedClasses['close-btn']} */ ;
    if (__VLS_ctx.activeEditor === 'medication') {
        __VLS_asFunctionalElement1(__VLS_intrinsics.form, __VLS_intrinsics.form)({
            ...{ onSubmit: (__VLS_ctx.submitMedicationDraft) },
            ...{ class: "inline-form inline-form--modal" },
        });
        /** @type {__VLS_StyleScopedClasses['inline-form']} */ ;
        /** @type {__VLS_StyleScopedClasses['inline-form--modal']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
            ...{ class: "field-block" },
        });
        /** @type {__VLS_StyleScopedClasses['field-block']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "field-label" },
        });
        /** @type {__VLS_StyleScopedClasses['field-label']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.textarea)({
            value: (__VLS_ctx.medicationNaturalText),
            ...{ class: "input-surface input-surface--textarea" },
            placeholder: "例如：早餐后吃一片代文 80mg，每天一次",
        });
        /** @type {__VLS_StyleScopedClasses['input-surface']} */ ;
        /** @type {__VLS_StyleScopedClasses['input-surface--textarea']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "inline-form__actions" },
        });
        /** @type {__VLS_StyleScopedClasses['inline-form__actions']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    if (!(__VLS_ctx.editorModalVisible))
                        return;
                    if (!(__VLS_ctx.activeEditor === 'medication'))
                        return;
                    __VLS_ctx.simulateAiNormalize('medication');
                    // @ts-ignore
                    [reminders, editorModalVisible, closeEditorModal, closeEditorModal, editorDialogTitle, activeEditor, submitMedicationDraft, medicationNaturalText, simulateAiNormalize,];
                } },
            type: "button",
            ...{ class: "mini-button mini-button--ghost" },
        });
        /** @type {__VLS_StyleScopedClasses['mini-button']} */ ;
        /** @type {__VLS_StyleScopedClasses['mini-button--ghost']} */ ;
        (__VLS_ctx.aiNormalizeLoading === 'medication' ? 'AI 标准化中...' : 'AI 标准化');
        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
            ...{ class: "field-block" },
        });
        /** @type {__VLS_StyleScopedClasses['field-block']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "field-label" },
        });
        /** @type {__VLS_StyleScopedClasses['field-label']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
            ...{ class: "input-surface" },
            placeholder: "例如 Metformin",
        });
        (__VLS_ctx.medicationDraft.genericName);
        /** @type {__VLS_StyleScopedClasses['input-surface']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
            ...{ class: "field-block" },
        });
        /** @type {__VLS_StyleScopedClasses['field-block']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "field-label" },
        });
        /** @type {__VLS_StyleScopedClasses['field-label']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
            ...{ class: "input-surface" },
            placeholder: "可选",
        });
        (__VLS_ctx.medicationDraft.brandName);
        /** @type {__VLS_StyleScopedClasses['input-surface']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "field-row" },
        });
        /** @type {__VLS_StyleScopedClasses['field-row']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
            ...{ class: "field-block" },
        });
        /** @type {__VLS_StyleScopedClasses['field-block']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "field-label" },
        });
        /** @type {__VLS_StyleScopedClasses['field-label']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
            ...{ class: "input-surface" },
            placeholder: "例如 0.5g",
        });
        (__VLS_ctx.medicationDraft.dose);
        /** @type {__VLS_StyleScopedClasses['input-surface']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
            ...{ class: "field-block" },
        });
        /** @type {__VLS_StyleScopedClasses['field-block']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "field-label" },
        });
        /** @type {__VLS_StyleScopedClasses['field-label']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
            value: (__VLS_ctx.medicationDraft.frequency),
            ...{ class: "input-surface" },
        });
        /** @type {__VLS_StyleScopedClasses['input-surface']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
            value: "QD",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
            value: "BID",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
            value: "TID",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
            ...{ class: "field-block" },
        });
        /** @type {__VLS_StyleScopedClasses['field-block']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "field-label" },
        });
        /** @type {__VLS_StyleScopedClasses['field-label']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
            value: (__VLS_ctx.medicationDraft.administrationTime),
            ...{ class: "input-surface" },
        });
        /** @type {__VLS_StyleScopedClasses['input-surface']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
            value: "AFTER_BREAKFAST",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
            value: "AFTER_BREAKFAST_AFTER_DINNER",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
            value: "BEFORE_MEAL",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "inline-form__actions" },
        });
        /** @type {__VLS_StyleScopedClasses['inline-form__actions']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            type: "submit",
            ...{ class: "mini-button" },
        });
        /** @type {__VLS_StyleScopedClasses['mini-button']} */ ;
    }
    else if (__VLS_ctx.activeEditor === 'reminder') {
        __VLS_asFunctionalElement1(__VLS_intrinsics.form, __VLS_intrinsics.form)({
            ...{ onSubmit: (__VLS_ctx.submitReminderDraft) },
            ...{ class: "inline-form inline-form--modal" },
        });
        /** @type {__VLS_StyleScopedClasses['inline-form']} */ ;
        /** @type {__VLS_StyleScopedClasses['inline-form--modal']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
            ...{ class: "field-block" },
        });
        /** @type {__VLS_StyleScopedClasses['field-block']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "field-label" },
        });
        /** @type {__VLS_StyleScopedClasses['field-label']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.textarea)({
            value: (__VLS_ctx.reminderNaturalText),
            ...{ class: "input-surface input-surface--textarea" },
            placeholder: "例如：明早 8 点提醒患者早餐后服用代文，并观察头晕情况",
        });
        /** @type {__VLS_StyleScopedClasses['input-surface']} */ ;
        /** @type {__VLS_StyleScopedClasses['input-surface--textarea']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "inline-form__actions" },
        });
        /** @type {__VLS_StyleScopedClasses['inline-form__actions']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    if (!(__VLS_ctx.editorModalVisible))
                        return;
                    if (!!(__VLS_ctx.activeEditor === 'medication'))
                        return;
                    if (!(__VLS_ctx.activeEditor === 'reminder'))
                        return;
                    __VLS_ctx.simulateAiNormalize('reminder');
                    // @ts-ignore
                    [activeEditor, simulateAiNormalize, aiNormalizeLoading, medicationDraft, medicationDraft, medicationDraft, medicationDraft, medicationDraft, submitReminderDraft, reminderNaturalText,];
                } },
            type: "button",
            ...{ class: "mini-button mini-button--ghost" },
        });
        /** @type {__VLS_StyleScopedClasses['mini-button']} */ ;
        /** @type {__VLS_StyleScopedClasses['mini-button--ghost']} */ ;
        (__VLS_ctx.aiNormalizeLoading === 'reminder' ? 'AI 标准化中...' : 'AI 标准化');
        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
            ...{ class: "field-block" },
        });
        /** @type {__VLS_StyleScopedClasses['field-block']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "field-label" },
        });
        /** @type {__VLS_StyleScopedClasses['field-label']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
            ...{ class: "input-surface" },
            placeholder: "例如 晚间服药提醒",
        });
        (__VLS_ctx.reminderDraft.title);
        /** @type {__VLS_StyleScopedClasses['input-surface']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
            ...{ class: "field-block" },
        });
        /** @type {__VLS_StyleScopedClasses['field-block']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "field-label" },
        });
        /** @type {__VLS_StyleScopedClasses['field-label']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
            type: "datetime-local",
            ...{ class: "input-surface" },
        });
        (__VLS_ctx.reminderDraft.plannedAt);
        /** @type {__VLS_StyleScopedClasses['input-surface']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
            ...{ class: "field-block" },
        });
        /** @type {__VLS_StyleScopedClasses['field-block']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "field-label" },
        });
        /** @type {__VLS_StyleScopedClasses['field-label']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
            ...{ class: "input-surface" },
            placeholder: "可选",
        });
        (__VLS_ctx.reminderDraft.medicationName);
        /** @type {__VLS_StyleScopedClasses['input-surface']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
            ...{ class: "field-block" },
        });
        /** @type {__VLS_StyleScopedClasses['field-block']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "field-label" },
        });
        /** @type {__VLS_StyleScopedClasses['field-label']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.textarea)({
            value: (__VLS_ctx.reminderDraft.followUpPrompt),
            ...{ class: "input-surface input-surface--textarea" },
            placeholder: "例如 如有不适请立即反馈",
        });
        /** @type {__VLS_StyleScopedClasses['input-surface']} */ ;
        /** @type {__VLS_StyleScopedClasses['input-surface--textarea']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "inline-form__actions" },
        });
        /** @type {__VLS_StyleScopedClasses['inline-form__actions']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            type: "submit",
            ...{ class: "mini-button" },
        });
        /** @type {__VLS_StyleScopedClasses['mini-button']} */ ;
    }
}
// @ts-ignore
[aiNormalizeLoading, reminderDraft, reminderDraft, reminderDraft, reminderDraft,];
const __VLS_export = (await import('vue')).defineComponent({});
export default {};
