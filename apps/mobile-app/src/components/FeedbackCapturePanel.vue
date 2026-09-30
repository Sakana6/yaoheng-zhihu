<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue';
import { useCaptureApi, type CaptureTask, type DeviceSession } from '../../../../packages/frontend/capture-api';
import { createAudioRecorder } from '../../../../packages/frontend/audio-recorder';
import { createDeviceReplay } from '../../../../packages/frontend/device-replay';
import { useVoiceCapture } from '../../../../packages/frontend/voice-capture';
const emit=defineEmits<{apply:[task:CaptureTask]}>();
const props=defineProps<{locked:boolean;deviceAllowed:boolean;appliedId?:string}>();
const api=useCaptureApi(),voice=useVoiceCapture(),{task,message}=voice,recording=ref(false),connectionBusy=ref(false);
const busy=computed(()=>voice.busy.value||connectionBusy.value);
const device=ref<DeviceSession>({deviceId:'local-replay',state:'DISCONNECTED',version:0,sourceVersion:'replay-v1'});
const packets=ref(''),results=ref<Array<{index:number;task?:CaptureTask;error?:string}>>([]),replaying=ref(false);
let alive=true;
let connectionAbort:AbortController|null=null,eventAbort:AbortController|null=null;
async function transcribe(audio:Blob){
  if(!alive||props.locked||props.appliedId||busy.value)return;
  await voice.transcribe(audio);
}
const recorder=createAudioRecorder(audio=>void transcribe(audio),error=>message.value=error,value=>recording.value=value);
function cancel(){voice.cancel();recorder.cancel();connectionAbort?.abort();}
async function audioFile(event:Event){const input=event.target as HTMLInputElement;const file=input.files?.[0];if(file)await transcribe(file);input.value='';}
async function connection(operation:'connect'|'disconnect'){
  if(!alive||props.locked||busy.value||recording.value||replaying.value)return;connectionBusy.value=true;
  const abort=new AbortController();connectionAbort=abort;const timer=setTimeout(()=>abort.abort(),20000);
  try{const fresh=await api.device(device.value.deviceId,abort.signal);if(!alive||abort.signal.aborted)return;if(operation==='connect')device.value={...fresh,state:'CONNECTING'};const result=await api.connection(fresh,operation,abort.signal);if(alive&&!abort.signal.aborted){device.value=result;message.value='软件回放连接：'+device.value.state;}}
  catch(e){if(alive){device.value={...device.value,state:'ERROR'};message.value=String(e);}}finally{clearTimeout(timer);connectionBusy.value=false;}
}
const replay=createDeviceReplay(async event=>{const abort=new AbortController();eventAbort=abort;const timer=setTimeout(()=>abort.abort(),20000);try{return await api.deviceEvent(event,abort.signal);}finally{clearTimeout(timer);}},(index,value)=>{if(!alive)return;results.value.push(value instanceof Error?{index,error:value.message}:{index,task:value});});
function loadExample(){const date=new Date().toISOString(),id=crypto.randomUUID();packets.value=JSON.stringify([
  {deviceId:'local-replay',eventId:id+'-bg',observedAt:date,metric:'GLUCOSE',value:108,unit:'mg/dL',sourceVersion:'replay-v1'},
  {deviceId:'local-replay',eventId:id+'-lid',observedAt:date,metric:'LID_OPEN',value:1,unit:'event',sourceVersion:'replay-v1'},
],null,2);}
async function startReplay(){try{const events=JSON.parse(packets.value);if(!Array.isArray(events)||events.some(e=>!e||typeof e!=='object'||Array.isArray(e)))throw Error('请输入报文对象数组');replay.load(events);results.value=[];await resume();}catch(e){message.value=String(e);}}
async function resume(){if(!alive||props.locked||busy.value||recording.value||replaying.value||device.value.state!=='CONNECTED')return;replaying.value=true;try{await replay.resume();}finally{replaying.value=false;}}
async function reject(){if(props.locked||props.appliedId||recording.value)return;await voice.reject();}
function apply(value:CaptureTask){if(!alive||busy.value||recording.value||props.locked||props.appliedId||value.status!=='CANDIDATE_READY')return;emit('apply',value);message.value='已应用到原反馈草稿，请核对后点击原确认保存按钮。';}
onBeforeUnmount(()=>{alive=false;voice.dispose();recorder.cancel();replay.pause();connectionAbort?.abort();eventAbort?.abort();});
</script>

