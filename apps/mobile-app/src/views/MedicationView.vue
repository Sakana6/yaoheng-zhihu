<script setup lang="ts">
import ConnectionStatus from '../components/ConnectionStatus.vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import type { ECharts } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

import { mobileApi, mobileRuntimeConfig } from '../lib/api';
import { formatStatus } from '../lib/format';
import { useMvpStore } from '../stores/mvp';
import type { CurrentPatientContext, MobileMedication, MobileReminder } from '../lib/types';
import homeCardImage from '../static/pictures/home-card.jpg';

import { selectedPatient } from '../../../../packages/frontend/session';
import { useRecordHistory, executionDay, executionLabel } from '../../../../packages/frontend/record-history';
import { shanghaiDate, displayTime } from '../../../../packages/frontend/care';
const isDemo = mobileRuntimeConfig.useMock;
const history = useRecordHistory();
// UI03 counts all effective medication items on the planned day, including later today.
// The due-only cutoff used elsewhere must not change this page's denominator or hide early feedback.
const realDays = computed(() => history.days.value.map(day => ({ date: day.date, ...executionDay(day, Number.POSITIVE_INFINITY) })));
async function reloadReal() { loading.value = true; await history.load(shanghaiDate(), 30); error.value = history.error.value; loading.value = false; }

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

type TimeRange = '7d' | '30d';
type StatusFilter = 'all' | 'done' | 'late';
type MedicationFilter = 'today' | 'hypertension' | 'diabetes' | 'all';
type DimensionFilter = 'all' | 'duty';

type RiskLevel = 'low' | 'medium' | 'high' | 'unknown';

interface MetricCard {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: 'green' | 'blue' | 'gold';
}

interface TrendPoint {
  date: string;
  adherence: number | null;
  missed: number;
}

interface MedicationSnapshot {
  id: number;
  medicationId?: number;
  ward: string;
  period: string;
  executionTime: string;
  status: Exclude<StatusFilter, 'all'>;
  risk: RiskLevel;
}

interface MedicationRow {
  medicationState?: string;
  id: number;
  name: string;
  spec: string;
  dosage: string;
  ward: string;
  period: string;
  executionTime: string;
  status: Exclude<StatusFilter, 'all'>;
  risk: RiskLevel;
}

interface MedicationDetailInfo {
  category: string;
  purpose: string;
  indications: string;
  interactionNote: string;
  adverseReactions: string[];
  observationPoints: string[];
}

interface DailyRecord {
  id: number;
  date: string;
  patient: string;
  medication: string;
  ward: string;
  nurse: string;
  status: Exclude<StatusFilter, 'all'>;
  note: string;
}

interface HistoryCalendarCell {
  key: string;
  label: string;
  date: string | null;
  adherence: number | null;
  isCurrentMonth: boolean;
  isSelected: boolean;
}

const loading = ref(true);
const error = ref('');
const patient = ref<CurrentPatientContext | null>(null);
const reminders = ref<MobileReminder[]>([]);
const medications = ref<MobileMedication[]>([]);
const mvpStore = isDemo ? useMvpStore() : null;
const chartHost = ref<HTMLElement | null>(null);

const pageTitle = '用药管理中心';
const pageSubtitle = isDemo ? '今日用药依从情况稳定，建议重点关注高风险患者用药执行情况' : '查看真实药历和逐药执行，历史记录保留当时剂量与版本。';

const timeRange = ref<TimeRange>('7d');
const medicationFilter = ref<MedicationFilter>('all');
const statusFilter = ref<StatusFilter>('all');
const dimensionFilter = ref<'all' | 'duty'>('all');
const showHistoryModal = ref(false);
const showDayRecordsModal = ref(false);
const selectedDate = ref(isDemo ? '04-21' : shanghaiDate());
const selectedPointIndex = ref(0);
const historyMonth = ref(isDemo ? '2026-04' : shanghaiDate().slice(0, 7));
const selectedMedication = ref<MedicationRow | null>(null);
const medicationDetailLibrary: Array<{ keywords: string[]; detail: MedicationDetailInfo }> = [
  {
    keywords: ['格列本脲', 'glibenclamide'],
    detail: {
      category: '磺脲类强效降糖药',
      purpose: '促进胰岛素分泌，适合需要较强降糖控制的 2 型糖尿病患者。',
      indications: '2 型糖尿病口服降糖治疗，尤其适用于胰岛功能尚存的患者。',
      interactionNote: '与其他降糖方案联用时需重点评估是否出现降糖过度。',
      adverseReactions: ['低血糖', '头晕', '乏力', '出汗', '胃部不适'],
      observationPoints: ['进食是否规律', '是否出现低血糖样症状', '是否和其他降糖药同时使用'],
    },
  },
  {
    keywords: ['缬沙坦', 'valsartan'],
    detail: {
      category: 'ARB 类降压药',
      purpose: '用于控制血压，并兼顾心肾保护相关获益。',
      indications: '高血压、心血管风险管理及部分心肾保护场景。',
      interactionNote: '与降糖药联用出现头晕、乏力时，需要联动排查低血糖和低血压。',
      adverseReactions: ['头晕', '低血压', '乏力', '血钾升高'],
      observationPoints: ['血压变化', '站立后是否头晕', '肾功能与血钾监测'],
    },
  },
  {
    keywords: ['二甲双胍', 'metformin'],
    detail: {
      category: '双胍类降糖药',
      purpose: '改善胰岛素抵抗，是 2 型糖尿病常用的一线基础治疗。',
      indications: '2 型糖尿病长期血糖管理，尤其适合超重或胰岛素抵抗患者。',
      interactionNote: '与其他降糖药联合时应结合症状和血糖值评估整体降糖强度。',
      adverseReactions: ['恶心', '腹泻', '食欲下降', '腹胀'],
      observationPoints: ['胃肠道反应', '进餐后服药情况', '肾功能变化'],
    },
  },
];
const defaultMedicationDetail: MedicationDetailInfo = {
  category: '常规慢病药物',
  purpose: '用于日常慢病治疗和长期风险管理。',
  indications: '请结合临床医嘱确认具体适应症和疗程。',
  interactionNote: '如与多种药物同时服用，建议关注症状变化和关键监测指标。',
  adverseReactions: ['头晕', '胃部不适', '乏力'],
  observationPoints: ['服药时间是否规律', '是否有新发不适', '是否存在联用风险提示'],
};
const tooltip = ref({
  visible: false,
  x: 0,
  y: 0,
  date: '',
  adherence: null as number | null,
  missed: 0,
});
let trendChart: ECharts | null = null;
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

