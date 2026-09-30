import type {
  JointEvent,
  KnowledgeCell,
  ReviewPriority,
  RiskDirection,
  RiskLatest,
} from './types';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

type MetricKey =
  | 'deintensificationScore'
  | 'interactionScore'
  | 'behaviorScore'
  | 'jointEventScore';

const reviewPriorityMap: Record<
  ReviewPriority,
  { label: string; tone: BadgeTone; summary: string }
> = {
  OBSERVE: {
    label: '继续观察',
    tone: 'success',
    summary: '当前风险仍可通过持续观察和规律记录管理，暂未触发高优先级复核。',
  },
  RETEST_SOON: {
    label: '近期复测',
    tone: 'info',
    summary: '建议近期补齐关键指标与症状记录，再次评估风险变化。',
  },
  CLINIC_REVIEW: {
    label: '门诊复核',
    tone: 'warning',
    summary: '建议尽快门诊复核，重点核对用药强度、服药时序和联合事件证据链。',
  },
  HIGH_PRIORITY: {
    label: '高优先级复查',
    tone: 'danger',
    summary: '建议优先安排复查，及时处置高危信号并补齐事件证据。',
  },
};

const genderMap: Record<string, string> = {
  MALE: '男',
  FEMALE: '女',
  OTHER: '其他',
};

const livingStatusMap: Record<string, string> = {
  WITH_FAMILY: '与家人同住',
  ALONE: '独居',
  INSTITUTION: '机构照护',
};

const digitalAbilityMap: Record<string, string> = {
  LOW: '数字能力较弱',
  MEDIUM: '数字能力一般',
  HIGH: '数字能力较强',
};

const diseaseTagMap: Record<string, string> = {
  HYPERTENSION: '高血压',
  TYPE2_DIABETES: '2 型糖尿病',
  CORONARY_HEART_DISEASE: '冠心病',
  ATRIAL_FIBRILLATION: '房颤',
};

const riskDirectionMap: Record<RiskDirection, string> = {
  DEINTENSIFICATION: '减药强度复核',
  INTERACTION: '药物联用风险',
  TEMPORAL_BEHAVIOR: '时序行为风险',
  JOINT_EVENT: '联合事件风险',
};

const eventTypeMap: Record<string, string> = {
  JE001: '降糖药 + 进食不足 + 低血糖倾向',
  JE002: '降压药 + 血压偏低 + 头晕站立不稳',
  JE003: '多药并用 + 漏服补服 + 指标波动',
  JE004: '夜间服药后次晨不适',
  JE005: '连续低糖倾向 + 维持原方案',
  JE006: '连续低压倾向 + 耐受下降',
  JE007: '新增药物后出现新症状',
  JE008: '关键记录持续缺失',
  JE009: '餐药错位引发异常',
  JE010: '指标表面正常但耐受下降',
};

const reminderTypeMap: Record<string, string> = {
  MEAL_AND_MED: '餐药记录',
  BG: '血糖复测',
  BP: '血压复测',
  FOLLOW_UP: '随访提醒',
};

const statusMap: Record<string, { label: string; tone: BadgeTone }> = {
  PENDING: { label: '待处理', tone: 'info' },
  RUNNING: { label: '处理中', tone: 'warning' },
  SUCCESS: { label: '已完成', tone: 'success' },
  FAILED: { label: '失败', tone: 'danger' },
  ACTIVE: { label: '使用中', tone: 'success' },
  STOPPED: { label: '已停用', tone: 'neutral' },
  ESCALATED: { label: '已升级处理', tone: 'danger' },
  REVIEWED: { label: '已复核', tone: 'success' },
  RECORDED: { label: '已记录', tone: 'info' },
  GENERATED: { label: '系统生成', tone: 'neutral' },
};

