import { computed, ref } from 'vue';
import { backendRequest, selectedPatient, sessionEpoch } from './session';
import { careItems, type Feedback } from './care';
import type { AnalysisSnapshot, LatestAnalysis, EvidenceReference } from './contracts';

export interface Snapshot extends AnalysisSnapshot {
  dataStatus: string; referenceTime: string;
  timeline: Array<{ type: string; time: string; payload: unknown; evidence: EvidenceReference }>;
  profile: { lowBgCount14d: number; lowBpCount14d: number; missedMedCount14d: number; responseRate: number | null };
  medications: unknown[];
  jointEvents: Array<{ eventId: string; eventType: string; label: string; severity?: number; window?: { start: string; end: string; policy: string }; evidence: EvidenceReference[] }>;
}
export const analysisLabels: Record<string, string> = { MATCHED:'命中', NOT_MATCHED:'已评估未命中', INSUFFICIENT:'资料不足', NOT_APPLICABLE:'规则不适用', SUFFICIENT:'资料充分', PARTIAL:'部分资料缺失', PENDING:'待处理', RUNNING:'分析中', SUCCESS:'成功', FAILED:'失败' };
export function profileParagraphs(snapshot: Snapshot | null): string[] {
  if (!snapshot?.profile) return [];
  const p = snapshot.profile;
  return [`近14天低血糖记录：${p.lowBgCount14d} 次`, `近14天低血压记录：${p.lowBpCount14d} 次`,
    `近14天明确漏服记录：${p.missedMedCount14d} 次`,
    p.responseRate == null ? '提醒响应率：暂无到期提醒分母' : `提醒响应率：${(p.responseRate * 100).toFixed(1)}%（已反馈不等同于已服药）`];
}

/** Shared read-only projections; no global fact store, score calculation or timers. */
export function useAnalysisState(includeHistory = false) {
  const patientId = selectedPatient.value?.id, epoch = sessionEpoch.value;
  const latest = ref<LatestAnalysis | null>(null), snapshot = ref<Snapshot | null>(null), history = ref<Snapshot[]>([]);
  const error = ref(''), historyError = ref(''), selectionError = ref(''), evidenceError = ref('');
  const loading = ref(false), selectionLoading = ref(false), evidenceLoading = ref(false), busy = ref(false), selectedRun = ref('');
  const evidenceRecord = ref<Feedback | null>(null), evidenceReference = ref<EvidenceReference | null>(null);
  const evidenceRevision = computed(() => evidenceRecord.value?.revisions.find(r => r.revisionId === evidenceReference.value?.revisionId) ?? null);
  let alive = true, sequence = 0, selectionSequence = 0, evidenceSequence = 0;
  let retryAttempt: { taskId: string; key: string } | null = null;
  const valid = () => alive && epoch === sessionEpoch.value;
  const api = async <T>(path: string, init?: RequestInit) => {
    if (!valid() || !patientId) throw Error('患者或会话已改变');
    return backendRequest<T>(`/patients/${patientId}${path}`, init);
  };
  function closeEvidence() { evidenceSequence++; evidenceRecord.value = null; evidenceReference.value = null; evidenceError.value = ''; evidenceLoading.value = false; }
  function replaceSnapshot(value: Snapshot | null) {
    if (snapshot.value?.snapshotId !== value?.snapshotId) closeEvidence();
    snapshot.value = value;
  }
  async function load() {
    if (!valid()) return;
    const seq = ++sequence; loading.value = true;
    await Promise.all([
      (async () => { try {
        const data = await api<LatestAnalysis>('/analysis/latest');
        if (!valid() || seq !== sequence) return;
        latest.value = data; error.value = '';
        if (!selectedRun.value) replaceSnapshot(data.snapshot as Snapshot | null);
      } catch (e) { if (valid() && seq === sequence) error.value = `分析读取失败，保留已读取结果。${String(e)}`; } })(),
      ...(includeHistory ? [(async () => { try {
        const data = await careItems<Snapshot>(api, '/analysis/runs');
        if (valid() && seq === sequence) { history.value = data; historyError.value = ''; }
      } catch (e) { if (valid() && seq === sequence) historyError.value = `历史读取失败，可重试。${String(e)}`; } })()] : []),
    ]);
    if (valid() && seq === sequence) loading.value = false;
  }
  async function choose(run = selectedRun.value) {
    if (!valid()) return;
    selectedRun.value = run; const seq = ++selectionSequence;
    closeEvidence(); snapshot.value = null; selectionError.value = ''; selectionLoading.value = true;
    try {
      const value = run ? await api<Snapshot>('/analysis/runs/' + encodeURIComponent(run)) : latest.value?.snapshot as Snapshot | null;
      if (valid() && seq === selectionSequence) replaceSnapshot(value ?? null);
    } catch (e) { if (valid() && seq === selectionSequence) selectionError.value = `快照读取失败，请重试选择。${String(e)}`; }
    finally { if (valid() && seq === selectionSequence) selectionLoading.value = false; }
  }
  async function evidence(reference: EvidenceReference) {
    if (!valid() || !snapshot.value) return;
    const seq = ++evidenceSequence, snapshotId = snapshot.value.snapshotId;
    evidenceRecord.value = null; evidenceReference.value = reference; evidenceError.value = ''; evidenceLoading.value = true;
    try {
      const record = await api<Feedback>('/feedback-records/' + encodeURIComponent(reference.sourceId));
      if (!valid() || seq !== evidenceSequence || snapshot.value?.snapshotId !== snapshotId) return;
      if (record.recordId !== reference.sourceId || !record.revisions.some(r => r.revisionId === reference.revisionId)) throw Error('指定来源修订不存在，不能用最新修订替代');
      evidenceRecord.value = record;
    } catch (e) { if (valid() && seq === evidenceSequence) evidenceError.value = `证据读取失败，可重试。${String(e)}`; }
    finally { if (valid() && seq === evidenceSequence) evidenceLoading.value = false; }
  }
  async function retry() {
    const task = latest.value?.pendingTask;
    if (!valid() || busy.value || task?.status !== 'FAILED') return;
    busy.value = true;
    if (retryAttempt?.taskId !== task.taskId) retryAttempt = { taskId: task.taskId, key: crypto.randomUUID() };
    try {
      await api('/analysis-tasks/' + encodeURIComponent(task.taskId) + '/retry', { method:'POST', headers:{'Idempotency-Key':retryAttempt.key}, body:'{}' });
      retryAttempt = null; await load();
    } catch (e) { if (valid()) error.value = `重试未确认，请重试。${String(e)}`; }
    finally { if (valid()) busy.value = false; }
  }
  const summary = computed(() => {
    const data = latest.value;
    if (!data?.snapshot) return '尚无成功分析快照，不能据此判断风险正常。';
    if (!data.snapshot.risk) return '资料不足，未生成风险评分。';
    return data.snapshot.jointEvents.length ? '已发布分析中的联合事件线索' : '当前快照未发现联合事件，仍需结合资料充分性判断。';
  });
  function dispose() { alive = false; sequence++; selectionSequence++; closeEvidence(); loading.value = false; selectionLoading.value = false; busy.value = false; }
  return { latest, snapshot, history, error, historyError, selectionError, loading, selectionLoading, selectedRun,
    evidenceRecord, evidenceReference, evidenceRevision, evidenceError, evidenceLoading, busy, load, choose, evidence, closeEvidence, retry, summary, dispose };
}
