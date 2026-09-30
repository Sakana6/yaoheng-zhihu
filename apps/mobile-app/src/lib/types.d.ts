export type AsyncStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';
export type RiskDirection = 'DEINTENSIFICATION' | 'INTERACTION' | 'TEMPORAL_BEHAVIOR' | 'JOINT_EVENT';
export type ReviewPriority = 'OBSERVE' | 'RETEST_SOON' | 'CLINIC_REVIEW' | 'HIGH_PRIORITY';
export type ReportType = 'DOCTOR' | 'FAMILY';
export interface CurrentPatientContext {
    userId: number;
    role: string;
    patientId: number;
    patientName: string;
}
export interface AcceptedTask {
    taskId: string;
    status: AsyncStatus;
}
export interface MobileReminder {
    reminderId: string;
    reminderType: string;
    plannedAt: string;
    title: string;
    status: string;
    medicationIds: number[];
    medicationNames: string[];
    voicePrompt: string;
    followUpPrompt: string;
}
export interface MobileRisk {
    deintensificationScore: number;
    interactionScore: number;
    behaviorScore: number;
    jointEventScore: number;
    reviewPriority: ReviewPriority;
    reasons: string[];
}
export interface MobileMedication {
    id: number;
    genericName: string;
    brandName?: string;
    dose: string;
    frequency: string;
    administrationTime: string;
    startDate: string;
    status: string;
}
export interface MedicationCandidate {
    genericName: string;
    brandName?: string;
    strength: string;
    confidence: number;
}
export interface MedicationTask {
    taskId: string;
    status: AsyncStatus;
    candidates: MedicationCandidate[];
}
export interface InquirySession {
    sessionId: string;
    triggerType: string;
    triggerTime: string;
    sessionStatus: string;
    modelVersion: string;
}
export interface InquiryNextQuestion {
    sessionId: string;
    questionCode: string;
    questionText: string;
    sourceType: string;
    orderNo: number;
    isFinished: boolean;
}
export interface AdherenceEventDraft {
    medicationId: number;
    eventTime: string;
    eventType: 'TAKEN' | 'MISSED' | 'MAKEUP';
    note?: string;
}
export interface InquiryAnswerDraft {
    questionCode: string;
    answerValue?: string;
    answerText?: string;
}
export interface DeviceCapability {
    nativeShell: boolean;
    canScheduleNotifications: boolean;
    canUseSpeechRecognition: boolean;
    canUseTextToSpeech: boolean;
}
export interface MobileJointEvent {
    eventType: string;
    eventLabel?: string;
    eventDate?: string;
    timeWindowStart?: string;
    timeWindowEnd?: string;
    severity: number;
    evidence: Record<string, unknown>;
    riskDirections: RiskDirection[];
}
export interface StructuredEvent {
    symptoms: string[];
    meal: Record<string, unknown>;
    adherence: Record<string, unknown>;
    timeHint?: string | null;
}
export interface ParseEventRequest {
    patientId: number;
    triggerType: string;
    rawText: string;
    context: {
        currentMedications: string[];
        latestBp?: Record<string, unknown> | null;
        latestBg?: number | null;
        [key: string]: unknown;
    };
}
export interface ParseEventResponse {
    structuredEvent: StructuredEvent;
    confidence: number;
    modelVersion: string;
}
export interface AiJointEvent {
    eventType: string;
    severity: number;
    evidence: Record<string, unknown>;
    riskDirections: RiskDirection[];
}
export interface DetectJointEventsRequest {
    patientId: number;
    timeWindow: {
        start: string;
        end: string;
    };
    events: Record<string, unknown>[];
    medications: Record<string, unknown>[];
    profile: Record<string, unknown>;
}
export interface DetectJointEventsResponse {
    jointEvents: AiJointEvent[];
    modelVersion: string;
}
export interface ScoreRiskRequest {
    patientId: number;
    jointEvents: AiJointEvent[];
    profile: Record<string, unknown>;
}
export interface ScoreRiskResponse extends MobileRisk {
    modelVersion: string;
}
export interface GenerateReportRequest {
    patientId: number;
    risk: ScoreRiskResponse;
    jointEvents: AiJointEvent[];
}
export interface GenerateReportResponse {
    familyVersion: {
        title?: string;
        actions?: string[];
    };
    doctorVersion: {
        title?: string;
        summary?: string[];
        evidence?: string[];
    };
    modelVersion: string;
}
export interface ReportTask {
    reportId: string;
    reportType: ReportType;
    status: AsyncStatus;
    generatedAt?: string;
    fileAssetId?: number | null;
}
export interface ReportDownloadInfo {
    reportId: string;
    downloadUrl: string;
    expiresAt: string;
}
