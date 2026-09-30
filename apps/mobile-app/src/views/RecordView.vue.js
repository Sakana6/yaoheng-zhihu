import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { mobileApi } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { useMvpStore } from '../stores/mvp';
import homeCardBg from '../static/pictures/home-card.jpg';
const pageTitle = '反馈记录中心';
const pageSubtitle = '记录页和“我的”页面共用同一份提醒数据，按提醒时间进入时间流，补录完整后才允许进入事件流。';
const reminderTitleMap = {
    'Morning medication reminder': '晨间服药提醒',
    'Midday follow-up reminder': '午间追访提醒',
    'Evening medication reminder': '晚间服药提醒',
};
const quickPresets = [
    { id: 'symptom', label: '症状反馈', text: '患者反馈服药后短暂乏力，已补充进食与饮水，15 分钟后缓解。' },
    { id: 'meal', label: '进食情况', text: '患者进食偏少，已提醒补餐并继续观察后续状态。' },
    { id: 'followup', label: '执行备注', text: '已电话回访确认，本次缺失窗口已补录完成，后续继续追踪。' },
];
const router = useRouter();
const mvpStore = useMvpStore();
const loading = ref(true);
const error = ref('');
const patient = ref(null);
const reminders = ref([]);
const medications = ref([]);
const feedbackRecords = ref([]);
const timelineFilter = ref('all');
const selectedRecord = ref(null);
const supplementText = ref('');
const savingSupplement = ref(false);
const supplementMessage = ref('');
const activeTimelineDateKey = ref('');
function toDateKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
function shiftDate(base, offsetDays) {
    const result = new Date(base);
    result.setDate(result.getDate() + offsetDays);
    return result;
}
function atTime(baseDate, hour, minute) {
    const result = new Date(baseDate);
    result.setHours(hour, minute, 0, 0);
    return result.toISOString();
}
function buildDynamicId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function formatReminderTitle(title) {
    return reminderTitleMap[title] ?? title;
}
function formatDateLabel(dateKey) {
    const [year, month, day] = dateKey.split('-');
    if (!year || !month || !day) {
        return '暂无日期';
    }
    return `${year}年${Number(month)}月${Number(day)}日`;
}
function sortRecords(records) {
    return [...records].sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());
}
function getRecordTone(status) {
    return status === 'done' ? 'success' : 'warning';
}
function buildStatusTags(status, medicationName, timeLabel) {
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
function buildStructuredOutput(summary, status, medicationName, nextAction) {
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
function getReminderStatus(reminder) {
    return reminder.status === 'SUCCESS' || reminder.status === 'DONE' ? 'done' : 'missed';
}
function buildHistoryRecords(reminderList, medicationList) {
    const yesterday = shiftDate(new Date(), -1);
    const medicationPool = medicationList.length > 0 ? medicationList.map((item) => item.genericName) : ['缬沙坦', '阿托伐他汀', '二甲双胍'];
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
            structuredOutput: buildStructuredOutput('晨间服药后出现短暂不适，已通过补餐和观察完成闭环。', 'done', reminderPool[0]?.medicationName ?? medicationPool[0], '维持早餐后服药节奏，继续观察今日同时间段状态。'),
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
            structuredOutput: buildStructuredOutput('午间反馈存在缺口，后续需要人工补齐以恢复完整时间流。', 'missed', reminderPool[1]?.medicationName ?? medicationPool[1] ?? medicationPool[0], '优先补录午间状态与进食情况，再继续晚间追踪。'),
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
            structuredOutput: buildStructuredOutput('晚间执行正常，无新增异常，时间流记录完整。', 'done', reminderPool[2]?.medicationName ?? medicationPool[2] ?? medicationPool[0], '继续保持当前随访节奏。'),
        },
    ];
}
function buildReminderRecord(reminder, existing) {
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
        rawConversation: existing?.rawConversation ??
            [
                { role: '我的页面', text: `新增提醒：${title}` },
                { role: '系统', text: `提醒时间：${timeLabel}` },
                { role: '系统', text: reminder.followUpPrompt?.trim() || '等待护理员补充本次提醒的执行反馈。' },
            ],
        structuredOutput: existing?.structuredOutput ??
            buildStructuredOutput(status === 'done' ? `${title} 已完成记录，可进入后续事件判断。` : `${title} 尚未完成记录。`, status, medicationName, status === 'done' ? '保持当前记录节奏。' : '补齐本条提醒反馈后，才能生成事件流。'),
        medicationName,
    };
}
function syncTimelineRecords(reminderList, medicationList) {
    const existingMap = new Map(feedbackRecords.value.map((item) => [item.id, item]));
    const historyRecords = buildHistoryRecords(reminderList, medicationList).map((record) => existingMap.get(record.id) ?? record);
    const reminderRecords = reminderList.map((item) => buildReminderRecord(item, existingMap.get(`reminder-${item.reminderId}`)));
    const manualRecords = feedbackRecords.value.filter((item) => item.kind === 'manual');
    feedbackRecords.value = sortRecords([...historyRecords, ...reminderRecords, ...manualRecords]);
    if (selectedRecord.value) {
        selectedRecord.value = feedbackRecords.value.find((item) => item.id === selectedRecord.value?.id) ?? null;
    }
}
async function loadPage() {
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
        if (!mvpStore.state.medications.length && loadedMedications.length) {
            mvpStore.syncMedicationData(loadedMedications, loadedReminders);
        }
        medications.value = mvpStore.state.medications.length ? [...mvpStore.state.medications] : loadedMedications;
        reminders.value = mvpStore.state.reminders.length ? [...mvpStore.state.reminders] : loadedReminders;
        syncTimelineRecords(reminders.value, medications.value);
    }
    catch (err) {
        error.value = err instanceof Error ? err.message : '记录页面加载失败';
    }
    finally {
        loading.value = false;
    }
}
function setTimelineFilter(next) {
    timelineFilter.value = next;
}
function openRecord(record) {
    selectedRecord.value = record;
    supplementText.value = '';
    supplementMessage.value = '';
}
function closeRecord() {
    selectedRecord.value = null;
    supplementText.value = '';
    supplementMessage.value = '';
}
function applyPreset(preset) {
    supplementText.value = preset.text;
}
function buildSupplementTags(record) {
    return [
        { icon: '✅', text: '已补录完成', tone: 'success' },
        { icon: '🕒', text: formatDateTime(new Date().toISOString()), tone: 'info' },
        { icon: '💊', text: record.medicationName ?? record.chip, tone: 'neutral' },
    ];
}
async function saveSupplement() {
    if (!selectedRecord.value || !supplementText.value.trim()) {
        supplementMessage.value = '请先填写补录内容。';
        return;
    }
    savingSupplement.value = true;
    supplementMessage.value = '';
    try {
        const currentRecord = selectedRecord.value;
        const savedAt = new Date().toISOString();
        const supplement = supplementText.value.trim();
        feedbackRecords.value = sortRecords(feedbackRecords.value.map((item) => item.id === currentRecord.id
            ? {
                ...item,
                detail: `${item.detail} 已补录：${supplement}`,
                tone: 'green',
                status: 'done',
                tags: buildSupplementTags(item),
                rawConversation: [...item.rawConversation, { role: '护理员补录', text: supplement }],
                structuredOutput: [
                    ...item.structuredOutput.filter((field) => field.label !== '处理状态'),
                    { icon: '✅', label: '处理状态', value: '补录后已闭环', tone: 'success' },
                    { icon: '📝', label: '补录备注', value: supplement, tone: 'info' },
                ],
            }
            : item));
        feedbackRecords.value.unshift({
            id: buildDynamicId('manual-record'),
            kind: 'manual',
            title: `补录反馈 · ${currentRecord.title}`,
            detail: supplement,
            timestamp: savedAt,
            chip: currentRecord.medicationName ?? currentRecord.chip,
            tone: 'blue',
            status: 'done',
            medicationName: currentRecord.medicationName,
            tags: [
                { icon: '📝', text: '人工补录', tone: 'info' },
                { icon: '✅', text: '已同步回时间流', tone: 'success' },
                { icon: '💊', text: currentRecord.medicationName ?? currentRecord.chip, tone: 'neutral' },
            ],
            rawConversation: [
                { role: '护理员补录', text: supplement },
                { role: '系统', text: '补录内容已回写原记录，并生成新的追踪节点。' },
            ],
            structuredOutput: [
                { icon: '📝', label: '补录内容', value: supplement, tone: 'info' },
                { icon: '✅', label: '同步结果', value: '原记录已闭环，新补录节点已生成', tone: 'success' },
                { icon: '📌', label: '后续动作', value: '继续检查剩余提醒是否已全部完成。', tone: 'info' },
            ],
        });
        feedbackRecords.value = sortRecords(feedbackRecords.value);
        if (currentRecord.sourceReminderId) {
            mvpStore.updateReminderStatus(currentRecord.sourceReminderId, 'DONE');
        }
        supplementMessage.value = '补录内容已保存。';
        selectedRecord.value = feedbackRecords.value.find((item) => item.id === currentRecord.id) ?? null;
        supplementText.value = '';
    }
    finally {
        savingSupplement.value = false;
    }
}
function goToOlderDate() {
    if (!canViewOlderDate.value) {
        return;
    }
    activeTimelineDateKey.value = availableDateKeys.value[activeDateIndex.value + 1];
}
function goToNewerDate() {
    if (!canViewNewerDate.value) {
        return;
    }
    activeTimelineDateKey.value = availableDateKeys.value[activeDateIndex.value - 1];
}
function goToJointEvents() {
    if (!canEnterJointEvents.value) {
        return;
    }
    if (!mvpStore.state.recordSeeded) {
        mvpStore.seedMvpRecord();
    }
    if (!mvpStore.state.inquiryCompleted) {
        mvpStore.completeInquiry();
    }
    mvpStore.generateRisk();
    if (typeof window !== 'undefined') {
        window.sessionStorage.setItem('risk-view-sync-from-record', '1');
    }
    void router.push('/risk');
}
onMounted(loadPage);
watch(() => mvpStore.state.reminders, (next) => {
    reminders.value = next.map((item) => ({ ...item }));
    syncTimelineRecords(reminders.value, medications.value);
}, { deep: true });
watch(() => mvpStore.state.medications, (next) => {
    medications.value = next.map((item) => ({ ...item }));
    syncTimelineRecords(reminders.value, medications.value);
}, { deep: true });
const patientName = computed(() => patient.value?.patientName ?? '演示患者');
const todayKey = computed(() => toDateKey(new Date()));
const yesterdayKey = computed(() => toDateKey(shiftDate(new Date(), -1)));
const dateBuckets = computed(() => {
    const buckets = new Map();
    for (const record of feedbackRecords.value) {
        const key = toDateKey(record.timestamp);
        const items = buckets.get(key) ?? [];
        items.push(record);
        buckets.set(key, items);
    }
    return buckets;
});
const availableDateKeys = computed(() => Array.from(dateBuckets.value.keys()).sort((left, right) => new Date(right).getTime() - new Date(left).getTime()));
watch(availableDateKeys, (keys) => {
    if (!keys.length) {
        activeTimelineDateKey.value = todayKey.value;
        return;
    }
    if (!activeTimelineDateKey.value || !keys.includes(activeTimelineDateKey.value)) {
        activeTimelineDateKey.value = keys.includes(todayKey.value) ? todayKey.value : keys[0];
    }
}, { immediate: true });
const activeDateIndex = computed(() => availableDateKeys.value.indexOf(activeTimelineDateKey.value));
const canViewOlderDate = computed(() => activeDateIndex.value >= 0 && activeDateIndex.value < availableDateKeys.value.length - 1);
const canViewNewerDate = computed(() => activeDateIndex.value > 0);
const timelineDateLabel = computed(() => formatDateLabel(activeTimelineDateKey.value));
const yesterdaySummaryDateKey = computed(() => {
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
const todayReminderRecords = computed(() => feedbackRecords.value.filter((item) => item.kind === 'reminder' && toDateKey(item.timestamp) === todayKey.value));
const completedTodayReminderCount = computed(() => todayReminderRecords.value.filter((item) => item.status === 'done').length);
const pendingTodayReminderCount = computed(() => todayReminderRecords.value.filter((item) => item.status !== 'done').length);
const canEnterJointEvents = computed(() => todayReminderRecords.value.length > 0 && pendingTodayReminderCount.value === 0);
const jointEventStatusLabel = computed(() => {
    if (!todayReminderRecords.value.length) {
        return '暂无今日提醒';
    }
    if (canEnterJointEvents.value) {
        return '可进入事件流';
    }
    return `待补录 ${pendingTodayReminderCount.value} 条`;
});
const jointEventHint = computed(() => {
    if (!todayReminderRecords.value.length) {
        return '先在“我的”页面添加提醒，记录页会按提醒时间同步展示。';
    }
    if (!canEnterJointEvents.value) {
        return `今日共 ${todayReminderRecords.value.length} 条提醒，仍有 ${pendingTodayReminderCount.value} 条未补录，当前不能生成事件流。`;
    }
    return `今日 ${completedTodayReminderCount.value} 条提醒已全部完成，进入后会将今日风险事件统一到风险页。`;
});
const yesterdayAiSummary = computed(() => {
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
        sentence: yesterdayMissedCount.value > 0
            ? `昨日共识别 ${yesterdayRecords.value.length} 条反馈，其中 ${yesterdayMissedCount.value} 条存在遗漏，建议今天优先补齐对应窗口。`
            : `昨日共识别 ${yesterdayRecords.value.length} 条反馈，整体节奏稳定，可继续保持当前随访频率。`,
        metrics: [
            `已完成 ${yesterdayDoneCount.value} 条`,
            `缺失 ${yesterdayMissedCount.value} 条`,
            titles.length ? `重点节点 ${titles.join(' / ')}` : '暂无重点节点',
        ],
    };
});
const __VLS_ctx = {
    ...{},
    ...{},
};
let __VLS_components;
let __VLS_intrinsics;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['record-page']} */ ;
/** @type {__VLS_StyleScopedClasses['record-page']} */ ;
/** @type {__VLS_StyleScopedClasses['summary-card']} */ ;
/** @type {__VLS_StyleScopedClasses['summary-card__heading']} */ ;
/** @type {__VLS_StyleScopedClasses['section-actions--timeline']} */ ;
/** @type {__VLS_StyleScopedClasses['section-actions--timeline']} */ ;
/** @type {__VLS_StyleScopedClasses['tab-group']} */ ;
/** @type {__VLS_StyleScopedClasses['tag-pill']} */ ;
/** @type {__VLS_StyleScopedClasses['close-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['tag-pill']} */ ;
/** @type {__VLS_StyleScopedClasses['date-nav']} */ ;
/** @type {__VLS_StyleScopedClasses['date-nav']} */ ;
/** @type {__VLS_StyleScopedClasses['date-switcher__label']} */ ;
/** @type {__VLS_StyleScopedClasses['date-switcher__label']} */ ;
/** @type {__VLS_StyleScopedClasses['stream-item']} */ ;
/** @type {__VLS_StyleScopedClasses['stream-copy']} */ ;
/** @type {__VLS_StyleScopedClasses['stream-copy']} */ ;
/** @type {__VLS_StyleScopedClasses['stream-tag-row']} */ ;
/** @type {__VLS_StyleScopedClasses['status-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['modal-head']} */ ;
/** @type {__VLS_StyleScopedClasses['modal-head']} */ ;
/** @type {__VLS_StyleScopedClasses['record-detail-row']} */ ;
/** @type {__VLS_StyleScopedClasses['record-detail-row']} */ ;
/** @type {__VLS_StyleScopedClasses['record-detail-row--stack']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-section__head']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-section__head']} */ ;
/** @type {__VLS_StyleScopedClasses['dialogue-item']} */ ;
/** @type {__VLS_StyleScopedClasses['structured-item']} */ ;
/** @type {__VLS_StyleScopedClasses['structured-item']} */ ;
/** @type {__VLS_StyleScopedClasses['action-button']} */ ;
/** @type {__VLS_StyleScopedClasses['record-page']} */ ;
/** @type {__VLS_StyleScopedClasses['patient-name']} */ ;
/** @type {__VLS_StyleScopedClasses['section-header']} */ ;
/** @type {__VLS_StyleScopedClasses['stream-head']} */ ;
/** @type {__VLS_StyleScopedClasses['modal-head']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-section__head']} */ ;
/** @type {__VLS_StyleScopedClasses['record-detail-row']} */ ;
/** @type {__VLS_StyleScopedClasses['date-switcher']} */ ;
/** @type {__VLS_StyleScopedClasses['date-switcher__label']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "mobile-page record-page" },
});
/** @type {__VLS_StyleScopedClasses['mobile-page']} */ ;
/** @type {__VLS_StyleScopedClasses['record-page']} */ ;
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
    (__VLS_ctx.patientName);
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
        src: (__VLS_ctx.homeCardBg),
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
    (__VLS_ctx.yesterdayMissedCount > 0 ? '⚠️ ' : '✅ ');
    (__VLS_ctx.yesterdayAiSummary.title);
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    (__VLS_ctx.yesterdayAiSummary.subtitle);
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "summary-card__date" },
    });
    /** @type {__VLS_StyleScopedClasses['summary-card__date']} */ ;
    (__VLS_ctx.yesterdaySummaryLabel);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "summary-card__body" },
    });
    /** @type {__VLS_StyleScopedClasses['summary-card__body']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
        ...{ class: "summary-card__sentence" },
    });
    /** @type {__VLS_StyleScopedClasses['summary-card__sentence']} */ ;
    (__VLS_ctx.yesterdayAiSummary.sentence);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "summary-card__metrics" },
    });
    /** @type {__VLS_StyleScopedClasses['summary-card__metrics']} */ ;
    for (const [metric] of __VLS_vFor((__VLS_ctx.yesterdayAiSummary.metrics))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            key: (metric),
            ...{ class: "summary-card__metric" },
        });
        /** @type {__VLS_StyleScopedClasses['summary-card__metric']} */ ;
        (metric);
        // @ts-ignore
        [loading, error, error, pageTitle, patientName, pageSubtitle, homeCardBg, yesterdayMissedCount, yesterdayAiSummary, yesterdayAiSummary, yesterdayAiSummary, yesterdayAiSummary, yesterdaySummaryLabel,];
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
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
        ...{ class: "section-note" },
    });
    /** @type {__VLS_StyleScopedClasses['section-note']} */ ;
    (__VLS_ctx.timelineDateLabel);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "section-actions section-actions--timeline" },
    });
    /** @type {__VLS_StyleScopedClasses['section-actions']} */ ;
    /** @type {__VLS_StyleScopedClasses['section-actions--timeline']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "tab-group" },
    });
    /** @type {__VLS_StyleScopedClasses['tab-group']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!!(__VLS_ctx.loading))
                    return;
                if (!!(__VLS_ctx.error))
                    return;
                __VLS_ctx.setTimelineFilter('all');
                // @ts-ignore
                [timelineDateLabel, setTimelineFilter,];
            } },
        ...{ class: (['tag-pill', { active: __VLS_ctx.timelineFilter === 'all' }]) },
    });
    /** @type {__VLS_StyleScopedClasses['active']} */ ;
    /** @type {__VLS_StyleScopedClasses['tag-pill']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!!(__VLS_ctx.loading))
                    return;
                if (!!(__VLS_ctx.error))
                    return;
                __VLS_ctx.setTimelineFilter('missed');
                // @ts-ignore
                [setTimelineFilter, timelineFilter,];
            } },
        ...{ class: (['tag-pill', { active: __VLS_ctx.timelineFilter === 'missed' }]) },
    });
    /** @type {__VLS_StyleScopedClasses['active']} */ ;
    /** @type {__VLS_StyleScopedClasses['tag-pill']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!!(__VLS_ctx.loading))
                    return;
                if (!!(__VLS_ctx.error))
                    return;
                __VLS_ctx.setTimelineFilter('done');
                // @ts-ignore
                [setTimelineFilter, timelineFilter,];
            } },
        ...{ class: (['tag-pill', { active: __VLS_ctx.timelineFilter === 'done' }]) },
    });
    /** @type {__VLS_StyleScopedClasses['active']} */ ;
    /** @type {__VLS_StyleScopedClasses['tag-pill']} */ ;
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
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "date-switcher__label" },
    });
    /** @type {__VLS_StyleScopedClasses['date-switcher__label']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
    (__VLS_ctx.timelineDateLabel);
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (__VLS_ctx.goToNewerDate) },
        ...{ class: "date-nav" },
        disabled: (!__VLS_ctx.canViewNewerDate),
    });
    /** @type {__VLS_StyleScopedClasses['date-nav']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "stream-list" },
    });
    /** @type {__VLS_StyleScopedClasses['stream-list']} */ ;
    for (const [record] of __VLS_vFor((__VLS_ctx.filteredTimelineRecords))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
            ...{ onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.loading))
                        return;
                    if (!!(__VLS_ctx.error))
                        return;
                    __VLS_ctx.openRecord(record);
                    // @ts-ignore
                    [timelineDateLabel, timelineFilter, goToOlderDate, canViewOlderDate, goToNewerDate, canViewNewerDate, filteredTimelineRecords, openRecord,];
                } },
            key: (record.id),
            ...{ class: "stream-item" },
            ...{ class: (`stream-item--${record.tone}`) },
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
        (record.title);
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (record.detail);
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "stream-time" },
        });
        /** @type {__VLS_StyleScopedClasses['stream-time']} */ ;
        (__VLS_ctx.formatDateTime(record.timestamp));
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "stream-tag-row" },
        });
        /** @type {__VLS_StyleScopedClasses['stream-tag-row']} */ ;
        for (const [tag] of __VLS_vFor((record.tags))) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                key: (`${record.id}-${tag.icon}-${tag.text}`),
                ...{ class: (`stream-tag stream-tag--${tag.tone}`) },
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            (tag.icon);
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            (tag.text);
            // @ts-ignore
            [formatDateTime,];
        }
        // @ts-ignore
        [];
    }
    if (!__VLS_ctx.filteredTimelineRecords.length) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "empty-state" },
        });
        /** @type {__VLS_StyleScopedClasses['empty-state']} */ ;
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "glass-section joint-entry-panel" },
    });
    /** @type {__VLS_StyleScopedClasses['glass-section']} */ ;
    /** @type {__VLS_StyleScopedClasses['joint-entry-panel']} */ ;
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
    (__VLS_ctx.canEnterJointEvents ? '✅' : '⚠️');
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
        ...{ class: "section-note" },
    });
    /** @type {__VLS_StyleScopedClasses['section-note']} */ ;
    (__VLS_ctx.jointEventHint);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "joint-entry-panel__actions" },
    });
    /** @type {__VLS_StyleScopedClasses['joint-entry-panel__actions']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "status-chip" },
        ...{ class: (__VLS_ctx.canEnterJointEvents ? 'status-chip--success' : 'status-chip--warning') },
    });
    /** @type {__VLS_StyleScopedClasses['status-chip']} */ ;
    (__VLS_ctx.jointEventStatusLabel);
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (__VLS_ctx.goToJointEvents) },
        ...{ class: "action-button action-button--secondary" },
        disabled: (!__VLS_ctx.canEnterJointEvents),
    });
    /** @type {__VLS_StyleScopedClasses['action-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['action-button--secondary']} */ ;
    (__VLS_ctx.canEnterJointEvents ? '✅ 进入事件流' : '⚠️ 进入事件流');
}
if (__VLS_ctx.selectedRecord) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ onClick: (__VLS_ctx.closeRecord) },
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
    (__VLS_ctx.selectedRecord.title);
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    (__VLS_ctx.formatDateTime(__VLS_ctx.selectedRecord.timestamp));
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (__VLS_ctx.closeRecord) },
        ...{ class: "close-btn" },
    });
    /** @type {__VLS_StyleScopedClasses['close-btn']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "record-detail-card" },
    });
    /** @type {__VLS_StyleScopedClasses['record-detail-card']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "record-detail-row" },
    });
    /** @type {__VLS_StyleScopedClasses['record-detail-row']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({
        ...{ class: (`status-chip status-chip--${__VLS_ctx.getRecordTone(__VLS_ctx.selectedRecord.status)}`) },
    });
    (__VLS_ctx.selectedRecord.status === 'done' ? '已完成反馈' : '待补录反馈');
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "record-detail-row" },
    });
    /** @type {__VLS_StyleScopedClasses['record-detail-row']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
    (__VLS_ctx.selectedRecord.chip);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "record-detail-row record-detail-row--stack" },
    });
    /** @type {__VLS_StyleScopedClasses['record-detail-row']} */ ;
    /** @type {__VLS_StyleScopedClasses['record-detail-row--stack']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    (__VLS_ctx.selectedRecord.detail);
    __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "detail-section" },
    });
    /** @type {__VLS_StyleScopedClasses['detail-section']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "detail-section__head" },
    });
    /** @type {__VLS_StyleScopedClasses['detail-section__head']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.h5, __VLS_intrinsics.h5)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "dialogue-list" },
    });
    /** @type {__VLS_StyleScopedClasses['dialogue-list']} */ ;
    for (const [line] of __VLS_vFor((__VLS_ctx.selectedRecord.rawConversation))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
            key: (`${__VLS_ctx.selectedRecord.id}-${line.role}-${line.text}`),
            ...{ class: "dialogue-item" },
        });
        /** @type {__VLS_StyleScopedClasses['dialogue-item']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "dialogue-role" },
        });
        /** @type {__VLS_StyleScopedClasses['dialogue-role']} */ ;
        (line.role);
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (line.text);
        // @ts-ignore
        [filteredTimelineRecords, formatDateTime, canEnterJointEvents, canEnterJointEvents, canEnterJointEvents, canEnterJointEvents, jointEventHint, jointEventStatusLabel, goToJointEvents, selectedRecord, selectedRecord, selectedRecord, selectedRecord, selectedRecord, selectedRecord, selectedRecord, selectedRecord, selectedRecord, closeRecord, closeRecord, getRecordTone,];
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "detail-section" },
    });
    /** @type {__VLS_StyleScopedClasses['detail-section']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "detail-section__head" },
    });
    /** @type {__VLS_StyleScopedClasses['detail-section__head']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.h5, __VLS_intrinsics.h5)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "structured-list" },
    });
    /** @type {__VLS_StyleScopedClasses['structured-list']} */ ;
    for (const [field] of __VLS_vFor((__VLS_ctx.selectedRecord.structuredOutput))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
            key: (`${__VLS_ctx.selectedRecord.id}-${field.label}`),
            ...{ class: (`structured-item structured-item--${field.tone}`) },
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        (field.icon);
        (field.label);
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        (field.value);
        // @ts-ignore
        [selectedRecord, selectedRecord,];
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "preset-row" },
    });
    /** @type {__VLS_StyleScopedClasses['preset-row']} */ ;
    for (const [preset] of __VLS_vFor((__VLS_ctx.quickPresets))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    if (!(__VLS_ctx.selectedRecord))
                        return;
                    __VLS_ctx.applyPreset(preset);
                    // @ts-ignore
                    [quickPresets, applyPreset,];
                } },
            key: (preset.id),
            ...{ class: "tag-pill" },
        });
        /** @type {__VLS_StyleScopedClasses['tag-pill']} */ ;
        (preset.label);
        // @ts-ignore
        [];
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "field-block" },
    });
    /** @type {__VLS_StyleScopedClasses['field-block']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
        ...{ class: "field-label" },
        for: "record-supplement",
    });
    /** @type {__VLS_StyleScopedClasses['field-label']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.textarea)({
        id: "record-supplement",
        value: (__VLS_ctx.supplementText),
        ...{ class: "input-surface input-surface--textarea" },
        placeholder: "补充本次反馈详情、患者原话或处理结果",
    });
    /** @type {__VLS_StyleScopedClasses['input-surface']} */ ;
    /** @type {__VLS_StyleScopedClasses['input-surface--textarea']} */ ;
    if (__VLS_ctx.supplementMessage) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "inline-message inline-message--success" },
        });
        /** @type {__VLS_StyleScopedClasses['inline-message']} */ ;
        /** @type {__VLS_StyleScopedClasses['inline-message--success']} */ ;
        (__VLS_ctx.supplementMessage);
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "action-row" },
    });
    /** @type {__VLS_StyleScopedClasses['action-row']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (__VLS_ctx.saveSupplement) },
        ...{ class: "action-button action-button--secondary" },
        disabled: (__VLS_ctx.savingSupplement || !__VLS_ctx.supplementText.trim()),
    });
    /** @type {__VLS_StyleScopedClasses['action-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['action-button--secondary']} */ ;
    (__VLS_ctx.savingSupplement ? '保存中...' : __VLS_ctx.selectedRecord.status === 'missed' ? '补录反馈' : '追加备注');
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (__VLS_ctx.closeRecord) },
        ...{ class: "action-button action-button--ghost" },
    });
    /** @type {__VLS_StyleScopedClasses['action-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['action-button--ghost']} */ ;
}
// @ts-ignore
[selectedRecord, closeRecord, supplementText, supplementText, supplementMessage, supplementMessage, saveSupplement, savingSupplement, savingSupplement,];
const __VLS_export = (await import('vue')).defineComponent({});
export default {};
