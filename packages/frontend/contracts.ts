/** R1 wire types. A planned contract does not mean its capability is enabled. */
export interface PatientMedication {
  id: number; version: number; genericName: string; brandName: string | null;
  dose: string; frequency: string; administrationTime: string; startDate: string;
  endDate: string | null; status: 'ACTIVE' | 'STOPPED' | 'ARCHIVED';
  standardizationStatus: 'STANDARDIZED' | 'UNSTANDARDIZED';
}
export interface EvidenceReference { sourceId: string; revisionId: string; fieldPath: string; occurredAt: string }
export interface RuleEvaluation {
  ruleId: string; status: 'MATCHED' | 'NOT_MATCHED' | 'INSUFFICIENT' | 'NOT_APPLICABLE';
  evidence: EvidenceReference[]; missingFields: string[];
}
export interface AnalysisTask {
  taskId: string; patientId: number; inputRevision: number;
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED'; attempt: number; errorCode: string | null;
}
export interface AnalysisSnapshot {
  runId: string; snapshotId: string; inputRevision: number; algorithmVersion: string;
  risk: { deintensificationScore: number; interactionScore: number; behaviorScore: number; jointEventScore: number;
    reviewPriority: 'OBSERVE' | 'RETEST_SOON' | 'CLINIC_REVIEW' | 'HIGH_PRIORITY' } | null;
  jointEvents: Array<{ eventId: string; eventType: string; evidence: EvidenceReference[] }>;
  evidence: EvidenceReference[]; evaluations: RuleEvaluation[]; missingFields: string[];
}
export interface LatestAnalysis { snapshot: AnalysisSnapshot | null; pendingTask: AnalysisTask | null; inputRevision: number }