<template>
  <details class="capture-assist">
    <summary>语音 / 设备辅助录入（可选）</summary>
    <p>候选不会自动完成提醒；原音频不落盘。</p>
    <div class="capture-actions">
      <button type="button" :disabled="locked||busy||recording||!!appliedId" @click="recorder.start()">开始录音</button>
      <button v-if="recording" type="button" @click="recorder.stop()">停止并转写</button>
      <button v-if="recording||busy" type="button" @click="cancel">取消</button>
    </div>
    <label>本地音频 / 合成回放<input type="file" accept="audio/wav,audio/webm,audio/ogg" :disabled="locked||busy||recording||!!appliedId" @change="audioFile" /></label>
    <p v-if="recording" role="status">正在录音，最长 60 秒…</p>
    <template v-if="task?.status==='CANDIDATE_READY'">
      <p>{{task.result?.text}} <small v-if="task.result?.engine==='SYNTHETIC_REPLAY'">（合成回放）</small></p>
      <div class="capture-actions"><button type="button" :disabled="locked||busy||recording||!!appliedId" @click="apply(task)">应用转写到原描述</button><button type="button" :disabled="locked||busy||recording||!!appliedId" @click="reject">拒绝此转写</button></div>
    </template>
    <details v-if="deviceAllowed"><summary>设备协议回放</summary>
      <p>连接状态：{{device.state}}；仅处理测量候选。</p>
      <div class="capture-actions"><button type="button" :disabled="locked||busy||replaying" @click="connection('connect')">连接回放器</button><button type="button" :disabled="locked||busy||replaying" @click="connection('disconnect')">断开</button><button type="button" :disabled="locked||replaying" @click="loadExample">载入合成报文</button></div>
      <label>回放报文<textarea v-model="packets" rows="4" :disabled="locked||replaying" /></label>
      <div class="capture-actions"><button type="button" :disabled="locked||busy||replaying||device.state!=='CONNECTED'" @click="startReplay">开始回放</button><button v-if="replaying" type="button" @click="replay.pause()">暂停</button><button v-else type="button" :disabled="locked||device.state!=='CONNECTED'" @click="resume">继续</button></div>
      <div v-for="row in results" :key="row.index"><p>{{row.index+1}} · {{row.error??row.task?.status}} {{row.task?.failureCode}}</p><button v-if="row.task?.status==='CANDIDATE_READY'" type="button" :disabled="locked||!!appliedId" @click="apply(row.task)">应用测量到原反馈</button></div>
    </details>
    <p v-if="message" role="status" aria-live="polite">{{message}}</p>
  </details>
</template>

<style scoped>
.capture-assist{font:inherit;color:inherit;max-width:100%;margin:8px 0;}
summary{cursor:pointer;font-weight:600;}
p{font-size:13px;line-height:1.6;overflow-wrap:anywhere;}
.capture-actions{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0;}
label{display:grid;gap:6px;font-size:13px;margin:8px 0;}
input,textarea{box-sizing:border-box;max-width:100%;width:100%;min-width:0;border:1px solid #dce8e0;border-radius:10px;padding:10px;font:inherit;background:#fff;color:inherit;}
button{border:1px solid #dce8e0;border-radius:10px;padding:8px 12px;background:#f2f8f4;color:#2b6855;font:inherit;cursor:pointer;}
button:disabled{opacity:.5;cursor:default;}
</style>