const trendMap: Record<TimeRange, TrendPoint[]> = {
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

const mockSnapshots: MedicationSnapshot[] = [
  { id: 1, medicationId: 1001, ward: '心内二区', period: '早餐后', executionTime: '08:10', status: 'done', risk: 'low' },
  { id: 2, medicationId: 1002, ward: '内分泌病区', period: '早晚餐后', executionTime: '09:25', status: 'late', risk: 'medium' },
  { id: 3, ward: '老年康复区', period: '睡前', executionTime: '21:05', status: 'done', risk: 'low' },
  { id: 4, ward: '心内二区', period: '晨间', executionTime: '09:18', status: 'late', risk: 'high' },
  { id: 5, ward: '康养一区', period: '早餐后', executionTime: '08:06', status: 'done', risk: 'medium' },
  { id: 6, ward: '神内病区', period: '午餐后', executionTime: '12:40', status: 'done', risk: 'high' },
];

const mockMedicationFallback: MobileMedication[] = [
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

const historyRecords = ref<DailyRecord[]>([
  { id: 1, date: '04-21', patient: '王春兰', medication: '缬沙坦胶囊', ward: '心内二区', nurse: '刘护士', status: 'done', note: '晨间执行准时' },
  { id: 2, date: '04-21', patient: '李建国', medication: '二甲双胍片', ward: '内分泌病区', nurse: '陈护士', status: 'late', note: '延后 25 分钟补服' },
  { id: 3, date: '04-20', patient: '赵阿姨', medication: '阿托伐他汀钙片', ward: '老年康复区', nurse: '王护士', status: 'done', note: '晚间服药完成' },
  { id: 4, date: '04-20', patient: '周明涛', medication: '氯沙坦钾片', ward: '心内二区', nurse: '刘护士', status: 'late', note: '患者外出检查后补服' },
  { id: 5, date: '04-19', patient: '孙敏', medication: '硝苯地平控释片', ward: '康养一区', nurse: '高护士', status: 'done', note: '按时服药' },
]);

onMounted(async () => {
  if (!isDemo) { await reloadReal(); return; }
  try {
    const [patientRes, reminderRes, medicationRes] = await Promise.allSettled([
      mobileApi.getCurrentPatient(),
      mobileApi.getTodayReminders(),
      mobileApi.getMedications(),
    ]);

    if (patientRes.status === 'fulfilled') {
      patient.value = patientRes.value;
    } else {
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

    if (!mvpStore!.state.medications.length && loadedMedications.length) {
      mvpStore!.syncMedicationData(loadedMedications, loadedReminders);
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载数据失败';
  } finally {
    loading.value = false;
  }
});

const resolvedReminders = computed(() => !isDemo ? [] : (mvpStore!.state.reminders.length ? mvpStore!.state.reminders : reminders.value));
const resolvedMedications = computed(() => !isDemo ? [] : (mvpStore!.state.medications.length ? mvpStore!.state.medications : medications.value));

const medicationRows = computed<MedicationRow[]>(() => !isDemo ? history.medications.value.map(m => ({
    id: m.id, name: m.genericName, spec: [m.brandName, m.dose].filter(Boolean).join(' | '),
    dosage: `频次 ${m.frequency} · ${m.startDate} 至 ${m.endDate ?? '未设置结束'}`,
    ward: m.standardizationStatus === 'STANDARDIZED' ? '已标准化' : '未标准化',
    period: m.administrationTime, executionTime: `药历版本 ${m.version}`,
    status: m.status === 'ACTIVE' ? 'done' : 'late', medicationState: m.status, risk: 'unknown',
  })) : resolvedMedications.value.map((item, index) => {
    const snapshot =
      mockSnapshots.find((entry) => entry.medicationId === item.id) ??
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
  }),
);

const summary = computed(() => {
  if (!isDemo) {
    const today = realDays.value.find(d => d.date === shanghaiDate());
    return { totalPlan: today?.total ?? 0, takenKinds: today?.taken ?? 0, pendingKinds: (today?.total ?? 0) - (today?.taken ?? 0),
      reminderCount: history.days.value.find(d => d.date === shanghaiDate())?.occurrences.filter(o => o.executionStatus !== 'CANCELLED').length ?? 0,
      adherence: today?.adherence == null ? '—' : `${today.adherence}%` };
  }
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

const metricCards = computed<MetricCard[]>(() => [
  {
    id: 'today',
    label: '今日服药',
    value: `${summary.value.takenKinds}/${summary.value.pendingKinds}`,
    detail: isDemo ? '已服/待服种类' : '已服/其余',
    tone: 'green',
  },
  {
    id: 'plan',
    label: '所有应服药',
    value: String(summary.value.totalPlan),
    detail: isDemo ? '今日应服药品种类' : '计划用药项',
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

const statusLabelMap: Record<StatusFilter, string> = {
  all: '全部',
  done: isDemo ? '已完成' : '使用中',
  late: isDemo ? '超迟' : '停用/归档',
};

const trendData = computed<TrendPoint[]>(() => isDemo ? trendMap[timeRange.value] : realDays.value.slice(timeRange.value === '7d' ? -7 : -30));
const selectedTrendPoint = computed(() => !isDemo ? trendData.value.find(d => d.date === selectedDate.value) ?? null : trendData.value[selectedPointIndex.value] ?? trendData.value[0] ?? null);
const historyTrendData = computed<TrendPoint[]>(() => isDemo ? trendMap['30d'] : realDays.value);
const trendPointMap = computed(() => new Map(historyTrendData.value.map((point) => [point.date, point])));
const selectedDayTrendPoint = computed(() => trendPointMap.value.get(selectedDate.value) ?? null);
const historyMonthOptions = computed(() => {
  const months = new Set(historyTrendData.value.map((point) => isDemo ? `${HISTORY_YEAR}-${point.date.slice(0, 2)}` : point.date.slice(0, 7)));
  return Array.from(months).sort();
});
const selectedDateLabel = computed(() => isDemo ? `${HISTORY_YEAR}-${selectedDate.value}` : selectedDate.value);
const historyMonthLabel = computed(() => {
  const [year, month] = historyMonth.value.split('-');
  return `${year}年${Number(month)}月`;
});
const historyCalendarCells = computed<HistoryCalendarCell[]>(() => {
  const [yearString, monthString] = historyMonth.value.split('-');
  const year = Number(yearString);
  const month = Number(monthString);
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: HistoryCalendarCell[] = [];

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
    const date = isDemo ? `${mm}-${dd}` : `${year}-${mm}-${dd}`;

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
  const weeks: HistoryCalendarCell[][] = [];

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
    formatter(params: Array<{ seriesName: string; value: number; axisValue: string }>) {
      const adherenceItem = params.find((item) => item.seriesName === (isDemo ? '依从率' : '确认执行率'));
      const missedItem = params.find((item) => item.seriesName === '漏服次数');

      return [
        `<strong>${params[0]?.axisValue ?? ''}</strong>`,
        `确认执行率：${adherenceItem?.value ?? '--'}%`,
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
    data: ['漏服次数', isDemo ? '依从率' : '确认执行率'],
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
      min: isDemo ? 60 : 0,
      max: isDemo ? 80 : 100,
      interval: isDemo ? 5 : 25,
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
      max: isDemo ? 4 : undefined,
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
          color:
            index === selectedPointIndex.value
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
      name: isDemo ? '依从率' : '确认执行率',
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
    const adherenceRatio = ((point.adherence ?? adherenceRange.min) - adherenceRange.min) / (adherenceRange.max - adherenceRange.min);
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

const linePath = computed(() =>
  chartPoints.value
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`)
    .join(' '),
);

const xLabels = computed(() => chartPoints.value.map((item) => ({ date: item.date, x: item.x })));
const yLabels = computed(() => [60, 65, 70, 75, 80]);

const legacyFilteredMedicationList = computed(() =>
  medicationRows.value.filter((item) => {
    if (statusFilter.value !== 'all' && item.status !== statusFilter.value) {
      return false;
    }

    if (dimensionFilter.value === 'duty') {
      return item.ward.includes('病区') || item.ward.includes('心内');
    }

    return true;
  }),
);

const legacyCurrentDateRecords = computed(() =>
  historyRecords.value.filter((item) => {
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
  }),
);

const todayMedicationIds = computed(() => new Set(isDemo ? resolvedReminders.value.flatMap(item => item.medicationIds) : history.days.value.find(d => d.date === shanghaiDate())?.occurrences.filter(o => o.executionStatus !== 'CANCELLED').flatMap(o => o.medications.map(m => m.medicationId)) ?? []));
const medicationFilterLabelMap: Record<MedicationFilter, string> = {
  today: '今日药品',
  hypertension: isDemo ? '高血压' : '使用中',
  diabetes: isDemo ? '糖尿病' : '停用/归档',
  all: '全部',
};

function matchesMedicationKeywords(item: MedicationRow, keywords: string[]): boolean {
  const text = `${item.name} ${item.spec}`.toLowerCase();
  return keywords.some((keyword) => text.includes(keyword));
}

function isHypertensionMedication(item: MedicationRow): boolean {
  return matchesMedicationKeywords(item, ['缬沙坦', '氯沙坦', '硝苯地平', '厄贝沙坦', 'valsartan', 'losartan']);
}

function isDiabetesMedication(item: MedicationRow): boolean {
  return matchesMedicationKeywords(item, ['二甲双胍', '格列', '阿卡波糖', '胰岛素', 'metformin', 'insulin']);
}

const filteredMedicationList = computed(() =>
  medicationRows.value.filter((item) => {
    if (medicationFilter.value === 'today') {
      return todayMedicationIds.value.has(item.id);
    }

    if (medicationFilter.value === 'hypertension') {
      return isDemo ? isHypertensionMedication(item) : item.medicationState === 'ACTIVE';
    }

    if (medicationFilter.value === 'diabetes') {
      return isDemo ? isDiabetesMedication(item) : item.medicationState !== 'ACTIVE';
    }

    return true;
  }),
);

const currentDateRecords = computed(() => !isDemo ? (realDays.value.find(d => d.date === selectedDate.value)?.rows ?? []).map((r, i) => ({
  id: i, date: selectedDate.value, patient: selectedPatient.value?.name ?? '当前患者', medication: `${r.medication.genericName} · ${r.medication.dose}`,
  ward: `历史药历版本 ${r.medication.version} · 计划版本 ${r.occurrence.planVersion}`, nurse: executionLabel(r.execution),
  status: ['TAKEN','MAKEUP'].includes(r.execution) ? 'done' as const : 'late' as const,
  note: `计划 ${displayTime(r.occurrence.plannedAt)}；确认时间 ${r.time ? displayTime(r.time) : '未确认'}；${r.record ? '记录 ' + r.record.recordId + ' / 修订 ' + r.record.revisionId : '无反馈'}${r.execution === 'CANCELLED' ? '（不入分母）' : ''}`,
})) : historyRecords.value.filter((item) => {
    if (item.date !== selectedDate.value) {
      return false;
    }

    return true;
  }),
);

const selectedDayCompletion = computed(() => {
  if (!isDemo) { const d = realDays.value.find(d => d.date === selectedDate.value); return d?.total ? `${d.taken}/${d.total}` : '—'; }
  const doneCount = currentDateRecords.value.filter((item) => item.status === 'done').length;
  return currentDateRecords.value.length ? `${doneCount}/${currentDateRecords.value.length}` : '--';
});

const patientName = computed(() => isDemo ? patient.value?.patientName ?? '演示患者' : selectedPatient.value?.name ?? '当前患者');
const patientSubtitle = computed(() => `${pageTitle} · 患者视图`);

function setTimeRange(next: TimeRange) {
  timeRange.value = next;
  if (!isDemo) { selectedPointIndex.value = Math.max(0, trendData.value.length - 1); selectedDate.value = shanghaiDate(); return; }
  const matchedIndex = trendMap[next].findIndex((point) => point.date === selectedDate.value);
  selectedPointIndex.value = matchedIndex >= 0 ? matchedIndex : 0;
  selectedDate.value = trendMap[next][selectedPointIndex.value]?.date ?? '04-21';
}

function setMedicationFilter(next: MedicationFilter) {
  medicationFilter.value = next;
}

function setStatusFilter(next: StatusFilter) {
  statusFilter.value = next;
}

function setDimensionFilter(next: DimensionFilter) {
  dimensionFilter.value = next;
}

function syncSelectedDate(date: string) {
  selectedDate.value = date;

  const activeRangeIndex = trendData.value.findIndex((point) => point.date === date);
  if (activeRangeIndex >= 0) {
    selectedPointIndex.value = activeRangeIndex;
    return;
  }

  const historyIndex = historyTrendData.value.findIndex((point) => point.date === date);
  if (historyIndex >= 0) {
    timeRange.value = '30d';
    selectedPointIndex.value = historyIndex;
  }
}

function legacySetStatusFilter(next: StatusFilter) {
  statusFilter.value = next;
}

function legacySetDimensionFilter(next: DimensionFilter) {
  dimensionFilter.value = next;
}

function openHistoryModal() {
  historyMonth.value = isDemo ? `${HISTORY_YEAR}-${selectedDate.value.slice(0, 2)}` : selectedDate.value.slice(0, 7);
  showHistoryModal.value = true;
}

function closeHistoryModal() {
  showHistoryModal.value = false;
}

function pickDate(point: TrendPoint, index: number) {
  selectedDate.value = point.date;
  selectedPointIndex.value = index;
}

function selectHistoryDate(date: string | null) {
  if (!date) {
    return;
  }

  syncSelectedDate(date);
  showHistoryModal.value = false;
  showDayRecordsModal.value = true;
}

function setHistoryMonth(next: string) {
  historyMonth.value = next;
}

function getCalendarTone(adherence: number | null): string {
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

function openDayRecords(point?: TrendPoint | null) {
  if (point) {
    syncSelectedDate(point.date);
  }
  showDayRecordsModal.value = true;
}

function closeDayRecordsModal() {
  showDayRecordsModal.value = false;
}

function openMedicationModal(item: MedicationRow) {
  selectedMedication.value = item;
}

function closeMedicationModal() {
  selectedMedication.value = null;
}

function resolveMedicationDetail(item: MedicationRow | null): MedicationDetailInfo {
  if (!isDemo) return { category: '暂无已核实分类', purpose: '本页仅展示药历与确认事实', indications: '未提供', interactionNote: '请在风险页查看已发布分析', adverseReactions: [], observationPoints: [] };
  if (!item) {
    return defaultMedicationDetail;
  }

  const text = `${item.name} ${item.spec}`.toLowerCase();
  const matched = medicationDetailLibrary.find((entry) => entry.keywords.some((keyword) => text.includes(keyword)));
  return matched?.detail ?? defaultMedicationDetail;
}

const selectedMedicationInfo = computed(() => resolveMedicationDetail(selectedMedication.value));

function showTooltip(event: MouseEvent, point: TrendPoint) {
  const target = event.currentTarget as SVGGraphicsElement;
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

function formatRiskLabel(risk: RiskLevel): string {
  if (risk === 'unknown') return '未在此评估';
  if (risk === 'high') {
    return '高风险';
  }
  if (risk === 'medium') {
    return '中风险';
  }
  return '低风险';
}

function getRowStatusTone(status: Exclude<StatusFilter, 'all'>): string {
  if (status === 'done') {
    return 'success';
  }
  return 'warning';
}

function handleTrendChartClick(params: { dataIndex?: number }) {
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

  if (trendChart && trendChart.getDom() !== chartHost.value) { trendChart.dispose(); trendChart = null; }
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
  history.dispose();
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
</script>

<template>
  <div class="mobile-page medication-page">
    <section v-if="loading" class="glass-section loading-panel">
      <ConnectionStatus :label="'正在读取 ' + patientName + ' 的药历与执行记录'" :completed="history.completedDays.value" :total="history.totalDays.value" />
    </section>

    <section v-else-if="error" class="glass-section loading-panel">
      <p>{{ error }}</p><button v-if="!isDemo" class="history-btn" @click="reloadReal">重试读取</button>
    </section>

    <template v-else>
      <section class="hero-panel">
        <div class="avatar-wrapper">
          <img class="avatar-image" src="https://i.pravatar.cc/150?u=medication-center" alt="患者头像" />
        </div>

        <div class="hero-top">
          <div class="hero-copy">
            <div class="hero-title-row">
              <h1 class="patient-name">{{ pageTitle }}</h1>
              <p class="patient-badge">{{ patientName }}</p>
            </div>
            <p class="patient-subtitle">{{ pageSubtitle }}</p>
          </div>
        </div>

        <div class="detail-strip">
          <div class="detail-item detail-item--green">
            <span class="detail-dot"></span>
            <span>{{ pageSubtitle }}</span>
          </div>
          <div class="detail-item detail-item--orange">
            <span class="detail-dot"></span>
            <span>{{ isDemo ? "重点风险患者" : "当前药历" }}</span>
            <strong>{{ isDemo ? "3 人" : history.medications.value.length + " 项" }}</strong>
          </div>
          <div class="detail-item detail-item--blue">
            <span class="detail-dot"></span>
            <span>今日提醒：{{ isDemo ? resolvedReminders.length : summary.reminderCount }} 条</span>
          </div>
        </div>

        <div class="metrics-panel">
          <article v-for="item in metricCards" :key="item.id" class="metric-card" :class="`metric-card--${item.tone}`">
            <div class="metric-copy">
              <span class="metric-label">{{ item.label }}</span>
              <span class="metric-detail">{{ item.detail }}</span>
            </div>
            <strong class="metric-value">{{ item.value }}</strong>
          </article>
        </div>
      </section>

      <section class="analysis-card glass-section" :style="analysisCardStyle">
        <div class="analysis-header">
          <h2 class="section-title">{{ isDemo ? "用药依从分析" : "用药执行趋势" }}</h2>
          <details v-if="!isDemo" class="analysis-note"><summary>执行率口径 · 近30天</summary>北京时间计划日：已服/补服 ÷ 有效计划用药项；无计划为—，未知/跳过不算已服，取消不入分母。不是医学风险结论。</details>
          <p v-if="selectedTrendPoint" class="analysis-note">
            {{ selectedTrendPoint.date }} | 依从率 {{ selectedTrendPoint.adherence == null ? "—" : selectedTrendPoint.adherence + "%" }} | 漏服 {{ selectedTrendPoint.missed }} 次
          </p>
          <div class="switch-group">
            <button :class="['tag-pill', { active: timeRange === '7d' }]" @click="setTimeRange('7d')">7天</button>
            <button :class="['tag-pill', { active: timeRange === '30d' }]" @click="setTimeRange('30d')">30天</button>
            <button class="history-btn" @click="openHistoryModal">查看历史记录</button><button v-if="!isDemo" class="history-btn" @click="reloadReal">刷新</button>
          </div>
        </div>

        <div class="chart-wrap">
          <div ref="chartHost" class="trend-chart-host"></div>
          <div class="chart-hit-area" :style="{ gridTemplateColumns: `repeat(${trendData.length}, minmax(0, 1fr))` }" aria-hidden="true">
            <button
              v-for="(point, index) in trendData"
              :key="`hit-${point.date}`"
              type="button"
              class="chart-hit-button"
              @click="openDayRecords(point)"
            >
              <span class="sr-only">查看 {{ point.date }} 用药记录</span>
            </button>
          </div>
          <svg v-if="isDemo" :viewBox="`0 0 ${chartConfig.width} ${chartConfig.height}`" class="trend-chart" preserveAspectRatio="none">
            <defs>
              <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#6ea88b" />
                <stop offset="100%" stop-color="#8bb4c2" />
              </linearGradient>
              <linearGradient id="barGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="rgba(157, 190, 204, 0.85)" />
                <stop offset="100%" stop-color="rgba(157, 190, 204, 0.28)" />
              </linearGradient>
            </defs>

            <line
              v-for="label in yLabels"
              :key="`grid-${label}`"
              :x1="chartConfig.paddingLeft"
              :x2="chartConfig.width - chartConfig.paddingRight"
              :y1="chartConfig.paddingTop + chartInner.height * (1 - (label - adherenceRange.min) / (adherenceRange.max - adherenceRange.min))"
              :y2="chartConfig.paddingTop + chartInner.height * (1 - (label - adherenceRange.min) / (adherenceRange.max - adherenceRange.min))"
              class="grid-line"
            />

            <g v-for="(point, index) in chartPoints" :key="`bar-${point.date}`">
              <rect
                :x="point.x - 13"
                :y="point.barY"
                width="26"
                :height="point.barHeight"
                rx="8"
                fill="url(#barGradient)"
                class="chart-bar"
                @mouseenter="showTooltip($event, point)"
                @mouseleave="hideTooltip"
                @click="pickDate(point, index)"
              />
            </g>

            <path :d="linePath" class="trend-line" />

            <circle
              v-for="(point, index) in chartPoints"
              :key="`dot-${point.date}`"
              :cx="point.x"
              :cy="point.y"
              r="index === selectedPointIndex ? 7 : 5"
              :class="['trend-dot', { selected: index === selectedPointIndex }]"
              @mouseenter="showTooltip($event, point)"
              @mouseleave="hideTooltip"
              @click="pickDate(point, index)"
            />

            <text
              v-for="label in yLabels"
              :key="`y-${label}`"
              :x="8"
              :y="chartConfig.paddingTop + chartInner.height * (1 - (label - adherenceRange.min) / (adherenceRange.max - adherenceRange.min)) + 4"
              class="axis-text"
            >
              {{ label }}%
            </text>

            <text
              v-for="label in xLabels"
              :key="`x-${label.date}`"
              :x="label.x"
              :y="chartConfig.height - 16"
              text-anchor="middle"
              class="axis-text"
            >
              {{ label.date }}
            </text>
          </svg>

          <div v-if="tooltip.visible" class="chart-tooltip" :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }">
            <p>{{ tooltip.date }}</p>
            <p>依从率：{{ tooltip.adherence }}%</p>
            <p>漏服次数：{{ tooltip.missed }}</p>
          </div>
        </div>

        <div v-if="false" class="day-records-panel">
          <div class="day-records-head">
            <div>
              <h3>{{ selectedDateLabel }} 用药记录</h3>
              <p>点击图表中的任意一天，可切换查看当天执行明细。</p>
            </div>
            <div class="day-records-summary">
              <strong>{{ selectedDayTrendPoint?.adherence ?? '--' }}%</strong>
              <span>完成 {{ selectedDayCompletion }}，漏服 {{ selectedDayTrendPoint?.missed ?? '--' }} 次</span>
            </div>
          </div>

          <ul class="day-records-list">
            <li v-for="record in currentDateRecords" :key="record.id" class="day-record-item">
              <div>
                <strong>{{ record.medication }}</strong>
                <p>{{ record.ward }} · {{ record.nurse }}</p>
                <p>{{ record.note }}</p>
              </div>
              <span :class="`status-chip status-chip--${getRowStatusTone(record.status)}`">{{ isDemo ? statusLabelMap[record.status] : record.nurse }}</span>
            </li>

            <li v-if="!currentDateRecords.length" class="history-empty">当天暂无用药执行记录</li>
          </ul>
        </div>

        <div class="analysis-actions">
          <div class="tab-group">
            <button :class="['tag-pill', { active: statusFilter === 'all' }]" @click="setStatusFilter('all')">全部</button>
            <button :class="['tag-pill', { active: statusFilter === 'done' }]" @click="setStatusFilter('done')">已完成</button>
            <button :class="['tag-pill', { active: statusFilter === 'late' }]" @click="setStatusFilter('late')">超迟</button>
          </div>

          <div class="tab-group tab-group--right">
            <button :class="['tag-pill', { active: dimensionFilter === 'all' }]" @click="setDimensionFilter('all')">全部</button>
            <button :class="['tag-pill', { active: dimensionFilter === 'duty' }]" @click="setDimensionFilter('duty')">值班</button>
            <button class="icon-pill" aria-label="更多筛选">⚙</button>
            <button class="history-btn" @click="openHistoryModal">查看历史记录</button>
          </div>
        </div>
      </section>

      <section class="list-panel glass-section">
        <div class="list-header">
          <p>当前筛选：{{ medicationFilterLabelMap[medicationFilter] }}</p>
          <div class="tab-group list-filter-group">
            <button :class="['tag-pill', { active: medicationFilter === 'today' }]" @click="setMedicationFilter('today')">今日药品</button>
            <button :class="['tag-pill', { active: medicationFilter === 'hypertension' }]" @click="setMedicationFilter('hypertension')">{{ medicationFilterLabelMap.hypertension }}</button>
            <button :class="['tag-pill', { active: medicationFilter === 'diabetes' }]" @click="setMedicationFilter('diabetes')">{{ medicationFilterLabelMap.diabetes }}</button>
            <button :class="['tag-pill', { active: medicationFilter === 'all' }]" @click="setMedicationFilter('all')">全部</button>
          </div>
          <h3 class="section-title">全部用药列表</h3>
          <p>当前筛选：{{ statusLabelMap[statusFilter] }} · {{ dimensionFilter === 'all' ? '全部维度' : '值班维度' }}</p>
        </div>

        <div class="medication-grid">
          <article v-for="item in filteredMedicationList" :key="item.id" class="medication-item" @click="openMedicationModal(item)">
            <div class="medication-item__head">
              <div>
                <h4>{{ item.name }}</h4>
                <p>{{ item.spec }}</p>
              </div>
              <span :class="`status-chip status-chip--${getRowStatusTone(item.status)}`">{{ statusLabelMap[item.status] }}</span>
            </div>
            <p>{{ item.dosage }}</p>
            <p>{{ item.period }} · {{ item.executionTime }} · {{ formatStatus(item.medicationState ?? 'ACTIVE').label }}</p>
            <div class="medication-item__foot">
              <span>{{ item.ward }}</span>
              <span :class="['risk-text', `risk-text--${item.risk}`]">{{ formatRiskLabel(item.risk) }}</span>
            </div>
          </article>
          <div v-if="!filteredMedicationList.length" class="medication-empty">当前暂无已同步药品，请先在管理页面新增药品。</div>
        </div>
      </section>
    </template>

    <div v-if="showHistoryModal" class="modal-mask" @click="closeHistoryModal">
      <div class="modal-card" @click.stop>
        <div class="modal-head">
          <h4>{{ historyMonthLabel }} 依从率日历</h4>
          <button class="close-btn" @click="closeHistoryModal">关闭</button>
        </div>

        <p class="modal-note">不同颜色表示不同依从率区间，点击某一天可切换查看当天记录。</p>

        <div class="calendar-toolbar">
          <div class="tab-group">
            <button
              v-for="month in historyMonthOptions"
              :key="month"
              :class="['tag-pill', { active: historyMonth === month }]"
              @click="setHistoryMonth(month)"
            >
              {{ month.replace('-', '年') }}月
            </button>
          </div>
          <div class="calendar-legend">
            <span class="calendar-legend__item calendar-legend__item--high">高依从</span>
            <span class="calendar-legend__item calendar-legend__item--medium">关注</span>
            <span class="calendar-legend__item calendar-legend__item--low">低依从</span>
          </div>
        </div>

        <div class="calendar-board">
          <div class="calendar-weekdays">
            <span v-for="weekday in historyWeekdays" :key="weekday">{{ weekday }}</span>
          </div>

          <div v-for="(week, weekIndex) in historyCalendarWeeks" :key="`week-${weekIndex}`" class="calendar-week">
            <button
              v-for="cell in week"
              :key="cell.key"
              type="button"
              class="calendar-day"
              :class="[
                `calendar-day--${getCalendarTone(cell.adherence)}`,
                {
                  'calendar-day--muted': !cell.isCurrentMonth,
                  'calendar-day--selected': cell.isSelected,
                },
              ]"
              :disabled="!cell.date || (!isDemo && !trendPointMap.has(cell.date))"
              @click="selectHistoryDate(cell.date)"
            >
              <span class="calendar-day__label">{{ cell.label }}</span>
              <strong class="calendar-day__value">{{ cell.adherence == null ? '--' : `${cell.adherence}%` }}</strong>
            </button>
          </div>
        </div>

        <div class="modal-day-summary">
          <strong>{{ selectedDateLabel }}</strong>
          <span>依从率 {{ selectedDayTrendPoint?.adherence ?? '--' }}% · 漏服 {{ selectedDayTrendPoint?.missed ?? '--' }} 次</span>
        </div>

        <div class="modal-actions">
          <button class="history-btn" @click="showHistoryModal = false; showDayRecordsModal = true">查看当天用药记录</button>
        </div>

        <ul v-if="false" class="history-list">
          <li v-for="record in currentDateRecords" :key="record.id" class="history-item">
            <div>
              <strong>{{ record.patient }}</strong>
              <p>{{ record.medication }} · {{ record.ward }}</p>
              <p>{{ record.note }}</p>
            </div>
            <div class="history-right">
              <span>{{ record.nurse }}</span>
              <span :class="`status-chip status-chip--${getRowStatusTone(record.status)}`">{{ isDemo ? statusLabelMap[record.status] : record.nurse }}</span>
            </div>
          </li>

          <li v-if="!currentDateRecords.length" class="history-empty">当前筛选条件下暂无记录</li>
        </ul>
      </div>
    </div>

    <div v-if="showDayRecordsModal" class="modal-mask" @click="closeDayRecordsModal">
      <div class="modal-card" @click.stop>
        <div class="modal-head">
          <h4>{{ selectedDateLabel }} 用药记录</h4>
          <button class="close-btn" @click="closeDayRecordsModal">关闭</button>
        </div>

        <div class="modal-day-summary">
          <strong>依从率 {{ selectedDayTrendPoint?.adherence ?? '--' }}%</strong>
          <span>完成 {{ selectedDayCompletion }} · 漏服 {{ selectedDayTrendPoint?.missed ?? '--' }} 次</span>
        </div>

        <ul class="history-list">
          <li v-for="record in currentDateRecords" :key="record.id" class="history-item">
            <div>
              <strong>{{ record.patient }}</strong>
              <p>{{ record.medication }} · {{ record.ward }}</p>
              <p>{{ record.note }}</p>
            </div>
            <div class="history-right">
              <span>{{ record.nurse }}</span>
              <span :class="`status-chip status-chip--${getRowStatusTone(record.status)}`">{{ isDemo ? statusLabelMap[record.status] : record.nurse }}</span>
            </div>
          </li>

          <li v-if="!currentDateRecords.length" class="history-empty">当天暂无用药执行记录</li>
        </ul>
      </div>
    </div>

    <div v-if="selectedMedication" class="modal-mask" @click="closeMedicationModal">
      <div class="modal-card" @click.stop>
        <div class="modal-head">
          <h4>{{ selectedMedication.name }}</h4>
          <button class="close-btn" @click="closeMedicationModal">关闭</button>
        </div>

        <div class="medication-detail">
          <div class="medication-detail__row">
            <span>规格</span>
            <strong>{{ selectedMedication.spec }}</strong>
          </div>
          <div class="medication-detail__row">
            <span>服用方案</span>
            <strong>{{ selectedMedication.dosage }}</strong>
          </div>
          <div class="medication-detail__row">
            <span>执行时段</span>
            <strong>{{ selectedMedication.period }} · {{ selectedMedication.executionTime }}</strong>
          </div>
          <div class="medication-detail__row">
            <span>{{ isDemo ? "病区" : "标准化状态" }}</span>
            <strong>{{ selectedMedication.ward }}</strong>
          </div>
          <div class="medication-detail__row">
            <span>风险等级</span>
            <strong :class="['risk-text', `risk-text--${selectedMedication.risk}`]">{{ formatRiskLabel(selectedMedication.risk) }}</strong>
          </div>
          <div class="medication-detail__row">
            <span>状态</span>
            <strong>{{ statusLabelMap[selectedMedication.status] }}</strong>
          </div>
        </div>

        <div class="medication-detail-section">
          <h5>药品说明</h5>
          <div class="medication-detail__row">
            <span>药品类别</span>
            <strong>{{ selectedMedicationInfo.category }}</strong>
          </div>
          <div class="medication-detail__row medication-detail__row--stack">
            <span>主要作用</span>
            <p>{{ selectedMedicationInfo.purpose }}</p>
          </div>
          <div class="medication-detail__row medication-detail__row--stack">
            <span>适用场景</span>
            <p>{{ selectedMedicationInfo.indications }}</p>
          </div>
          <div class="medication-detail__row medication-detail__row--stack">
            <span>联用提示</span>
            <p>{{ selectedMedicationInfo.interactionNote }}</p>
          </div>
        </div>

        <div class="medication-detail-section">
          <h5>常见不良反应</h5>
          <div class="pill-list">
            <span
              v-for="item in selectedMedicationInfo.adverseReactions"
              :key="`${selectedMedication.id}-adverse-${item}`"
              class="detail-pill"
            >
              {{ item }}
            </span>
          </div>
        </div>

        <div class="medication-detail-section">
          <h5>观察重点</h5>
          <div class="pill-list">
            <span
              v-for="item in selectedMedicationInfo.observationPoints"
              :key="`${selectedMedication.id}-observation-${item}`"
              class="detail-pill detail-pill--accent"
            >
              {{ item }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.medication-page {
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

.medication-page::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    linear-gradient(90deg, rgba(241, 249, 255, 0.58) 0%, rgba(220, 237, 247, 0.42) 38%, rgba(200, 224, 238, 0.14) 68%, rgba(255, 255, 255, 0) 100%);
  pointer-events: none;
  z-index: 0;
}

.medication-page::after {
  content: '';
  position: fixed;
  inset: auto 0 -160px 0;
  height: 300px;
  pointer-events: none;
  z-index: 0;
}

.medication-page > * {
  position: relative;
  z-index: 1;
}

.loading-panel {
  padding: 28px 16px;
  text-align: center;
  color: #4f697b;
}

.hero-panel {
  margin-bottom: 14px;
  padding: 48px 0 0;
  position: relative;
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
  max-width: 340px;
}

.avatar-wrapper {
  display: none;
}

.hero-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.patient-badge {
  margin: 0;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  min-height: 34px;
  padding: 0 14px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(29, 80, 72, 0.12) 0%, rgba(45, 138, 103, 0.22) 100%);
  border: 1px solid rgba(45, 138, 103, 0.16);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: #205f56;
}

.patient-name {
  margin: 0;
  font-size: 34px;
  font-weight: 900;
  line-height: 1.02;
  letter-spacing: -0.02em;
  color: #173f46;
  text-align: left;
}

.patient-subtitle {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: rgba(31, 54, 70, 0.72);
  text-align: left;
  max-width: 30ch;
}

.detail-strip {
  display: none;
}

.detail-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
  white-space: nowrap;
  color: #375268;
  font-size: 13px;
}

.detail-item + .detail-item {
  position: relative;
}

.detail-item + .detail-item::before {
  content: '';
  width: 1px;
  height: 18px;
  margin-right: 6px;
  background: rgba(88, 117, 138, 0.22);
}

.detail-item strong {
  font-weight: 700;
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

.metrics-panel {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 20px;
}

.metric-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-width: 0;
  min-height: 92px;
  padding: 16px 15px;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  color: #f2fbf8;
  box-shadow: 0 14px 28px rgba(22, 53, 52, 0.14);
  transition: transform 0.24s ease, box-shadow 0.24s ease;
}

.metric-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 16px 32px rgba(22, 53, 52, 0.18);
}

.metric-card--green {
  background:
    radial-gradient(circle at top right, rgba(255, 255, 255, 0.2), transparent 36%),
    linear-gradient(135deg, #3a7d85 0%, #59aaa4 100%);
}

.metric-card--blue {
  background:
    radial-gradient(circle at top right, rgba(255, 255, 255, 0.2), transparent 36%),
    linear-gradient(135deg, #42856f 0%, #68bb8f 100%);
}

.metric-card--gold {
  background:
    radial-gradient(circle at top right, rgba(255, 255, 255, 0.18), transparent 36%),
    linear-gradient(135deg, #5d8f81 0%, #8cc1aa 100%);
}

.metric-copy {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.metric-label {
  display: block;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.2;
  color: inherit;
}

.metric-value {
  display: block;
  flex-shrink: 0;
  font-size: 30px;
  font-weight: 800;
  line-height: 1;
  color: inherit;
}

.metric-detail {
  display: block;
  font-size: 12px;
  line-height: 1.4;
  color: rgba(242, 251, 248, 0.8);
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

.analysis-card {
  position: relative;
  padding: 14px;
  border-color: rgba(255, 255, 255, 0.56);
  box-shadow: 0 16px 34px rgba(39, 72, 96, 0.14);
}

.analysis-card::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(244, 250, 255, 0.34), rgba(86, 139, 182, 0.1));
  pointer-events: none;
}

.analysis-card > * {
  position: relative;
  z-index: 1;
}

.analysis-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.section-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #3b5262;
}

.analysis-note {
  margin: 0;
  flex: 1 1 100%;
  font-size: 12px;
  color: #667d94;
}

.switch-group,
.tab-group {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.tag-pill,
.icon-pill,
.history-btn,
.close-btn {
  border: none;
  border-radius: 999px;
  padding: 8px 14px;
  background: rgba(255, 255, 255, 0.62);
  color: #4b6760;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.24s ease;
}

.tag-pill:hover,
.icon-pill:hover,
.history-btn:hover,
.close-btn:hover {
  transform: translateY(-1px);
  background: rgba(255, 255, 255, 0.82);
}

.tag-pill.active {
  color: #2b4a40;
  background: rgba(225, 239, 232, 0.9);
  box-shadow: inset 0 0 0 1px rgba(141, 174, 158, 0.42);
}

.chart-wrap {
  position: relative;
  border-radius: 16px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.9) 0%, rgba(236, 245, 252, 0.76) 100%),
    rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.72);
  padding: 10px 10px 2px;
  overflow: hidden;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.42);
}

.chart-hit-area {
  position: absolute;
  inset: 10px 10px 2px;
  z-index: 2;
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  pointer-events: none;
}

.chart-hit-button {
  width: 100%;
  height: 100%;
  border-radius: 0;
  background: transparent;
  pointer-events: auto;
}

.sr-only {
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

.day-records-panel {
  margin-top: 14px;
  padding: 14px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.58);
  border: 1px solid rgba(255, 255, 255, 0.72);
}

.day-records-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.day-records-head h3,
.modal-day-summary strong {
  margin: 0;
  font-size: 15px;
  color: #355369;
}

.day-records-head p,
.modal-day-summary span {
  margin: 4px 0 0;
  font-size: 12px;
  color: #667d94;
}

.day-records-summary {
  display: grid;
  gap: 4px;
  min-width: 136px;
  justify-items: end;
  text-align: right;
}

.day-records-summary strong {
  font-size: 28px;
  line-height: 1;
  color: #2f6f59;
}

.day-records-summary span {
  font-size: 12px;
  color: #5f7774;
}

.day-records-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}

.day-record-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border-radius: 14px;
  background: rgba(246, 250, 255, 0.8);
}

.day-record-item strong {
  font-size: 14px;
}

.day-record-item p {
  margin: 4px 0 0;
  font-size: 12px;
  color: #627b76;
}

.trend-chart-host {
  width: 100%;
  height: 226px;
}

.trend-chart,
.chart-tooltip {
  display: none;
}

.analysis-actions {
  display: none;
}

.tab-group--right {
  justify-content: flex-end;
}

.history-btn {
  background: linear-gradient(120deg, rgba(205, 223, 212, 0.92), rgba(227, 237, 227, 0.92));
}

.list-panel {
  padding: 16px;
}

.list-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.list-header p {
  margin: 0;
  font-size: 12px;
  color: #5f7774;
}

.list-header .section-title {
  order: 0;
}

.list-header > p:first-of-type {
  order: 1;
}

.list-filter-group {
  order: 2;
  width: 100%;
}

.list-header > p:last-of-type {
  display: none;
}

.medication-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.medication-empty {
  grid-column: 1 / -1;
  padding: 18px 16px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.58);
  border: 1px solid rgba(255, 255, 255, 0.72);
  text-align: center;
  color: #5f7774;
  font-size: 13px;
}

.medication-item {
  background: rgba(255, 255, 255, 0.53);
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  padding: 14px;
  cursor: pointer;
  transition: all 0.24s ease;
}

.medication-item:hover {
  background: rgba(255, 255, 255, 0.74);
  box-shadow: 0 14px 30px rgba(77, 106, 96, 0.16);
}

.medication-item__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.medication-item__head h4 {
  margin: 0;
  font-size: 14px;
}

.medication-item__head p,
.medication-item p {
  margin: 4px 0 0;
  font-size: 12px;
  color: #607874;
}

.medication-item__foot {
  margin-top: 9px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: #65807a;
}

.risk-text--low {
  color: #6a8c74;
}

.risk-text--medium {
  color: #9a8558;
}

.risk-text--high {
  color: #a76245;
}

.modal-mask {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: rgba(102, 124, 118, 0.26);
  backdrop-filter: blur(4px);
  display: grid;
  place-items: center;
  padding: 16px;
}

.modal-card {
  width: min(760px, 100%);
  max-height: 75vh;
  overflow: auto;
  border-radius: 22px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  background: rgba(248, 252, 251, 0.9);
  box-shadow: 0 22px 44px rgba(69, 96, 86, 0.22);
  padding: 18px;
}

.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.modal-head h4 {
  margin: 0;
  font-size: 15px;
}

.modal-note {
  margin: 8px 0 12px;
  font-size: 12px;
  color: #607b76;
}

.modal-actions {
  margin-bottom: 12px;
}

.calendar-toolbar {
  display: grid;
  gap: 10px;
  margin-bottom: 12px;
}

.calendar-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.calendar-legend__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #617a74;
}

.calendar-legend__item::before {
  content: '';
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: currentColor;
}

.calendar-legend__item--high {
  color: #3d8a61;
}

.calendar-legend__item--medium {
  color: #be8b32;
}

.calendar-legend__item--low {
  color: #c56b5b;
}

.calendar-board {
  display: grid;
  gap: 6px;
  margin-bottom: 14px;
}

.calendar-weekdays,
.calendar-week {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
}

.calendar-weekdays span {
  text-align: center;
  font-size: 11px;
  color: #70849a;
}

.calendar-day {
  min-height: 66px;
  padding: 8px 6px;
  border-radius: 14px;
  border: 1px solid transparent;
  display: grid;
  align-content: space-between;
  justify-items: start;
  text-align: left;
  background: rgba(242, 247, 250, 0.75);
  color: #4d667d;
}

.calendar-day:disabled {
  cursor: default;
  opacity: 0.45;
}

.calendar-day--selected {
  border-color: rgba(47, 111, 89, 0.48);
  box-shadow: inset 0 0 0 1px rgba(47, 111, 89, 0.18);
}

.calendar-day--high {
  background: rgba(98, 168, 120, 0.2);
}

.calendar-day--medium {
  background: rgba(212, 160, 79, 0.24);
}

.calendar-day--low {
  background: rgba(214, 110, 92, 0.22);
}

.calendar-day--empty {
  background: rgba(242, 247, 250, 0.75);
}

.calendar-day--muted {
  visibility: hidden;
}

.calendar-day__label {
  font-size: 12px;
  font-weight: 700;
}

.calendar-day__value {
  font-size: 11px;
}

.modal-day-summary {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(243, 248, 246, 0.9);
}

.medication-detail {
  display: grid;
  gap: 10px;
}

.medication-detail__row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(245, 249, 248, 0.92);
}

.medication-detail__row span {
  font-size: 12px;
  color: #647a76;
}

.medication-detail__row strong {
  font-size: 13px;
  color: #294a67;
  text-align: right;
}

.medication-detail__row--stack {
  display: grid;
  grid-template-columns: 84px 1fr;
  align-items: flex-start;
}

.medication-detail__row--stack p {
  margin: 0;
  color: #536b7d;
  font-size: 13px;
  line-height: 1.65;
  text-align: right;
}

.medication-detail-section {
  display: grid;
  gap: 12px;
}

.medication-detail-section h5 {
  margin: 2px 0 0;
  color: #264660;
  font-size: 14px;
}

.pill-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.detail-pill {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(255, 245, 240, 0.92);
  color: #8a5336;
  border: 1px solid rgba(233, 201, 184, 0.9);
  font-size: 12px;
  font-weight: 700;
}

.detail-pill--accent {
  background: rgba(239, 247, 255, 0.94);
  color: #295b86;
  border-color: rgba(190, 214, 235, 0.92);
}

.history-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.history-item {
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.95);
  padding: 12px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.history-item strong {
  font-size: 14px;
}

.history-item p {
  margin: 4px 0 0;
  font-size: 12px;
  color: #627b76;
}

.history-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 7px;
  font-size: 12px;
  color: #617a74;
}

.history-empty {
  text-align: center;
  color: #67827c;
  font-size: 13px;
  padding: 14px 0;
}

@media (max-width: 900px) {
  .medication-grid {
    grid-template-columns: 1fr;
  }

  .analysis-actions {
    flex-direction: column;
    align-items: flex-start;
  }

  .tab-group--right {
    justify-content: flex-start;
  }
}

@media (max-width: 640px) {
  .medication-page {
    padding: 10px 12px calc(var(--bottom-nav-height) + env(safe-area-inset-bottom, 0px));
  }

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

  .patient-subtitle {
    font-size: 13px;
  }

  .metric-card {
    min-height: 84px;
    padding: 14px 12px;
    gap: 12px;
  }

  .metric-label {
    font-size: 14px;
  }

  .metric-value {
    font-size: 24px;
  }

  .metric-detail {
    font-size: 11px;
  }

  .analysis-card,
  .list-panel {
    padding: 12px;
  }

  .analysis-header {
    flex-direction: column;
    align-items: stretch;
  }

  .trend-chart-host {
    height: 208px;
  }

  .day-records-head,
  .modal-day-summary {
    flex-direction: column;
    align-items: flex-start;
  }

  .day-records-summary {
    justify-items: start;
    text-align: left;
    min-width: 0;
  }

  .calendar-weekdays,
  .calendar-week {
    gap: 4px;
  }

  .calendar-day {
    min-height: 58px;
    padding: 7px 5px;
  }

  .calendar-day__value {
    font-size: 10px;
  }

  .list-header {
    align-items: flex-start;
  }
}
</style>
