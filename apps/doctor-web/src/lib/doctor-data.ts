import { ref, shallowRef } from 'vue';
import { backendRequest, selectedPatient, sessionEpoch } from '../../../../packages/frontend/session';
import { careItems, type Feedback } from '../../../../packages/frontend/care';
import type { PatientMedication } from '../../../../packages/frontend/contracts';

export interface DoctorProfile { id:number; version:number; name:string; gender:string; birthday:string; livingStatus:string; digitalAbilityLevel:string; diseaseTags?:string[]; createdAt?:string }
/** Mount-scoped, read-only resources. No 30-second shared cache or alternate analysis result source. */
export function useDoctorData() {
  const patientId=selectedPatient.value?.id, epoch=sessionEpoch.value;
  let alive=true;
  const valid=()=>alive && epoch===sessionEpoch.value;
  const api=<T>(path:string)=>{
    if(!valid() || !patientId)return Promise.reject(new Error('患者或会话已改变'));
    return backendRequest<T>('/patients/'+patientId+path);
  };
  function resource<T>(initial:T) {
    const value=shallowRef(initial), error=ref(''), loading=ref(false); let sequence=0;
    async function load(fetch:()=>Promise<T>,clear=false) {
      if(!valid())return;const seq=++sequence;loading.value=true;error.value='';if(clear)value.value=initial;
      try {const next=await fetch();if(valid()&&seq===sequence)value.value=next;}
      catch(e){if(valid()&&seq===sequence)error.value='读取失败，请重试。'+String(e);}
      finally{if(valid()&&seq===sequence)loading.value=false;}
    }
    return {value,error,loading,load};
  }
  const profile=resource<DoctorProfile|null>(null),medications=resource<PatientMedication[]>([]),timeline=resource<Feedback[]>([]);
  const loadProfile=()=>profile.load(()=>api<DoctorProfile>('/profile'));
  const loadMedications=()=>medications.load(async()=> (await api<{medications:PatientMedication[]}>('/medications?history=true')).medications);
  const loadTimeline=(date:string)=>timeline.load(()=>careItems<Feedback>(api,'/daily-events?date='+encodeURIComponent(date)),true);
  return {profile,medications,timeline,loadProfile,loadMedications,loadTimeline,dispose(){alive=false;}};
}
