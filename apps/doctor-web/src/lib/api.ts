import { watch } from 'vue';
import { useMock as USE_MOCK, session, selectedPatient, sessionEpoch, backendRequest } from '../../../../packages/frontend/session';
import { doctorMockApi } from './mock';
import type {
  AcceptedTask,
  CurrentPatientContext,
  DailyEventListResponse,
  FollowUpRecordListResponse,
  JointEventListResponse,
  KnowledgeBaseResponse,
  MedicationBoardResponse,
  MedicationListResponse,
  PatientProfile,
  ReminderListResponse,
  ReportDownload,
  ReportTask,
  RiskLatest,
} from './types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api';
const GET_CACHE_TTL_MS = 30_000;

type Envelope<T> = {
  code: number;
  message: string;
  data: T;
};

export const DEFAULT_REPORT_ID = 'report_demo_001';

const reportIdsByPatient = new Map<number, string>();
const getResponseCache = new Map<string, { expiresAt: number; data: unknown }>();
const inflightGetRequests = new Map<string, Promise<unknown>>();
let currentPatientContext: CurrentPatientContext | null = null;

export const doctorRuntimeConfig = {
  apiBaseUrl: API_BASE_URL,
  useMock: USE_MOCK,
};

function getAuthToken(): string | undefined { return session.value?.token; }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return backendRequest<T>(path, init);
}

watch(sessionEpoch, () => {
  currentPatientContext = null;
  reportIdsByPatient.clear(); getResponseCache.clear(); inflightGetRequests.clear();
});

async function callApi<T>(path: string, fallback: () => Promise<T>, init?: RequestInit): Promise<T> {
  if (USE_MOCK) {
    return fallback();
  }

  return request<T>(path, init);
}

async function callApiCached<T>(path: string, fallback: () => Promise<T>): Promise<T> {
  if (USE_MOCK) {
    return fallback();
  }

  const now = Date.now();
  const cached = getResponseCache.get(path);
  if (cached && cached.expiresAt > now) {
    return cached.data as T;
  }

  const inflight = inflightGetRequests.get(path);
  if (inflight) {
    return (await inflight) as T;
  }

  const requestPromise = request<T>(path)
    .then((data) => {
      getResponseCache.set(path, {
        data,
        expiresAt: Date.now() + GET_CACHE_TTL_MS,
      });
      return data;
    })
    .finally(() => {
      inflightGetRequests.delete(path);
    });

  inflightGetRequests.set(path, requestPromise as Promise<unknown>);
  return requestPromise;
}

function requireReportId(patientId: number, reportId?: string): string {
  const resolvedReportId = reportId ?? reportIdsByPatient.get(patientId);
  if (!resolvedReportId) {
    throw new Error('Report task is not available yet');
  }

  return resolvedReportId;
}

export const doctorApi = {
  async getCurrentPatient(): Promise<CurrentPatientContext> {
    const context = await callApiCached('/patients/current', () => doctorMockApi.getCurrentPatient());
    currentPatientContext = context;
    return context;
  },

  getCachedCurrentPatient(): CurrentPatientContext | null {
    return currentPatientContext;
  },

  getProfile: (patientId: number): Promise<PatientProfile> =>
    callApiCached(`/patients/${patientId}/profile`, () => doctorMockApi.getProfile(patientId)),

  getMedications: (patientId: number): Promise<MedicationListResponse> =>
    callApiCached(`/patients/${patientId}/medications`, () => doctorMockApi.getMedications(patientId)),

  getMedicationBoard: (): Promise<MedicationBoardResponse> =>
    callApiCached('/medications/board', () => doctorMockApi.getMedicationBoard()),

  getJointEvents: (patientId: number): Promise<JointEventListResponse> =>
    callApiCached(`/patients/${patientId}/joint-events`, () => doctorMockApi.getJointEvents(patientId)),

  getDailyEvents: (patientId: number, date?: string): Promise<DailyEventListResponse> =>
    callApiCached(`/patients/${patientId}/daily-events?date=${date ?? ''}`, () =>
      doctorMockApi.getDailyEvents(patientId, date),
    ),

  getFollowUpRecords: (): Promise<FollowUpRecordListResponse> =>
    callApiCached('/follow-ups', () => doctorMockApi.getFollowUpRecords()),

  getKnowledgeBase: (): Promise<KnowledgeBaseResponse> =>
    callApiCached('/knowledge-base/datasets', () => doctorMockApi.getKnowledgeBase()),

  getRisk: (patientId: number): Promise<RiskLatest> =>
    callApiCached(`/patients/${patientId}/risk/latest`, () => doctorMockApi.getRisk(patientId)),

  async ensureReportTask(patientId: number, reportType = 'DOCTOR'): Promise<string> {
    if (USE_MOCK) {
      const mockReportId = reportIdsByPatient.get(patientId) ?? DEFAULT_REPORT_ID;
      reportIdsByPatient.set(patientId, mockReportId);
      return mockReportId;
    }

    const cachedReportId = reportIdsByPatient.get(patientId);
    if (cachedReportId) {
      return cachedReportId;
    }

    const task = await request<AcceptedTask>(`/patients/${patientId}/reports/generate`, {
      method: 'POST',
      body: JSON.stringify({ reportType }),
    });
    reportIdsByPatient.set(patientId, task.taskId);
    return task.taskId;
  },

  async getReport(patientId: number, reportId?: string): Promise<ReportTask> {
    const resolvedReportId = requireReportId(patientId, reportId);
    const task = await callApi(`/patients/${patientId}/reports/${resolvedReportId}`, () =>
      doctorMockApi.getReport(patientId, resolvedReportId),
    );
    reportIdsByPatient.set(patientId, task.reportId);
    return task;
  },

  async getReportDownload(patientId: number, reportId?: string): Promise<ReportDownload> {
    const resolvedReportId = requireReportId(patientId, reportId);
    const download = await callApi(`/patients/${patientId}/reports/${resolvedReportId}/download`, () =>
      doctorMockApi.getReportDownload(patientId, resolvedReportId),
    );
    reportIdsByPatient.set(patientId, download.reportId);
    return download;
  },

  getTodayReminders: (patientId: number): Promise<ReminderListResponse> =>
    callApiCached(`/patients/${patientId}/reminders/today`, () =>
      doctorMockApi.getTodayReminders(patientId),
    ),
};
