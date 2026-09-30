import { ref } from 'vue';

const configured = import.meta.env.VITE_DATA_SOURCE;
const legacy = import.meta.env.VITE_USE_MOCK;
if (configured && !['demo', 'backend'].includes(configured)) throw new Error('Invalid VITE_DATA_SOURCE');
if (configured && legacy && (configured === 'demo') !== (legacy !== 'false')) throw new Error('Conflicting data source configuration');
export const useMock = configured ? configured === 'demo' : legacy ? legacy !== 'false' : false;
export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api';
export const session = ref<{ token: string; userId: number; role: string } | null>(null);
export const selectedPatient = ref<{ id: number; name: string } | null>(null);
export const sessionEpoch = ref(0);
export const patients = ref<Array<{ id: number; name: string }>>([]);
export function clearSession() {
  session.value = null; selectedPatient.value = null; patients.value = []; sessionEpoch.value++;
  // Remove obsolete tokens; never migrate demo data into the backend environment.
  if (typeof window !== 'undefined') window.localStorage.removeItem('auth_token');
}
export function selectPatient(id: number) {
  selectedPatient.value = patients.value.find(p => p.id === id) ?? null;
  sessionEpoch.value++;
}
export async function backendRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const epoch = sessionEpoch.value;
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (session.value) headers.set('Authorization', `Bearer ${session.value.token}`);
  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers });
  const payload = await response.json();
  if (epoch !== sessionEpoch.value) throw new Error('会话已改变，请重新读取');
  if (response.status === 401) clearSession();
  if (!response.ok || payload.code !== 0) throw new Error(`${payload.message ?? '请求失败'} (${response.status})`);
  return payload.data as T;
}
export async function login(mobile: string, password: string) {
  clearSession();
  const epoch = sessionEpoch.value;
  session.value = await backendRequest('/auth/password-login', { method: 'POST', body: JSON.stringify({ mobile, password }) });
  try {
    let cursor: string | null = null;
    do {
      const page: { items: Array<{ id: number; name: string }>; nextCursor: string | null } = await backendRequest(`/patients?limit=100${cursor ? `&cursor=${cursor}` : ''}`);
      patients.value.push(...page.items); cursor = page.nextCursor;
    } while (cursor);
    selectedPatient.value = patients.value[0] ?? null;
  } catch (e) { if (epoch === sessionEpoch.value) clearSession(); throw e; }
}
export async function logout() {
  const token = session.value?.token;
  try { await backendRequest('/auth/logout', { method: 'POST' }); }
  finally { if (token === session.value?.token) clearSession(); }
}
export async function refreshPatients() {
  const items:Array<{id:number;name:string}>=[];let cursor:string|null=null;
  do {const page:{items:Array<{id:number;name:string}>;nextCursor:string|null}=await backendRequest(`/patients?limit=100${cursor?`&cursor=${cursor}`:''}`);items.push(...page.items);cursor=page.nextCursor;}while(cursor);
  patients.value=items;
  if(!items.some(p=>p.id===selectedPatient.value?.id))selectPatient(items[0]?.id??0);
}
