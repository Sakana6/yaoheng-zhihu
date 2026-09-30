<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { useMock, patients, selectedPatient, refreshPatients } from '../../../../packages/frontend/session';

type MetricTone = 'blue' | 'teal' | 'violet' | 'orange';
type ScheduleStatusTone = 'processing' | 'waiting' | 'reserved' | 'done';

interface DashboardMetric {
  label: string;
  value: string;
  unit: string;
  compare: string;
  trend: string;
  tone: MetricTone;
  icon: string;
}

interface ScheduleRow {
  time: string;
  name: string;
  gender: string;
  age: number;
  type: string;
  status: string;
  statusTone: ScheduleStatusTone;
  action: string;
  accent: string;
  link: string;
}

interface RecentPatient {
  id: number;
  name: string;
  gender: string;
  age: number;
  diagnosis: string;
  time: string;
}

interface QuickAction {
  label: string;
  icon: string;
  tone: string;
  to: string;
}

const currentDate = ref(new Date());
const greetingDate = computed(() => '今天是 ' + currentDate.value.toLocaleDateString('zh-CN', {timeZone:'Asia/Shanghai',year:'numeric',month:'long',day:'numeric',weekday:'long'}));
const dateLabel = computed(() => currentDate.value.toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'}));
const listError=ref(''), refreshing=ref(false);
let alive=true, clock: ReturnType<typeof setInterval> | undefined;
async function refreshList(){ if(refreshing.value)return; refreshing.value=true; try{await refreshPatients(); if(alive)listError.value='';}catch(e){if(alive)listError.value='授权患者读取失败，请重试。'+String(e);}finally{if(alive)refreshing.value=false;} }
onMounted(()=>{clock=setInterval(()=>{currentDate.value=new Date();},60000);});
onBeforeUnmount(()=>{alive=false;clearInterval(clock);});

const demoMetrics: DashboardMetric[] = [
  {
    label: '今日接诊',
    value: '24',
    unit: '位患者',
    compare: '较昨日 +12%',
    trend: '24 18 27 22 31 28 35',
    tone: 'blue',
    icon: 'M12 3.2 3.5 9.8v8.4a1 1 0 0 0 1 1h5.2v-5.2h4.6V19h5.2a1 1 0 0 0 1-1V9.8L12 3.2Z',
  },
  {
    label: '待复核用药',
    value: '8',
    unit: '条记录',
    compare: '较昨日 -1',
    trend: '18 20 16 22 19 21 28',
    tone: 'teal',
    icon: 'M4.5 6.8a1.8 1.8 0 0 1 1.8-1.8h11.4a1.8 1.8 0 0 1 1.8 1.8v10.4A1.8 1.8 0 0 1 17.7 19H6.3a1.8 1.8 0 0 1-1.8-1.8V6.8Zm3.2 3.1h8.6m-8.6 3.7h4.2m3.4-.3 1.2 1.2 2.2-2.2',
  },
  {
    label: '今日随访',
    value: '12',
    unit: '次反馈',
    compare: '需升级处理 2 次',
    trend: '14 16 13 17 23 20 24',
    tone: 'violet',
    icon: 'M7.2 5.4h9.6a2 2 0 0 1 2 2v9.2a2 2 0 0 1-2 2H11l-4.6 3.2v-3.2H7.2a2 2 0 0 1-2-2V7.4a2 2 0 0 1 2-2Zm2.5 4.3h4.6m-4.6 3.5h6.6',
  },
  {
    label: '知识库数据集',
    value: '2',
    unit: '个来源',
    compare: '药品 / 随访已同步',
    trend: '10 12 12 16 18 22 24',
    tone: 'orange',
    icon: 'M7.5 4.6h9a2 2 0 0 1 2 2v10.8a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V6.6a2 2 0 0 1 2-2Zm2.4 3.5h4.8m-4.8 4h4.8m-4.8 4h3.1',
  },
];

const demoScheduleRows: ScheduleRow[] = [
  {
    time: '09:00',
    name: '王建国',
    gender: '男',
    age: 58,
    type: '复诊',
    status: '进行中',
    statusTone: 'processing',
    action: '进入详情',
    accent: '#5680ff',
    link: '/patients/1',
  },
  {
    time: '09:30',
    name: '李秀兰',
    gender: '女',
    age: 63,
    type: '随访回访',
    status: '待开始',
    statusTone: 'waiting',
    action: '看随访',
    accent: '#ffb85a',
    link: '/follow-ups',
  },
  {
    time: '10:00',
    name: '张明远',
    gender: '男',
    age: 45,
    type: '用药复核',
    status: '已预约',
    statusTone: 'reserved',
    action: '看用药',
    accent: '#8ab933',
    link: '/medications',
  },
  {
    time: '10:30',
    name: '陈小雪',
    gender: '女',
    age: 29,
    type: '知识库核对',
    status: '已预约',
    statusTone: 'reserved',
    action: '看数据',
    accent: '#53c98c',
    link: '/knowledge-base',
  },
  {
    time: '11:00',
    name: '刘志强',
    gender: '男',
    age: 71,
    type: '复诊',
    status: '已完成',
    statusTone: 'done',
    action: '查看记录',
    accent: '#6288ff',
    link: '/patients/1',
  },
];

const demoRecentPatients: RecentPatient[] = [
  { id: 1, name: '王建国', gender: '男', age: 58, diagnosis: '高血压 / 2 型糖尿病', time: '今日 09:00' },
  { id: 2, name: '李秀兰', gender: '女', age: 63, diagnosis: '2 型糖尿病', time: '今日 09:30' },
  { id: 3, name: '张明远', gender: '男', age: 45, diagnosis: '冠心病', time: '昨日 14:20' },
  { id: 4, name: '陈小雪', gender: '女', age: 29, diagnosis: '慢性咽炎', time: '昨日 10:15' },
];

const demoQuickActions: QuickAction[] = [
  {
    label: '查看患者详情',
    icon: 'M12 12.5a4.2 4.2 0 1 0-4.2-4.2 4.2 4.2 0 0 0 4.2 4.2Zm-7.4 8.3a6.7 6.7 0 0 1 13.4 0',
    tone: 'blue',
    to: '/patients/1',
  },
  {
    label: '进入用药管理',
    icon: 'M8 4.8h8a1.8 1.8 0 0 1 1.8 1.8v10.8A1.8 1.8 0 0 1 16 19.2H8A1.8 1.8 0 0 1 6.2 17.4V6.6A1.8 1.8 0 0 1 8 4.8Zm2.2 3.4h3.6m-3.6 4h3.6m-3.6 4h2.2',
    tone: 'violet',
    to: '/medications',
  },
  {
    label: '查看随访反馈',
    icon: 'M12 19.8s-6.7-4.2-6.7-10a3.8 3.8 0 0 1 6.4-2.7l.3.3.3-.3a3.8 3.8 0 0 1 6.4 2.7c0 5.8-6.7 10-6.7 10ZM12 8v4.4l2.4 1.4',
    tone: 'teal',
    to: '/follow-ups',
  },
  {
    label: '打开知识库',
    icon: 'M7.8 4.8h8.4A1.8 1.8 0 0 1 18 6.6v10.8a1.8 1.8 0 0 1-1.8 1.8H7.8A1.8 1.8 0 0 1 6 17.4V6.6A1.8 1.8 0 0 1 7.8 4.8Zm4.2 3.4v7.6m-3.8-3.8h7.6',
    tone: 'blue',
    to: '/knowledge-base',
  },
];
const metrics=computed(() => useMock ? demoMetrics : demoMetrics.map(x=>({...x,value:'—',unit:'暂无数据',compare:'暂无对应统计服务',trend:''})));
const scheduleRows=computed(()=>useMock?demoScheduleRows:[]);
const recentPatients=computed(()=>useMock?demoRecentPatients:patients.value.map(p=>({...p,gender:'未提供',age:null,diagnosis:'未提供诊断信息',time:'已授权'})));
const quickActions=computed(()=>demoQuickActions.map(x=>({...x,to:!useMock&&x.to==='/patients/1'?selectedPatient.value?'/patients/'+selectedPatient.value.id:'/patients':x.to})));
</script>

<template>
  <div class="doctor-dashboard">
    <section class="doctor-dashboard__greeting">
      <div class="doctor-dashboard__greeting-copy">
        <div class="doctor-dashboard__headline">
          <h1>{{ useMock ? '上午好，张医生' : '您好，医生' }}</h1>
          <span class="doctor-dashboard__sun" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="4.4" />
              <path d="M12 2.8v3M12 18.2v3M21.2 12h-3M5.8 12h-3M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1M18.5 18.5l-2.1-2.1M7.6 7.6 5.5 5.5" />
            </svg>
          </span>
        </div>
        <p>{{ greetingDate }}</p>
      </div>
    </section>

    <section class="doctor-dashboard__metric-row">
      <article
        v-for="item in metrics"
        :key="item.label"
        class="doctor-metric-card"
        :class="`doctor-metric-card--${item.tone}`"
      >
        <div class="doctor-metric-card__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path :d="item.icon" />
          </svg>
        </div>

        <div class="doctor-metric-card__body">
          <p>{{ item.label }}</p>
          <div class="doctor-metric-card__value">
            <strong>{{ item.value }}</strong>
            <span>{{ item.unit }}</span>
          </div>
          <div class="doctor-metric-card__foot">
            <span>{{ item.compare }}</span>

            <svg v-if="useMock" viewBox="0 0 58 18" fill="none" aria-hidden="true">
              <polyline
                :points="item.trend.split(' ').map((point, index) => `${index * 9.2},${18 - Number(point) / 2}`).join(' ')"
              />
            </svg>
          </div>
        </div>
      </article>
    </section>

    <section class="doctor-dashboard__core-grid">
      <article class="dashboard-panel dashboard-panel--schedule">
        <div class="dashboard-panel__head">
          <div>
            <h2>今日管理安排</h2>
            <p>聚焦患者详情、用药复核和随访回访，不再展示工作台数据概览与 AI 助手卡片。</p>
          </div>

          <button type="button" class="dashboard-date-chip">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M7.7 4.8v2.4M16.3 4.8v2.4M5.8 8.6h12.4M7.6 4.8h8.8A1.8 1.8 0 0 1 18.2 6.6v10.8a1.8 1.8 0 0 1-1.8 1.8H7.6a1.8 1.8 0 0 1-1.8-1.8V6.6A1.8 1.8 0 0 1 7.6 4.8Z" />
            </svg>
            <span>{{ dateLabel }}</span>
          </button>
        </div>

        <p v-if="!useMock">暂无排班数据。</p>
        <div class="schedule-table">
          <div class="schedule-table__head">
            <span>时间</span>
            <span>患者信息</span>
            <span>类型</span>
            <span>状态</span>
            <span>操作</span>
          </div>

          <div
            v-for="row in scheduleRows"
            :key="`${row.time}-${row.name}`"
            class="schedule-row"
            :style="{ '--row-accent': row.accent }"
          >
            <span class="schedule-row__time">{{ row.time }}</span>
            <span class="schedule-row__patient">{{ row.name }} / {{ row.gender }} {{ row.age }} 岁</span>
            <span class="schedule-row__type">{{ row.type }}</span>
            <span class="schedule-status" :class="`schedule-status--${row.statusTone}`">{{ row.status }}</span>
            <RouterLink :to="row.link" class="schedule-action">{{ row.action }}</RouterLink>
          </div>
        </div>
      </article>

      <article class="dashboard-panel dashboard-panel--patients">
        <div class="dashboard-panel__head">
          <div>
            <h2>{{ useMock ? '最近患者' : '授权患者' }}</h2>
            <p>进入授权患者详情，查看风险快照与当日确认记录。</p>
          </div>
        </div>

        <template v-if="!useMock"><button class="history-button" :disabled="refreshing" @click="refreshList">刷新患者列表</button><p v-if="listError" role="alert">{{ listError }}</p><p v-if="!recentPatients.length">暂无授权患者。</p></template>
        <div class="recent-patient-list">
          <article v-for="item in recentPatients" :key="item.id" class="recent-patient-card">
            <div class="recent-patient-card__identity">
              <div class="recent-patient-card__avatar">{{ item.name.slice(0, 1) }}</div>
              <div>
                <strong>{{ item.name }}<template v-if="useMock"> / {{ item.gender }} {{ item.age }} 岁</template></strong>
                <p>{{ item.diagnosis }}</p>
              </div>
            </div>

            <div class="recent-patient-card__meta">
              <span>{{ item.time }}</span>
              <RouterLink :to="`/patients/${item.id}`" class="history-button">
                查看详情
              </RouterLink>
            </div>
          </article>
        </div>
      </article>
    </section>

    <section class="dashboard-panel dashboard-panel--actions">
      <div class="dashboard-panel__head">
        <div>
          <h2>快捷入口</h2>
          <p>工作台仅保留实际管理入口。</p>
        </div>
      </div>

      <div class="quick-action-grid">
        <RouterLink
          v-for="item in quickActions"
          :key="item.label"
          :to="item.to"
          class="quick-action-button"
          :class="`quick-action-button--${item.tone}`"
        >
          <span class="quick-action-button__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path :d="item.icon" />
            </svg>
          </span>
          <span>{{ item.label }}</span>
        </RouterLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
.doctor-dashboard {
  display: grid;
  gap: 18px;
}

.doctor-dashboard__greeting {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 8px 8px 4px;
}

.doctor-dashboard__headline {
  display: flex;
  align-items: center;
  gap: 14px;
}

.doctor-dashboard__headline h1 {
  margin: 0;
  font-size: 24px;
  line-height: 1.15;
  color: #2e4360;
}

.doctor-dashboard__greeting p,
.dashboard-panel__head p {
  margin: 8px 0 0;
  color: #73859d;
  font-size: 14px;
  line-height: 1.7;
}

.doctor-dashboard__sun {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 999px;
  background: rgba(255, 180, 76, 0.12);
  color: #ffb03b;
}

.doctor-dashboard__sun svg {
  width: 22px;
  height: 22px;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.doctor-dashboard__metric-row,
.quick-action-grid {
  display: grid;
  gap: 14px;
}

.doctor-dashboard__metric-row {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.doctor-metric-card,
.dashboard-panel {
  position: relative;
  overflow: hidden;
  border-radius: 22px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.82), rgba(255, 255, 255, 0.72));
  border: 1px solid rgba(255, 255, 255, 0.78);
  box-shadow:
    0 18px 40px rgba(90, 113, 147, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.84);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

.doctor-metric-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 16px;
  min-height: 120px;
  padding: 18px 20px;
}

.doctor-metric-card::before,
.dashboard-panel::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at top right, rgba(255, 255, 255, 0.52), transparent 30%);
  pointer-events: none;
}

