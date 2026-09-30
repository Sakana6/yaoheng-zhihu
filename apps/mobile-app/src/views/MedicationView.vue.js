import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { mobileApi } from '../lib/api';
import { formatStatus } from '../lib/format';
import { useMvpStore } from '../stores/mvp';
import homeCardImage from '../static/pictures/home-card.jpg';
echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);
const loading = ref(true);
const error = ref('');
const patient = ref(null);
const reminders = ref([]);
const medications = ref([]);
const mvpStore = useMvpStore();
const chartHost = ref(null);
const pageTitle = '用药管理中心';
const pageSubtitle = '今日用药依从情况稳定，建议重点关注高风险患者用药执行情况';
const timeRange = ref('7d');
const medicationFilter = ref('all');
const statusFilter = ref('all');
const dimensionFilter = ref('all');
const showHistoryModal = ref(false);
const showDayRecordsModal = ref(false);
const selectedDate = ref('04-21');
const selectedPointIndex = ref(0);
const historyMonth = ref('2026-04');
const selectedMedication = ref(null);
const tooltip = ref({
    visible: false,
    x: 0,
    y: 0,
    date: '',
    adherence: 0,
    missed: 0,
});
let trendChart = null;
const HISTORY_YEAR = 2026;
const historyWeekdays = ['日', '一', '二', '三', '四', '五', '六'];
const chartPalette = {
    adherence: '#4f8f78',
    adherenceActive: '#2f6f59',
    adherenceAreaTop: 'rgba(79, 143, 120, 0.24)',
    adherenceAreaBottom: 'rgba(79, 143, 120, 0.03)',
    adherenceShadow: 'rgba(79, 143, 120, 0.22)',
    adherencePointer: 'rgba(79, 143, 120, 0.26)',
    barActiveTop: 'rgba(96, 169, 255, 0.88)',
    barActiveBottom: 'rgba(96, 169, 255, 0.24)',
    barDefaultTop: 'rgba(197, 210, 225, 0.95)',
    barDefaultBottom: 'rgba(197, 210, 225, 0.28)',
};
const analysisCardStyle = {
    backgroundImage: `linear-gradient(180deg, rgba(229, 241, 253, 0.48) 0%, rgba(212, 231, 248, 0.24) 100%), url(${homeCardImage})`,
    backgroundPosition: 'center',
    backgroundSize: 'cover',
    backgroundRepeat: 'no-repeat',
};
const trendMap = {
    '7d': [
        { date: '04-15', adherence: 66, missed: 2 },
        { date: '04-16', adherence: 68, missed: 1 },
        { date: '04-17', adherence: 70, missed: 2 },
        { date: '04-18', adherence: 72, missed: 3 },
        { date: '04-19', adherence: 69, missed: 2 },
        { date: '04-20', adherence: 76, missed: 3 },
        { date: '04-21', adherence: 75, missed: 1 },
    ],
    '30d': [
        { date: '03-23', adherence: 64, missed: 3 },
        { date: '03-27', adherence: 65, missed: 3 },
        { date: '03-31', adherence: 67, missed: 2 },
        { date: '04-04', adherence: 68, missed: 2 },
        { date: '04-08', adherence: 69, missed: 3 },
        { date: '04-12', adherence: 72, missed: 2 },
        { date: '04-16', adherence: 74, missed: 1 },
        { date: '04-21', adherence: 75, missed: 1 },
    ],
};
const mockSnapshots = [
    { id: 1, medicationId: 1001, ward: '心内二区', period: '早餐后', executionTime: '08:10', status: 'done', risk: 'low' },
    { id: 2, medicationId: 1002, ward: '内分泌病区', period: '早晚餐后', executionTime: '09:25', status: 'late', risk: 'medium' },
    { id: 3, ward: '老年康复区', period: '睡前', executionTime: '21:05', status: 'done', risk: 'low' },
    { id: 4, ward: '心内二区', period: '晨间', executionTime: '09:18', status: 'late', risk: 'high' },
    { id: 5, ward: '康养一区', period: '早餐后', executionTime: '08:06', status: 'done', risk: 'medium' },
    { id: 6, ward: '神内病区', period: '午餐后', executionTime: '12:40', status: 'done', risk: 'high' },
];
const mockMedicationFallback = [
    {
        id: 9201,
        genericName: '缬沙坦胶囊',
        brandName: '诺欣妥',
        dose: '80mg*14 粒',
        frequency: 'QD',
        administrationTime: 'AFTER_BREAKFAST',
        startDate: '2026-03-12',
        status: 'ACTIVE',
    },
    {
        id: 9202,
        genericName: '阿托伐他汀钙片',
        brandName: '立普妥',
        dose: '20mg*7 片',
        frequency: 'QD',
        administrationTime: 'AFTER_BREAKFAST',
        startDate: '2026-03-12',
        status: 'ACTIVE',
    },
    {
        id: 9203,
        genericName: '氯沙坦钾片',
        brandName: '科素亚',
        dose: '50mg*14 片',
        frequency: 'QD',
        administrationTime: 'AFTER_BREAKFAST',
        startDate: '2026-03-18',
        status: 'ACTIVE',
    },
    {
        id: 9204,
        genericName: '硝苯地平控释片',
        brandName: '拜新同',
        dose: '30mg*10 片',
        frequency: 'QD',
        administrationTime: 'AFTER_BREAKFAST',
        startDate: '2026-03-18',
        status: 'ACTIVE',
    },
];
const historyRecords = ref([
    { id: 1, date: '04-21', patient: '王春兰', medication: '缬沙坦胶囊', ward: '心内二区', nurse: '刘护士', status: 'done', note: '晨间执行准时' },
    { id: 2, date: '04-21', patient: '李建国', medication: '二甲双胍片', ward: '内分泌病区', nurse: '陈护士', status: 'late', note: '延后 25 分钟补服' },
    { id: 3, date: '04-20', patient: '赵阿姨', medication: '阿托伐他汀钙片', ward: '老年康复区', nurse: '王护士', status: 'done', note: '晚间服药完成' },
    { id: 4, date: '04-20', patient: '周明涛', medication: '氯沙坦钾片', ward: '心内二区', nurse: '刘护士', status: 'late', note: '患者外出检查后补服' },
    { id: 5, date: '04-19', patient: '孙敏', medication: '硝苯地平控释片', ward: '康养一区', nurse: '高护士', status: 'done', note: '按时服药' },
]);
onMounted(async () => {
    try {
        const [patientRes, reminderRes, medicationRes] = await Promise.allSettled([
            mobileApi.getCurrentPatient(),
            mobileApi.getTodayReminders(),
            mobileApi.getMedications(),
        ]);
        if (patientRes.status === 'fulfilled') {
            patient.value = patientRes.value;
        }
        else {
            patient.value = {
                userId: 1,
                role: 'CAREGIVER',
                patientId: 1,
                patientName: '演示患者',
            };
        }
        const loadedReminders = reminderRes.status === 'fulfilled' ? reminderRes.value.reminders : [];
        const loadedMedications = medicationRes.status === 'fulfilled' ? medicationRes.value.medications : [];
        reminders.value = loadedReminders;
        medications.value = loadedMedications;
        if (!mvpStore.state.medications.length && loadedMedications.length) {
            mvpStore.syncMedicationData(loadedMedications, loadedReminders);
        }
    }
    catch (err) {
        error.value = err instanceof Error ? err.message : '加载数据失败';
    }
    finally {
        loading.value = false;
    }
});
const resolvedReminders = computed(() => (mvpStore.state.reminders.length ? mvpStore.state.reminders : reminders.value));
const resolvedMedications = computed(() => (mvpStore.state.medications.length ? mvpStore.state.medications : medications.value));
const medicationRows = computed(() => resolvedMedications.value.map((item, index) => {
    const snapshot = mockSnapshots.find((entry) => entry.medicationId === item.id) ??
        mockSnapshots[index % mockSnapshots.length];
    return {
        id: item.id,
        name: item.genericName,
        spec: item.brandName ? `${item.brandName} | ${item.dose}` : item.dose,
        dosage: `频次 ${item.frequency} · 开始于 ${item.startDate}`,
        ward: snapshot.ward,
        period: snapshot.period,
        executionTime: snapshot.executionTime,
        status: snapshot.status,
        risk: snapshot.risk,
    };
}));
const summary = computed(() => {
    const totalPlan = medicationRows.value.length;
    const takenKinds = medicationRows.value.filter((item) => item.status === 'done').length;
    const pendingKinds = Math.max(totalPlan - takenKinds, 0);
    const reminderCount = resolvedReminders.value.length;
    const adherence = totalPlan ? `${Math.round((takenKinds / totalPlan) * 100)}%` : '0%';
    return {
        totalPlan,
        takenKinds,
        pendingKinds,
        reminderCount,
        adherence,
    };
});
const metricCards = computed(() => [
    {
        id: 'today',
        label: '今日服药',
        value: `${summary.value.takenKinds}/${summary.value.pendingKinds}`,
        detail: '已服/待服种类',
        tone: 'green',
    },
    {
        id: 'plan',
        label: '所有应服药',
        value: String(summary.value.totalPlan),
        detail: '今日应服药品种类',
        tone: 'blue',
    },
    {
        id: 'reminder',
        label: '今日提醒',
        value: String(summary.value.reminderCount),
        detail: `依从率 ${summary.value.adherence}`,
        tone: 'gold',
    },
]);
const statusLabelMap = {
    all: '全部',
    done: '已完成',
    late: '超迟',
};
const trendData = computed(() => trendMap[timeRange.value]);
const selectedTrendPoint = computed(() => trendData.value[selectedPointIndex.value] ?? trendData.value[0] ?? null);
const historyTrendData = computed(() => trendMap['30d']);
const trendPointMap = computed(() => new Map(historyTrendData.value.map((point) => [point.date, point])));
const selectedDayTrendPoint = computed(() => trendPointMap.value.get(selectedDate.value) ?? null);
const historyMonthOptions = computed(() => {
    const months = new Set(historyTrendData.value.map((point) => `${HISTORY_YEAR}-${point.date.slice(0, 2)}`));
    return Array.from(months).sort();
});
const selectedDateLabel = computed(() => `${HISTORY_YEAR}-${selectedDate.value}`);
const historyMonthLabel = computed(() => {
    const [year, month] = historyMonth.value.split('-');
    return `${year}年${Number(month)}月`;
});
const historyCalendarCells = computed(() => {
    const [yearString, monthString] = historyMonth.value.split('-');
    const year = Number(yearString);
    const month = Number(monthString);
    const firstDay = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const cells = [];
    for (let index = 0; index < firstDay; index += 1) {
        cells.push({
            key: `empty-${index}`,
            label: '',
            date: null,
            adherence: null,
            isCurrentMonth: false,
            isSelected: false,
        });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
        const mm = String(month).padStart(2, '0');
        const dd = String(day).padStart(2, '0');
        const date = `${mm}-${dd}`;
        cells.push({
            key: date,
            label: String(day),
            date,
            adherence: trendPointMap.value.get(date)?.adherence ?? null,
            isCurrentMonth: true,
            isSelected: selectedDate.value === date,
        });
    }
    while (cells.length % 7 !== 0) {
        cells.push({
            key: `tail-${cells.length}`,
            label: '',
            date: null,
            adherence: null,
            isCurrentMonth: false,
            isSelected: false,
        });
    }
    return cells;
});
const historyCalendarWeeks = computed(() => {
    const weeks = [];
    for (let index = 0; index < historyCalendarCells.value.length; index += 7) {
        weeks.push(historyCalendarCells.value.slice(index, index + 7));
    }
    return weeks;
});
const chartOption = computed(() => ({
    animationDuration: 320,
    tooltip: {
        trigger: 'axis',
        triggerOn: 'mousemove|click',
        backgroundColor: 'rgba(28, 45, 66, 0.94)',
        borderWidth: 0,
        padding: [10, 12],
        textStyle: {
            color: '#eef5ff',
            fontSize: 12,
        },
        axisPointer: {
            type: 'line',
            lineStyle: {
                color: chartPalette.adherencePointer,
                width: 1.5,
            },
        },
        formatter(params) {
            const adherenceItem = params.find((item) => item.seriesName === '依从率');
            const missedItem = params.find((item) => item.seriesName === '漏服次数');
            return [
                `<strong>${params[0]?.axisValue ?? ''}</strong>`,
                `依从率：${adherenceItem?.value ?? '--'}%`,
                `漏服次数：${missedItem?.value ?? '--'}`,
            ].join('<br/>');
        },
    },
    legend: {
        top: 2,
        right: 0,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: {
            color: '#60758b',
            fontSize: 12,
        },
        data: ['漏服次数', '依从率'],
    },
    grid: {
        left: 6,
        right: 6,
        top: 42,
        bottom: 4,
        containLabel: true,
    },
    xAxis: {
        type: 'category',
        data: trendData.value.map((item) => item.date),
        axisTick: { show: false },
        axisLine: {
            lineStyle: {
                color: 'rgba(117, 138, 160, 0.22)',
            },
        },
        axisLabel: {
            color: '#70849a',
            fontSize: 11,
        },
    },
    yAxis: [
        {
            type: 'value',
            min: 60,
            max: 80,
            interval: 5,
            axisLabel: {
                color: '#70849a',
                fontSize: 11,
                formatter: '{value}%',
            },
            splitLine: {
                lineStyle: {
                    color: 'rgba(117, 138, 160, 0.16)',
                },
            },
        },
        {
            type: 'value',
            min: 0,
            max: 4,
            interval: 1,
            axisLabel: {
                color: '#93a2b2',
                fontSize: 11,
            },
            splitLine: { show: false },
        },
    ],
    series: [
        {
            name: '漏服次数',
            type: 'bar',
            yAxisIndex: 1,
            barWidth: 14,
            data: trendData.value.map((point, index) => ({
                value: point.missed,
                itemStyle: {
                    borderRadius: [7, 7, 0, 0],
                    color: index === selectedPointIndex.value
                        ? new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                            { offset: 0, color: chartPalette.barActiveTop },
                            { offset: 1, color: chartPalette.barActiveBottom },
                        ])
                        : new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                            { offset: 0, color: chartPalette.barDefaultTop },
                            { offset: 1, color: chartPalette.barDefaultBottom },
                        ]),
                },
            })),
        },
        {
            name: '依从率',
            type: 'line',
            smooth: 0.35,
            symbol: 'circle',
            yAxisIndex: 0,
            itemStyle: {
                color: chartPalette.adherence,
            },
            lineStyle: {
                width: 3,
                color: chartPalette.adherence,
            },
            areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: chartPalette.adherenceAreaTop },
                    { offset: 1, color: chartPalette.adherenceAreaBottom },
                ]),
            },
            data: trendData.value.map((point, index) => ({
                value: point.adherence,
                symbolSize: index === selectedPointIndex.value ? 11 : 8,
                itemStyle: {
                    color: index === selectedPointIndex.value ? chartPalette.adherenceActive : chartPalette.adherence,
                    borderColor: '#ffffff',
                    borderWidth: 2,
                    shadowColor: chartPalette.adherenceShadow,
                    shadowBlur: index === selectedPointIndex.value ? 10 : 0,
                },
            })),
            z: 3,
        },
    ],
}));
const chartConfig = {
    width: 1100,
    height: 300,
    paddingLeft: 46,
    paddingRight: 24,
    paddingTop: 22,
    paddingBottom: 44,
};
const chartInner = computed(() => ({
    width: chartConfig.width - chartConfig.paddingLeft - chartConfig.paddingRight,
    height: chartConfig.height - chartConfig.paddingTop - chartConfig.paddingBottom,
}));
const adherenceRange = { min: 60, max: 80 };
const missedRange = { min: 0, max: 4 };
const chartPoints = computed(() => {
    const data = trendData.value;
    const stepX = data.length > 1 ? chartInner.value.width / (data.length - 1) : chartInner.value.width;
    return data.map((point, index) => {
        const x = chartConfig.paddingLeft + stepX * index;
        const adherenceRatio = (point.adherence - adherenceRange.min) / (adherenceRange.max - adherenceRange.min);
        const y = chartConfig.paddingTop + chartInner.value.height * (1 - adherenceRatio);
        const missedRatio = (point.missed - missedRange.min) / (missedRange.max - missedRange.min);
        const barHeight = chartInner.value.height * missedRatio;
        const barY = chartConfig.paddingTop + chartInner.value.height - barHeight;
        return {
            ...point,
            x,
            y,
            barY,
            barHeight,
        };
    });
});
const linePath = computed(() => chartPoints.value
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`)
    .join(' '));
const xLabels = computed(() => chartPoints.value.map((item) => ({ date: item.date, x: item.x })));
const yLabels = computed(() => [60, 65, 70, 75, 80]);
const legacyFilteredMedicationList = computed(() => medicationRows.value.filter((item) => {
    if (statusFilter.value !== 'all' && item.status !== statusFilter.value) {
        return false;
    }
    if (dimensionFilter.value === 'duty') {
        return item.ward.includes('病区') || item.ward.includes('心内');
    }
    return true;
}));
const legacyCurrentDateRecords = computed(() => historyRecords.value.filter((item) => {
    if (item.date !== selectedDate.value) {
        return false;
    }
    if (statusFilter.value !== 'all' && item.status !== statusFilter.value) {
        return false;
    }
    if (dimensionFilter.value === 'duty') {
        return item.ward.includes('病区') || item.ward.includes('心内');
    }
    return true;
}));
const todayMedicationIds = computed(() => new Set(resolvedReminders.value.flatMap((item) => item.medicationIds)));
const medicationFilterLabelMap = {
    today: '今日药品',
    hypertension: '高血压',
    diabetes: '糖尿病',
    all: '全部',
};
function matchesMedicationKeywords(item, keywords) {
    const text = `${item.name} ${item.spec}`.toLowerCase();
    return keywords.some((keyword) => text.includes(keyword));
}
function isHypertensionMedication(item) {
    return matchesMedicationKeywords(item, ['缬沙坦', '氯沙坦', '硝苯地平', '厄贝沙坦', 'valsartan', 'losartan']);
}
function isDiabetesMedication(item) {
    return matchesMedicationKeywords(item, ['二甲双胍', '格列', '阿卡波糖', '胰岛素', 'metformin', 'insulin']);
}
const filteredMedicationList = computed(() => medicationRows.value.filter((item) => {
    if (medicationFilter.value === 'today') {
        return todayMedicationIds.value.has(item.id);
    }
    if (medicationFilter.value === 'hypertension') {
        return isHypertensionMedication(item);
    }
    if (medicationFilter.value === 'diabetes') {
        return isDiabetesMedication(item);
    }
    return true;
}));
const currentDateRecords = computed(() => historyRecords.value.filter((item) => {
    if (item.date !== selectedDate.value) {
        return false;
    }
    return true;
}));
const selectedDayCompletion = computed(() => {
    const doneCount = currentDateRecords.value.filter((item) => item.status === 'done').length;
    return currentDateRecords.value.length ? `${doneCount}/${currentDateRecords.value.length}` : '--';
});
const patientName = computed(() => patient.value?.patientName ?? '演示患者');
const patientSubtitle = computed(() => `${pageTitle} · 患者视图`);
function setTimeRange(next) {
    timeRange.value = next;
    const matchedIndex = trendMap[next].findIndex((point) => point.date === selectedDate.value);
    selectedPointIndex.value = matchedIndex >= 0 ? matchedIndex : 0;
    selectedDate.value = trendMap[next][selectedPointIndex.value]?.date ?? '04-21';
}
function setMedicationFilter(next) {
    medicationFilter.value = next;
}
function setStatusFilter(next) {
    statusFilter.value = next;
}
function setDimensionFilter(next) {
    dimensionFilter.value = next;
}
function syncSelectedDate(date) {
    selectedDate.value = date;
    const activeRangeIndex = trendData.value.findIndex((point) => point.date === date);
    if (activeRangeIndex >= 0) {
        selectedPointIndex.value = activeRangeIndex;
        return;
    }
    const historyIndex = trendMap['30d'].findIndex((point) => point.date === date);
    if (historyIndex >= 0) {
        timeRange.value = '30d';
        selectedPointIndex.value = historyIndex;
    }
}
function legacySetStatusFilter(next) {
    statusFilter.value = next;
}
function legacySetDimensionFilter(next) {
    dimensionFilter.value = next;
}
function openHistoryModal() {
    historyMonth.value = `${HISTORY_YEAR}-${selectedDate.value.slice(0, 2)}`;
    showHistoryModal.value = true;
}
function closeHistoryModal() {
    showHistoryModal.value = false;
}
function pickDate(point, index) {
    selectedDate.value = point.date;
    selectedPointIndex.value = index;
}
function selectHistoryDate(date) {
    if (!date) {
        return;
    }
    syncSelectedDate(date);
    showHistoryModal.value = false;
    showDayRecordsModal.value = true;
}
function setHistoryMonth(next) {
    historyMonth.value = next;
}
function getCalendarTone(adherence) {
    if (adherence == null) {
        return 'empty';
    }
    if (adherence >= 75) {
        return 'high';
    }
    if (adherence >= 70) {
        return 'medium';
    }
    return 'low';
}
function openDayRecords(point) {
    if (point) {
        syncSelectedDate(point.date);
    }
    showDayRecordsModal.value = true;
}
function closeDayRecordsModal() {
    showDayRecordsModal.value = false;
}
function openMedicationModal(item) {
    selectedMedication.value = item;
}
function closeMedicationModal() {
    selectedMedication.value = null;
}
function showTooltip(event, point) {
    const target = event.currentTarget;
    const box = target.ownerSVGElement?.getBoundingClientRect();
    tooltip.value = {
        visible: true,
        x: event.clientX - (box?.left ?? 0) + 10,
        y: event.clientY - (box?.top ?? 0) - 18,
        date: point.date,
        adherence: point.adherence,
        missed: point.missed,
    };
}
function hideTooltip() {
    tooltip.value.visible = false;
}
function formatRiskLabel(risk) {
    if (risk === 'high') {
        return '高风险';
    }
    if (risk === 'medium') {
        return '中风险';
    }
    return '低风险';
}
function getRowStatusTone(status) {
    if (status === 'done') {
        return 'success';
    }
    return 'warning';
}
function handleTrendChartClick(params) {
    if (typeof params.dataIndex !== 'number') {
        return;
    }
    const point = trendData.value[params.dataIndex];
    if (!point) {
        return;
    }
    pickDate(point, params.dataIndex);
    openDayRecords(point);
}
function renderTrendChart() {
    if (loading.value || error.value || !chartHost.value) {
        return;
    }
    if (!trendChart) {
        trendChart = echarts.init(chartHost.value);
        trendChart.on('click', handleTrendChartClick);
    }
    trendChart.setOption(chartOption.value, true);
}
function resizeTrendChart() {
    trendChart?.resize();
}
onMounted(() => {
    window.addEventListener('resize', resizeTrendChart);
});
onBeforeUnmount(() => {
    window.removeEventListener('resize', resizeTrendChart);
    trendChart?.dispose();
    trendChart = null;
});
watch([loading, error], async () => {
    await nextTick();
    renderTrendChart();
});
watch([trendData, selectedPointIndex], async () => {
    await nextTick();
    renderTrendChart();
});
const __VLS_ctx = {
    ...{},
    ...{},
};
let __VLS_components;
let __VLS_intrinsics;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['medication-page']} */ ;
/** @type {__VLS_StyleScopedClasses['medication-page']} */ ;
/** @type {__VLS_StyleScopedClasses['medication-page']} */ ;
/** @type {__VLS_StyleScopedClasses['hero-top']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-item']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-item']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-item']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-item']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-item']} */ ;
/** @type {__VLS_StyleScopedClasses['metric-card']} */ ;
/** @type {__VLS_StyleScopedClasses['analysis-card']} */ ;
/** @type {__VLS_StyleScopedClasses['analysis-card']} */ ;
/** @type {__VLS_StyleScopedClasses['tag-pill']} */ ;
/** @type {__VLS_StyleScopedClasses['icon-pill']} */ ;
/** @type {__VLS_StyleScopedClasses['history-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['close-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['tag-pill']} */ ;
/** @type {__VLS_StyleScopedClasses['day-records-head']} */ ;
/** @type {__VLS_StyleScopedClasses['day-records-head']} */ ;
/** @type {__VLS_StyleScopedClasses['modal-day-summary']} */ ;
/** @type {__VLS_StyleScopedClasses['day-records-summary']} */ ;
/** @type {__VLS_StyleScopedClasses['day-records-summary']} */ ;
/** @type {__VLS_StyleScopedClasses['day-record-item']} */ ;
/** @type {__VLS_StyleScopedClasses['day-record-item']} */ ;
/** @type {__VLS_StyleScopedClasses['history-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['list-header']} */ ;
/** @type {__VLS_StyleScopedClasses['list-header']} */ ;
/** @type {__VLS_StyleScopedClasses['section-title']} */ ;
/** @type {__VLS_StyleScopedClasses['list-header']} */ ;
/** @type {__VLS_StyleScopedClasses['list-header']} */ ;
/** @type {__VLS_StyleScopedClasses['medication-item']} */ ;
/** @type {__VLS_StyleScopedClasses['medication-item__head']} */ ;
/** @type {__VLS_StyleScopedClasses['medication-item__head']} */ ;
/** @type {__VLS_StyleScopedClasses['medication-item']} */ ;
/** @type {__VLS_StyleScopedClasses['modal-head']} */ ;
/** @type {__VLS_StyleScopedClasses['calendar-legend__item']} */ ;
/** @type {__VLS_StyleScopedClasses['calendar-weekdays']} */ ;
/** @type {__VLS_StyleScopedClasses['calendar-day']} */ ;
/** @type {__VLS_StyleScopedClasses['modal-day-summary']} */ ;
/** @type {__VLS_StyleScopedClasses['medication-detail__row']} */ ;
/** @type {__VLS_StyleScopedClasses['medication-detail__row']} */ ;
/** @type {__VLS_StyleScopedClasses['history-item']} */ ;
/** @type {__VLS_StyleScopedClasses['history-item']} */ ;
/** @type {__VLS_StyleScopedClasses['medication-grid']} */ ;
/** @type {__VLS_StyleScopedClasses['analysis-actions']} */ ;
/** @type {__VLS_StyleScopedClasses['tab-group--right']} */ ;
/** @type {__VLS_StyleScopedClasses['medication-page']} */ ;
/** @type {__VLS_StyleScopedClasses['hero-panel']} */ ;
/** @type {__VLS_StyleScopedClasses['hero-top']} */ ;
/** @type {__VLS_StyleScopedClasses['patient-name']} */ ;
/** @type {__VLS_StyleScopedClasses['patient-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['patient-subtitle']} */ ;
/** @type {__VLS_StyleScopedClasses['metric-card']} */ ;
/** @type {__VLS_StyleScopedClasses['metric-label']} */ ;
/** @type {__VLS_StyleScopedClasses['metric-value']} */ ;
/** @type {__VLS_StyleScopedClasses['metric-detail']} */ ;
/** @type {__VLS_StyleScopedClasses['analysis-card']} */ ;
/** @type {__VLS_StyleScopedClasses['list-panel']} */ ;
/** @type {__VLS_StyleScopedClasses['analysis-header']} */ ;
/** @type {__VLS_StyleScopedClasses['trend-chart-host']} */ ;
/** @type {__VLS_StyleScopedClasses['day-records-head']} */ ;
/** @type {__VLS_StyleScopedClasses['modal-day-summary']} */ ;
/** @type {__VLS_StyleScopedClasses['day-records-summary']} */ ;
/** @type {__VLS_StyleScopedClasses['calendar-weekdays']} */ ;
/** @type {__VLS_StyleScopedClasses['calendar-week']} */ ;
/** @type {__VLS_StyleScopedClasses['calendar-day']} */ ;
/** @type {__VLS_StyleScopedClasses['calendar-day__value']} */ ;
/** @type {__VLS_StyleScopedClasses['list-header']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "mobile-page medication-page" },
});
/** @type {__VLS_StyleScopedClasses['mobile-page']} */ ;
/** @type {__VLS_StyleScopedClasses['medication-page']} */ ;
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
        ...{ class: "avatar-wrapper" },
    });
    /** @type {__VLS_StyleScopedClasses['avatar-wrapper']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.img)({
        ...{ class: "avatar-image" },
        src: "https://i.pravatar.cc/150?u=medication-center",
        alt: "患者头像",
    });
    /** @type {__VLS_StyleScopedClasses['avatar-image']} */ ;
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
    (__VLS_ctx.pageSubtitle);
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
    __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
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
    (__VLS_ctx.resolvedReminders.length);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "metrics-panel" },
    });
    /** @type {__VLS_StyleScopedClasses['metrics-panel']} */ ;
    for (const [item] of __VLS_vFor((__VLS_ctx.metricCards))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
            key: (item.id),
            ...{ class: "metric-card" },
            ...{ class: (`metric-card--${item.tone}`) },
        });
        /** @type {__VLS_StyleScopedClasses['metric-card']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "metric-copy" },
        });
        /** @type {__VLS_StyleScopedClasses['metric-copy']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "metric-label" },
        });
        /** @type {__VLS_StyleScopedClasses['metric-label']} */ ;
        (item.label);
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "metric-detail" },
        });
        /** @type {__VLS_StyleScopedClasses['metric-detail']} */ ;
        (item.detail);
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({
            ...{ class: "metric-value" },
        });
        /** @type {__VLS_StyleScopedClasses['metric-value']} */ ;
        (item.value);
        // @ts-ignore
        [loading, error, error, pageTitle, patientName, pageSubtitle, pageSubtitle, resolvedReminders, metricCards,];
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "analysis-card glass-section" },
        ...{ style: (__VLS_ctx.analysisCardStyle) },
    });
    /** @type {__VLS_StyleScopedClasses['analysis-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['glass-section']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "analysis-header" },
    });
    /** @type {__VLS_StyleScopedClasses['analysis-header']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({
        ...{ class: "section-title" },
    });
    /** @type {__VLS_StyleScopedClasses['section-title']} */ ;
    if (__VLS_ctx.selectedTrendPoint) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "analysis-note" },
        });
        /** @type {__VLS_StyleScopedClasses['analysis-note']} */ ;
        (__VLS_ctx.selectedTrendPoint.date);
        (__VLS_ctx.selectedTrendPoint.adherence);
        (__VLS_ctx.selectedTrendPoint.missed);
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "switch-group" },
    });
    /** @type {__VLS_StyleScopedClasses['switch-group']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!!(__VLS_ctx.loading))
                    return;
                if (!!(__VLS_ctx.error))
                    return;
                __VLS_ctx.setTimeRange('7d');
                // @ts-ignore
                [analysisCardStyle, selectedTrendPoint, selectedTrendPoint, selectedTrendPoint, selectedTrendPoint, setTimeRange,];
            } },
        ...{ class: (['tag-pill', { active: __VLS_ctx.timeRange === '7d' }]) },
    });
    /** @type {__VLS_StyleScopedClasses['active']} */ ;
    /** @type {__VLS_StyleScopedClasses['tag-pill']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!!(__VLS_ctx.loading))
                    return;
                if (!!(__VLS_ctx.error))
                    return;
                __VLS_ctx.setTimeRange('30d');
                // @ts-ignore
                [setTimeRange, timeRange,];
            } },
        ...{ class: (['tag-pill', { active: __VLS_ctx.timeRange === '30d' }]) },
    });
    /** @type {__VLS_StyleScopedClasses['active']} */ ;
    /** @type {__VLS_StyleScopedClasses['tag-pill']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (__VLS_ctx.openHistoryModal) },
        ...{ class: "history-btn" },
    });
    /** @type {__VLS_StyleScopedClasses['history-btn']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "chart-wrap" },
    });
    /** @type {__VLS_StyleScopedClasses['chart-wrap']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ref: "chartHost",
        ...{ class: "trend-chart-host" },
    });
    /** @type {__VLS_StyleScopedClasses['trend-chart-host']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "chart-hit-area" },
        ...{ style: ({ gridTemplateColumns: `repeat(${__VLS_ctx.trendData.length}, minmax(0, 1fr))` }) },
        'aria-hidden': "true",
    });
    /** @type {__VLS_StyleScopedClasses['chart-hit-area']} */ ;
    for (const [point, index] of __VLS_vFor((__VLS_ctx.trendData))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.loading))
                        return;
                    if (!!(__VLS_ctx.error))
                        return;
                    __VLS_ctx.openDayRecords(point);
                    // @ts-ignore
                    [timeRange, openHistoryModal, trendData, trendData, openDayRecords,];
                } },
            key: (`hit-${point.date}`),
            type: "button",
            ...{ class: "chart-hit-button" },
        });
        /** @type {__VLS_StyleScopedClasses['chart-hit-button']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "sr-only" },
        });
        /** @type {__VLS_StyleScopedClasses['sr-only']} */ ;
        (point.date);
        // @ts-ignore
        [];
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.svg, __VLS_intrinsics.svg)({
        viewBox: (`0 0 ${__VLS_ctx.chartConfig.width} ${__VLS_ctx.chartConfig.height}`),
        ...{ class: "trend-chart" },
        preserveAspectRatio: "none",
    });
    /** @type {__VLS_StyleScopedClasses['trend-chart']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.defs, __VLS_intrinsics.defs)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.linearGradient, __VLS_intrinsics.linearGradient)({
        id: "lineGradient",
        x1: "0%",
        y1: "0%",
        x2: "100%",
        y2: "0%",
    });
    __VLS_asFunctionalElement1(__VLS_intrinsics.stop)({
        offset: "0%",
        'stop-color': "#6ea88b",
    });
    __VLS_asFunctionalElement1(__VLS_intrinsics.stop)({
        offset: "100%",
        'stop-color': "#8bb4c2",
    });
    __VLS_asFunctionalElement1(__VLS_intrinsics.linearGradient, __VLS_intrinsics.linearGradient)({
        id: "barGradient",
        x1: "0%",
        y1: "0%",
        x2: "0%",
        y2: "100%",
    });
    __VLS_asFunctionalElement1(__VLS_intrinsics.stop)({
        offset: "0%",
        'stop-color': "rgba(157, 190, 204, 0.85)",
    });
    __VLS_asFunctionalElement1(__VLS_intrinsics.stop)({
        offset: "100%",
        'stop-color': "rgba(157, 190, 204, 0.28)",
    });
    for (const [label] of __VLS_vFor((__VLS_ctx.yLabels))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.line)({
            key: (`grid-${label}`),
            x1: (__VLS_ctx.chartConfig.paddingLeft),
            x2: (__VLS_ctx.chartConfig.width - __VLS_ctx.chartConfig.paddingRight),
            y1: (__VLS_ctx.chartConfig.paddingTop + __VLS_ctx.chartInner.height * (1 - (label - __VLS_ctx.adherenceRange.min) / (__VLS_ctx.adherenceRange.max - __VLS_ctx.adherenceRange.min))),
            y2: (__VLS_ctx.chartConfig.paddingTop + __VLS_ctx.chartInner.height * (1 - (label - __VLS_ctx.adherenceRange.min) / (__VLS_ctx.adherenceRange.max - __VLS_ctx.adherenceRange.min))),
            ...{ class: "grid-line" },
        });
        /** @type {__VLS_StyleScopedClasses['grid-line']} */ ;
        // @ts-ignore
        [chartConfig, chartConfig, chartConfig, chartConfig, chartConfig, chartConfig, chartConfig, yLabels, chartInner, chartInner, adherenceRange, adherenceRange, adherenceRange, adherenceRange, adherenceRange, adherenceRange,];
    }
    for (const [point, index] of __VLS_vFor((__VLS_ctx.chartPoints))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.g, __VLS_intrinsics.g)({
            key: (`bar-${point.date}`),
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.rect)({
            ...{ onMouseenter: (...[$event]) => {
                    if (!!(__VLS_ctx.loading))
                        return;
                    if (!!(__VLS_ctx.error))
                        return;
                    __VLS_ctx.showTooltip($event, point);
                    // @ts-ignore
                    [chartPoints, showTooltip,];
                } },
            ...{ onMouseleave: (__VLS_ctx.hideTooltip) },
            ...{ onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.loading))
                        return;
                    if (!!(__VLS_ctx.error))
                        return;
                    __VLS_ctx.pickDate(point, index);
                    // @ts-ignore
                    [hideTooltip, pickDate,];
                } },
            x: (point.x - 13),
            y: (point.barY),
            width: "26",
            height: (point.barHeight),
            rx: "8",
            fill: "url(#barGradient)",
            ...{ class: "chart-bar" },
        });
        /** @type {__VLS_StyleScopedClasses['chart-bar']} */ ;
        // @ts-ignore
        [];
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.path)({
        d: (__VLS_ctx.linePath),
        ...{ class: "trend-line" },
    });
    /** @type {__VLS_StyleScopedClasses['trend-line']} */ ;
    for (const [point, index] of __VLS_vFor((__VLS_ctx.chartPoints))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.circle)({
            ...{ onMouseenter: (...[$event]) => {
                    if (!!(__VLS_ctx.loading))
                        return;
                    if (!!(__VLS_ctx.error))
                        return;
                    __VLS_ctx.showTooltip($event, point);
                    // @ts-ignore
                    [chartPoints, showTooltip, linePath,];
                } },
            ...{ onMouseleave: (__VLS_ctx.hideTooltip) },
            ...{ onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.loading))
                        return;
                    if (!!(__VLS_ctx.error))
                        return;
                    __VLS_ctx.pickDate(point, index);
                    // @ts-ignore
                    [hideTooltip, pickDate,];
                } },
            key: (`dot-${point.date}`),
            cx: (point.x),
            cy: (point.y),
            r: "index === selectedPointIndex ? 7 : 5",
            ...{ class: (['trend-dot', { selected: index === __VLS_ctx.selectedPointIndex }]) },
        });
        /** @type {__VLS_StyleScopedClasses['selected']} */ ;
        /** @type {__VLS_StyleScopedClasses['trend-dot']} */ ;
        // @ts-ignore
        [selectedPointIndex,];
    }
    for (const [label] of __VLS_vFor((__VLS_ctx.yLabels))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.text, __VLS_intrinsics.text)({
            key: (`y-${label}`),
            x: (8),
            y: (__VLS_ctx.chartConfig.paddingTop + __VLS_ctx.chartInner.height * (1 - (label - __VLS_ctx.adherenceRange.min) / (__VLS_ctx.adherenceRange.max - __VLS_ctx.adherenceRange.min)) + 4),
            ...{ class: "axis-text" },
        });
        /** @type {__VLS_StyleScopedClasses['axis-text']} */ ;
        (label);
        // @ts-ignore
        [chartConfig, yLabels, chartInner, adherenceRange, adherenceRange, adherenceRange,];
    }
    for (const [label] of __VLS_vFor((__VLS_ctx.xLabels))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.text, __VLS_intrinsics.text)({
            key: (`x-${label.date}`),
            x: (label.x),
            y: (__VLS_ctx.chartConfig.height - 16),
            'text-anchor': "middle",
            ...{ class: "axis-text" },
        });
        /** @type {__VLS_StyleScopedClasses['axis-text']} */ ;
        (label.date);
        // @ts-ignore
        [chartConfig, xLabels,];
    }
    if (__VLS_ctx.tooltip.visible) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "chart-tooltip" },
            ...{ style: ({ left: `${__VLS_ctx.tooltip.x}px`, top: `${__VLS_ctx.tooltip.y}px` }) },
        });
        /** @type {__VLS_StyleScopedClasses['chart-tooltip']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (__VLS_ctx.tooltip.date);
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (__VLS_ctx.tooltip.adherence);
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (__VLS_ctx.tooltip.missed);
    }
    if (false) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "day-records-panel" },
        });
        /** @type {__VLS_StyleScopedClasses['day-records-panel']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "day-records-head" },
        });
        /** @type {__VLS_StyleScopedClasses['day-records-head']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
        (__VLS_ctx.selectedDateLabel);
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "day-records-summary" },
        });
        /** @type {__VLS_StyleScopedClasses['day-records-summary']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        (__VLS_ctx.selectedDayTrendPoint?.adherence ?? '--');
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        (__VLS_ctx.selectedDayCompletion);
        (__VLS_ctx.selectedDayTrendPoint?.missed ?? '--');
        __VLS_asFunctionalElement1(__VLS_intrinsics.ul, __VLS_intrinsics.ul)({
            ...{ class: "day-records-list" },
        });
        /** @type {__VLS_StyleScopedClasses['day-records-list']} */ ;
        for (const [record] of __VLS_vFor((__VLS_ctx.currentDateRecords))) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.li, __VLS_intrinsics.li)({
                key: (record.id),
                ...{ class: "day-record-item" },
            });
            /** @type {__VLS_StyleScopedClasses['day-record-item']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
            (record.medication);
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
            (record.ward);
            (record.nurse);
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
            (record.note);
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: (`status-chip status-chip--${__VLS_ctx.getRowStatusTone(record.status)}`) },
            });
            (__VLS_ctx.statusLabelMap[record.status]);
            // @ts-ignore
            [tooltip, tooltip, tooltip, tooltip, tooltip, tooltip, selectedDateLabel, selectedDayTrendPoint, selectedDayTrendPoint, selectedDayCompletion, currentDateRecords, getRowStatusTone, statusLabelMap,];
        }
        if (!__VLS_ctx.currentDateRecords.length) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.li, __VLS_intrinsics.li)({
                ...{ class: "history-empty" },
            });
            /** @type {__VLS_StyleScopedClasses['history-empty']} */ ;
        }
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "analysis-actions" },
    });
    /** @type {__VLS_StyleScopedClasses['analysis-actions']} */ ;
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
                __VLS_ctx.setStatusFilter('all');
                // @ts-ignore
                [currentDateRecords, setStatusFilter,];
            } },
        ...{ class: (['tag-pill', { active: __VLS_ctx.statusFilter === 'all' }]) },
    });
    /** @type {__VLS_StyleScopedClasses['active']} */ ;
    /** @type {__VLS_StyleScopedClasses['tag-pill']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!!(__VLS_ctx.loading))
                    return;
                if (!!(__VLS_ctx.error))
                    return;
                __VLS_ctx.setStatusFilter('done');
                // @ts-ignore
                [setStatusFilter, statusFilter,];
            } },
        ...{ class: (['tag-pill', { active: __VLS_ctx.statusFilter === 'done' }]) },
    });
    /** @type {__VLS_StyleScopedClasses['active']} */ ;
    /** @type {__VLS_StyleScopedClasses['tag-pill']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!!(__VLS_ctx.loading))
                    return;
                if (!!(__VLS_ctx.error))
                    return;
                __VLS_ctx.setStatusFilter('late');
                // @ts-ignore
                [setStatusFilter, statusFilter,];
            } },
        ...{ class: (['tag-pill', { active: __VLS_ctx.statusFilter === 'late' }]) },
    });
    /** @type {__VLS_StyleScopedClasses['active']} */ ;
    /** @type {__VLS_StyleScopedClasses['tag-pill']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "tab-group tab-group--right" },
    });
    /** @type {__VLS_StyleScopedClasses['tab-group']} */ ;
    /** @type {__VLS_StyleScopedClasses['tab-group--right']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!!(__VLS_ctx.loading))
                    return;
                if (!!(__VLS_ctx.error))
                    return;
                __VLS_ctx.setDimensionFilter('all');
                // @ts-ignore
                [statusFilter, setDimensionFilter,];
            } },
        ...{ class: (['tag-pill', { active: __VLS_ctx.dimensionFilter === 'all' }]) },
    });
    /** @type {__VLS_StyleScopedClasses['active']} */ ;
    /** @type {__VLS_StyleScopedClasses['tag-pill']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!!(__VLS_ctx.loading))
                    return;
                if (!!(__VLS_ctx.error))
                    return;
                __VLS_ctx.setDimensionFilter('duty');
                // @ts-ignore
                [setDimensionFilter, dimensionFilter,];
            } },
        ...{ class: (['tag-pill', { active: __VLS_ctx.dimensionFilter === 'duty' }]) },
    });
    /** @type {__VLS_StyleScopedClasses['active']} */ ;
    /** @type {__VLS_StyleScopedClasses['tag-pill']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ class: "icon-pill" },
        'aria-label': "更多筛选",
    });
    /** @type {__VLS_StyleScopedClasses['icon-pill']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (__VLS_ctx.openHistoryModal) },
        ...{ class: "history-btn" },
    });
    /** @type {__VLS_StyleScopedClasses['history-btn']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "list-panel glass-section" },
    });
    /** @type {__VLS_StyleScopedClasses['list-panel']} */ ;
    /** @type {__VLS_StyleScopedClasses['glass-section']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "list-header" },
    });
    /** @type {__VLS_StyleScopedClasses['list-header']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    (__VLS_ctx.medicationFilterLabelMap[__VLS_ctx.medicationFilter]);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "tab-group list-filter-group" },
    });
    /** @type {__VLS_StyleScopedClasses['tab-group']} */ ;
    /** @type {__VLS_StyleScopedClasses['list-filter-group']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!!(__VLS_ctx.loading))
                    return;
                if (!!(__VLS_ctx.error))
                    return;
                __VLS_ctx.setMedicationFilter('today');
                // @ts-ignore
                [openHistoryModal, dimensionFilter, medicationFilterLabelMap, medicationFilter, setMedicationFilter,];
            } },
        ...{ class: (['tag-pill', { active: __VLS_ctx.medicationFilter === 'today' }]) },
    });
    /** @type {__VLS_StyleScopedClasses['active']} */ ;
    /** @type {__VLS_StyleScopedClasses['tag-pill']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!!(__VLS_ctx.loading))
                    return;
                if (!!(__VLS_ctx.error))
                    return;
                __VLS_ctx.setMedicationFilter('hypertension');
                // @ts-ignore
                [medicationFilter, setMedicationFilter,];
            } },
        ...{ class: (['tag-pill', { active: __VLS_ctx.medicationFilter === 'hypertension' }]) },
    });
    /** @type {__VLS_StyleScopedClasses['active']} */ ;
    /** @type {__VLS_StyleScopedClasses['tag-pill']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!!(__VLS_ctx.loading))
                    return;
                if (!!(__VLS_ctx.error))
                    return;
                __VLS_ctx.setMedicationFilter('diabetes');
                // @ts-ignore
                [medicationFilter, setMedicationFilter,];
            } },
        ...{ class: (['tag-pill', { active: __VLS_ctx.medicationFilter === 'diabetes' }]) },
    });
    /** @type {__VLS_StyleScopedClasses['active']} */ ;
    /** @type {__VLS_StyleScopedClasses['tag-pill']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!!(__VLS_ctx.loading))
                    return;
                if (!!(__VLS_ctx.error))
                    return;
                __VLS_ctx.setMedicationFilter('all');
                // @ts-ignore
                [medicationFilter, setMedicationFilter,];
            } },
        ...{ class: (['tag-pill', { active: __VLS_ctx.medicationFilter === 'all' }]) },
    });
    /** @type {__VLS_StyleScopedClasses['active']} */ ;
    /** @type {__VLS_StyleScopedClasses['tag-pill']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({
        ...{ class: "section-title" },
    });
    /** @type {__VLS_StyleScopedClasses['section-title']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    (__VLS_ctx.statusLabelMap[__VLS_ctx.statusFilter]);
    (__VLS_ctx.dimensionFilter === 'all' ? '全部维度' : '值班维度');
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "medication-grid" },
    });
    /** @type {__VLS_StyleScopedClasses['medication-grid']} */ ;
    for (const [item] of __VLS_vFor((__VLS_ctx.filteredMedicationList))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
            ...{ onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.loading))
                        return;
                    if (!!(__VLS_ctx.error))
                        return;
                    __VLS_ctx.openMedicationModal(item);
                    // @ts-ignore
                    [statusLabelMap, statusFilter, dimensionFilter, medicationFilter, filteredMedicationList, openMedicationModal,];
                } },
            key: (item.id),
            ...{ class: "medication-item" },
        });
        /** @type {__VLS_StyleScopedClasses['medication-item']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "medication-item__head" },
        });
        /** @type {__VLS_StyleScopedClasses['medication-item__head']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.h4, __VLS_intrinsics.h4)({});
        (item.name);
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (item.spec);
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: (`status-chip status-chip--${__VLS_ctx.getRowStatusTone(item.status)}`) },
        });
        (__VLS_ctx.statusLabelMap[item.status]);
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (item.dosage);
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (item.period);
        (item.executionTime);
        (__VLS_ctx.formatStatus('ACTIVE').label);
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "medication-item__foot" },
        });
        /** @type {__VLS_StyleScopedClasses['medication-item__foot']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        (item.ward);
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: (['risk-text', `risk-text--${item.risk}`]) },
        });
        /** @type {__VLS_StyleScopedClasses['risk-text']} */ ;
        (__VLS_ctx.formatRiskLabel(item.risk));
        // @ts-ignore
        [getRowStatusTone, statusLabelMap, formatStatus, formatRiskLabel,];
    }
    if (!__VLS_ctx.filteredMedicationList.length) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "medication-empty" },
        });
        /** @type {__VLS_StyleScopedClasses['medication-empty']} */ ;
    }
}
if (__VLS_ctx.showHistoryModal) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ onClick: (__VLS_ctx.closeHistoryModal) },
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
    __VLS_asFunctionalElement1(__VLS_intrinsics.h4, __VLS_intrinsics.h4)({});
    (__VLS_ctx.historyMonthLabel);
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (__VLS_ctx.closeHistoryModal) },
        ...{ class: "close-btn" },
    });
    /** @type {__VLS_StyleScopedClasses['close-btn']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
        ...{ class: "modal-note" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-note']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "calendar-toolbar" },
    });
    /** @type {__VLS_StyleScopedClasses['calendar-toolbar']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "tab-group" },
    });
    /** @type {__VLS_StyleScopedClasses['tab-group']} */ ;
    for (const [month] of __VLS_vFor((__VLS_ctx.historyMonthOptions))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    if (!(__VLS_ctx.showHistoryModal))
                        return;
                    __VLS_ctx.setHistoryMonth(month);
                    // @ts-ignore
                    [filteredMedicationList, showHistoryModal, closeHistoryModal, closeHistoryModal, historyMonthLabel, historyMonthOptions, setHistoryMonth,];
                } },
            key: (month),
            ...{ class: (['tag-pill', { active: __VLS_ctx.historyMonth === month }]) },
        });
        /** @type {__VLS_StyleScopedClasses['active']} */ ;
        /** @type {__VLS_StyleScopedClasses['tag-pill']} */ ;
        (month.replace('-', '年'));
        // @ts-ignore
        [historyMonth,];
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "calendar-legend" },
    });
    /** @type {__VLS_StyleScopedClasses['calendar-legend']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "calendar-legend__item calendar-legend__item--high" },
    });
    /** @type {__VLS_StyleScopedClasses['calendar-legend__item']} */ ;
    /** @type {__VLS_StyleScopedClasses['calendar-legend__item--high']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "calendar-legend__item calendar-legend__item--medium" },
    });
    /** @type {__VLS_StyleScopedClasses['calendar-legend__item']} */ ;
    /** @type {__VLS_StyleScopedClasses['calendar-legend__item--medium']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "calendar-legend__item calendar-legend__item--low" },
    });
    /** @type {__VLS_StyleScopedClasses['calendar-legend__item']} */ ;
    /** @type {__VLS_StyleScopedClasses['calendar-legend__item--low']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "calendar-board" },
    });
    /** @type {__VLS_StyleScopedClasses['calendar-board']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "calendar-weekdays" },
    });
    /** @type {__VLS_StyleScopedClasses['calendar-weekdays']} */ ;
    for (const [weekday] of __VLS_vFor((__VLS_ctx.historyWeekdays))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            key: (weekday),
        });
        (weekday);
        // @ts-ignore
        [historyWeekdays,];
    }
    for (const [week, weekIndex] of __VLS_vFor((__VLS_ctx.historyCalendarWeeks))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            key: (`week-${weekIndex}`),
            ...{ class: "calendar-week" },
        });
        /** @type {__VLS_StyleScopedClasses['calendar-week']} */ ;
        for (const [cell] of __VLS_vFor((week))) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (...[$event]) => {
                        if (!(__VLS_ctx.showHistoryModal))
                            return;
                        __VLS_ctx.selectHistoryDate(cell.date);
                        // @ts-ignore
                        [historyCalendarWeeks, selectHistoryDate,];
                    } },
                key: (cell.key),
                type: "button",
                ...{ class: "calendar-day" },
                ...{ class: ([
                        `calendar-day--${__VLS_ctx.getCalendarTone(cell.adherence)}`,
                        {
                            'calendar-day--muted': !cell.isCurrentMonth,
                            'calendar-day--selected': cell.isSelected,
                        },
                    ]) },
                disabled: (!cell.date),
            });
            /** @type {__VLS_StyleScopedClasses['calendar-day']} */ ;
            /** @type {__VLS_StyleScopedClasses['calendar-day--muted']} */ ;
            /** @type {__VLS_StyleScopedClasses['calendar-day--selected']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: "calendar-day__label" },
            });
            /** @type {__VLS_StyleScopedClasses['calendar-day__label']} */ ;
            (cell.label);
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({
                ...{ class: "calendar-day__value" },
            });
            /** @type {__VLS_StyleScopedClasses['calendar-day__value']} */ ;
            (cell.adherence == null ? '--' : `${cell.adherence}%`);
            // @ts-ignore
            [getCalendarTone,];
        }
        // @ts-ignore
        [];
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "modal-day-summary" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-day-summary']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
    (__VLS_ctx.selectedDateLabel);
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    (__VLS_ctx.selectedDayTrendPoint?.adherence ?? '--');
    (__VLS_ctx.selectedDayTrendPoint?.missed ?? '--');
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "modal-actions" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-actions']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.showHistoryModal))
                    return;
                __VLS_ctx.showHistoryModal = false;
                __VLS_ctx.showDayRecordsModal = true;
                // @ts-ignore
                [selectedDateLabel, selectedDayTrendPoint, selectedDayTrendPoint, showHistoryModal, showDayRecordsModal,];
            } },
        ...{ class: "history-btn" },
    });
    /** @type {__VLS_StyleScopedClasses['history-btn']} */ ;
    if (false) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.ul, __VLS_intrinsics.ul)({
            ...{ class: "history-list" },
        });
        /** @type {__VLS_StyleScopedClasses['history-list']} */ ;
        for (const [record] of __VLS_vFor((__VLS_ctx.currentDateRecords))) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.li, __VLS_intrinsics.li)({
                key: (record.id),
                ...{ class: "history-item" },
            });
            /** @type {__VLS_StyleScopedClasses['history-item']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
            (record.patient);
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
            (record.medication);
            (record.ward);
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
            (record.note);
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "history-right" },
            });
            /** @type {__VLS_StyleScopedClasses['history-right']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            (record.nurse);
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: (`status-chip status-chip--${__VLS_ctx.getRowStatusTone(record.status)}`) },
            });
            (__VLS_ctx.statusLabelMap[record.status]);
            // @ts-ignore
            [currentDateRecords, getRowStatusTone, statusLabelMap,];
        }
        if (!__VLS_ctx.currentDateRecords.length) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.li, __VLS_intrinsics.li)({
                ...{ class: "history-empty" },
            });
            /** @type {__VLS_StyleScopedClasses['history-empty']} */ ;
        }
    }
}
if (__VLS_ctx.showDayRecordsModal) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ onClick: (__VLS_ctx.closeDayRecordsModal) },
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
    __VLS_asFunctionalElement1(__VLS_intrinsics.h4, __VLS_intrinsics.h4)({});
    (__VLS_ctx.selectedDateLabel);
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (__VLS_ctx.closeDayRecordsModal) },
        ...{ class: "close-btn" },
    });
    /** @type {__VLS_StyleScopedClasses['close-btn']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "modal-day-summary" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-day-summary']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
    (__VLS_ctx.selectedDayTrendPoint?.adherence ?? '--');
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    (__VLS_ctx.selectedDayCompletion);
    (__VLS_ctx.selectedDayTrendPoint?.missed ?? '--');
    __VLS_asFunctionalElement1(__VLS_intrinsics.ul, __VLS_intrinsics.ul)({
        ...{ class: "history-list" },
    });
    /** @type {__VLS_StyleScopedClasses['history-list']} */ ;
    for (const [record] of __VLS_vFor((__VLS_ctx.currentDateRecords))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.li, __VLS_intrinsics.li)({
            key: (record.id),
            ...{ class: "history-item" },
        });
        /** @type {__VLS_StyleScopedClasses['history-item']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        (record.patient);
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (record.medication);
        (record.ward);
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (record.note);
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "history-right" },
        });
        /** @type {__VLS_StyleScopedClasses['history-right']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        (record.nurse);
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: (`status-chip status-chip--${__VLS_ctx.getRowStatusTone(record.status)}`) },
        });
        (__VLS_ctx.statusLabelMap[record.status]);
        // @ts-ignore
        [selectedDateLabel, selectedDayTrendPoint, selectedDayTrendPoint, selectedDayCompletion, currentDateRecords, currentDateRecords, getRowStatusTone, statusLabelMap, showDayRecordsModal, closeDayRecordsModal, closeDayRecordsModal,];
    }
    if (!__VLS_ctx.currentDateRecords.length) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.li, __VLS_intrinsics.li)({
            ...{ class: "history-empty" },
        });
        /** @type {__VLS_StyleScopedClasses['history-empty']} */ ;
    }
}
if (__VLS_ctx.selectedMedication) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ onClick: (__VLS_ctx.closeMedicationModal) },
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
    __VLS_asFunctionalElement1(__VLS_intrinsics.h4, __VLS_intrinsics.h4)({});
    (__VLS_ctx.selectedMedication.name);
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (__VLS_ctx.closeMedicationModal) },
        ...{ class: "close-btn" },
    });
    /** @type {__VLS_StyleScopedClasses['close-btn']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "medication-detail" },
    });
    /** @type {__VLS_StyleScopedClasses['medication-detail']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "medication-detail__row" },
    });
    /** @type {__VLS_StyleScopedClasses['medication-detail__row']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
    (__VLS_ctx.selectedMedication.spec);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "medication-detail__row" },
    });
    /** @type {__VLS_StyleScopedClasses['medication-detail__row']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
    (__VLS_ctx.selectedMedication.dosage);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "medication-detail__row" },
    });
    /** @type {__VLS_StyleScopedClasses['medication-detail__row']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
    (__VLS_ctx.selectedMedication.period);
    (__VLS_ctx.selectedMedication.executionTime);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "medication-detail__row" },
    });
    /** @type {__VLS_StyleScopedClasses['medication-detail__row']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
    (__VLS_ctx.selectedMedication.ward);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "medication-detail__row" },
    });
    /** @type {__VLS_StyleScopedClasses['medication-detail__row']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({
        ...{ class: (['risk-text', `risk-text--${__VLS_ctx.selectedMedication.risk}`]) },
    });
    /** @type {__VLS_StyleScopedClasses['risk-text']} */ ;
    (__VLS_ctx.formatRiskLabel(__VLS_ctx.selectedMedication.risk));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "medication-detail__row" },
    });
    /** @type {__VLS_StyleScopedClasses['medication-detail__row']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
    (__VLS_ctx.statusLabelMap[__VLS_ctx.selectedMedication.status]);
}
// @ts-ignore
[currentDateRecords, statusLabelMap, formatRiskLabel, selectedMedication, selectedMedication, selectedMedication, selectedMedication, selectedMedication, selectedMedication, selectedMedication, selectedMedication, selectedMedication, selectedMedication, closeMedicationModal, closeMedicationModal,];
const __VLS_export = (await import('vue')).defineComponent({});
export default {};
