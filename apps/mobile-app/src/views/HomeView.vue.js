import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { mobileApi } from '../lib/api';
import { formatStatus } from '../lib/format';
import { useMvpStore } from '../stores/mvp';
import cardBg from '../static/pictures/card-bg.png';
const pageTitle = '两病联合治疗看板';
const pageSubtitle = '聚焦高血压与糖尿病的联合干预，只保留风险复核、用药执行和随访提醒。';
const patientLabel = '高血压 + 糖尿病';
const autoRotateMs = 4200;
const showAncillaryPanels = false;
const fallbackRiskEvents = [
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
const fallbackReminders = [
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
const mvpStore = useMvpStore();
const reminderSource = ref([]);
function isValidDate(value) {
    return !!value && !Number.isNaN(new Date(value).getTime());
}
function toDate(value) {
    return isValidDate(value) ? new Date(value) : null;
}
function toDateKey(value) {
    const date = toDate(value);
    if (!date)
        return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
function formatClock(value) {
    const date = toDate(value);
    if (!date)
        return '--:--';
    return new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(date);
}
function cloneReminders(reminders) {
    return reminders.map((item) => ({
        ...item,
        medicationIds: [...item.medicationIds],
        medicationNames: [...item.medicationNames],
    }));
}
function sortReminders(reminders) {
    return [...reminders].sort((left, right) => {
        const leftTime = toDate(left.plannedAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const rightTime = toDate(right.plannedAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return leftTime - rightTime;
    });
}
function normalizeText(reminder) {
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
function isCompleted(status) {
    return status === 'SUCCESS' || status === 'DONE';
}
function isPending(status) {
    return !isCompleted(status) && status !== 'FAILED';
}
function isOverdue(reminder) {
    const plannedAt = toDate(reminder.plannedAt);
    return !!plannedAt && isPending(reminder.status) && plannedAt.getTime() < Date.now();
}
function isCriticalReminder(reminder) {
    const text = normalizeText(reminder);
    return (isOverdue(reminder) ||
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
        ].some((keyword) => text.includes(keyword)));
}
function isWarningReminder(reminder) {
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
function getRiskTone(reminder) {
    if (reminder.status === 'FAILED')
        return 'critical';
    if (isCriticalReminder(reminder))
        return 'critical';
    if (isWarningReminder(reminder))
        return 'warning';
    return 'muted';
}
function getReminderTone(reminder) {
    if (isCompleted(reminder.status))
        return 'success';
    if (reminder.status === 'FAILED')
        return 'critical';
    if (isCriticalReminder(reminder))
        return 'critical';
    if (isWarningReminder(reminder))
        return 'warning';
    return 'neutral';
}
function getReminderIcon(tone) {
    if (tone === 'critical')
        return '⚠️';
    if (tone === 'warning')
        return '⏰';
    if (tone === 'success')
        return '✅';
    return '💊';
}
function getReminderHint(reminder, tone) {
    if (isCompleted(reminder.status))
        return '已完成';
    if (reminder.status === 'FAILED')
        return '处理异常';
    if (tone === 'critical')
        return '优先处理';
    if (tone === 'warning')
        return '注意跟进';
    return '常规提醒';
}
function getRiskKind(reminder, tone) {
    if (isCompleted(reminder.status))
        return '已处理';
    if (tone === 'critical')
        return '高风险提醒';
    if (tone === 'warning')
        return '待跟进提醒';
    return '提醒安排';
}
function getRiskLevel(tone) {
    if (tone === 'critical')
        return '高优先级';
    if (tone === 'warning')
        return '中优先级';
    return '待确认';
}
function getRiskAction(reminder) {
    if (isCompleted(reminder.status))
        return '查看记录';
    if (isCriticalReminder(reminder))
        return '立即处理';
    return '去确认';
}
function getRiskSignal(reminder) {
    const detail = reminder.followUpPrompt?.trim() || reminder.voicePrompt?.trim();
    if (detail)
        return detail;
    if (reminder.medicationNames.length)
        return `关联药物：${reminder.medicationNames.join('、')}`;
    return '请按提醒安排完成本次跟进。';
}
function getRiskSubject(reminder) {
    return reminder.medicationNames.length ? reminder.medicationNames.join('、') : reminder.reminderType;
}
function getReminderDetail(reminder) {
    const detail = reminder.followUpPrompt?.trim() || reminder.voicePrompt?.trim();
    if (detail)
        return detail;
    if (reminder.medicationNames.length)
        return `关联药物：${reminder.medicationNames.join('、')}`;
    return '等待补充本次提醒的执行说明。';
}
function getReminderPriority(reminder) {
    if (isCompleted(reminder.status))
        return 1;
    if (isCriticalReminder(reminder))
        return 4;
    if (isWarningReminder(reminder))
        return 3;
    return 2;
}
function isActiveRiskReminder(reminder) {
    return !isCompleted(reminder.status) && getRiskTone(reminder) !== 'muted';
}
async function loadReminderSource() {
    if (mvpStore.state.reminders.length) {
        reminderSource.value = cloneReminders(mvpStore.state.reminders);
        return;
    }
    try {
        const response = await mobileApi.getTodayReminders();
        reminderSource.value = cloneReminders(response.reminders);
    }
    catch {
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
const reminders = computed(() => {
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
const riskEvents = computed(() => {
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
let riskTimer = null;
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
    if (!riskEvents.value.length)
        return;
    activeRiskIndex.value = (activeRiskIndex.value - 1 + riskEvents.value.length) % riskEvents.value.length;
    startRiskAutoplay();
}
function goToNextRisk() {
    if (!riskEvents.value.length)
        return;
    activeRiskIndex.value = (activeRiskIndex.value + 1) % riskEvents.value.length;
    startRiskAutoplay();
}
function setActiveRisk(index) {
    if (!riskEvents.value.length)
        return;
    activeRiskIndex.value = index;
    startRiskAutoplay();
}
onMounted(() => {
    void loadReminderSource();
    startRiskAutoplay();
});
watch(() => mvpStore.state.reminders, (next) => {
    reminderSource.value = cloneReminders(next);
}, { deep: true });
watch(riskEvents, (next) => {
    if (!next.length) {
        activeRiskIndex.value = 0;
        stopRiskAutoplay();
        return;
    }
    if (activeRiskIndex.value >= next.length) {
        activeRiskIndex.value = 0;
    }
    startRiskAutoplay();
}, { immediate: true });
onBeforeUnmount(() => {
    stopRiskAutoplay();
});
const __VLS_ctx = {
    ...{},
    ...{},
};
let __VLS_components;
let __VLS_intrinsics;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['home-page']} */ ;
/** @type {__VLS_StyleScopedClasses['home-page']} */ ;
/** @type {__VLS_StyleScopedClasses['hero-top']} */ ;
/** @type {__VLS_StyleScopedClasses['patient-name']} */ ;
/** @type {__VLS_StyleScopedClasses['risk-carousel-section']} */ ;
/** @type {__VLS_StyleScopedClasses['risk-carousel-section']} */ ;
/** @type {__VLS_StyleScopedClasses['risk-carousel-bg']} */ ;
/** @type {__VLS_StyleScopedClasses['risk-carousel-overlay']} */ ;
/** @type {__VLS_StyleScopedClasses['section-title']} */ ;
/** @type {__VLS_StyleScopedClasses['carousel-button']} */ ;
/** @type {__VLS_StyleScopedClasses['risk-strip-shell']} */ ;
/** @type {__VLS_StyleScopedClasses['risk-strip-shell']} */ ;
/** @type {__VLS_StyleScopedClasses['risk-empty-state']} */ ;
/** @type {__VLS_StyleScopedClasses['risk-empty-state']} */ ;
/** @type {__VLS_StyleScopedClasses['risk-strip']} */ ;
/** @type {__VLS_StyleScopedClasses['risk-strip-summary']} */ ;
/** @type {__VLS_StyleScopedClasses['risk-strip-kind']} */ ;
/** @type {__VLS_StyleScopedClasses['risk-strip-time']} */ ;
/** @type {__VLS_StyleScopedClasses['risk-action-button']} */ ;
/** @type {__VLS_StyleScopedClasses['carousel-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['carousel-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['reminder-item']} */ ;
/** @type {__VLS_StyleScopedClasses['reminder-body']} */ ;
/** @type {__VLS_StyleScopedClasses['reminder-body']} */ ;
/** @type {__VLS_StyleScopedClasses['reminder-meta-pill']} */ ;
/** @type {__VLS_StyleScopedClasses['reminder-status']} */ ;
/** @type {__VLS_StyleScopedClasses['dots-indicator']} */ ;
/** @type {__VLS_StyleScopedClasses['device-item']} */ ;
/** @type {__VLS_StyleScopedClasses['hero-panel']} */ ;
/** @type {__VLS_StyleScopedClasses['hero-top']} */ ;
/** @type {__VLS_StyleScopedClasses['patient-name']} */ ;
/** @type {__VLS_StyleScopedClasses['patient-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['patient-subtitle']} */ ;
/** @type {__VLS_StyleScopedClasses['section-note']} */ ;
/** @type {__VLS_StyleScopedClasses['risk-carousel-section']} */ ;
/** @type {__VLS_StyleScopedClasses['reminders-section']} */ ;
/** @type {__VLS_StyleScopedClasses['risk-strip']} */ ;
/** @type {__VLS_StyleScopedClasses['risk-strip-side']} */ ;
/** @type {__VLS_StyleScopedClasses['risk-strip-title']} */ ;
/** @type {__VLS_StyleScopedClasses['risk-strip-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['reminder-body__top']} */ ;
/** @type {__VLS_StyleScopedClasses['bottom-grid']} */ ;
/** @type {__VLS_StyleScopedClasses['home-page']} */ ;
/** @type {__VLS_StyleScopedClasses['patient-name']} */ ;
/** @type {__VLS_StyleScopedClasses['section-title']} */ ;
/** @type {__VLS_StyleScopedClasses['carousel-controls']} */ ;
/** @type {__VLS_StyleScopedClasses['risk-strip-shell']} */ ;
/** @type {__VLS_StyleScopedClasses['risk-strip']} */ ;
/** @type {__VLS_StyleScopedClasses['risk-strip-leading']} */ ;
/** @type {__VLS_StyleScopedClasses['risk-strip-side']} */ ;
/** @type {__VLS_StyleScopedClasses['reminder-item']} */ ;
/** @type {__VLS_StyleScopedClasses['reminder-icon-wrap']} */ ;
/** @type {__VLS_StyleScopedClasses['bottom-grid']} */ ;
/** @type {__VLS_StyleScopedClasses['recovery-content']} */ ;
/** @type {__VLS_StyleScopedClasses['device-content']} */ ;
/** @type {__VLS_StyleScopedClasses['device-bottom']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-label']} */ ;
/** @type {__VLS_StyleScopedClasses['stat-value']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "mobile-page home-page" },
});
/** @type {__VLS_StyleScopedClasses['mobile-page']} */ ;
/** @type {__VLS_StyleScopedClasses['home-page']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
    ...{ class: "hero-panel" },
});
/** @type {__VLS_StyleScopedClasses['hero-panel']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "hero-top" },
});
/** @type {__VLS_StyleScopedClasses['hero-top']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "hero-copy" },
});
/** @type {__VLS_StyleScopedClasses['hero-copy']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "hero-title-row" },
});
/** @type {__VLS_StyleScopedClasses['hero-title-row']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
    ...{ class: "patient-name" },
});
/** @type {__VLS_StyleScopedClasses['patient-name']} */ ;
(__VLS_ctx.pageTitle);
__VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
    ...{ class: "patient-badge" },
});
/** @type {__VLS_StyleScopedClasses['patient-badge']} */ ;
(__VLS_ctx.patientLabel);
__VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
    ...{ class: "patient-subtitle" },
});
/** @type {__VLS_StyleScopedClasses['patient-subtitle']} */ ;
(__VLS_ctx.pageSubtitle);
__VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
    ...{ class: "glass-section risk-carousel-section" },
});
/** @type {__VLS_StyleScopedClasses['glass-section']} */ ;
/** @type {__VLS_StyleScopedClasses['risk-carousel-section']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.img)({
    ...{ class: "risk-carousel-bg" },
    src: (__VLS_ctx.cardBg),
    alt: "",
});
/** @type {__VLS_StyleScopedClasses['risk-carousel-bg']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "risk-carousel-overlay" },
});
/** @type {__VLS_StyleScopedClasses['risk-carousel-overlay']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "section-header" },
});
/** @type {__VLS_StyleScopedClasses['section-header']} */ ;
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
__VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
    ...{ class: "section-note" },
});
/** @type {__VLS_StyleScopedClasses['section-note']} */ ;
if (__VLS_ctx.hasRiskEvents) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "carousel-controls" },
    });
    /** @type {__VLS_StyleScopedClasses['carousel-controls']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (__VLS_ctx.goToPrevRisk) },
        type: "button",
        ...{ class: "carousel-button" },
        'aria-label': "上一条风险事件",
    });
    /** @type {__VLS_StyleScopedClasses['carousel-button']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "carousel-count" },
    });
    /** @type {__VLS_StyleScopedClasses['carousel-count']} */ ;
    (__VLS_ctx.activeRiskIndex + 1);
    (__VLS_ctx.riskEvents.length);
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (__VLS_ctx.goToNextRisk) },
        type: "button",
        ...{ class: "carousel-button" },
        'aria-label': "下一条风险事件",
    });
    /** @type {__VLS_StyleScopedClasses['carousel-button']} */ ;
}
if (__VLS_ctx.hasRiskEvents) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ onMouseenter: (__VLS_ctx.stopRiskAutoplay) },
        ...{ onMouseleave: (__VLS_ctx.startRiskAutoplay) },
        ...{ class: "risk-strip-shell" },
        ...{ class: (`risk-strip-shell--${__VLS_ctx.activeRisk.tone}`) },
    });
    /** @type {__VLS_StyleScopedClasses['risk-strip-shell']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "risk-strip-viewport" },
        'aria-live': "polite",
    });
    /** @type {__VLS_StyleScopedClasses['risk-strip-viewport']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "risk-strip-track" },
        ...{ style: ({ transform: `translateX(-${__VLS_ctx.activeRiskIndex * 100}%)` }) },
    });
    /** @type {__VLS_StyleScopedClasses['risk-strip-track']} */ ;
    for (const [item, index] of __VLS_vFor((__VLS_ctx.riskEvents))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
            key: (`${item.time}-${item.title}`),
            ...{ class: "risk-strip" },
            ...{ class: (`risk-strip--${item.tone}`) },
        });
        /** @type {__VLS_StyleScopedClasses['risk-strip']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "risk-strip-leading" },
        });
        /** @type {__VLS_StyleScopedClasses['risk-strip-leading']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "risk-strip-summary" },
        });
        /** @type {__VLS_StyleScopedClasses['risk-strip-summary']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "risk-strip-head" },
        });
        /** @type {__VLS_StyleScopedClasses['risk-strip-head']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "risk-strip-kind" },
        });
        /** @type {__VLS_StyleScopedClasses['risk-strip-kind']} */ ;
        (item.kind);
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "risk-strip-time" },
        });
        /** @type {__VLS_StyleScopedClasses['risk-strip-time']} */ ;
        (item.time);
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({
            ...{ class: "risk-strip-title" },
        });
        /** @type {__VLS_StyleScopedClasses['risk-strip-title']} */ ;
        (item.title);
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "risk-strip-meta" },
        });
        /** @type {__VLS_StyleScopedClasses['risk-strip-meta']} */ ;
        (item.subject);
        (item.signal);
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "risk-strip-side" },
        });
        /** @type {__VLS_StyleScopedClasses['risk-strip-side']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "risk-level-chip" },
        });
        /** @type {__VLS_StyleScopedClasses['risk-level-chip']} */ ;
        (item.level);
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            type: "button",
            ...{ class: "risk-action-button" },
            'aria-label': (`处理第 ${index + 1} 条风险事件`),
        });
        /** @type {__VLS_StyleScopedClasses['risk-action-button']} */ ;
        (item.action);
        // @ts-ignore
        [pageTitle, patientLabel, pageSubtitle, cardBg, hasRiskEvents, hasRiskEvents, goToPrevRisk, activeRiskIndex, activeRiskIndex, riskEvents, riskEvents, goToNextRisk, stopRiskAutoplay, startRiskAutoplay, activeRisk,];
    }
}
else {
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "risk-strip-shell risk-strip-shell--muted risk-empty-state" },
    });
    /** @type {__VLS_StyleScopedClasses['risk-strip-shell']} */ ;
    /** @type {__VLS_StyleScopedClasses['risk-strip-shell--muted']} */ ;
    /** @type {__VLS_StyleScopedClasses['risk-empty-state']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "risk-strip risk-strip--muted" },
    });
    /** @type {__VLS_StyleScopedClasses['risk-strip']} */ ;
    /** @type {__VLS_StyleScopedClasses['risk-strip--muted']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "risk-strip-leading" },
    });
    /** @type {__VLS_StyleScopedClasses['risk-strip-leading']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "risk-strip-summary" },
    });
    /** @type {__VLS_StyleScopedClasses['risk-strip-summary']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "risk-strip-head" },
    });
    /** @type {__VLS_StyleScopedClasses['risk-strip-head']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "risk-strip-kind" },
    });
    /** @type {__VLS_StyleScopedClasses['risk-strip-kind']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "risk-strip-time" },
    });
    /** @type {__VLS_StyleScopedClasses['risk-strip-time']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({
        ...{ class: "risk-strip-title" },
    });
    /** @type {__VLS_StyleScopedClasses['risk-strip-title']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
        ...{ class: "risk-strip-meta" },
    });
    /** @type {__VLS_StyleScopedClasses['risk-strip-meta']} */ ;
}
if (__VLS_ctx.hasRiskEvents && __VLS_ctx.riskEvents.length > 1) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "carousel-dots" },
    });
    /** @type {__VLS_StyleScopedClasses['carousel-dots']} */ ;
    for (const [_, index] of __VLS_vFor((__VLS_ctx.riskEvents))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    if (!(__VLS_ctx.hasRiskEvents && __VLS_ctx.riskEvents.length > 1))
                        return;
                    __VLS_ctx.setActiveRisk(index);
                    // @ts-ignore
                    [hasRiskEvents, riskEvents, riskEvents, setActiveRisk,];
                } },
            key: (index),
            type: "button",
            ...{ class: "carousel-dot" },
            ...{ class: ({ active: index === __VLS_ctx.activeRiskIndex }) },
            'aria-label': (`查看第 ${index + 1} 条风险事件`),
        });
        /** @type {__VLS_StyleScopedClasses['carousel-dot']} */ ;
        /** @type {__VLS_StyleScopedClasses['active']} */ ;
        // @ts-ignore
        [activeRiskIndex,];
    }
}
__VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
    ...{ class: "glass-section reminders-section" },
});
/** @type {__VLS_StyleScopedClasses['glass-section']} */ ;
/** @type {__VLS_StyleScopedClasses['reminders-section']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "section-header" },
});
/** @type {__VLS_StyleScopedClasses['section-header']} */ ;
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
__VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
    ...{ class: "section-note" },
});
/** @type {__VLS_StyleScopedClasses['section-note']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "reminder-list" },
});
/** @type {__VLS_StyleScopedClasses['reminder-list']} */ ;
for (const [item] of __VLS_vFor((__VLS_ctx.reminders))) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
        key: (`${item.time}-${item.title}`),
        ...{ class: "reminder-item" },
        ...{ class: (`reminder-item--${item.tone}`) },
    });
    /** @type {__VLS_StyleScopedClasses['reminder-item']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "reminder-icon-wrap" },
    });
    /** @type {__VLS_StyleScopedClasses['reminder-icon-wrap']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "reminder-icon" },
    });
    /** @type {__VLS_StyleScopedClasses['reminder-icon']} */ ;
    (item.icon);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "reminder-body" },
    });
    /** @type {__VLS_StyleScopedClasses['reminder-body']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "reminder-body__top" },
    });
    /** @type {__VLS_StyleScopedClasses['reminder-body__top']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
    (item.title);
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "reminder-status" },
        ...{ class: (`reminder-status--${item.tone}`) },
    });
    /** @type {__VLS_StyleScopedClasses['reminder-status']} */ ;
    (item.status);
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    (item.detail);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "reminder-meta" },
    });
    /** @type {__VLS_StyleScopedClasses['reminder-meta']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "reminder-meta-pill" },
    });
    /** @type {__VLS_StyleScopedClasses['reminder-meta-pill']} */ ;
    (item.time);
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "reminder-meta-pill" },
    });
    /** @type {__VLS_StyleScopedClasses['reminder-meta-pill']} */ ;
    (item.hint);
    // @ts-ignore
    [reminders,];
}
if (__VLS_ctx.showAncillaryPanels) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "bottom-grid" },
    });
    /** @type {__VLS_StyleScopedClasses['bottom-grid']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "glass-section bottom-card" },
    });
    /** @type {__VLS_StyleScopedClasses['glass-section']} */ ;
    /** @type {__VLS_StyleScopedClasses['bottom-card']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "section-header section-header--compact" },
    });
    /** @type {__VLS_StyleScopedClasses['section-header']} */ ;
    /** @type {__VLS_StyleScopedClasses['section-header--compact']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({
        ...{ class: "section-title" },
    });
    /** @type {__VLS_StyleScopedClasses['section-title']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "dots-indicator" },
    });
    /** @type {__VLS_StyleScopedClasses['dots-indicator']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "recovery-content" },
    });
    /** @type {__VLS_StyleScopedClasses['recovery-content']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "circular-chart" },
    });
    /** @type {__VLS_StyleScopedClasses['circular-chart']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.svg, __VLS_intrinsics.svg)({
        viewBox: "0 0 36 36",
        ...{ class: "circular-svg" },
    });
    /** @type {__VLS_StyleScopedClasses['circular-svg']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.path)({
        ...{ class: "circle-bg" },
        d: "M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831",
    });
    /** @type {__VLS_StyleScopedClasses['circle-bg']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.path)({
        ...{ class: "circle-path" },
        'stroke-dasharray': "84, 100",
        d: "M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831",
    });
    /** @type {__VLS_StyleScopedClasses['circle-path']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.text, __VLS_intrinsics.text)({
        x: "18",
        y: "20.35",
        ...{ class: "percentage" },
    });
    /** @type {__VLS_StyleScopedClasses['percentage']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.text, __VLS_intrinsics.text)({
        x: "18",
        y: "26",
        ...{ class: "stars" },
    });
    /** @type {__VLS_StyleScopedClasses['stars']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "recovery-stats" },
    });
    /** @type {__VLS_StyleScopedClasses['recovery-stats']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "stat-label" },
    });
    /** @type {__VLS_StyleScopedClasses['stat-label']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "stat-value text-green" },
    });
    /** @type {__VLS_StyleScopedClasses['stat-value']} */ ;
    /** @type {__VLS_StyleScopedClasses['text-green']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "progress-bar" },
    });
    /** @type {__VLS_StyleScopedClasses['progress-bar']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "progress-fill" },
        ...{ style: {} },
    });
    /** @type {__VLS_StyleScopedClasses['progress-fill']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "stat-bottom" },
    });
    /** @type {__VLS_StyleScopedClasses['stat-bottom']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "diamonds" },
    });
    /** @type {__VLS_StyleScopedClasses['diamonds']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "glass-section bottom-card" },
    });
    /** @type {__VLS_StyleScopedClasses['glass-section']} */ ;
    /** @type {__VLS_StyleScopedClasses['bottom-card']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "section-header section-header--compact" },
    });
    /** @type {__VLS_StyleScopedClasses['section-header']} */ ;
    /** @type {__VLS_StyleScopedClasses['section-header--compact']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({
        ...{ class: "section-title" },
    });
    /** @type {__VLS_StyleScopedClasses['section-title']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "dots-indicator" },
    });
    /** @type {__VLS_StyleScopedClasses['dots-indicator']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "device-content" },
    });
    /** @type {__VLS_StyleScopedClasses['device-content']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "device-top" },
    });
    /** @type {__VLS_StyleScopedClasses['device-top']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "device-icon" },
    });
    /** @type {__VLS_StyleScopedClasses['device-icon']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "watch-shape" },
    });
    /** @type {__VLS_StyleScopedClasses['watch-shape']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "device-status" },
    });
    /** @type {__VLS_StyleScopedClasses['device-status']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "stat-label" },
    });
    /** @type {__VLS_StyleScopedClasses['stat-label']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "stat-value text-dark" },
    });
    /** @type {__VLS_StyleScopedClasses['stat-value']} */ ;
    /** @type {__VLS_StyleScopedClasses['text-dark']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "dash-line" },
    });
    /** @type {__VLS_StyleScopedClasses['dash-line']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "device-bottom" },
    });
    /** @type {__VLS_StyleScopedClasses['device-bottom']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "device-item" },
    });
    /** @type {__VLS_StyleScopedClasses['device-item']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "stat-label" },
    });
    /** @type {__VLS_StyleScopedClasses['stat-label']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "check" },
    });
    /** @type {__VLS_StyleScopedClasses['check']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "stat-value text-green" },
    });
    /** @type {__VLS_StyleScopedClasses['stat-value']} */ ;
    /** @type {__VLS_StyleScopedClasses['text-green']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "device-item" },
    });
    /** @type {__VLS_StyleScopedClasses['device-item']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "stat-label" },
    });
    /** @type {__VLS_StyleScopedClasses['stat-label']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "stat-value text-dark" },
    });
    /** @type {__VLS_StyleScopedClasses['stat-value']} */ ;
    /** @type {__VLS_StyleScopedClasses['text-dark']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
}
// @ts-ignore
[showAncillaryPanels,];
const __VLS_export = (await import('vue')).defineComponent({});
export default {};
