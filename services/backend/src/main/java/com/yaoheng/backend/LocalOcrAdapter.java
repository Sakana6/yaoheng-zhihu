package com.yaoheng.backend;

import com.fasterxml.jackson.databind.node.ObjectNode;
import static com.yaoheng.backend.R1Service.*;

interface LocalOcrAdapter {
    ObjectNode recognize(byte[] image);
    default ObjectNode recognize(byte[] image,String requestId){return recognize(image);}
    static LocalOcrAdapter configured() {
        String mode=System.getenv().getOrDefault("CAPTURE_OCR_MODE","disabled");
        if(mode.equals("deepseek"))return new LocalOcrAdapter(){
            public ObjectNode recognize(byte[] image){return recognize(image,"image_"+CaptureStore.digest(image));}
            public ObjectNode recognize(byte[] image,String requestId){return CaptureInferenceClient.call(true,image,requestId);}
        };
        return image->{
            if(!mode.equals("replay"))throw new Failure(503,"OCR_ENGINE_UNAVAILABLE");
            try(var in=LocalOcrAdapter.class.getResourceAsStream("/capture/ocr-replay-v1.json")){
                var fixtures=JSON.readTree(in);String hash=CaptureStore.digest(image);
                for(var item:fixtures.path("fixtures"))if(item.path("sha256").asText().equals(hash)){
                    ObjectNode out=((ObjectNode)item).deepCopy();
                    out.put("engine","SYNTHETIC_REPLAY").put("engineVersion",fixtures.path("version").asText());return out;
                }
                throw new Failure(422,"OCR_REPLAY_NO_MATCH");
            }catch(Failure e){throw e;}catch(Exception e){throw new Failure(503,"OCR_FIXTURE_UNAVAILABLE");}
        };
    }
}
