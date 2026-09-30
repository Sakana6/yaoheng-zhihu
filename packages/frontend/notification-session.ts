import { ref } from 'vue';
import { careItems, type Occurrence } from './care';
import { backendRequest, selectedPatient, session, sessionEpoch } from './session';
import { notificationPermission, notificationQueue } from './notifications';

export const remindersAllowed = ref(false);
export const reminderNotificationError = ref('');
let refreshOwner: (() => Promise<void>) | undefined;
/** Pages request reconciliation; only SessionGate owns the queue and polling lifetime. */
export async function refreshReminderNotifications() { await refreshOwner?.(); }
export async function enableReminderNotifications() {
  const epoch = sessionEpoch.value;
  try {
    const allowed = await notificationPermission(true);
    if (epoch !== sessionEpoch.value) return;
    remindersAllowed.value = allowed;
    await refreshReminderNotifications();
  } catch { if (epoch === sessionEpoch.value) reminderNotificationError.value = '无法获取通知权限，请检查系统设置。'; }
}
export function startReminderNotifications() {
  const patientId = selectedPatient.value?.id, epoch = sessionEpoch.value;
  let alive = true, sequence = 0;
  const valid = () => alive && epoch === sessionEpoch.value;
  remindersAllowed.value = false; reminderNotificationError.value = '';
  void notificationQueue.stop().catch(() => {});
  if (!patientId || session.value?.role !== 'CAREGIVER') return () => { alive = false; };
  const api = <T>(path: string) => backendRequest<T>(`/patients/${patientId}${path}`);
  const refresh = async () => {
    const seq = ++sequence;
    try {
      const allowed = await notificationPermission();
      if (!valid() || seq !== sequence) return;
      remindersAllowed.value = allowed;
      const items = allowed ? await careItems<Occurrence>(api, '/reminders/upcoming') : [];
      if (!valid() || seq !== sequence) return;
      await notificationQueue.sync(items, allowed);
      if (valid() && seq === sequence) reminderNotificationError.value = '';
    } catch {
      if (!valid() || seq !== sequence) return;
      reminderNotificationError.value = '通知同步失败，记录仍可保存；请刷新或检查系统通知设置。';
      await notificationQueue.stop().catch(() => {});
    }
  };
  refreshOwner = refresh;
  void refresh();
  const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 60000);
  return () => {
    alive = false; sequence++; clearInterval(timer);
    if (refreshOwner === refresh) refreshOwner = undefined;
    remindersAllowed.value = false;
    void notificationQueue.stop().catch(() => {});
  };
}
