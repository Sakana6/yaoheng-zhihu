import { computed, watch } from 'vue';
import type { RouteLocationNormalizedLoaded, Router } from 'vue-router';
import { patients, selectedPatient, selectPatient, session, useMock } from '../../../../packages/frontend/session';

export function doctorPatientRoute(path: string) {
  const match = path.match(/^\/patients\/([^/]+)(\/summary)?\/?$/);
  if (!match) return null;
  const id = /^\d+$/.test(match[1]) ? Number(match[1]) : NaN;
  return { id: Number.isSafeInteger(id) && id > 0 ? id : null, summary: !!match[2] };
}
/** The URL authorizes detail mounting; the header selector navigates, never silently retargets a URL. */
export function useDoctorRouting(route: RouteLocationNormalizedLoaded, router: Router) {
  let syncing = false;
  const target = computed(() => doctorPatientRoute(route.path));
  const allowed = computed(() => !target.value || (target.value.id !== null && patients.value.some(p => p.id === target.value!.id)));
  watch([() => route.path, patients, () => session.value?.token], () => {
    if (useMock || !session.value || !target.value || !allowed.value || selectedPatient.value?.id === target.value.id) return;
    syncing = true; selectPatient(target.value.id!); syncing = false;
  }, { immediate: true, flush: 'sync' });
  watch(() => selectedPatient.value?.id, (id, previous) => {
    if (useMock || syncing || !session.value || id == null || !target.value || !allowed.value || target.value.id === id) return;
    // Login assigns the first patient only after all authorization pages arrive.
    // A deep link takes precedence on that first selection; later changes are user navigation.
    if (previous == null) { syncing = true; selectPatient(target.value.id!); syncing = false; return; }
    if (patients.value.some(p => p.id === id)) {const query={...route.query};delete query.runId;delete query.snapshotId;void router.replace({path:'/patients/'+id+(target.value.summary?'/summary':''),query});}
  }, { flush: 'sync' });
  watch([()=>route.query.care,()=>route.path,()=>selectedPatient.value?.id,()=>session.value?.token],()=>{
    if(useMock||!session.value||!allowed.value||!selectedPatient.value)return;
    const care=route.query.care;if(typeof care!=='string')return;
    const id=selectedPatient.value.id;
    const paths:Record<string,string>={home:'/patients',medications:'/medications',records:'/follow-ups',risk:'/patients/'+id+'/summary',profile:'/patients/'+id};
    if(!paths[care])return;const query={...route.query};delete query.care;
    void router.replace({path:paths[care],query});
  },{immediate:true,flush:'post'});
  const ready = computed(() => allowed.value && (!target.value || target.value.id === selectedPatient.value?.id));
  return { allowed, ready };
}
