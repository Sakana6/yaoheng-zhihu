import { ref } from 'vue';
import { backendRequest, selectedPatient, sessionEpoch } from './session';
import { careItems, displayTime, localInput, type Feedback, type Facts, type Occurrence } from './care';
import type { PatientMedication } from './contracts';

export const dayKey = (value: string | Date) => localInput(new Date(value).toISOString()).slice(0, 10);
export function dayWindow(end: string, count: number) {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(end) || !Number.isInteger(count) || count < 1 || count > 31) throw Error('日期窗口无效');
  return Array.from({ length: count }, (_, i) => new Date(Date.parse(end + 'T00:00:00Z') - (count - i - 1) * 86400000).toISOString().slice(0, 10));
}
export const executionLabel = (value: string) => ({ TAKEN: '已服', MAKEUP: '补服', MISSED: '明确漏服', UNKNOWN: '未知', SKIPPED: '已跳过', CANCELLED: '已取消' }[value] ?? value);
export interface HistoryDay { date: string; occurrences: Occurrence[]; records: Feedback[]; linked: Feedback[] }
/** A revision may move dates while independent date requests are in flight. */
export function timelineRecords(days: HistoryDay[]) {
  const latest = new Map<string, Feedback>();
  const dates = new Set(days.map(day => day.date));
  for (const day of days) for (const record of [...day.records, ...day.linked]) {
    if (!latest.has(record.recordId) || latest.get(record.recordId)!.version < record.version) latest.set(record.recordId, record);
  }
  return [...latest.values()].filter(record => dates.has(dayKey(record.occurredAt)))
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || a.recordId.localeCompare(b.recordId));
}
export function executionDay(day: HistoryDay, now: number = Number.POSITIVE_INFINITY) {
  const latest = new Map<string, Feedback>();
  for (const r of [...day.records, ...day.linked]) if (!latest.has(r.recordId) || latest.get(r.recordId)!.version < r.version) latest.set(r.recordId, r);
  const rows: Array<{ key: string; occurrence: Occurrence; medication: Occurrence['medications'][number]; execution: string; time: string | null; record?: Feedback }> = [];
  const seen = new Set<string>();
  for (const o of day.occurrences) {
    if (dayKey(o.plannedAt) !== day.date || Date.parse(o.plannedAt) > now) continue;
    const record = [...latest.values()].find(r => r.occurrenceId === o.occurrenceId);
    for (const medication of o.medications) {
      const key = `${o.occurrenceId}:${medication.medicationId}`;
      if (seen.has(key)) continue; seen.add(key);
      const facts = record?.confirmedFacts.medications.filter(m => m.medicationId === medication.medicationId) ?? [];
      // Duplicated equal facts count once; contradictory facts remain unknown, never optimistically TAKEN.
      const types = new Set(facts.map(f => f.executionType));
      const execution = ['SKIPPED','CANCELLED'].includes(o.executionStatus) ? o.executionStatus : types.size === 1 ? facts[0].executionType : 'UNKNOWN';
      rows.push({ key, occurrence: o, medication, execution, time: facts.length === 1 ? facts[0].occurredAt : null, record });
    }
  }
  const eligible = rows.filter(r => r.execution !== 'CANCELLED');
  const taken = eligible.filter(r => ['TAKEN', 'MAKEUP'].includes(r.execution)).length;
  return { rows, total: eligible.length, taken, missed: eligible.filter(r => r.execution === 'MISSED').length,
    adherence: eligible.length ? Math.round(taken / eligible.length * 100) : null };
}

