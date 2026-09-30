/** Bounded microphone lifecycle. No upload, transcription or medication decision here. */
export function createAudioRecorder(onAudio: (audio: Blob) => void, onError: (error: string) => void, onState: (recording: boolean) => void) {
  let media: MediaRecorder | null=null,stream: MediaStream|null=null,timer: ReturnType<typeof setTimeout>|undefined,epoch=0;
  function release(){if(timer)clearTimeout(timer);stream?.getTracks().forEach(t=>t.stop());stream=null;onState(false);}
  function cancel(){epoch++;if(media?.state==='recording')media.stop();media=null;release();}
  return {
    async start(){
      cancel();const current=epoch;
      try{
        if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw Error('当前环境无法录音，请使用文字输入或本地回放文件');
        const acquired=await navigator.mediaDevices.getUserMedia({audio:true});
        if(current!==epoch){acquired.getTracks().forEach(t=>t.stop());return;}
        stream=acquired;media=new MediaRecorder(stream);const recorder=media,parts:Blob[]=[];let size=0;
        recorder.ondataavailable=e=>{if(current!==epoch)return;size+=e.data.size;
          if(size>2*1024*1024){cancel();onError('录音超过 2 MiB，请缩短后重录');return;}parts.push(e.data);};
        recorder.onerror=()=>{if(current!==epoch)return;cancel();onError('录音失败，可继续文字输入');};
        recorder.onstop=()=>{if(current!==epoch)return;release();onAudio(new Blob(parts,{type:recorder.mimeType}));};
        recorder.start(250);onState(true);timer=setTimeout(()=>{if(recorder.state==='recording')recorder.stop();},60000);
      }catch(e){if(current===epoch){release();onError('麦克风不可用或权限被拒绝。'+String(e));}}
    },
    stop(){if(media?.state==='recording')media.stop();},cancel,
  };
}
