import { watch } from 'vue';
import { useMock as USE_MOCK, session, selectedPatient, sessionEpoch, backendRequest } from '../../../../packages/frontend/session';
import { mobileMockApi } from './mock';
import {
  normalizeGenerateReportResponse,
  normalizeJointEvent,
  normalizeLegacyText,
  normalizeMedication,
  normalizeMedicationTask,
  normalizeReminder,
  normalizeRisk,
} from './legacyText';
import type {
  AcceptedTask,
  AdherenceEventDraft,
  DetectJointEventsRequest,
  DetectJointEventsResponse,
  CurrentPatientContext,
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
  ScoreRiskRequest,
  ScoreRiskResponse,
} from './types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api';

let currentPatientContext: CurrentPatientContext | null = null;
let latestMedicationTaskId: string | null = null;
let latestInquirySessionId: string | null = null;

type Envelope<T> = {
  code: number;
  message: string;
  data: T;
  requestId?: string;
  timestamp?: string;
};

function getAuthToken(): string | undefined { return session.value?.token; }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return backendRequest<T>(path, init);
}

watch(sessionEpoch, () => {
  currentPatientContext = null; latestMedicationTaskId = null; latestInquirySessionId = null;
});

async function requestRaw<T>(path: string, init?: RequestInit): Promise<T> {
  return requestWithParser(path, init, async (response) => (await response.json()) as T);
}

async function requestWithParser<T>(
  path: string,
  init: RequestInit | undefined,
  parse: (response: Response) => Promise<T>,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const token = getAuthToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return parse(response);
}

async function resolvePatientId(): Promise<number> {
  if (USE_MOCK) {
    return currentPatientContext?.patientId ?? 1;
  }

  if (selectedPatient.value) return selectedPatient.value.id;

  if (currentPatientContext?.patientId) {
    return currentPatientContext.patientId;
  }

  const context = await request<CurrentPatientContext>('/patients/current');
  currentPatientContext = context;
  return context.patientId;
}

function requireRuntimeId(id: string | null, label: string): string {
  if (!id) {
    throw new Error(`${label} is not available yet`);
  }

  return id;
}

export const mobileRuntimeConfig = {
  apiBaseUrl: API_BASE_URL,
  useMock: USE_MOCK,
};

