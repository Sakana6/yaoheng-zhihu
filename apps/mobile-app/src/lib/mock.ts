import type {
  AcceptedTask,
  AdherenceEventDraft,
  DetectJointEventsRequest,
  DetectJointEventsResponse,
  GenerateReportRequest,
  GenerateReportResponse,
  InquiryAnswerDraft,
  InquiryNextQuestion,
  InquirySession,
  MedicationTask,
  MobileJointEvent,
  MobileMedication,
  MobileReminder,
  MobileRisk,
  ParseEventRequest,
  ParseEventResponse,
  ReportDownloadInfo,
  ReportTask,
  ReportType,
  ScoreRiskResponse,
} from './types';

const reminders: MobileReminder[] = [
  {
    reminderId: 'rem_001',
    reminderType: 'MEDICATION',
    plannedAt: '2026-04-12T08:30:00+08:00',
    title: '晨间服药提醒',
    status: 'PENDING',
    medicationIds: [1001, 1002],
    medicationNames: ['二甲双胍片', '缬沙坦胶囊'],
    voicePrompt: '请在早餐后按时服用晨间药物。',
    followUpPrompt: '服药后如果出现头晕、出汗或乏力，请及时反馈。',
  },
  {
    reminderId: 'rem_002',
    reminderType: 'MEDICATION',
    plannedAt: '2026-04-12T18:30:00+08:00',
    title: '晚间服药提醒',
    status: 'PENDING',
    medicationIds: [1001],
    medicationNames: ['二甲双胍片'],
    voicePrompt: '请按时服用晚间药物。',
    followUpPrompt: '如有不适，请立即记录症状反馈。',
  },
];

const risk: MobileRisk = {
  deintensificationScore: 82,
  interactionScore: 32,
  behaviorScore: 61,
  jointEventScore: 88,
  reviewPriority: 'CLINIC_REVIEW',
  reasons: [
    '用药前进食量不足。',
    '近期症状提示可能存在低血糖风险。',
    '用药时序与依从性存在异常，建议进一步复核。',
  ],
};

const medications: MobileMedication[] = [
  {
    id: 1001,
    genericName: '二甲双胍片',
    brandName: '格华止',
    dose: '0.5g',
    frequency: 'BID',
    administrationTime: 'AFTER_BREAKFAST_AFTER_DINNER',
    startDate: '2026-03-01',
    status: 'ACTIVE',
  },
  {
    id: 1002,
    genericName: '缬沙坦胶囊',
    brandName: '代文',
    dose: '80mg',
    frequency: 'QD',
    administrationTime: 'AFTER_BREAKFAST',
    startDate: '2026-03-01',
    status: 'ACTIVE',
  },
];

const medicationTask: MedicationTask = {
  taskId: 'task_demo_med_001',
  status: 'SUCCESS',
  candidates: [
    {
      genericName: '二甲双胍片',
      brandName: '格华止',
      strength: '0.5g',
      confidence: 0.98,
    },
    {
      genericName: '缬沙坦胶囊',
      brandName: '代文',
      strength: '80mg',
      confidence: 0.95,
    },
  ],
};

const jointEvents: MobileJointEvent[] = [
  {
    eventType: 'JE001',
    eventLabel: '早餐摄入不足后继续服用降糖药',
    eventDate: '2026-03-31',
    timeWindowStart: '2026-03-31T08:00:00+08:00',
    timeWindowEnd: '2026-03-31T09:10:00+08:00',
    severity: 82,
    evidence: {
      meal: '摄入不足',
      symptoms: ['头晕', '出汗'],
      glucose: '3.8 mmol/L',
    },
    riskDirections: ['DEINTENSIFICATION', 'JOINT_EVENT'],
  },
  {
    eventType: 'JE009',
    eventLabel: '用药时间与后续症状上报不一致',
    eventDate: '2026-03-28',
    timeWindowStart: '2026-03-28T07:40:00+08:00',
    timeWindowEnd: '2026-03-28T09:00:00+08:00',
    severity: 64,
    evidence: {
      meal: '未进食',
      adherence: '补服',
      symptoms: ['头晕'],
    },
    riskDirections: ['TEMPORAL_BEHAVIOR'],
  },
];

const inquiryPrompts = [
  {
    questionCode: 'BODY_DISCOMFORT',
    questionText: '请描述是否出现头晕、出汗、手抖或乏力。',
  },
  {
    questionCode: 'MEAL_AMOUNT',
    questionText: '症状出现前进食了多少？',
  },
];

const mockScoreRisk: ScoreRiskResponse = {
  ...risk,
  modelVersion: 'ai-io-v1-mock',
};

const mockGeneratedReport: GenerateReportResponse = {
  familyVersion: {
    title: '居家照护摘要',
    actions: [
      '请连续 3 天记录进食和症状。',
      '请与护理团队确认用药时间安排。',
      '若症状再次出现，请尽快安排门诊复核。',
    ],
  },
  doctorVersion: {
    title: 'AI 风险复核',
    summary: [
      '联合事件数：2',
      '复核优先级：门诊复核',
      `四类风险评分：${mockScoreRisk.deintensificationScore}/${mockScoreRisk.interactionScore}/${mockScoreRisk.behaviorScore}/${mockScoreRisk.jointEventScore}`,
    ],
    evidence: [...mockScoreRisk.reasons],
  },
  modelVersion: 'ai-io-v1-mock',
};

