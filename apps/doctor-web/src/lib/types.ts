export type AsyncStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';

export type ReviewPriority =
  | 'OBSERVE'
  | 'RETEST_SOON'
  | 'CLINIC_REVIEW'
  | 'HIGH_PRIORITY';

export type RiskDirection =
  | 'DEINTENSIFICATION'
  | 'INTERACTION'
  | 'TEMPORAL_BEHAVIOR'
  | 'JOINT_EVENT';

export type KnowledgeCell = string | number | boolean | null;

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

export interface PatientProfile {
  id: number;
  name: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER' | string;
  birthday: string;
  livingStatus: string;
  digitalAbilityLevel: string;
  diseaseTags?: string[];
  createdAt?: string;
}

export interface PatientMedication {
  id: number;
  medicationMasterId: number;
  genericName: string;
  brandName?: string;
  dose: string;
  frequency: string;
  administrationTime: string;
  startDate: string;
  endDate?: string | null;
  status: string;
  confirmedByUser: boolean;
}

export interface MedicationBoardItem extends PatientMedication {
  patientId: number;
  patientName: string;
  source: string;
  lastConfirmedAt: string;
  riskFlags: string[];
  note?: string;
}

export interface JointEvent {
  eventType: string;
  eventLabel?: string;
  eventDate?: string;
  timeWindowStart?: string;
  timeWindowEnd?: string;
  severity: number;
  evidence: Record<string, unknown>;
  riskDirections: RiskDirection[];
}

export interface DailyPatientEvent {
  id: string;
  occurredAt: string;
  category: string;
  title: string;
  detail: string;
  source: string;
  status: string;
  relatedMedication?: string;
  indicator?: string;
}

export interface RiskLatest {
  deintensificationScore: number;
  interactionScore: number;
  behaviorScore: number;
  jointEventScore: number;
  reviewPriority: ReviewPriority;
  reasons: string[];
  modelVersion?: string;
}

export interface ReportTask {
  reportId: string;
  reportType: string;
  status: AsyncStatus;
  generatedAt?: string;
  fileAssetId?: number | null;
}

export interface ReportDownload {
  reportId: string;
  downloadUrl: string;
  expiresAt: string;
}

export interface ReminderItem {
  reminderId: string;
  reminderType: string;
  plannedAt: string;
  title: string;
  status: string;
}

export interface FollowUpFeedbackRecord {
  id: string;
  patientId: number;
  patientName: string;
  eventDate: string;
  eventType: string;
  channel: string;
  feedbackSummary: string;
  symptoms: string[];
  adherenceStatus: string;
  mealStatus: string;
  status: string;
  nextAction: string;
  linkedEventType?: string;
  linkedEventDate?: string;
}

export interface KnowledgeDataset {
  id: string;
  title: string;
  description: string;
  columns: string[];
  rows: Array<Record<string, KnowledgeCell>>;
}

export interface MedicationListResponse {
  medications: PatientMedication[];
}

export interface MedicationBoardResponse {
  medications: MedicationBoardItem[];
}

export interface JointEventListResponse {
  jointEvents: JointEvent[];
}

export interface DailyEventListResponse {
  date: string;
  events: DailyPatientEvent[];
}

export interface ReminderListResponse {
  reminders: ReminderItem[];
}

export interface FollowUpRecordListResponse {
  records: FollowUpFeedbackRecord[];
}

export interface KnowledgeBaseResponse {
  datasets: KnowledgeDataset[];
}
