import { ref } from 'vue';
import { backendRequest, selectedPatient, sessionEpoch } from './session';
import { careItems, type Plan } from './care';
import type { PatientMedication } from './contracts';
import { refreshReminderNotifications } from './notification-session';

/** Patient-bound commands shared by original Profile and the transitional workspaces. */
export function useManagementApi() {
  const patientId = selectedPatient.value?.id;
  const epoch = sessionEpoch.value;
  const busy = ref(false);
  let pending: { scope: string; body: string; key: string } | null = null;
  const request = <T>(path: string, init?: RequestInit) => {
    if (!patientId || epoch !== sessionEpoch.value) throw new Error('患者或会话已改变，请重新打开页面');
    return backendRequest<T>(`/patients/${patientId}${path}`, init);
  };
  async function write<T>(path: string, method: string, value: object): Promise<T> {
    if (busy.value) throw new Error('正在保存，请勿重复提交');
    const body = JSON.stringify(value), scope = method + path;
    if (!pending || pending.scope !== scope || pending.body !== body) pending = { scope, body, key: crypto.randomUUID() };
    busy.value = true;
    try {
      const saved = await request<T>(path, { method, body, headers: { 'Idempotency-Key': pending.key } });
      void refreshReminderNotifications();
      return saved;
    }
    finally { busy.value = false; }
  }
  return {
    busy, resetAttempt() { if (!busy.value) pending = null; },
    profile: () => request<{ id: number; birthday: string | null }>('/profile'),
    medications: (history = false) => request<{ medications: PatientMedication[] }>(`/medications?history=${history}`),
    plans: () => careItems<Plan>(request, '/reminder-plans'),
    saveMedication: (id: number | null, draft: object) => write<PatientMedication>(id === null ? '/medications' : `/medications/${id}`, id === null ? 'POST' : 'PATCH', draft),
    savePlan: (id: string | null, draft: object) => write<{ plan: Plan; occurrenceIds: string[] }>(id === null ? '/reminder-plans' : `/reminder-plans/${id}`, id === null ? 'POST' : 'PATCH', draft),
  };
}
