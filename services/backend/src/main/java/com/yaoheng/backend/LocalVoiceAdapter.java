package com.yaoheng.backend;

import com.fasterxml.jackson.databind.node.ObjectNode;
import static com.yaoheng.backend.R1Service.*;

/** Audio stays in bounded request memory; replay never guesses from filenames. */
interface LocalVoiceAdapter {
    ObjectNode transcribe(byte[] audio);
    static LocalVoiceAdapter configured(){
        if(System.getenv().getOrDefault("CAPTURE_VOICE_MODE","disabled").equals("local"))
            return audio->CaptureInferenceClient.call(false,audio,"audio_"+CaptureStore.digest(audio));
        return audio->{
            if(!System.getenv().getOrDefault("CAPTURE_VOICE_MODE","disabled").equals("replay"))throw new Failure(503,"VOICE_ENGINE_UNAVAILABLE");
            try(var in=LocalVoiceAdapter.class.getResourceAsStream("/capture/voice-replay-v1.json")){
                var root=JSON.readTree(in);String hash=CaptureStore.digest(audio);
                for(var item:root.path("fixtures"))if(item.path("sha256").asText().equals(hash)){
                    return ((ObjectNode)item).deepCopy().put("engine","SYNTHETIC_REPLAY").put("engineVersion",root.path("version").asText());
                }
                throw new Failure(422,"VOICE_REPLAY_NO_MATCH");
            }catch(Failure e){throw e;}catch(Exception e){throw new Failure(503,"VOICE_FIXTURE_UNAVAILABLE");}
        };
    }
}
