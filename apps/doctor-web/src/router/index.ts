import { createRouter, createWebHistory } from 'vue-router';

import FollowUpManagementView from '../views/FollowUpManagementView.vue';
import KnowledgeBaseView from '../views/KnowledgeBaseView.vue';
import MedicationManagementView from '../views/MedicationManagementView.vue';
import PatientDetailView from '../views/PatientDetailView.vue';
import PatientsView from '../views/PatientsView.vue';
import SummaryView from '../views/SummaryView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/patients' },
    {
      path: '/patients',
      component: PatientsView,
      meta: {
        title: '工作台',
        description: '医生端首页，展示今日排班、重点患者和快捷入口。',
      },
    },
    {
      path: '/patients/:patientId',
      component: PatientDetailView,
      meta: {
        title: '患者管理',
        description: '查看患者画像、风险快照、用药信息和联合事件链。',
      },
    },
    {
      path: '/patients/:patientId/summary',
      component: SummaryView,
      meta: {
        title: 'AI辅助诊疗',
        description: '医生摘要页面，承载 AI 分析结果和导出能力。',
      },
    },
    {
      path: '/medications',
      component: MedicationManagementView,
      meta: {
        title: '用药管理',
        description: '展示医生端已接收到的全部用药列表。',
      },
    },
    {
      path: '/follow-ups',
      component: FollowUpManagementView,
      meta: {
        title: '随访管理',
        description: '展示用户每次事件反馈与随访跟进状态。',
      },
    },
    {
      path: '/knowledge-base',
      component: KnowledgeBaseView,
      meta: {
        title: '知识库',
        description: '展示传递到医生端的药品和随访记录模拟数据集。',
      },
    },
  ],
});

export default router;
