import { backendRequest, selectedPatient } from './session';
export interface Plan {
  managedByDoctor?: boolean;
  planId: string; version: number; title: string; reminderType: string; frequency: 'ONCE' | 'DAILY';
  timezone: string; localTime: string; startDate: string; endDate: string | null; medicationIds: number[]; status: 'ACTIVE' | 'PAUSED';
}
export interface Occurrence {
  feedbackRecordId?: string | null;
  followUpId?: string | null;
  occurrenceId: string; version: number; planId: string; planVersion: number; title: string; plannedAt: string;
  executionStatus: 'PENDING' | 'DONE' | 'SKIPPED' | 'CANCELLED'; displayStatus: string; skipReason: string | null;
  medications: Array<{ medicationId: number; genericName: string; dose: string; version: number }>;
}
export interface Facts {
  medications: Array<{ medicationId: number; executionType: string; occurredAt: string }>;
  symptoms: Array<{ code: string; severity: number; occurredAt: string }>;
  explicitNoSymptoms: boolean | null;
  glucose: Array<{ value: number; unit: string; occurredAt: string }>;
  bloodPressure: Array<{ systolic: number; diastolic: number; heartRate?: number | null; unit: string; occurredAt: string }>;
  meals: Array<{ mealType: string; intakeLevel: string; occurredAt: string }>;
}
export interface Feedback {
  captureSource?: 'VOICE' | 'DEVICE';
  captureTaskId?: string;
  followUpId?: string | null;
  reminder: Occurrence | null;
  recordId: string; revisionId: string; version: number; rawText: string; source: string; occurredAt: string; occurrenceId: string | null;
  confirmedFacts: Facts; revisions: Array<{ revisionId: string; occurredAt: string; source: string; version: number; rawText: string; changeReason: string; recordedAt: string; confirmedFacts: Facts }>;
  analysisTask: { taskId: string; status: string }; changeReason: string;
}
export function careApi() {
  // Bind this mounted workspace to its patient. Session epoch rejects late responses.
  const prefix = `/patients/${selectedPatient.value!.id}`;
  return <T>(path: string, init?: RequestInit) => backendRequest<T>(prefix + path, init);
}
export async function careItems<T>(api:ReturnType<typeof careApi>,path:string):Promise<T[]> {
  const items:T[]=[];let cursor:string|null=null;
  do {
    const page:{items:T[];nextCursor:string|null}=await api(`${path}${path.includes('?')?'&':'?'}limit=100${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`);
    items.push(...page.items);cursor=page.nextCursor;
  } while(cursor);
  return items;
}
export const shanghaiDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const localInput = (iso: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(iso)).replace(' ', 'T');
export const offsetTime = (local: string) => `${local}+08:00`;
export const displayTime = (iso: string) => new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
export const statusLabel = (value: string) => ({ PENDING: '待反馈', OVERDUE: '已过时待反馈', DONE: '已反馈', SKIPPED: '已跳过', CANCELLED: '已取消' }[value] ?? value);

export interface FollowUp {followUpId:string;sourceReviewId:string;analysisRunId:string;snapshotId:string;status:string;version:number;requiredFields:string[];dueAt:string;instruction:string;occurrenceId:string;completedRecordId:string|null;reminder:Occurrence}
