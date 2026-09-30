import { mobileMockApi } from './mock';
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api';
const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false';
const AUTH_TOKEN = import.meta.env.VITE_AUTH_TOKEN;
let currentPatientContext = null;
let latestMedicationTaskId = null;
let latestInquirySessionId = null;
function getAuthToken() {
    if (typeof window === 'undefined') {
        return AUTH_TOKEN;
    }
    return window.localStorage.getItem('auth_token') ?? AUTH_TOKEN;
}
async function request(path, init) {
    return requestWithParser(path, init, async (response) => {
        const payload = (await response.json());
        return payload.data;
    });
}
async function requestRaw(path, init) {
    return requestWithParser(path, init, async (response) => (await response.json()));
}
async function requestWithParser(path, init, parse) {
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
async function resolvePatientId() {
    if (USE_MOCK) {
        return currentPatientContext?.patientId ?? 1;
    }
    if (currentPatientContext?.patientId) {
        return currentPatientContext.patientId;
    }
    const context = await request('/patients/current');
    currentPatientContext = context;
    return context.patientId;
}
function requireRuntimeId(id, label) {
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
    async getCurrentPatient() {
        if (USE_MOCK) {
            const mockContext = {
                userId: 1,
                role: 'CAREGIVER',
                patientId: 1,
                patientName: 'Demo Patient',
            };
            currentPatientContext = mockContext;
            return mockContext;
        }
        const context = await request('/patients/current');
        currentPatientContext = context;
        return context;
    },
    async getTodayReminders() {
        if (USE_MOCK) {
            return mobileMockApi.getTodayReminders();
        }
        const patientId = await resolvePatientId();
        return request(`/patients/${patientId}/reminders/today`);
    },
    async ackReminder(reminderId) {
        if (USE_MOCK) {
            return mobileMockApi.ackReminder(reminderId);
        }
        const patientId = await resolvePatientId();
        return request(`/patients/${patientId}/reminders/ack`, {
            method: 'POST',
            body: JSON.stringify({ reminderId }),
        });
    },
    async getRiskLatest() {
        if (USE_MOCK) {
            return mobileMockApi.getRiskLatest();
        }
        const patientId = await resolvePatientId();
        return request(`/patients/${patientId}/risk/latest`);
    },
    async getMedications() {
        if (USE_MOCK) {
            return mobileMockApi.getMedications();
        }
        const patientId = await resolvePatientId();
        return request(`/patients/${patientId}/medications`);
    },
    async createMedicationUpload(fileAssetId, sourceType = 'DRUG_BOX') {
        if (USE_MOCK) {
            latestMedicationTaskId = 'task_demo_med_001';
            return {
                taskId: latestMedicationTaskId,
                status: 'PENDING',
            };
        }
        const patientId = await resolvePatientId();
        const task = await request(`/patients/${patientId}/medication-uploads`, {
            method: 'POST',
            body: JSON.stringify({
                fileAssetId,
                sourceType,
            }),
        });
        latestMedicationTaskId = task.taskId;
        return task;
    },
    async getMedicationTask(taskId = latestMedicationTaskId) {
        if (USE_MOCK) {
            latestMedicationTaskId = latestMedicationTaskId ?? 'task_demo_med_001';
            return mobileMockApi.getMedicationTask();
        }
        if (!taskId) {
            return null;
        }
        const patientId = await resolvePatientId();
        const task = await request(`/patients/${patientId}/medication-uploads/${taskId}`);
        latestMedicationTaskId = task.taskId;
        return task;
    },
    async startInquiry() {
        if (USE_MOCK) {
            const session = await mobileMockApi.startInquiry();
            latestInquirySessionId = session.sessionId;
            return session;
        }
        const patientId = await resolvePatientId();
        const session = await request(`/patients/${patientId}/inquiry-sessions/start`, {
            method: 'POST',
            body: JSON.stringify({
                triggerType: 'medication_reminder',
                triggerTime: new Date().toISOString(),
            }),
        });
        latestInquirySessionId = session.sessionId;
        return session;
    },
    async submitInquiryAnswer(payload, sessionId = latestInquirySessionId) {
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
    async getNextQuestion(sessionId = latestInquirySessionId) {
        if (USE_MOCK) {
            latestInquirySessionId = latestInquirySessionId ?? 'inq_demo_001';
            return mobileMockApi.getNextQuestion(sessionId ?? latestInquirySessionId);
        }
        const patientId = await resolvePatientId();
        const resolvedSessionId = requireRuntimeId(sessionId, 'Inquiry session');
        return request(`/patients/${patientId}/inquiry-sessions/${resolvedSessionId}/next-question`);
    },
    async getJointEvents() {
        if (USE_MOCK) {
            return mobileMockApi.getJointEvents();
        }
        const patientId = await resolvePatientId();
        return request(`/patients/${patientId}/joint-events`);
    },
    async createAdherenceEvent(payload) {
        if (USE_MOCK) {
            return mobileMockApi.createAdherenceEvent(payload);
        }
        const patientId = await resolvePatientId();
        return request(`/patients/${patientId}/adherence-events`, {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    },
    async parseEvent(payload) {
        if (USE_MOCK) {
            return mobileMockApi.parseEvent(payload);
        }
        return requestRaw('/ai/parse-event', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    },
    async detectJointEvents(payload) {
        if (USE_MOCK) {
            return mobileMockApi.detectJointEvents(payload);
        }
        return requestRaw('/ai/detect-joint-events', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    },
    async scoreRisk(payload) {
        if (USE_MOCK) {
            return mobileMockApi.scoreRisk(payload);
        }
        return requestRaw('/ai/score-risk', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    },
    async generateAiReport(payload) {
        if (USE_MOCK) {
            return mobileMockApi.generateAiReport(payload);
        }
        return requestRaw('/ai/generate-report', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    },
    async createPatientReport(reportType) {
        if (USE_MOCK) {
            return mobileMockApi.createPatientReport(reportType);
        }
        const patientId = await resolvePatientId();
        return request(`/patients/${patientId}/reports/generate`, {
            method: 'POST',
            body: JSON.stringify({ reportType }),
        });
    },
    async getPatientReportTask(reportId) {
        if (USE_MOCK) {
            return mobileMockApi.getPatientReportTask(reportId);
        }
        const patientId = await resolvePatientId();
        return request(`/patients/${patientId}/reports/${reportId}`);
    },
    async getPatientReportDownload(reportId) {
        if (USE_MOCK) {
            return mobileMockApi.getPatientReportDownload(reportId);
        }
        const patientId = await resolvePatientId();
        return request(`/patients/${patientId}/reports/${reportId}/download`);
    },
};
