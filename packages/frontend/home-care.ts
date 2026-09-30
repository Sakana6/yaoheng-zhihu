import { computed, ref } from 'vue';
import { backendRequest, selectedPatient, sessionEpoch } from './session';
import { careItems, shanghaiDate, type Occurrence, type FollowUp } from './care';
import type { PatientMedication } from './contracts';
import { useAnalysisState } from './analysis-state';
import { refreshReminderNotifications } from './notification-session';

/** Original Home data; independent request failures never block feedback capture. */
export function useHomeCare() {
  const patientId = selectedPatient.value?.id, epoch = sessionEpoch.value;
  const dailyOccurrences = ref<Occurrence[]>([]), followups=ref<FollowUp[]>([]), followupError=ref(''), medications = ref<PatientMedication[]>([]);
  const occurrences=computed(()=>{const rows=[...dailyOccurrences.value];for(const task of followups.value)if(task.status==='PENDING'&&task.reminder&&!rows.some(o=>o.occurrenceId===task.occurrenceId))rows.push(task.reminder);return rows.sort((a,b)=>Date.parse(a.plannedAt)-Date.parse(b.plannedAt));});
  async function readFollowUp(id:string){const task=await api<FollowUp>('/follow-ups/'+encodeURIComponent(id));if(!alive||epoch!==sessionEpoch.value)throw Error('会话已改变');if(task.status!=='PENDING')throw Error('随访已完成或已取消，请刷新任务');return task;}
  const analysis = useAnalysisState();
  const {latest,error:analysisError,summary} = analysis;
  const loading = ref(false), error = ref(''), medicationError = ref('');
  let alive = true, sequence = 0;
  const api = async <T>(path: string, init?: RequestInit) => {
    if (!alive || !patientId || epoch !== sessionEpoch.value) throw Error('患者或会话已改变');
    return backendRequest<T>(`/patients/${patientId}${path}`, init);
  };
  async function load() {
    if (!alive || epoch !== sessionEpoch.value) return;
    const seq = ++sequence; loading.value = true;
    const results = await Promise.allSettled([
      careItems<Occurrence>(api, `/reminders?date=${shanghaiDate()}`),
      api<{ medications: PatientMedication[] }>('/medications?history=true'),
      analysis.load(),
      careItems<FollowUp>(api,'/follow-ups'),
    ]);
    if (!alive || seq !== sequence || epoch !== sessionEpoch.value) return;
    const [o, m, , f] = results;
    if (o.status === 'fulfilled') { dailyOccurrences.value = o.value; error.value = ''; }
    else error.value = `提醒读取失败，保留上次结果，请重试。${String(o.reason)}`;
    if (m.status === 'fulfilled') { medications.value = m.value.medications; medicationError.value = ''; }
    else medicationError.value = `药历读取失败，主动记录请刷新后再试。${String(m.reason)}`;
    if(f.status==='fulfilled'){followups.value=f.value;followupError.value='';}else followupError.value='随访读取失败，可刷新重试。'+String(f.reason);
    loading.value = false;
  }
  const skipBusy = ref(false), skipError = ref('');
  let pending: { scope: string; body: string; key: string } | null = null;
  async function skip(o: Occurrence, reason: string) {
    if (skipBusy.value) return false;
    skipBusy.value = true; skipError.value = '';
    const body = JSON.stringify({ expectedVersion: o.version, reason }), scope = o.occurrenceId;
    if (!pending || pending.scope !== scope || pending.body !== body) pending = { scope, body, key: crypto.randomUUID() };
    try {
      await api(`/reminders/${scope}/skip`, { method: 'POST', body, headers: { 'Idempotency-Key': pending.key } });
      pending = null; void refreshReminderNotifications(); return true;
    } catch (e) { skipError.value = `跳过未确认，原因已保留，可重试。${String(e)}`; return false; }
    finally { skipBusy.value = false; }
  }
  return { analysis, occurrences, followups, followupError, readFollowUp, medications, latest, loading, error, analysisError, medicationError, summary,
    load, skip, skipBusy, skipError, dispose() { alive = false; sequence++; analysis.dispose(); loading.value = false; } };
}
