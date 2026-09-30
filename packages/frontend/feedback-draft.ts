import { ref, onScopeDispose, getCurrentScope } from 'vue';
import { prefillRa, type RaArtifact } from './ra-candidates';
import { backendRequest } from './session';
import { sessionEpoch } from './session';
import { careApi, localInput, offsetTime, type Facts, type Feedback, type Occurrence, type FollowUp } from './care';
import type { PatientMedication } from './contracts';
export interface FeedbackDraftInput { raEnabled?:boolean; occurrence?:Occurrence; record?:Feedback; followUp?:FollowUp; medications:PatientMedication[] }
export function useFeedbackDraft(props: FeedbackDraftInput) {
const epoch = sessionEpoch.value;
const capture=ref<{taskId:string;version:number;kind:'VOICE'|'DEVICE'}|null>(null);
const api=careApi(),busy=ref(false),error=ref(''),rawText=ref(props.record?.rawText??''),time=ref(localInput(props.record?.occurredAt??new Date().toISOString())),reason=ref(''),reviewed=ref(false);
const original=props.record?.confirmedFacts;
const facts=ref<Facts>(original?JSON.parse(JSON.stringify(original)):{medications:(props.occurrence?.medications??[]).map(m=>({medicationId:m.medicationId,executionType:'UNKNOWN',occurredAt:new Date().toISOString()})),symptoms:[],explicitNoSymptoms:null,glucose:[],bloodPressure:[],meals:[]});
// Preserve each original measurement time on revisions; new rows receive an explicit editable time.
const toLocal=()=>{for(const group of ['medications','symptoms','glucose','bloodPressure','meals'] as const)for(const f of facts.value[group])f.occurredAt=localInput(f.occurredAt);};toLocal();
const symptomState=ref(original?.explicitNoSymptoms===true?'none':original?.symptoms.length?'present':'unknown');
const linkedOccurrence=props.occurrence??props.record?.reminder;
const choices=linkedOccurrence?.followUpId?props.medications:linkedOccurrence?.medications.map(m=>({id:m.medicationId,genericName:m.genericName}))??props.medications;
function add(group:'glucose'|'bloodPressure'|'symptoms'|'meals'){
  const occurredAt=time.value;
  if(group==='glucose')facts.value.glucose.push({value:0,unit:'mmol/L',occurredAt});
  if(group==='bloodPressure')facts.value.bloodPressure.push({systolic:0,diastolic:0,unit:'mmHg',occurredAt});
  if(group==='symptoms'){symptomState.value='present';facts.value.symptoms.push({code:'',severity:0,occurredAt});}
  if(group==='meals')facts.value.meals.push({mealType:'UNKNOWN',intakeLevel:'UNKNOWN',occurredAt});
}
let pending:{body:string;key:string}|null=null;
let alive=true, raText:string|null=null,raArtifact:RaArtifact|null=null,raEnabled:boolean|undefined=props.raEnabled;
let raAbort:AbortController|null=null;
if(getCurrentScope())onScopeDispose(()=>{alive=false;raAbort?.abort();});
async function prepareCandidates():Promise<boolean>{
  if(!rawText.value.trim()){raText=null;raArtifact=null;return false;}
  if(raText===rawText.value)return false;
  const text=rawText.value, before=JSON.stringify(facts.value),state=symptomState.value;
  const abort=new AbortController();raAbort=abort;const timeout=setTimeout(()=>abort.abort(),35000);
  try{
    if(raEnabled===undefined)raEnabled=(await backendRequest<{raCandidates?:boolean}>('/capabilities',{signal:abort.signal})).raCandidates===true;
    if(!raEnabled)return false;
    const current=await api<{inputRevision:number}>('/analysis/latest',{signal:abort.signal});
    const artifact=await api<RaArtifact>('/ra/candidates',{method:'POST',signal:abort.signal,headers:{'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({rawText:text,referenceTime:new Date().toISOString(),timezone:'Asia/Shanghai',inputRevision:current.inputRevision,recordId:props.record?.recordId??null,recordRevision:props.record?.revisionId??null})});
    if(!alive||epoch!==sessionEpoch.value||text!==rawText.value||before!==JSON.stringify(facts.value)||state!==symptomState.value)throw new Error('草稿或会话已改变，候选未应用');
    if(artifact.state!=='READY')throw new Error('候选尚未完成，请重新生成或手工填写');
    raText=text;raArtifact=artifact;
    facts.value=prefillRa(facts.value,artifact.result.candidates,choices,localInput);
    reviewed.value=false;
    const subjects:Record<string,string>={SELF:'本人',OTHER:'他人',UNKNOWN:'主体待核实'},polarities:Record<string,string>={AFFIRMED:'肯定描述',NEGATED:'否定描述',UNCERTAIN:'尚不确定'};
    const hints=artifact.result.candidates.map(c=>`${c.quote??''}（${subjects[c.subject]??'待核实'}，${polarities[c.polarity]??'待核实'}；时间：${c.timeHint||'待确认'}）`).join('；');
    error.value=`${artifact.result.generationMode==='DEEPSEEK'?'模型候选':'本地规则候选'}已生成，尚未保存。${hints}。请核对原表单，补齐空白时间和症状程度，再勾选核对并确认保存。`;
    return true;
  }catch(e){
    if(!alive||epoch!==sessionEpoch.value)throw e;
    raText=text;raArtifact=null;reviewed.value=false;
    error.value=`候选未应用，草稿已保留。请人工填写核对后再次确认保存。${String(e)}`;
    return true;
  }finally{clearTimeout(timeout);if(raAbort===abort)raAbort=null;}
}
async function save(){if(busy.value)return;busy.value=true;error.value='';try{
  if (!alive || epoch !== sessionEpoch.value) throw new Error('会话已改变，请重新打开反馈');
  if(await prepareCandidates())return;
  if(raArtifact&&!reviewed.value)throw new Error('请重新核对候选并勾选确认');
  const confirmedFacts:Facts=JSON.parse(JSON.stringify(facts.value));confirmedFacts.explicitNoSymptoms=symptomState.value==='none'?true:symptomState.value==='present'?false:null;
  if(symptomState.value!=='present')confirmedFacts.symptoms=[];
  for(const group of ['medications','symptoms','glucose','bloodPressure','meals'] as const)for(const f of confirmedFacts[group])f.occurredAt=offsetTime(f.occurredAt);
  const body=JSON.stringify({rawText:rawText.value,source:props.record?.source??(props.occurrence?'REMINDER':'MANUAL'),occurredAt:offsetTime(time.value),occurrenceId:props.record?.occurrenceId??props.occurrence?.occurrenceId??null,followUpId:props.record?.followUpId??props.followUp?.followUpId??null,...(props.followUp?{expectedFollowUpVersion:props.followUp.version}:{}),...(capture.value?{captureTaskId:capture.value.taskId,captureVersion:capture.value.version}:{}),...(raArtifact?{raArtifactId:raArtifact.artifactId,raArtifactHash:raArtifact.artifactHash}:{}),confirmedFacts,textFactsReviewed:reviewed.value,...(props.record?{expectedVersion:props.record.version,changeReason:reason.value}:props.occurrence?{expectedVersion:props.occurrence.version}:{})});
  if(pending?.body!==body)pending={body,key:crypto.randomUUID()};
  const saved=await api<Feedback>(props.record?`/feedback-records/${props.record.recordId}/revisions`:'/feedback-records',{method:'POST',body,headers:{'Idempotency-Key':pending!.key}});return saved;
 }catch(e){error.value=`保存未确认，草稿已保留；可重试。${String(e)}。版本冲突需关闭并重新读取详情。`;}finally{busy.value=false;}}

return { busy, error, rawText, time, reason, reviewed, facts, symptomState, choices, capture, add, save };
}
