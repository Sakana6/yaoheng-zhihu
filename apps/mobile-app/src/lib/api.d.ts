import type { AcceptedTask, AdherenceEventDraft, DetectJointEventsRequest, DetectJointEventsResponse, CurrentPatientContext, GenerateReportRequest, GenerateReportResponse, InquiryAnswerDraft, InquiryNextQuestion, InquirySession, MedicationTask, MobileJointEvent, MobileMedication, MobileReminder, MobileRisk, ParseEventRequest, ParseEventResponse, ReportDownloadInfo, ReportTask, ReportType, ScoreRiskRequest, ScoreRiskResponse } from './types';
export declare const mobileRuntimeConfig: {
    apiBaseUrl: any;
    useMock: boolean;
};
export declare const mobileApi: {
    getCurrentPatient(): Promise<CurrentPatientContext>;
    getTodayReminders(): Promise<{
        reminders: MobileReminder[];
    }>;
    ackReminder(reminderId: string): Promise<{
        success: boolean;
    }>;
    getRiskLatest(): Promise<MobileRisk>;
    getMedications(): Promise<{
        medications: MobileMedication[];
    }>;
    createMedicationUpload(fileAssetId: number, sourceType?: string): Promise<AcceptedTask>;
    getMedicationTask(taskId?: string | null): Promise<MedicationTask | null>;
    startInquiry(): Promise<InquirySession>;
    submitInquiryAnswer(payload: InquiryAnswerDraft, sessionId?: string | null): Promise<{
        success: boolean;
    }>;
    getNextQuestion(sessionId?: string | null): Promise<InquiryNextQuestion>;
    getJointEvents(): Promise<{
        jointEvents: MobileJointEvent[];
    }>;
    createAdherenceEvent(payload: AdherenceEventDraft): Promise<{
        success: boolean;
    }>;
    parseEvent(payload: ParseEventRequest): Promise<ParseEventResponse>;
    detectJointEvents(payload: DetectJointEventsRequest): Promise<DetectJointEventsResponse>;
    scoreRisk(payload: ScoreRiskRequest): Promise<ScoreRiskResponse>;
    generateAiReport(payload: GenerateReportRequest): Promise<GenerateReportResponse>;
    createPatientReport(reportType: ReportType): Promise<AcceptedTask>;
    getPatientReportTask(reportId: string): Promise<ReportTask>;
    getPatientReportDownload(reportId: string): Promise<ReportDownloadInfo>;
};