const administrationTimeMap: Record<string, string> = {
  AFTER_BREAKFAST_AFTER_DINNER: '早餐后 / 晚餐后',
  AFTER_BREAKFAST: '早餐后',
  BEFORE_MEAL: '餐前',
  BEFORE_SLEEP: '睡前',
  AFTER_LUNCH: '午餐后',
};

const frequencyMap: Record<string, string> = {
  QD: '每日 1 次',
  BID: '每日 2 次',
  TID: '每日 3 次',
  QN: '每晚 1 次',
  PRN: '按需',
};

const enumValueMap: Record<string, string> = {
  INSUFFICIENT: '进食不足',
  MISSED: '漏餐',
  NORMAL: '正常',
  MAKEUP: '补服',
  TAKEN: '已服药',
  DIZZINESS: '头晕',
  SWEATING: '出汗',
  TREMOR: '手抖',
  FATIGUE: '乏力',
  PALPITATION: '心悸',
  LOW: '偏低',
  STABLE: '稳定',
};

const evidenceLabelMap: Record<string, string> = {
  meal: '进食情况',
  symptoms: '症状',
  glucose: '血糖值',
  bloodPressure: '血压',
  medication: '关联药物',
  adherence: '依从事件',
};

const metricMetaMap: Record<MetricKey, { title: string; subtitle: string }> = {
  deintensificationScore: {
    title: '减药强度复核',
    subtitle: '关注疑似降糖或降压过强化场景。',
  },
  interactionScore: {
    title: '药物联用',
    subtitle: '关注重复用药与潜在相互作用。',
  },
  behaviorScore: {
    title: '时序行为',
    subtitle: '关注餐药错位、漏服补服与关键记录缺失。',
  },
  jointEventScore: {
    title: '联合事件',
    subtitle: '关注药、餐、指标与症状的组合证据。',
  },
};

const medicationSourceMap: Record<string, string> = {
  APP_SYNC: 'App 同步',
  DOCTOR_REVIEW: '医生复核',
  FAMILY_CONFIRM: '家属确认',
  CALL_RECORD: '电话随访',
};

const followUpChannelMap: Record<string, string> = {
  APP: 'App 反馈',
  PHONE: '电话随访',
  FAMILY: '家属代答',
  CLINIC: '门诊记录',
};

const followUpTypeMap: Record<string, string> = {
  SYMPTOM: '症状反馈',
  MEDICATION: '服药反馈',
  DIET: '饮食反馈',
  REMINDER: '提醒回执',
};

const adherenceStatusMap: Record<string, string> = {
  GOOD: '按计划服药',
  DELAYED: '延迟服药',
  MAKEUP: '补服',
  MISSED: '漏服',
};

const eventCategoryMap: Record<string, string> = {
  DIET: '饮食',
  MEDICATION: '服药',
  SYMPTOM: '症状',
  INDICATOR: '指标',
  FOLLOW_UP: '随访',
  SYSTEM: '系统',
};

function isValidDate(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}

function formatEnumValue(value: string): string {
  return enumValueMap[value] ?? value;
}