/** Bounded date reads. Never mixes a failed/new query with an older query's date label. */
export function useRecordHistory() {
  const patientId = selectedPatient.value?.id, epoch = sessionEpoch.value;
  const days = ref<HistoryDay[]>([]), medications = ref<PatientMedication[]>([]);
  const completedDays = ref(0), totalDays = ref(0);
  const loading = ref(false), error = ref(''), detail = ref<Feedback | null>(null), detailError = ref(''), detailLoading = ref(false);
  let alive = true, sequence = 0, detailSequence = 0;
  const valid = () => alive && epoch === sessionEpoch.value;
  const api = async <T>(path: string) => {
    if (!valid() || !patientId) throw Error('患者或会话已改变');
    return backendRequest<T>(`/patients/${patientId}${path}`);
  };
  async function load(end: string, count: number) {
    const seq = ++sequence; loading.value = true; error.value = ''; days.value = [];
    completedDays.value = 0; totalDays.value = 0;
    let stopped = false;
    const current = () => !stopped && valid() && seq === sequence;
    // Deduplicate cross-day evidence only within this read; never cache revisions across refreshes.
    const linkedReads = new Map<string, Promise<Feedback>>();
    try {
      const dates = dayWindow(end, count); totalDays.value = dates.length;
      const result: HistoryDay[] = new Array(dates.length);
      let next = 0;
      const worker = async () => {
        while (current()) {
          const index = next++; if (index >= dates.length) return;
          const date = dates[index];
          const [occurrences, records] = await Promise.all([careItems<Occurrence>(api, '/reminders?date=' + date), careItems<Feedback>(api, '/daily-events?date=' + date)]);
          if (!current()) return;
          const ids = [...new Set(occurrences.map(o => o.feedbackRecordId).filter((id): id is string => !!id))];
          const linked: Feedback[] = [];
          for (let j = 0; j < ids.length && current(); j += 4) {
            linked.push(...await Promise.all(ids.slice(j, j + 4).map(id => {
              const sameDay = records.find(r => r.recordId === id);
              if (sameDay) return sameDay;
              if (!linkedReads.has(id)) linkedReads.set(id, api<Feedback>('/feedback-records/' + encodeURIComponent(id)));
              return linkedReads.get(id)!;
            })));
          }
          if (!current()) return;
          result[index] = { date, occurrences, records, linked };
          completedDays.value++;
        }
      };
      // Same four-day concurrency limit, but a fast day need not wait for its slow batch peer.
      const [meds] = await Promise.all([
        api<{ medications: PatientMedication[] }>('/medications?history=true'),
        Promise.all(Array.from({ length: Math.min(4, dates.length) }, worker)),
      ]);
      if (!current()) return;
      days.value = result; medications.value = meds.medications;
    } catch (e) {
      stopped = true;
      if (valid() && seq === sequence) error.value = '读取失败，请重试；本次日期范围不显示旧数据。' + String(e);
    } finally { if (valid() && seq === sequence) loading.value = false; }
  }
  async function open(id: string) {
    const seq = ++detailSequence; detail.value = null; detailLoading.value = true; detailError.value = '';
    try { const fresh = await api<Feedback>(`/feedback-records/${encodeURIComponent(id)}`); if (valid() && seq === detailSequence) { detail.value = fresh; return fresh; } }
    catch (e) { if (valid() && seq === detailSequence) detailError.value = `详情读取失败，可重试。${String(e)}`; }
    finally { if (valid() && seq === detailSequence) detailLoading.value = false; }
  }
  function close() { detailSequence++; detail.value = null; detailError.value = ''; detailLoading.value = false; }
  return { days, medications, loading, completedDays, totalDays, error, detail, detailError, detailLoading, load, open, close, dispose() { alive = false; sequence++; close(); } };
}

export function factFields(facts: Facts, reminder: Occurrence | null, medications: PatientMedication[]) {
  const fields: Array<{ icon: string; label: string; value: string; tone: 'neutral' | 'info' }> = [];
  const add = (label: string, value: string) => fields.push({ icon: '🧾', label: `${fields.length + 1}. ${label}`, value, tone: 'neutral' });
  for (const m of facts.medications) add('药品执行', `${reminder?.medications.find(x => x.medicationId === m.medicationId)?.genericName ?? medications.find(x => x.id === m.medicationId)?.genericName ?? `药历#${m.medicationId}`} · ${executionLabel(m.executionType)} · ${displayTime(m.occurredAt)}`);
  add('症状确认', facts.explicitNoSymptoms === true ? '明确无症状' : facts.symptoms.length ? '有症状' : '未知');
  for (const s of facts.symptoms) add('症状', `${s.code} · 程度${s.severity} · ${displayTime(s.occurredAt)}`);
  for (const g of facts.glucose) add('血糖', `${g.value} ${g.unit} · ${displayTime(g.occurredAt)}`);
  for (const b of facts.bloodPressure) add('血压', `${b.systolic}/${b.diastolic} ${b.unit}${b.heartRate == null ? '' : ` · 心率 ${b.heartRate} 次/分`} · ${displayTime(b.occurredAt)}`);
  for (const m of facts.meals) add('进食', `${m.mealType} / ${m.intakeLevel} · ${displayTime(m.occurredAt)}`);
  return fields;
}