export const mobileApi = {
  async getCurrentPatient(): Promise<CurrentPatientContext> {
    if (USE_MOCK) {
      const mockContext: CurrentPatientContext = {
        userId: 1,
        role: 'CAREGIVER',
        patientId: 1,
        patientName: '演示患者',
      };
      currentPatientContext = mockContext;
      return mockContext;
    }

    const context = await request<CurrentPatientContext>('/patients/current');
    currentPatientContext = {
      ...context,
      patientName: normalizeLegacyText(context.patientName),
    };
    return currentPatientContext;
  },

  async getTodayReminders(): Promise<{ reminders: MobileReminder[] }> {
    if (USE_MOCK) {
      const response = await mobileMockApi.getTodayReminders();
      return {
        reminders: response.reminders.map((item) => normalizeReminder(item)),
      };
    }

    const patientId = await resolvePatientId();
    const response = await request<{ reminders: MobileReminder[] }>(`/patients/${patientId}/reminders/today`);
    return {
      reminders: response.reminders.map((item) => normalizeReminder(item)),
    };
  },

  async ackReminder(reminderId: string): Promise<{ success: boolean }> {
    if (USE_MOCK) {
      return mobileMockApi.ackReminder(reminderId);
    }

    const patientId = await resolvePatientId();
    return request(`/patients/${patientId}/reminders/ack`, {
      method: 'POST',
      body: JSON.stringify({ reminderId }),
    });
  },

  async getRiskLatest(): Promise<MobileRisk> {
    if (USE_MOCK) {
      return normalizeRisk(await mobileMockApi.getRiskLatest()) as MobileRisk;
    }

    const patientId = await resolvePatientId();
    return normalizeRisk(await request<MobileRisk>(`/patients/${patientId}/risk/latest`)) as MobileRisk;
  },

  async getMedications(): Promise<{ medications: MobileMedication[] }> {
    if (USE_MOCK) {
      const response = await mobileMockApi.getMedications();
      return {
        medications: response.medications.map((item) => normalizeMedication(item)),
      };
    }

    const patientId = await resolvePatientId();
    const response = await request<{ medications: MobileMedication[] }>(`/patients/${patientId}/medications`);
    return {
      medications: response.medications.map((item) => normalizeMedication(item)),
    };
  },

  async createMedication(input: Omit<MobileMedication, 'id'>): Promise<MobileMedication> {
    if (USE_MOCK) {
      return { ...input, id: Date.now() };
    }
    const patientId = await resolvePatientId();
    const medication = await request<MobileMedication>(`/patients/${patientId}/medications`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return normalizeMedication(medication);
  },

  async updateMedication(id: number, input: Partial<MobileMedication>): Promise<MobileMedication> {
    if (USE_MOCK) return { ...(input as MobileMedication), id };
    const patientId = await resolvePatientId();
    const medication = await request<MobileMedication>(`/patients/${patientId}/medications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
    return normalizeMedication(medication);
  },

  async createMedicationUpload(fileAssetId: number, sourceType = 'DRUG_BOX'): Promise<AcceptedTask> {
    if (USE_MOCK) {
      latestMedicationTaskId = 'task_demo_med_001';
      return {
        taskId: latestMedicationTaskId,
        status: 'PENDING',
      };
    }

    const patientId = await resolvePatientId();
    const task = await request<AcceptedTask>(`/patients/${patientId}/medication-uploads`, {
      method: 'POST',
      body: JSON.stringify({
        fileAssetId,
        sourceType,
      }),
    });
    latestMedicationTaskId = task.taskId;
    return task;
  },

  async getMedicationTask(taskId = latestMedicationTaskId): Promise<MedicationTask | null> {
    if (USE_MOCK) {
      latestMedicationTaskId = latestMedicationTaskId ?? 'task_demo_med_001';
      const task = await mobileMockApi.getMedicationTask();
      return task ? normalizeMedicationTask(task) : null;
    }

    if (!taskId) {
      return null;
    }

    const patientId = await resolvePatientId();
    const task = await request<MedicationTask>(`/patients/${patientId}/medication-uploads/${taskId}`);
    latestMedicationTaskId = task.taskId;
    return normalizeMedicationTask(task);
  },

  async startInquiry(): Promise<InquirySession> {
    if (USE_MOCK) {
      const session = await mobileMockApi.startInquiry();
      latestInquirySessionId = session.sessionId;
      return session;
    }

    const patientId = await resolvePatientId();
    const session = await request<InquirySession>(`/patients/${patientId}/inquiry-sessions/start`, {
      method: 'POST',
      body: JSON.stringify({
        triggerType: 'medication_reminder',
        triggerTime: new Date().toISOString(),
      }),
    });
    latestInquirySessionId = session.sessionId;
    return session;
  },

  async submitInquiryAnswer(
    payload: InquiryAnswerDraft,
    sessionId = latestInquirySessionId,
  ): Promise<{ success: boolean }> {
    if (USE_MOCK) {
      return mobileMockApi.submitInquiryAnswer(payload, sessionId);
    }

    const patientId = await resolvePatientId();
    const resolvedSessionId = requireRuntimeId(sessionId, 'Inquiry session');
    return request(`/patients/${patientId}/inquiry-sessions/${resolvedSessionId}/answer`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async getNextQuestion(sessionId = latestInquirySessionId): Promise<InquiryNextQuestion> {
    if (USE_MOCK) {
      latestInquirySessionId = latestInquirySessionId ?? 'inq_demo_001';
      return mobileMockApi.getNextQuestion(sessionId ?? latestInquirySessionId);
    }

    const patientId = await resolvePatientId();
    const resolvedSessionId = requireRuntimeId(sessionId, 'Inquiry session');
    return request(`/patients/${patientId}/inquiry-sessions/${resolvedSessionId}/next-question`);
  },

  async getJointEvents(): Promise<{ jointEvents: MobileJointEvent[] }> {
    if (USE_MOCK) {
      const response = await mobileMockApi.getJointEvents();
      return {
        jointEvents: response.jointEvents.map((item) => normalizeJointEvent(item)),
      };
    }

    const patientId = await resolvePatientId();
    const response = await request<{ jointEvents: MobileJointEvent[] }>(`/patients/${patientId}/joint-events`);
    return {
      jointEvents: response.jointEvents.map((item) => normalizeJointEvent(item)),
    };
  },

  async createAdherenceEvent(payload: AdherenceEventDraft): Promise<{ success: boolean }> {
    if (USE_MOCK) {
      return mobileMockApi.createAdherenceEvent(payload);
    }

    const patientId = await resolvePatientId();
    return request(`/patients/${patientId}/adherence-events`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async parseEvent(payload: ParseEventRequest): Promise<ParseEventResponse> {
    if (USE_MOCK) {
      return mobileMockApi.parseEvent(payload);
    }

    return requestRaw('/ai/parse-event', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async detectJointEvents(payload: DetectJointEventsRequest): Promise<DetectJointEventsResponse> {
    if (USE_MOCK) {
      return mobileMockApi.detectJointEvents(payload);
    }

    return requestRaw('/ai/detect-joint-events', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async scoreRisk(payload: ScoreRiskRequest): Promise<ScoreRiskResponse> {
    if (USE_MOCK) {
      return mobileMockApi.scoreRisk(payload);
    }

    return requestRaw('/ai/score-risk', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async generateAiReport(payload: GenerateReportRequest): Promise<GenerateReportResponse> {
    if (USE_MOCK) {
      return normalizeGenerateReportResponse(await mobileMockApi.generateAiReport(payload));
    }

    return normalizeGenerateReportResponse(await requestRaw('/ai/generate-report', {
      method: 'POST',
      body: JSON.stringify(payload),
    }));
  },

  async createPatientReport(reportType: ReportType): Promise<AcceptedTask> {
    if (USE_MOCK) {
      return mobileMockApi.createPatientReport(reportType);
    }

    const patientId = await resolvePatientId();
    return request(`/patients/${patientId}/reports/generate`, {
      method: 'POST',
      body: JSON.stringify({ reportType }),
    });
  },

  async getPatientReportTask(reportId: string): Promise<ReportTask> {
    if (USE_MOCK) {
      return mobileMockApi.getPatientReportTask(reportId);
    }

    const patientId = await resolvePatientId();
    return request(`/patients/${patientId}/reports/${reportId}`);
  },

  async getPatientReportDownload(reportId: string): Promise<ReportDownloadInfo> {
    if (USE_MOCK) {
      return mobileMockApi.getPatientReportDownload(reportId);
    }

    const patientId = await resolvePatientId();
    return request(`/patients/${patientId}/reports/${reportId}/download`);
  },
};