.doctor-metric-card__icon {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 14px;
}

.doctor-metric-card__icon svg,
.dashboard-date-chip svg,
.quick-action-button svg {
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.doctor-metric-card__body {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 10px;
}

.doctor-metric-card__body p {
  margin: 0;
  color: #5c718c;
  font-size: 15px;
  font-weight: 600;
}

.doctor-metric-card__value {
  display: flex;
  align-items: flex-end;
  gap: 6px;
}

.doctor-metric-card__value strong {
  font-size: 28px;
  line-height: 1;
  color: #243950;
}

.doctor-metric-card__value span {
  color: #8a9bb2;
  font-size: 13px;
  font-weight: 600;
}

.doctor-metric-card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.doctor-metric-card__foot span {
  color: #56b57a;
  font-size: 14px;
  font-weight: 600;
}

.doctor-metric-card__foot svg {
  width: 58px;
  height: 18px;
  flex: 0 0 auto;
}

.doctor-metric-card__foot polyline {
  fill: none;
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.doctor-metric-card--blue .doctor-metric-card__icon {
  background: rgba(89, 132, 248, 0.16);
  color: #5a83f8;
}

.doctor-metric-card--blue polyline {
  stroke: #5a83f8;
}

.doctor-metric-card--teal .doctor-metric-card__icon {
  background: rgba(79, 200, 191, 0.18);
  color: #47bfb4;
}

.doctor-metric-card--teal polyline {
  stroke: #47bfb4;
}

.doctor-metric-card--violet .doctor-metric-card__icon {
  background: rgba(149, 136, 255, 0.18);
  color: #8e83ff;
}

.doctor-metric-card--violet polyline {
  stroke: #8e83ff;
}

.doctor-metric-card--orange .doctor-metric-card__icon {
  background: rgba(255, 183, 96, 0.18);
  color: #ff9d47;
}

.doctor-metric-card--orange polyline {
  stroke: #ff914a;
}

.doctor-dashboard__core-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(340px, 0.92fr);
  gap: 18px;
}

.dashboard-panel {
  padding: 16px 18px 18px;
}

.dashboard-panel__head {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.dashboard-panel__head h2 {
  margin: 0;
  color: #2d4260;
  font-size: 18px;
}

.dashboard-date-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(224, 232, 243, 0.92);
  color: #607791;
  font-size: 14px;
  font-weight: 600;
}

.schedule-table {
  position: relative;
  z-index: 1;
  display: grid;
  border-radius: 18px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.48);
}

