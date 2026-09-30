const reminders = [
    {
        reminderId: 'rem_001',
        reminderType: 'MEDICATION',
        plannedAt: '2026-04-12T08:30:00+08:00',
        title: 'Morning medication reminder',
        status: 'PENDING',
        medicationIds: [1001, 1002],
        medicationNames: ['Metformin', 'Valsartan'],
        voicePrompt: 'Please take the morning medication after breakfast.',
        followUpPrompt: 'Do you feel dizzy, sweaty, or weak after taking it?',
    },
    {
        reminderId: 'rem_002',
        reminderType: 'MEDICATION',
        plannedAt: '2026-04-12T18:30:00+08:00',
        title: 'Evening medication reminder',
        status: 'PENDING',
        medicationIds: [1001],
        medicationNames: ['Metformin'],
        voicePrompt: 'Please take the evening medication on time.',
        followUpPrompt: 'If you feel unwell, record the symptom right away.',
    },
];
const risk = {
    deintensificationScore: 82,
    interactionScore: 32,
    behaviorScore: 61,
    jointEventScore: 88,
    reviewPriority: 'CLINIC_REVIEW',
    reasons: [
        'Meal intake was low before the medication event.',
        'Recent symptoms suggest a possible low-glucose episode.',
        'There are timing and adherence issues that need review.',
    ],
};
const medications = [
    {
        id: 1001,
        genericName: 'Metformin',
        brandName: 'Glucophage',
        dose: '0.5g',
        frequency: 'BID',
        administrationTime: 'AFTER_BREAKFAST_AFTER_DINNER',
        startDate: '2026-03-01',
        status: 'ACTIVE',
    },
    {
        id: 1002,
        genericName: 'Valsartan',
        brandName: 'Diovan',
        dose: '80mg',
        frequency: 'QD',
        administrationTime: 'AFTER_BREAKFAST',
        startDate: '2026-03-01',
        status: 'ACTIVE',
    },
];
const medicationTask = {
    taskId: 'task_demo_med_001',
    status: 'SUCCESS',
    candidates: [
        {
            genericName: 'Metformin',
            brandName: 'Glucophage',
            strength: '0.5g',
            confidence: 0.98,
        },
        {
            genericName: 'Valsartan',
            brandName: 'Diovan',
            strength: '80mg',
            confidence: 0.95,
        },
    ],
};
const jointEvents = [
    {
        eventType: 'JE001',
        eventLabel: 'Low meal intake followed by glucose-lowering medication',
        eventDate: '2026-03-31',
        timeWindowStart: '2026-03-31T08:00:00+08:00',
        timeWindowEnd: '2026-03-31T09:10:00+08:00',
        severity: 82,
        evidence: {
            meal: 'LOW',
            symptoms: ['dizziness', 'sweating'],
            glucose: '3.8 mmol/L',
        },
        riskDirections: ['DEINTENSIFICATION', 'JOINT_EVENT'],
    },
    {
        eventType: 'JE009',
        eventLabel: 'Medication timing mismatch with later symptom report',
        eventDate: '2026-03-28',
        timeWindowStart: '2026-03-28T07:40:00+08:00',
        timeWindowEnd: '2026-03-28T09:00:00+08:00',
        severity: 64,
        evidence: {
            meal: 'SKIPPED',
            adherence: 'MAKEUP',
            symptoms: ['dizziness'],
        },
        riskDirections: ['TEMPORAL_BEHAVIOR'],
    },
];
const inquiryPrompts = [
    {
        questionCode: 'BODY_DISCOMFORT',
        questionText: 'Please describe any dizziness, sweating, tremor, or weakness.',
    },
    {
        questionCode: 'MEAL_AMOUNT',
        questionText: 'How much did you eat before the symptom happened?',
    },
];
const mockScoreRisk = {
    ...risk,
    modelVersion: 'ai-io-v1-mock',
};
const mockGeneratedReport = {
    familyVersion: {
        title: 'Home care summary',
        actions: [
            'Record meals and symptoms for the next 3 days.',
            'Confirm medication timing with the care team.',
            'Arrange a clinic review if symptoms happen again.',
        ],
    },
    doctorVersion: {
        title: 'AI risk review',
        summary: [
            'jointEvents=2',
            `reviewPriority=${mockScoreRisk.reviewPriority}`,
            `scores=${mockScoreRisk.deintensificationScore}/${mockScoreRisk.interactionScore}/${mockScoreRisk.behaviorScore}/${mockScoreRisk.jointEventScore}`,
        ],
        evidence: [...mockScoreRisk.reasons],
    },
    modelVersion: 'ai-io-v1-mock',
};
let inquiryCounter = 1;
let reportCounter = 1;
const inquiryAnswerCount = new Map();
const reportTasks = new Map();
function clone(value) {
    return JSON.parse(JSON.stringify(value));
}
function delay(value, wait = 180) {
    return new Promise((resolve) => {
        window.setTimeout(() => resolve(clone(value)), wait);
    });
}
function nextInquirySession() {
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
function getInquiryQuestion(sessionId) {
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
function buildStructuredEvent(rawText) {
    const normalized = rawText.toLowerCase();
    const symptoms = [];
    if (normalized.includes('dizzy') || rawText.includes('头晕')) {
        symptoms.push('dizziness');
    }
    if (normalized.includes('sweat') || rawText.includes('出汗')) {
        symptoms.push('sweating');
    }
    if (normalized.includes('tremor') || rawText.includes('手抖')) {
        symptoms.push('tremor');
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
function nextReportId() {
    reportCounter += 1;
    return `report_demo_${String(reportCounter).padStart(3, '0')}`;
}
export const mobileMockApi = {
    getTodayReminders: async () => delay({ reminders }),
    ackReminder: async (reminderId) => {
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
    submitInquiryAnswer: async (_payload, sessionId) => {
        if (sessionId) {
            inquiryAnswerCount.set(sessionId, (inquiryAnswerCount.get(sessionId) ?? 0) + 1);
        }
        return delay({ success: true });
    },
    getNextQuestion: async (sessionId = `inq_demo_${inquiryCounter}`) => delay(getInquiryQuestion(sessionId)),
    getJointEvents: async () => delay({ jointEvents }),
    createAdherenceEvent: async (_payload) => delay({ success: true }),
    parseEvent: async (payload) => delay(buildStructuredEvent(payload.rawText)),
    detectJointEvents: async (_payload) => delay({
        jointEvents: jointEvents.map((item) => ({
            eventType: item.eventType,
            severity: item.severity,
            evidence: item.evidence,
            riskDirections: item.riskDirections,
        })),
        modelVersion: 'ai-detect-v1-mock',
    }),
    scoreRisk: async (_payload) => delay(mockScoreRisk),
    generateAiReport: async (_payload) => delay(mockGeneratedReport),
    createPatientReport: async (reportType) => {
        const reportId = nextReportId();
        reportTasks.set(reportId, {
            reportId,
            reportType,
            status: 'PENDING',
        });
        return delay({
            taskId: reportId,
            status: 'PENDING',
        });
    },
    getPatientReportTask: async (reportId) => {
        const existing = reportTasks.get(reportId) ?? {
            reportId,
            reportType: 'FAMILY',
            status: 'PENDING',
        };
        const task = {
            ...existing,
            status: 'SUCCESS',
            generatedAt: new Date().toISOString(),
            fileAssetId: 2,
        };
        reportTasks.set(reportId, task);
        return delay(task);
    },
    getPatientReportDownload: async (reportId) => delay({
        reportId,
        downloadUrl: `mock://reports/${reportId}.pdf`,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }),
};
