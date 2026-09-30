import type { AdherenceEventDraft, DetectJointEventsRequest, GenerateReportRequest, GenerateReportResponse, InquiryAnswerDraft, InquiryNextQuestion, InquirySession, MedicationTask, MobileJointEvent, MobileMedication, MobileReminder, MobileRisk, ParseEventRequest, ParseEventResponse, ReportTask, ReportType, ScoreRiskResponse } from './types';
export declare const mobileMockApi: {
    getTodayReminders: () => Promise<{
        reminders: MobileReminder[];
    }>;
    ackReminder: (reminderId: string) => Promise<{
        success: boolean;
    }>;
    getRiskLatest: () => Promise<MobileRisk>;
    getMedications: () => Promise<{
        medications: MobileMedication[];
    }>;
    getMedicationTask: () => Promise<MedicationTask>;
    startInquiry: () => Promise<InquirySession>;
    submitInquiryAnswer: (_payload: InquiryAnswerDraft, sessionId?: string | null) => Promise<{
        success: boolean;
    }>;
    getNextQuestion: (sessionId?: string) => Promise<InquiryNextQuestion>;
    getJointEvents: () => Promise<{
        jointEvents: MobileJointEvent[];
    }>;
    createAdherenceEvent: (_payload: AdherenceEventDraft) => Promise<{
        success: boolean;
    }>;
    parseEvent: (payload: ParseEventRequest) => Promise<ParseEventResponse>;
    detectJointEvents: (_payload: DetectJointEventsRequest) => Promise<{
        jointEvents: {
            eventType: string;
            severity: number;
            evidence: Record<string, unknown>;
            riskDirections: import("./types").RiskDirection[];
        }[];
        modelVersion: string;
    }>;
    scoreRisk: (_payload: {
        patientId: number;
    }) => Promise<ScoreRiskResponse>;
    generateAiReport: (_payload: GenerateReportRequest) => Promise<GenerateReportResponse>;
    createPatientReport: (reportType: ReportType) => Promise<{
        taskId: string;
        status: "PENDING";
    }>;
    getPatientReportTask: (reportId: string) => Promise<ReportTask>;
    getPatientReportDownload: (reportId: string) => Promise<{
        reportId: string;
        downloadUrl: string;
        expiresAt: string;
    }>;
};