.schedule-table__head,
.schedule-row {
  display: grid;
  grid-template-columns: 88px minmax(0, 1.3fr) 108px 110px 96px;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
}

.schedule-table__head {
  background: rgba(245, 247, 252, 0.82);
  color: #8d9eb4;
  font-size: 13px;
  font-weight: 700;
}

.schedule-row {
  position: relative;
  color: #394e68;
  border-top: 1px solid rgba(231, 237, 246, 0.88);
}

.schedule-row::before {
  content: '';
  position: absolute;
  left: 0;
  top: 13px;
  bottom: 13px;
  width: 3px;
  border-radius: 999px;
  background: var(--row-accent);
}

.schedule-row__patient {
  font-weight: 600;
  color: #364960;
}

.schedule-status,
.schedule-action,
.history-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  padding: 0 12px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 700;
}

.schedule-status {
  width: fit-content;
}

.schedule-status--processing {
  color: #33a974;
  background: rgba(62, 199, 135, 0.14);
}

.schedule-status--waiting {
  color: #ff9c41;
  background: rgba(255, 189, 98, 0.18);
}

.schedule-status--reserved {
  color: #6f86ff;
  background: rgba(111, 134, 255, 0.14);
}

.schedule-status--done {
  color: #52b795;
  background: rgba(82, 183, 149, 0.14);
}

