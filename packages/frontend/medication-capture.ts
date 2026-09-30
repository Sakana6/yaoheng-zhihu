import { ref } from 'vue';
import { useCaptureApi, type CaptureTask, type MedicationCandidate } from './capture-api';

/** Modal-local state, kept out of shared medication/reminder stores. */
export function useMedicationCapture() {
  const api = useCaptureApi();
  const task = ref<CaptureTask | null>(null), busy = ref(false), message = ref('');
  let sequence = 0, controller: AbortController | null = null;
  async function run(work: (signal: AbortSignal, current: () => boolean) => Promise<CaptureTask>) {
    if (busy.value) return;
    const current = ++sequence; const abort = new AbortController();controller=abort;busy.value = true;message.value = '正在连接本地采集服务…';
    // Includes the bounded 30s provider request plus local upload/confirmation overhead.
    const timer = setTimeout(() => abort.abort(), 35000);
    try {
      const result = await work(abort.signal, () => current === sequence);
      if (current !== sequence) return;
      task.value = result;
      message.value = result.status === 'FAILED' ? '识别未完成（' + result.failureCode + '），可以重试或手工填写。'
        : result.status === 'CONFIRMED' ? '此证据已确认保存，请在药历中查看，不能重复入药。'
        : result.fileDeleted ? '原图已清理，不可用作重新识别；可手工核对填写，历史证据元数据保留。'
        : result.status === 'RUNNING' || result.status === 'PENDING' ? '采集尚未完成，可取消后重试；不会自动保存药历。'
        : result.status === 'CANCELLED' || result.status === 'REJECTED' ? '候选已取消或拒绝，可以重试或手工填写。'
        : result.result?.unknown ? '未找到可靠药名候选，请按原文手工核对填写。'
        : '结果仅为候选；请选择或修改药名，核对剂量和日期后点击原保存按钮。';
    } catch (e) {
      if (current === sequence) message.value = '采集未完成，草稿保留，可重试或手工填写。' + String(e);
    } finally { clearTimeout(timer);if (current === sequence) busy.value = false; }
  }
  return {
    task, busy, message,
    recognize(file: File) { if(busy.value)return;task.value=null;return run(async (signal, current) => {
      let uploaded = await api.upload(file,signal);
      if (!current()) return uploaded;
      // Idempotency responses can describe an earlier state: query the authoritative task.
      uploaded = await api.get(uploaded.taskId,signal);
      if (!current()) return uploaded;
      task.value = uploaded;
      if(uploaded.fileDeleted)return uploaded;
      if (['PENDING','FAILED','CANCELLED','REJECTED'].includes(uploaded.status)) return api.action(uploaded,'process',signal);
      return uploaded;
    }); },
    normalize(text: string) { if(busy.value)return;task.value=null;return run(async (signal,current) => {
      const result = await api.normalize(text,signal);
      if(!current())return result;
      const latest=await api.get(result.taskId,signal);
      if(!current())return latest;
      task.value=latest;
      return ['FAILED','CANCELLED','REJECTED','PENDING'].includes(latest.status)?api.action(latest,'process',signal):latest;
    }); },
    async reject() {
      if (!task.value || busy.value || task.value.status !== 'CANDIDATE_READY') return;
      const snapshot = task.value;
      await run(signal => api.action(snapshot,'reject',signal));
      if((task.value as CaptureTask | null)?.status==='REJECTED') message.value = '已拒绝候选，可以手工填写；原证据保留。';
    },
    async cancel() {
      const snapshot = task.value;const current=++sequence;controller?.abort();busy.value=false;
      message.value='已取消采集，可以手工填写。';
      if(snapshot && snapshot.status!=='CONFIRMED') {
        const abort=new AbortController();controller=abort;const timer=setTimeout(()=>abort.abort(),20000);
        try { const latest=await api.get(snapshot.taskId,abort.signal); if(current!==sequence)return;const result=await api.action(latest,'cancel',abort.signal);
          if(current===sequence&&task.value?.taskId===snapshot.taskId)task.value=result;
        } catch { if(current===sequence)message.value='本地等待已取消；服务端状态需重试查询，手工草稿保留。'; }
        finally {clearTimeout(timer);}
      }
    },
    reset() { ++sequence;controller?.abort();task.value=null;busy.value=false;message.value=''; },
    confirmation() {
      if(busy.value)throw Error('采集仍在处理中，请等待或取消后保存');
      if(!task.value)return {};
      if(['PENDING','RUNNING','CONFIRMED'].includes(task.value.status))throw Error('请先取消未完成采集，或查看已确认药历');
      return {captureTaskId:task.value.taskId,captureVersion:task.value.version};
    },
    select(candidate: MedicationCandidate) { message.value='已选候选：' + candidate.genericName + '。规格仅供核对，不自动决定剂量或服法。';return {genericName:candidate.genericName,brandName:candidate.brandName}; },
  };
}
