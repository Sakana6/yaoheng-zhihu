import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { formatDateTime, formatReviewPriority, getRiskTone } from '../lib/format';
import { useMvpStore } from '../stores/mvp';
import bannerImage from '../static/pictures/home-card.jpg';
function shiftDate(base, offsetDays) {
    const result = new Date(base);
    result.setDate(result.getDate() + offsetDays);
    return result;
}
function toDateKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
function atTime(baseDate, hour, minute) {
    const result = new Date(baseDate);
    result.setHours(hour, minute, 0, 0);
    return result.toISOString();
}
function formatEvidenceChain(payload) {
    return JSON.stringify(payload, null, 2);
}
const pageTitle = '风险判断中心';
const pageSubtitle = '记录页统一后的今日风险会展示在这里；如果当天尚未形成事件流，则默认回看昨日四类风险和昨日联合事件。';
const mvpStore = useMvpStore();
const patient = ref({
    userId: 1,
    role: 'CAREGIVER',
    patientId: 1,
    patientName: '张建国',
});
const yesterday = shiftDate(new Date(), -1);
const twoDaysAgo = shiftDate(new Date(), -2);
const fourDaysAgo = shiftDate(new Date(), -4);
const todayKey = toDateKey(new Date());
const shouldSyncTodayRisk = (() => {
    if (typeof window === 'undefined') {
        return false;
    }
    const enabled = window.sessionStorage.getItem('risk-view-sync-from-record') === '1';
    if (enabled) {
        window.sessionStorage.removeItem('risk-view-sync-from-record');
    }
    return enabled;
})();
const fallbackRisk = {
    deintensificationScore: 82,
    interactionScore: 32,
    behaviorScore: 61,
    jointEventScore: 88,
    reviewPriority: 'CLINIC_REVIEW',
    reasons: [],
};
const archives = ref([
    {
        date: toDateKey(yesterday),
        summary: '昨日以过强化治疗风险和联合事件风险为主，时序行为风险次之，联用风险暂未见明显升高。',
        inferredRisk: '疑似降糖过强化，伴随药-餐-症状联合事件异常',
        confidence: 0.94,
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
        summary: '当天以时序行为风险为主，联用风险需要继续复核，过强化治疗风险暂时维持观察。',
        inferredRisk: '补服与记录延迟共同驱动时序行为风险升高',
        confidence: 0.87,
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
        summary: '当天以过强化治疗风险和联合事件风险为主，晨间窗口重复出现异常，建议继续关注降压强度。',
        inferredRisk: '疑似降压过强化，晨间低压与站立不稳形成联合风险',
        confidence: 0.92,
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
]);
const activeDayIndex = ref(0);
const selectedDay = ref(null);
const isEvaluatingTodayRisk = ref(false);
let revealTodayRiskTimer = null;
const activeArchive = computed(() => archives.value[activeDayIndex.value] ?? archives.value[0]);
const activeRisk = computed(() => activeArchive.value?.riskSnapshot ?? fallbackRisk);
const priorityMeta = computed(() => formatReviewPriority(activeRisk.value.reviewPriority));
const canViewOlderDate = computed(() => activeDayIndex.value < archives.value.length - 1);
const canViewNewerDate = computed(() => activeDayIndex.value > 0);
const summaryTitle = computed(() => (activeArchive.value.date === todayKey ? '今日四类风险' : '昨日风险四类'));
const summaryNote = computed(() => isEvaluatingTodayRisk.value
    ? 'AI 正在根据今日时间流评估风险，当前先展示昨日兜底结果。'
    : activeArchive.value.date === todayKey
        ? '今日风险事件已从记录页统一进入风险页。'
        : '当天尚未统一组织成事件流时，默认展示昨日风险四类和昨日联合事件。');
const metricCards = computed(() => [
    {
        label: '药物联用风险',
        score: activeRisk.value.interactionScore,
        theme: 'sand',
    },
    {
        label: '时序行为风险',
        score: activeRisk.value.behaviorScore,
        theme: 'sage',
    },
    {
        label: '联合事件风险',
        score: activeRisk.value.jointEventScore,
        theme: 'sky',
    },
    {
        label: '过强化治疗风险',
        score: activeRisk.value.deintensificationScore,
        theme: 'gold',
        featured: true,
    },
]);
function riskLevel(score) {
    if (score >= 80) {
        return '高';
    }
    if (score >= 60) {
        return '中高';
    }
    if (score >= 40) {
        return '中';
    }
    return '低';
}
function formatArchiveDate(value) {
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
function formatDirection(direction) {
    const labels = {
        DEINTENSIFICATION: '过强化治疗风险',
        INTERACTION: '药物联用风险',
        TEMPORAL_BEHAVIOR: '时序行为风险',
        JOINT_EVENT: '联合事件风险',
    };
    return labels[direction];
}
function formatConfidence(value) {
    return `${Math.round(value * 100)}%`;
}
function goToOlderDate() {
    if (canViewOlderDate.value) {
        activeDayIndex.value += 1;
    }
}
function goToNewerDate() {
    if (canViewNewerDate.value) {
        activeDayIndex.value -= 1;
    }
}
function openDay() {
    selectedDay.value = activeArchive.value;
}
function closeDay() {
    selectedDay.value = null;
}
function buildTodayRiskArchive() {
    if (!mvpStore.state.risk || !mvpStore.state.jointEvents.length) {
        return null;
    }
    const eventDate = mvpStore.state.jointEvents[0].eventDate ?? todayKey;
    if (eventDate !== todayKey) {
        return null;
    }
    return {
        date: todayKey,
        summary: '今日风险事件已经从记录页统一进入风险页，当前以过强化治疗风险和联合事件风险为主。',
        inferredRisk: '早餐摄入不足、疑似低血糖症状与补服共同驱动今日风险升高',
        confidence: 0.94,
        riskSnapshot: { ...mvpStore.state.risk },
        events: mvpStore.state.jointEvents.map((item) => ({
            code: item.eventType,
            label: item.eventLabel ?? item.eventType,
            occurredAt: item.timeWindowStart ?? new Date().toISOString(),
            severity: item.severity,
            directions: item.riskDirections,
            evidenceSummary: formatEvidenceChain(item.evidence),
        })),
    };
}
function startTodayRiskEvaluation() {
    const todayArchive = buildTodayRiskArchive();
    if (!todayArchive) {
        return;
    }
    isEvaluatingTodayRisk.value = true;
    revealTodayRiskTimer = setTimeout(() => {
        archives.value = [todayArchive, ...archives.value.filter((item) => item.date !== todayKey)];
        activeDayIndex.value = 0;
        selectedDay.value = todayArchive;
        isEvaluatingTodayRisk.value = false;
        revealTodayRiskTimer = null;
    }, 1800);
}
onMounted(() => {
    if (shouldSyncTodayRisk) {
        startTodayRiskEvaluation();
    }
});
onBeforeUnmount(() => {
    if (revealTodayRiskTimer) {
        clearTimeout(revealTodayRiskTimer);
    }
});
const __VLS_ctx = {
    ...{},
    ...{},
};
let __VLS_components;
let __VLS_intrinsics;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['risk-page']} */ ;
/** @type {__VLS_StyleScopedClasses['risk-page']} */ ;
/** @type {__VLS_StyleScopedClasses['summary-card']} */ ;
/** @type {__VLS_StyleScopedClasses['summary-card__heading']} */ ;
/** @type {__VLS_StyleScopedClasses['summary-card__heading']} */ ;
/** @type {__VLS_StyleScopedClasses['metric-item__copy']} */ ;
/** @type {__VLS_StyleScopedClasses['metric-item']} */ ;
/** @type {__VLS_StyleScopedClasses['metric-item__meta']} */ ;
/** @type {__VLS_StyleScopedClasses['date-switcher']} */ ;
/** @type {__VLS_StyleScopedClasses['date-nav']} */ ;
/** @type {__VLS_StyleScopedClasses['date-nav']} */ ;
/** @type {__VLS_StyleScopedClasses['action-button--ghost']} */ ;
/** @type {__VLS_StyleScopedClasses['stream-item']} */ ;
/** @type {__VLS_StyleScopedClasses['event-item']} */ ;
/** @type {__VLS_StyleScopedClasses['stream-item']} */ ;
/** @type {__VLS_StyleScopedClasses['event-item']} */ ;
/** @type {__VLS_StyleScopedClasses['stream-item--danger']} */ ;
/** @type {__VLS_StyleScopedClasses['stream-item--warning']} */ ;
/** @type {__VLS_StyleScopedClasses['stream-item--info']} */ ;
/** @type {__VLS_StyleScopedClasses['event-item']} */ ;
/** @type {__VLS_StyleScopedClasses['status-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['inference-footer']} */ ;
/** @type {__VLS_StyleScopedClasses['inference-banner']} */ ;
/** @type {__VLS_StyleScopedClasses['inference-footer']} */ ;
/** @type {__VLS_StyleScopedClasses['inference-footer']} */ ;
/** @type {__VLS_StyleScopedClasses['inference-banner']} */ ;
/** @type {__VLS_StyleScopedClasses['inference-footer']} */ ;
/** @type {__VLS_StyleScopedClasses['inference-banner']} */ ;
/** @type {__VLS_StyleScopedClasses['modal-head']} */ ;
/** @type {__VLS_StyleScopedClasses['modal-head']} */ ;
/** @type {__VLS_StyleScopedClasses['patient-name']} */ ;
/** @type {__VLS_StyleScopedClasses['summary-card__top']} */ ;
/** @type {__VLS_StyleScopedClasses['section-header']} */ ;
/** @type {__VLS_StyleScopedClasses['modal-head']} */ ;
/** @type {__VLS_StyleScopedClasses['stream-head']} */ ;
/** @type {__VLS_StyleScopedClasses['event-item__top']} */ ;
/** @type {__VLS_StyleScopedClasses['section-actions']} */ ;
/** @type {__VLS_StyleScopedClasses['metric-item']} */ ;
/** @type {__VLS_StyleScopedClasses['metric-item']} */ ;
/** @type {__VLS_StyleScopedClasses['metric-item__copy']} */ ;
/** @type {__VLS_StyleScopedClasses['metric-item__meta']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "mobile-page risk-page" },
});
/** @type {__VLS_StyleScopedClasses['mobile-page']} */ ;
/** @type {__VLS_StyleScopedClasses['risk-page']} */ ;
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
__VLS_asFunctionalElement1(__VLS_intrinsics.h1, __VLS_intrinsics.h1)({
    ...{ class: "patient-name" },
});
/** @type {__VLS_StyleScopedClasses['patient-name']} */ ;
(__VLS_ctx.pageTitle);
__VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
    ...{ class: "patient-badge" },
});
/** @type {__VLS_StyleScopedClasses['patient-badge']} */ ;
(__VLS_ctx.patient.patientName);
__VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
    ...{ class: "patient-subtitle" },
});
/** @type {__VLS_StyleScopedClasses['patient-subtitle']} */ ;
(__VLS_ctx.pageSubtitle);
__VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
    ...{ class: "summary-card" },
});
/** @type {__VLS_StyleScopedClasses['summary-card']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.img)({
    ...{ class: "summary-card__bg" },
    src: (__VLS_ctx.bannerImage),
    alt: "",
});
/** @type {__VLS_StyleScopedClasses['summary-card__bg']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "summary-card__content" },
});
/** @type {__VLS_StyleScopedClasses['summary-card__content']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "summary-card__top" },
});
/** @type {__VLS_StyleScopedClasses['summary-card__top']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "summary-card__heading" },
});
/** @type {__VLS_StyleScopedClasses['summary-card__heading']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({});
(__VLS_ctx.summaryTitle);
__VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
(__VLS_ctx.summaryNote);
__VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
    ...{ class: (`status-chip status-chip--${__VLS_ctx.priorityMeta.tone}`) },
});
(__VLS_ctx.priorityMeta.label);
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "summary-card__body" },
});
/** @type {__VLS_StyleScopedClasses['summary-card__body']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "metrics-row" },
});
/** @type {__VLS_StyleScopedClasses['metrics-row']} */ ;
for (const [item] of __VLS_vFor((__VLS_ctx.metricCards))) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
        key: (item.label),
        ...{ class: "metric-item" },
        ...{ class: ([`metric-item--${item.theme}`, { 'metric-item--featured': item.featured }]) },
    });
    /** @type {__VLS_StyleScopedClasses['metric-item']} */ ;
    /** @type {__VLS_StyleScopedClasses['metric-item--featured']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "metric-item__copy" },
    });
    /** @type {__VLS_StyleScopedClasses['metric-item__copy']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    (item.label);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "metric-item__meta" },
    });
    /** @type {__VLS_StyleScopedClasses['metric-item__meta']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
    (item.score);
    __VLS_asFunctionalElement1(__VLS_intrinsics.em, __VLS_intrinsics.em)({});
    (__VLS_ctx.riskLevel(item.score));
    // @ts-ignore
    [pageTitle, patient, pageSubtitle, bannerImage, summaryTitle, summaryNote, priorityMeta, priorityMeta, metricCards, riskLevel,];
}
if (__VLS_ctx.isEvaluatingTodayRisk) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "glass-section risk-thinking-panel" },
    });
    /** @type {__VLS_StyleScopedClasses['glass-section']} */ ;
    /** @type {__VLS_StyleScopedClasses['risk-thinking-panel']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "inference-banner" },
    });
    /** @type {__VLS_StyleScopedClasses['inference-banner']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
}
__VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
    ...{ class: "glass-section timeline-panel" },
});
/** @type {__VLS_StyleScopedClasses['glass-section']} */ ;
/** @type {__VLS_StyleScopedClasses['timeline-panel']} */ ;
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
(__VLS_ctx.formatArchiveDate(__VLS_ctx.activeArchive.date));
__VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
    ...{ class: "section-note" },
});
/** @type {__VLS_StyleScopedClasses['section-note']} */ ;
(__VLS_ctx.activeArchive.summary);
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "section-actions" },
});
/** @type {__VLS_StyleScopedClasses['section-actions']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "date-switcher" },
});
/** @type {__VLS_StyleScopedClasses['date-switcher']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
    ...{ onClick: (__VLS_ctx.goToOlderDate) },
    ...{ class: "date-nav" },
    disabled: (!__VLS_ctx.canViewOlderDate),
});
/** @type {__VLS_StyleScopedClasses['date-nav']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
    ...{ onClick: (__VLS_ctx.goToNewerDate) },
    ...{ class: "date-nav" },
    disabled: (!__VLS_ctx.canViewNewerDate),
});
/** @type {__VLS_StyleScopedClasses['date-nav']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
    ...{ onClick: (__VLS_ctx.openDay) },
    ...{ class: "action-button action-button--ghost" },
});
/** @type {__VLS_StyleScopedClasses['action-button']} */ ;
/** @type {__VLS_StyleScopedClasses['action-button--ghost']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "stream-list" },
});
/** @type {__VLS_StyleScopedClasses['stream-list']} */ ;
for (const [event] of __VLS_vFor((__VLS_ctx.activeArchive.events))) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
        key: (`${__VLS_ctx.activeArchive.date}-${event.code}-${event.occurredAt}`),
        ...{ class: "stream-item" },
        ...{ class: (`stream-item--${__VLS_ctx.getRiskTone(event.severity)}`) },
    });
    /** @type {__VLS_StyleScopedClasses['stream-item']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "stream-head" },
    });
    /** @type {__VLS_StyleScopedClasses['stream-head']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "stream-copy" },
    });
    /** @type {__VLS_StyleScopedClasses['stream-copy']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
    (event.label);
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "stream-time" },
    });
    /** @type {__VLS_StyleScopedClasses['stream-time']} */ ;
    (__VLS_ctx.formatDateTime(event.occurredAt));
    __VLS_asFunctionalElement1(__VLS_intrinsics.pre, __VLS_intrinsics.pre)({
        ...{ class: "stream-evidence" },
    });
    /** @type {__VLS_StyleScopedClasses['stream-evidence']} */ ;
    (event.evidenceSummary);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "stream-tag-row" },
    });
    /** @type {__VLS_StyleScopedClasses['stream-tag-row']} */ ;
    for (const [direction] of __VLS_vFor((event.directions))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            key: (`${event.code}-${direction}`),
            ...{ class: "stream-tag" },
        });
        /** @type {__VLS_StyleScopedClasses['stream-tag']} */ ;
        (__VLS_ctx.formatDirection(direction));
        // @ts-ignore
        [isEvaluatingTodayRisk, formatArchiveDate, activeArchive, activeArchive, activeArchive, activeArchive, goToOlderDate, canViewOlderDate, goToNewerDate, canViewNewerDate, openDay, getRiskTone, formatDateTime, formatDirection,];
    }
    // @ts-ignore
    [];
}
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "inference-footer" },
});
/** @type {__VLS_StyleScopedClasses['inference-footer']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
(__VLS_ctx.activeArchive.inferredRisk);
__VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
(__VLS_ctx.formatConfidence(__VLS_ctx.activeArchive.confidence));
if (__VLS_ctx.selectedDay) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ onClick: (__VLS_ctx.closeDay) },
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
    (__VLS_ctx.formatArchiveDate(__VLS_ctx.selectedDay.date));
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    (__VLS_ctx.selectedDay.summary);
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (__VLS_ctx.closeDay) },
        ...{ class: "close-btn" },
    });
    /** @type {__VLS_StyleScopedClasses['close-btn']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "inference-banner" },
    });
    /** @type {__VLS_StyleScopedClasses['inference-banner']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    (__VLS_ctx.selectedDay.inferredRisk);
    __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
    (__VLS_ctx.formatConfidence(__VLS_ctx.selectedDay.confidence));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "event-list" },
    });
    /** @type {__VLS_StyleScopedClasses['event-list']} */ ;
    for (const [event] of __VLS_vFor((__VLS_ctx.selectedDay.events))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
            key: (`${__VLS_ctx.selectedDay.date}-${event.code}-${event.occurredAt}`),
            ...{ class: "event-item" },
        });
        /** @type {__VLS_StyleScopedClasses['event-item']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "event-item__top" },
        });
        /** @type {__VLS_StyleScopedClasses['event-item__top']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "event-item__code" },
        });
        /** @type {__VLS_StyleScopedClasses['event-item__code']} */ ;
        (event.code);
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        (event.label);
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: (`severity-pill severity-pill--${__VLS_ctx.getRiskTone(event.severity)}`) },
        });
        (event.severity);
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "event-item__time" },
        });
        /** @type {__VLS_StyleScopedClasses['event-item__time']} */ ;
        (__VLS_ctx.formatDateTime(event.occurredAt));
        __VLS_asFunctionalElement1(__VLS_intrinsics.pre, __VLS_intrinsics.pre)({
            ...{ class: "event-item__summary" },
        });
        /** @type {__VLS_StyleScopedClasses['event-item__summary']} */ ;
        (event.evidenceSummary);
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "stream-tag-row" },
        });
        /** @type {__VLS_StyleScopedClasses['stream-tag-row']} */ ;
        for (const [direction] of __VLS_vFor((event.directions))) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                key: (`${event.code}-${direction}-modal`),
                ...{ class: "stream-tag" },
            });
            /** @type {__VLS_StyleScopedClasses['stream-tag']} */ ;
            (__VLS_ctx.formatDirection(direction));
            // @ts-ignore
            [formatArchiveDate, activeArchive, activeArchive, getRiskTone, formatDateTime, formatDirection, formatConfidence, formatConfidence, selectedDay, selectedDay, selectedDay, selectedDay, selectedDay, selectedDay, selectedDay, closeDay, closeDay,];
        }
        // @ts-ignore
        [];
    }
}
// @ts-ignore
[];
const __VLS_export = (await import('vue')).defineComponent({});
export default {};