export function formatDate(value?: string | null): string {
  if (!value || !isValidDate(value)) {
    return '未提供';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
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

export function formatTime(value?: string | null): string {
  if (!value || !isValidDate(value)) {
    return '未提供';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function calculateAge(birthday?: string | null): number | null {
  if (!birthday || !isValidDate(birthday)) {
    return null;
  }

  const birth = new Date(birthday);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDelta = today.getMonth() - birth.getMonth();

  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birth.getDate())) {
    age -= 1;
  }

  return age;
}

export function formatGender(value?: string): string {
  if (!value) {
    return '未标注';
  }

  return genderMap[value] ?? value;
}

export function formatLivingStatus(value?: string): string {
  if (!value) {
    return '未标注';
  }

  return livingStatusMap[value] ?? value;
}

export function formatDigitalAbility(value?: string): string {
  if (!value) {
    return '未标注';
  }

  return digitalAbilityMap[value] ?? value;
}

export function formatDiseaseTag(value: string): string {
  return diseaseTagMap[value] ?? value;
}

export function formatAdministrationTime(value: string): string {
  return administrationTimeMap[value] ?? value;
}

export function formatFrequency(value: string): string {
  return frequencyMap[value] ?? value;
}

export function formatReviewPriority(priority: ReviewPriority) {
  return reviewPriorityMap[priority];
}

export function getRiskLevel(score: number): { label: string; tone: BadgeTone } {
  if (score >= 80) {
    return { label: '高风险', tone: 'danger' };
  }

  if (score >= 60) {
    return { label: '中高风险', tone: 'warning' };
  }

  if (score >= 40) {
    return { label: '中风险', tone: 'info' };
  }

  return { label: '低风险', tone: 'success' };
}

export function getMetricMeta(key: MetricKey) {
  return metricMetaMap[key];
}

export function formatRiskDirection(value: RiskDirection): string {
  return riskDirectionMap[value];
}

export function formatEventType(value: string): string {
  return eventTypeMap[value] ?? value;
}

export function formatReminderType(value: string): string {
  return reminderTypeMap[value] ?? value;
}

export function formatMedicationSource(value: string): string {
  return medicationSourceMap[value] ?? value;
}

export function formatFollowUpChannel(value: string): string {
  return followUpChannelMap[value] ?? value;
}

export function formatFollowUpType(value: string): string {
  return followUpTypeMap[value] ?? value;
}

export function formatAdherenceStatus(value: string): string {
  return adherenceStatusMap[value] ?? value;
}

export function formatMealStatus(value: string): string {
  return formatEnumValue(value);
}

export function formatEventCategory(value: string): string {
  return eventCategoryMap[value] ?? value;
}

export function formatStatus(value?: string): { label: string; tone: BadgeTone } {
  if (!value) {
    return { label: '未提供', tone: 'neutral' };
  }

  return statusMap[value] ?? { label: value, tone: 'neutral' };
}

export function formatEvidenceEntries(
  evidence: Record<string, unknown>,
): Array<{ label: string; value: string }> {
  return Object.entries(evidence).map(([key, rawValue]) => {
    const label = evidenceLabelMap[key] ?? key;
    let value = '未提供';

    if (Array.isArray(rawValue)) {
      value = rawValue
        .map((item) => (typeof item === 'string' ? formatEnumValue(item) : String(item)))
        .join('、');
    } else if (typeof rawValue === 'number') {
      value = key === 'glucose' ? `${rawValue} mmol/L` : String(rawValue);
    } else if (typeof rawValue === 'string') {
      value = formatEnumValue(rawValue);
    } else if (typeof rawValue === 'boolean') {
      value = rawValue ? '是' : '否';
    } else if (rawValue && typeof rawValue === 'object') {
      value = JSON.stringify(rawValue);
    }

    return { label, value };
  });
}

export function formatDatasetValue(value: KnowledgeCell): string {
  if (value === null) {
    return '-';
  }

  if (typeof value === 'boolean') {
    return value ? '是' : '否';
  }

  return String(value);
}

export function buildReviewSuggestions(risk: RiskLatest, events: JointEvent[]): string[] {
  const suggestions: string[] = [];

  if (risk.deintensificationScore >= 70) {
    suggestions.push('优先复核降糖或降压方案强度，排查低血糖与耐受下降风险。');
  }

  if (risk.behaviorScore >= 55) {
    suggestions.push('补看近 7 天餐药时序、漏服补服和关键记录缺失情况。');
  }

  if (risk.interactionScore >= 45) {
    suggestions.push('核对新增药物、重复用药与潜在相互作用，必要时发起药师复审。');
  }

  if (events.length > 0) {
    suggestions.push(`已识别 ${events.length} 条联合事件，建议结合当日完整事件链完成门诊复核。`);
  }

  if (suggestions.length === 0) {
    suggestions.push('继续观察并保持规律记录，等待后续风险快照更新。');
  }

  return suggestions;
}