let inquiryCounter = 1;
let reportCounter = 1;

const inquiryAnswerCount = new Map<string, number>();
const reportTasks = new Map<string, ReportTask>();

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function delay<T>(value: T, wait = 180): Promise<T> {
  return new Promise((resolve) => {
    window.setTimeout(() => resolve(clone(value)), wait);
  });
}

function nextInquirySession(): InquirySession {
  inquiryCounter += 1;
  const sessionId = `inq_demo_${inquiryCounter}`;
  inquiryAnswerCount.set(sessionId, 0);
  return {
    sessionId,
    triggerType: 'medication_reminder',
    triggerTime: new Date().toISOString(),
    sessionStatus: 'IN_PROGRESS',
    modelVersion: 'parse_v1',
  };
}

function getInquiryQuestion(sessionId: string): InquiryNextQuestion {
  const answered = inquiryAnswerCount.get(sessionId) ?? 0;
  const prompt = inquiryPrompts[answered];
  if (!prompt) {
    return {
      sessionId,
      questionCode: '',
      questionText: '',
      sourceType: 'RULE_TEMPLATE',
      orderNo: answered + 1,
      isFinished: true,
    };
  }

  return {
    sessionId,
    questionCode: prompt.questionCode,
    questionText: prompt.questionText,
    sourceType: 'RULE_TEMPLATE',
    orderNo: answered + 1,
    isFinished: false,
  };
}

function buildStructuredEvent(rawText: string): ParseEventResponse {
  const normalized = rawText.toLowerCase();
  const symptoms: string[] = [];
  if (normalized.includes('dizzy') || rawText.includes('头晕')) {
    symptoms.push('头晕');
  }
  if (normalized.includes('sweat') || rawText.includes('出汗')) {
    symptoms.push('出汗');
  }
  if (normalized.includes('tremor') || rawText.includes('手抖')) {
    symptoms.push('手抖');
  }

  return {
    structuredEvent: {
      symptoms,
      meal: {
        taken: !(normalized.includes('skip') || rawText.includes('没吃')),
        amount: normalized.includes('little') || rawText.includes('吃得少') ? 'LOW' : 'NORMAL',
      },
      adherence: {
        makeupMed: normalized.includes('makeup') || rawText.includes('补服'),
        missedMed: normalized.includes('missed') || rawText.includes('漏服'),
      },
      timeHint: 'AFTER_BREAKFAST',
    },
    confidence: 0.94,
    modelVersion: 'ai-parse-v1-mock',
  };
}

function nextReportId(): string {
  reportCounter += 1;
  return `report_demo_${String(reportCounter).padStart(3, '0')}`;
}

export const mobileMockApi = {
  getTodayReminders: async () => delay({ reminders }),
  ackReminder: async (reminderId: string) => {
    const reminder = reminders.find((item) => item.reminderId === reminderId);
    if (reminder) {
      reminder.status = 'SUCCESS';
    }
    return delay({ success: true });
  },
  getRiskLatest: async () => delay(risk),
  getMedications: async () => delay({ medications }),
  getMedicationTask: async () => delay(medicationTask),
  startInquiry: async () => delay(nextInquirySession()),
  submitInquiryAnswer: async (_payload: InquiryAnswerDraft, sessionId?: string | null) => {
    if (sessionId) {
      inquiryAnswerCount.set(sessionId, (inquiryAnswerCount.get(sessionId) ?? 0) + 1);
    }
    return delay({ success: true });
  },
  getNextQuestion: async (sessionId = `inq_demo_${inquiryCounter}`) => delay(getInquiryQuestion(sessionId)),
  getJointEvents: async () => delay({ jointEvents }),
  createAdherenceEvent: async (_payload: AdherenceEventDraft) => delay({ success: true }),
  parseEvent: async (payload: ParseEventRequest) => delay(buildStructuredEvent(payload.rawText)),
  detectJointEvents: async (_payload: DetectJointEventsRequest) =>
    delay({
      jointEvents: jointEvents.map((item) => ({
        eventType: item.eventType,
        severity: item.severity,
        evidence: item.evidence,
        riskDirections: item.riskDirections,
      })),
      modelVersion: 'ai-detect-v1-mock',
    } satisfies DetectJointEventsResponse),
  scoreRisk: async (_payload: { patientId: number }) => delay(mockScoreRisk),
  generateAiReport: async (_payload: GenerateReportRequest) => delay(mockGeneratedReport),
  createPatientReport: async (reportType: ReportType) => {
    const reportId = nextReportId();
    reportTasks.set(reportId, {
      reportId,
      reportType,
      status: 'PENDING',
    });
    return delay({
      taskId: reportId,
      status: 'PENDING',
    } satisfies AcceptedTask);
  },
  getPatientReportTask: async (reportId: string) => {
    const existing = reportTasks.get(reportId) ?? {
      reportId,
      reportType: 'FAMILY',
      status: 'PENDING',
    };
    const task: ReportTask = {
      ...existing,
      status: 'SUCCESS',
      generatedAt: new Date().toISOString(),
      fileAssetId: 2,
    };
    reportTasks.set(reportId, task);
    return delay(task);
  },
  getPatientReportDownload: async (reportId: string) =>
    delay({
      reportId,
      downloadUrl: `mock://reports/${reportId}.pdf`,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    } satisfies ReportDownloadInfo),
};
