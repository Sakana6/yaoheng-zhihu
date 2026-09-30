import { computed, ref, watch, type Ref } from 'vue';
import { apiBaseUrl, backendRequest, clearSession, selectedPatient, session, sessionEpoch } from './session';
import { careItems } from './care';
export interface ReportArtifact { reportId:string; snapshotId:string; reportType:string; templateVersion:string; status:string; attempt:number; errorCode:string|null; checksum:string|null }
/** A preview and its download always use the same verified server artifact. */
export function useReportState(snapshotId: Ref<string>) {
  const patientId=selectedPatient.value?.id, epoch=sessionEpoch.value;
  const reports=ref<ReportArtifact[]>([]), type=ref('DOCTOR'), html=ref(''), error=ref(''), busy=ref(false), loading=ref(false);
  const report=computed(()=>reports.value.find(r=>r.snapshotId===snapshotId.value&&r.reportType===type.value)??null);
  let alive=true, sequence=0, loadSequence=0, objectUrl:string|null=null;
  let attempt:{body:string;key:string}|null=null;
  const valid=()=>alive&&epoch===sessionEpoch.value&&patientId===selectedPatient.value?.id;
  const api=<T>(path:string,init?:RequestInit)=> { if(!valid()||!patientId)throw Error('患者或会话已改变');return backendRequest<T>('/patients/'+patientId+path,init); };
  function clearContent(){sequence++;html.value='';if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}}
  const stop=watch(()=>[sessionEpoch.value,snapshotId.value,type.value,report.value?.reportId,report.value?.status,report.value?.checksum],clearContent,{flush:'sync'});
  async function load(){if(!valid())return;const seq=++loadSequence;loading.value=true;try{const rows=await careItems<ReportArtifact>(api,'/reports');if(valid()&&seq===loadSequence){reports.value=rows;error.value='';}}catch(e){if(valid()&&seq===loadSequence)error.value=String(e);}finally{if(valid()&&seq===loadSequence)loading.value=false;}}
  async function generate(){if(!valid()||busy.value||!snapshotId.value)return;busy.value=true;error.value='';clearContent();const body=JSON.stringify({snapshotId:snapshotId.value,reportType:type.value});if(attempt?.body!==body)attempt={body,key:crypto.randomUUID()};try{await api('/reports',{method:'POST',body,headers:{'Idempotency-Key':attempt.key}});if(!valid())return;attempt=null;await load();}catch(e){if(valid())error.value=String(e);}finally{if(valid())busy.value=false;}}
  async function preview(){const item=report.value;if(!valid()||busy.value||item?.status!=='SUCCESS')return;clearContent();const seq=sequence;busy.value=true;error.value='';try{
    const response=await fetch(apiBaseUrl+'/patients/'+patientId+'/reports/'+encodeURIComponent(item.reportId)+'/content',{headers:{Authorization:'Bearer '+session.value?.token}});
    if(!valid()||seq!==sequence)return;
    if(response.status===401){clearSession();throw Error('登录已失效');}
    if(!response.ok)throw Error('报告内容读取失败 ('+response.status+')');
    const content=await response.text();
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(content)))).map(x=>x.toString(16).padStart(2,'0')).join('');
    if(!valid()||seq!==sequence)return;
    if(!item.checksum||digest!==item.checksum)throw Error('报告校验失败，请刷新任务后重试');
    html.value=content;
  }catch(e){if(valid()&&seq===sequence)error.value=String(e);}finally{if(valid())busy.value=false;}}
  function download(){if(!valid()||!html.value||report.value?.status!=='SUCCESS')return;if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=URL.createObjectURL(new Blob([html.value],{type:'text/html;charset=utf-8'}));const a=document.createElement('a');a.href=objectUrl;a.download=report.value.reportId+'.html';a.click();URL.revokeObjectURL(objectUrl);objectUrl=null;}
  function dispose(){alive=false;stop();clearContent();loadSequence++;busy.value=false;}
  return {reports,type,report,html,error,busy,loading,load,generate,preview,download,dispose};
}
