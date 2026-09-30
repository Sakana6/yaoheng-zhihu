import type {
  GenerateReportResponse,
  MedicationTask,
  MobileJointEvent,
  MobileMedication,
  MobileReminder,
  MobileRisk,
} from './types';

const legacyTextMap: Record<string, string> = {
  'Demo Patient': '演示患者',
  Metformin: '二甲双胍片',
  Valsartan: '缬沙坦胶囊',
  Glucophage: '格华止',
  Diovan: '代文',
  'Morning medication reminder': '晨间服药提醒',
  'Midday follow-up reminder': '午间追访提醒',
  'Evening medication reminder': '晚间服药提醒',
  'Please finish the morning medication after breakfast.': '请在早餐后完成晨间服药。',
  'Please take the morning medication after breakfast.': '请在早餐后按时服用晨间药物。',
  'Please follow up on meal intake and dizziness or tremor.': '请追访进食情况，以及是否出现头晕或手抖。',
  'Please finish the evening medication on time.': '请按时完成晚间服药。',
  'Please take the evening medication on time.': '请按时服用晚间药物。',
  'Record meal intake, symptoms, blood glucose and whether you made up the dose.':
    '请记录进食情况、症状、血糖，以及是否有补服。',
  'Complete the missing morning feedback if needed.': '如有需要，请补齐晨间缺失反馈。',
  'Continue the daily symptom follow-up after dinner.': '晚餐后请继续完成今日症状追访。',
  'Do you feel dizzy, sweaty, or weak after taking it?': '服药后如果出现头晕、出汗或乏力，请及时反馈。',
  'If you feel unwell, record the symptom right away.': '如有不适，请立即记录症状反馈。',
  'Meal intake was low before the medication event.': '用药前进食量不足。',
  'Recent symptoms suggest a possible low-glucose episode.': '近期症状提示可能存在低血糖风险。',
  'There are timing and adherence issues that need review.': '用药时序与依从性存在异常，建议进一步复核。',
  'Low meal intake followed by glucose-lowering medication': '早餐摄入不足后继续服用降糖药',
  'Medication timing mismatch with later symptom report': '用药时间与后续症状上报不一致',
  dizziness: '头晕',
  sweating: '出汗',
  tremor: '手抖',
  weakness: '乏力',
  LOW: '摄入不足',
  SKIPPED: '未进食',
  MAKEUP: '补服',
  'Please describe any dizziness, sweating, tremor, or weakness.': '请描述是否出现头晕、出汗、手抖或乏力。',
  'How much did you eat before the symptom happened?': '症状出现前进食了多少？',
  'Home care summary': '居家照护摘要',
  'Record meals and symptoms for the next 3 days.': '请连续 3 天记录进食和症状。',
  'Confirm medication timing with the care team.': '请与护理团队确认用药时间安排。',
  'Arrange a clinic review if symptoms happen again.': '若症状再次出现，请尽快安排门诊复核。',
  'AI risk review': 'AI 风险复核',
  'jointEvents=2': '联合事件数：2',
  'reviewPriority=CLINIC_REVIEW': '复核优先级：门诊复核',
};

export function normalizeLegacyText(value: string): string {
  return legacyTextMap[value] ?? value;
}

export function normalizeLegacyTextList(values: string[]): string[] {
  return values.map((item) => normalizeLegacyText(item));
}

function normalizeUnknown(value: unknown): unknown {
  if (typeof value === 'string') {
    return normalizeLegacyText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeUnknown(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeUnknown(item)]));
  }

  return value;
}

export function normalizeMedication(item: MobileMedication): MobileMedication {
  return {
    ...item,
    genericName: normalizeLegacyText(item.genericName),
    brandName: item.brandName ? normalizeLegacyText(item.brandName) : item.brandName,
  };
}

export function normalizeReminder(item: MobileReminder): MobileReminder {
  return {
    ...item,
    title: normalizeLegacyText(item.title),
    medicationNames: item.medicationNames.map((name) => normalizeLegacyText(name)),
    voicePrompt: normalizeLegacyText(item.voicePrompt),
    followUpPrompt: normalizeLegacyText(item.followUpPrompt),
  };
}

export function normalizeRisk(risk: MobileRisk | null): MobileRisk | null {
  if (!risk) {
    return null;
  }

  return {
    ...risk,
    reasons: normalizeLegacyTextList(risk.reasons),
  };
}

export function normalizeJointEvent(item: MobileJointEvent): MobileJointEvent {
  return {
    ...item,
    eventLabel: item.eventLabel ? normalizeLegacyText(item.eventLabel) : item.eventLabel,
    evidence: normalizeUnknown(item.evidence) as Record<string, unknown>,
  };
}

export function normalizeMedicationTask(task: MedicationTask): MedicationTask {
  return {
    ...task,
    candidates: task.candidates.map((item) => ({
      ...item,
      genericName: normalizeLegacyText(item.genericName),
      brandName: item.brandName ? normalizeLegacyText(item.brandName) : item.brandName,
    })),
  };
}

export function normalizeGenerateReportResponse(payload: GenerateReportResponse): GenerateReportResponse {
  return {
    ...payload,
    familyVersion: {
      ...payload.familyVersion,
      title: payload.familyVersion.title ? normalizeLegacyText(payload.familyVersion.title) : payload.familyVersion.title,
      actions: payload.familyVersion.actions ? normalizeLegacyTextList(payload.familyVersion.actions) : payload.familyVersion.actions,
    },
    doctorVersion: {
      ...payload.doctorVersion,
      title: payload.doctorVersion.title ? normalizeLegacyText(payload.doctorVersion.title) : payload.doctorVersion.title,
      summary: payload.doctorVersion.summary ? normalizeLegacyTextList(payload.doctorVersion.summary) : payload.doctorVersion.summary,
      evidence: payload.doctorVersion.evidence ? normalizeLegacyTextList(payload.doctorVersion.evidence) : payload.doctorVersion.evidence,
    },
  };
}
