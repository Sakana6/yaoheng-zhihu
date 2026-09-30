import type { MobileRisk } from './types';

/** Calendar age, using the caller's patient-local date; missing/invalid dates stay unknown. */
export function formatPatientAge(birthday: string | null, today: string): string {
  if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return '年龄未提供';
  const birth = new Date(birthday + 'T00:00:00Z');
  if (!Number.isFinite(birth.getTime()) || birth.toISOString().slice(0,10) !== birthday || birthday > today) return '年龄未提供';
  const age = Number(today.slice(0,4)) - Number(birthday.slice(0,4)) - (today.slice(5) < birthday.slice(5) ? 1 : 0);
  return `${age} 岁`;
}

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const reminderTypeMap: Record<string, string> = {
  MEDICATION: '服药提醒',
  MEAL_AND_MED: '餐药记录',
  BG: '血糖复测',
  BP: '血压复测',
};

const statusMap: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: '待处理', tone: 'info' },
  IN_PROGRESS: { label: '处理中', tone: 'warning' },
  RUNNING: { label: '处理中', tone: 'warning' },
  SUCCESS: { label: '已完成', tone: 'success' },
  DONE: { label: '已完成', tone: 'success' },
  FAILED: { label: '失败', tone: 'danger' },
  ACTIVE: { label: '使用中', tone: 'success' },
  STOPPED: { label: '已停用', tone: 'neutral' },
};

const reviewPriorityMap: Record<string, { label: string; tone: Tone }> = {
  OBSERVE: { label: '继续观察', tone: 'success' },
  RETEST_SOON: { label: '近期复测', tone: 'info' },
  CLINIC_REVIEW: { label: '门诊复核', tone: 'warning' },
  HIGH_PRIORITY: { label: '高优先复核', tone: 'danger' },
};

const riskDirectionMap: Record<string, string> = {
  DEINTENSIFICATION: '减药强度复核',
  INTERACTION: '联用风险',
  TEMPORAL_BEHAVIOR: '行为时序风险',
  JOINT_EVENT: '联合事件风险',
};

const frequencyMap: Record<string, string> = {
  QD: '每日 1 次',
  BID: '每日 2 次',
  TID: '每日 3 次',
};

const administrationTimeMap: Record<string, string> = {
  AFTER_BREAKFAST_AFTER_DINNER: '早餐后 / 晚餐后',
  AFTER_BREAKFAST: '早餐后',
  BEFORE_MEAL: '餐前',
};

const eventTypeMap: Record<string, string> = {
  JE001: '早餐摄入不足后仍服药，伴低血糖倾向',
  JE009: '餐药错位导致异常',
};

function isValidDate(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}

export function formatDateTime(value?: string | null): string {
  if (!value || !isValidDate(value)) {
    return '未提供';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function formatDate(value?: string | null): string {
  if (!value || !isValidDate(value)) {
    return '未提供';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

export function formatReminderType(value: string): string {
  return reminderTypeMap[value] ?? value;
}

export function formatStatus(value?: string): { label: string; tone: Tone } {
  if (!value) {
    return { label: '未提供', tone: 'neutral' };
  }

  return statusMap[value] ?? { label: value, tone: 'neutral' };
}

export function formatReviewPriority(value?: string): { label: string; tone: Tone } {
  if (!value) {
    return { label: '待评估', tone: 'neutral' };
  }

  return reviewPriorityMap[value] ?? { label: value, tone: 'neutral' };
}

export function getRiskTone(score: number): Tone {
  if (score >= 80) {
    return 'danger';
  }
  if (score >= 60) {
    return 'warning';
  }
  if (score >= 40) {
    return 'info';
  }
  return 'success';
}

export function formatFrequency(value: string): string {
  return frequencyMap[value] ?? value;
}

export function formatAdministrationTime(value: string): string {
  return administrationTimeMap[value] ?? value;
}

export function formatEventType(value: string): string {
  return eventTypeMap[value] ?? value;
}

export function formatRiskDirection(value: string): string {
  return riskDirectionMap[value] ?? value;
}

export function buildRiskActions(risk: MobileRisk): string[] {
  const actions: string[] = [];

  if (risk.deintensificationScore >= 70) {
    actions.push('优先和医生确认当前降糖或降压方案是否需要复核。');
  }

  if (risk.behaviorScore >= 55) {
    actions.push('连续 3 天补齐进餐、用药和症状记录。');
  }

  if (risk.interactionScore >= 45) {
    actions.push('如果近期新增药物，请重新上传药盒并核对药历。');
  }

  if (actions.length === 0) {
    actions.push('继续保持规律记录，等待下一次风险刷新。');
  }

  return actions;
}
