import { apiBaseUrl, clearSession, selectedPatient, session, sessionEpoch } from './session';
import type { Facts } from './care';

export interface MedicationCandidate {
  code: string; genericName: string; brandName: string; strength: string;
  method: string; distance: number; score: number; confidenceLevel: string; explanation: string;
}
export interface CaptureTask {
  taskId: string; patientId: number; kind: 'IMAGE' | 'TEXT' | 'VOICE' | 'DEVICE'; version: number;
  status: 'PENDING' | 'RUNNING' | 'CANDIDATE_READY' | 'FAILED' | 'CANCELLED' | 'REJECTED' | 'CONFIRMED';
  failureCode: string | null; medicationId: number | null; fileDeleted: boolean;
  result: { rawText?: string; dictionaryVersion?: string; engine?: string; unknown?: boolean; candidates?: MedicationCandidate[]; text?: string; proposedFacts?: Facts; observedAt?: string; rawEvent?: object } | null;
}
export interface DeviceSession { deviceId: string; state: 'DISCONNECTED'|'CONNECTING'|'CONNECTED'|'ERROR'; version: number; sourceVersion: string }
/** Does not mutate medication facts. The existing save command performs confirmation. */
export function useCaptureApi() {
  const patient = selectedPatient.value?.id, epoch = sessionEpoch.value;
  const attempts = new Map<string,string>();
  function context() {
    if (!patient || epoch !== sessionEpoch.value || patient !== selectedPatient.value?.id) throw Error('患者或会话已改变，请重新打开页面');
  }
  async function request<T = CaptureTask>(path: string, body?: BodyInit, mime = 'application/json', filename?: string, signal?: AbortSignal, identity = ''): Promise<T> {
    context();
    const headers = new Headers({ 'Content-Type': mime });
    if (session.value) headers.set('Authorization', 'Bearer ' + session.value.token);
    if (filename) headers.set('X-File-Name', encodeURIComponent(filename));
    if (body !== undefined) {
      const scope = path + ':' + identity;
      if (!attempts.has(scope)) attempts.set(scope, crypto.randomUUID());
      headers.set('Idempotency-Key', attempts.get(scope)!);
    }
    const response = await fetch(apiBaseUrl + '/patients/' + patient + '/capture-tasks' + path, {
      method: body === undefined ? 'GET' : 'POST', body, headers, signal,
    });
    const payload = await response.json();context();
    if (response.status === 401) clearSession();
    if (!response.ok || payload.code !== 0) throw Error((payload.message ?? '采集请求失败') + ' (' + response.status + ')');
    return payload.data;
  }
  return {
    async voice(audio: Blob, signal?: AbortSignal, retryVersion = 0) {
      if(audio.size===0||audio.size>2*1024*1024)throw Error('录音须在 2 MiB 以内');
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await audio.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');
      return request('/voice',audio,audio.type||'audio/wav',undefined,signal,hash+':'+retryVersion);
    },
    device(id: string, signal?: AbortSignal) { return request<DeviceSession>('/devices/'+encodeURIComponent(id),undefined,undefined,undefined,signal); },
    connection(device: DeviceSession, operation: 'connect'|'disconnect', signal?: AbortSignal) {
      const body=JSON.stringify({operation,expectedVersion:device.version,sourceVersion:'replay-v1'});
      return request<DeviceSession>('/devices/'+encodeURIComponent(device.deviceId),body,undefined,undefined,signal,body);
    },
    deviceEvent(event: object, signal?: AbortSignal) {const body=JSON.stringify(event);return request('/device-events',body,undefined,undefined,signal,body);},
    async upload(file: File, signal?: AbortSignal) {
      context();
      if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 5 * 1024 * 1024 || file.size === 0) throw Error('请选择 5 MiB 以内的 PNG/JPEG 图片');
      const bytes = await file.arrayBuffer();
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
      return request('', file, file.type, file.name, signal, hash + ':' + file.name);
    },
    normalize(rawText: string, signal?: AbortSignal) { const body = JSON.stringify({ rawText });return request('/text',body,undefined,undefined,signal,body); },
    get(id: string, signal?: AbortSignal) { return request('/' + encodeURIComponent(id),undefined,undefined,undefined,signal); },
    action(task: CaptureTask, action: 'process' | 'cancel' | 'reject' | 'purge', signal?: AbortSignal) {
      const body = JSON.stringify({ expectedVersion: task.version });
      return request('/' + encodeURIComponent(task.taskId) + '/' + action,body,undefined,undefined,signal,body);
    },
  };
}
