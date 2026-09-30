import { ref } from 'vue';
import { useCaptureApi, type CaptureTask } from './capture-api';

/** Preview-only state: the existing feedback form remains the only fact writer. */
export function useVoiceCapture() {
  const api=useCaptureApi(),task=ref<CaptureTask|null>(null),busy=ref(false),message=ref('');
  let alive=true,sequence=0,retryVersion=0,controller:AbortController|null=null;
  async function transcribe(audio:Blob) {
    if(!alive||busy.value)return;
    const current=++sequence,abort=new AbortController();controller=abort;
    task.value=null;busy.value=true;message.value='正在连接本地转写服务…';
    // The isolated local decoder has a 60s hard deadline; UI must not abandon it at 20s.
    const timer=setTimeout(()=>abort.abort(),65000);
    try {
      const uploaded=await api.voice(audio,abort.signal,retryVersion);
      if(!alive||current!==sequence)return;
      const result=await api.get(uploaded.taskId,abort.signal);
      if(!alive||current!==sequence)return;
      task.value=result;retryVersion=result.version;
      message.value=result.status==='CANDIDATE_READY'?'请预览文字，可应用到原描述后修改；确认字段由你核对。':result.status==='CONFIRMED'?'该录音已经确认，请查看原记录。':'转写未完成（'+(result.failureCode??result.status)+'），请重试或使用原文字输入。';
    }catch(e){if(alive&&current===sequence)message.value='转写未完成，文字草稿保留。'+String(e);}
    finally{clearTimeout(timer);if(current===sequence)busy.value=false;}
  }
  function cancel(){sequence++;controller?.abort();task.value=null;busy.value=false;message.value='已取消本次录音/等待，未保存反馈。';}
  async function reject(){
    if(!alive||busy.value||task.value?.status!=='CANDIDATE_READY')return;
    const current=++sequence,snapshot=task.value,abort=new AbortController();controller=abort;busy.value=true;
    const timer=setTimeout(()=>abort.abort(),20000);
    try{const result=await api.action(snapshot,'reject',abort.signal);if(alive&&current===sequence){task.value=result;retryVersion=result.version;message.value='候选已拒绝，原文字输入仍可使用。';}}
    catch(e){if(alive&&current===sequence)message.value='拒绝未确认，请重试。'+String(e);}
    finally{clearTimeout(timer);if(current===sequence)busy.value=false;}
  }
  return {task,busy,message,transcribe,cancel,reject,dispose(){alive=false;cancel();}};
}