.schedule-action,
.history-button {
  justify-self: start;
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid rgba(207, 218, 232, 0.92);
  color: #4d77f5;
}

.recent-patient-list {
  display: grid;
  gap: 10px;
}

.recent-patient-card {
  display: grid;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.62);
  border: 1px solid rgba(229, 236, 246, 0.92);
}

.recent-patient-card__identity,
.recent-patient-card__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.recent-patient-card__avatar {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  background: linear-gradient(135deg, #7ea1ff, #5881f8);
  color: #fff;
  font-weight: 700;
  box-shadow: 0 10px 18px rgba(88, 129, 248, 0.22);
}

.recent-patient-card__identity {
  justify-content: flex-start;
}

.recent-patient-card strong {
  color: #33475f;
  font-size: 16px;
}

.recent-patient-card p,
.recent-patient-card span {
  margin: 4px 0 0;
  color: #7a8ca4;
  font-size: 14px;
}

.history-button {
  min-width: 86px;
}

.quick-action-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.quick-action-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 54px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(229, 236, 246, 0.94);
  color: #4b76f5;
  font-size: 14px;
  font-weight: 700;
  transition:
    transform 180ms ease,
    box-shadow 180ms ease,
    background-color 180ms ease;
}

.quick-action-button:hover,
.schedule-action:hover,
.history-button:hover,
.dashboard-date-chip:hover {
  transform: translateY(-1px);
}

.quick-action-button:hover {
  box-shadow: 0 14px 26px rgba(95, 116, 151, 0.12);
}

.quick-action-button__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
}

.quick-action-button--teal {
  color: #46b88e;
}

.quick-action-button--violet {
  color: #6b84ff;
}

@media (max-width: 1280px) {
  .doctor-dashboard__metric-row,
  .quick-action-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .doctor-dashboard__core-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .schedule-table__head,
  .schedule-row {
    grid-template-columns: 1fr;
  }

  .recent-patient-card__meta,
  .recent-patient-card__identity {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (max-width: 720px) {
  .doctor-dashboard__headline h1 {
    font-size: 22px;
  }

  .doctor-dashboard__metric-row,
  .quick-action-grid {
    grid-template-columns: 1fr;
  }
}
</style>
