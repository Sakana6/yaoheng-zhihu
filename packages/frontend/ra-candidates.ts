import type { Facts } from './care';
export interface RaCandidate { candidateId:string;kind:string;quote?:string;timeHint?:string;payload:Record<string,unknown>;eligibleForPrefill:boolean;anchor:{precision:string;start:string|null;future:boolean};subject:string;polarity:string }
export interface RaArtifact {artifactId:string;artifactHash:string;state:string;inputRevision:number;result:{generationMode:string;fallbackReason?:string;candidates:RaCandidate[]}}
/** Fill only empty groups. Unknown candidate times remain blank for explicit user entry. */
export function prefillRa(facts:Facts, candidates:RaCandidate[], choices:Array<{id:number;genericName:string}>, local:(value:string)=>string):Facts {
  const result:Facts=JSON.parse(JSON.stringify(facts));
  const empty=new Set(Object.keys(facts).filter(k=>Array.isArray(facts[k as keyof Facts])&&(facts[k as keyof Facts] as unknown[]).length===0));
  for(const c of candidates){
    if(!c.eligibleForPrefill||c.subject!=='SELF'||c.polarity!=='AFFIRMED'||c.anchor.future)continue;
    const occurredAt=c.anchor.precision==='POINT'&&c.anchor.start?local(c.anchor.start):'';
    const p=c.payload;
    if(c.kind==='BG'&&empty.has('glucose'))result.glucose.push({value:Number(p.value),unit:'mmol/L',occurredAt});
    if(c.kind==='BP'&&empty.has('bloodPressure'))result.bloodPressure.push({systolic:Number(p.systolic),diastolic:Number(p.diastolic),unit:'mmHg',occurredAt});
    // No invented severity: leave original symptom controls for explicit entry.
    if(c.kind==='MEAL'&&empty.has('meals'))result.meals.push({mealType:String(p.mealType),intakeLevel:String(p.intakeLevel),occurredAt});
    if(c.kind==='ADHERENCE'&&empty.has('medications')){
      const matches=choices.filter(m=>m.genericName===p.medicineName);
      if(matches.length===1&&!result.medications.some(m=>m.medicationId===matches[0].id))result.medications.push({medicationId:matches[0].id,executionType:String(p.executionType),occurredAt});
    }
  }
  return result;
}
