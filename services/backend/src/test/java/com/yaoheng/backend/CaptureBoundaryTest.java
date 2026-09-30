package com.yaoheng.backend;
import java.util.*;
import static com.yaoheng.backend.R1Service.*;
public final class CaptureBoundaryTest {
    static void require(boolean b){if(!b)throw new AssertionError();}
    public static void main(String[] args){
        var normal=new MedicationNormalizer();
        require(normal.candidates("  ＭＥＴＦＯＲＭＩＮ  ").path("candidates").get(0).path("genericName").asText().equals("二甲双胍"));
        require(normal.candidates("二甲双瓜").path("candidates").get(0).path("confidenceLevel").asText().equals("LOW"));
        require(normal.candidates("完全未知XYZ").path("unknown").asBoolean());
        require(normal.candidates("代文").path("vectorStatus").asText().equals("DISABLED"));
        var failure=new MedicationNormalizer(text->{throw new IllegalStateException();});
        require(failure.candidates("代文").path("candidates").size()==1);
        require(failure.candidates("代文").path("vectorStatus").asText().equals("RULE_FALLBACK"));
        var vector=new MedicationNormalizer(text->List.of(JSON.createObjectNode().put("code","LOCAL_VALSARTAN").put("genericName","untrusted").put("score",.9),JSON.createObjectNode().put("code","unknown-code").put("score",1)));
        var hits=vector.candidates("XYZ").path("candidates");require(hits.size()==1&&hits.get(0).path("genericName").asText().equals("缬沙坦"));
        try{CaptureStore.validate(new byte[10],"../bad.png","image/png");throw new AssertionError();}catch(Failure e){require(e.status==422);}
        if(System.getenv().getOrDefault("CAPTURE_OCR_MODE","disabled").equals("disabled")){
            try{LocalOcrAdapter.configured().recognize(new byte[1]);throw new AssertionError();}catch(Failure e){require(e.getMessage().equals("OCR_ENGINE_UNAVAILABLE"));}
        }
        if(System.getenv().getOrDefault("CAPTURE_VOICE_MODE","disabled").equals("disabled")){
            try{LocalVoiceAdapter.configured().transcribe(new byte[1]);throw new AssertionError();}catch(Failure e){require(e.getMessage().equals("VOICE_ENGINE_UNAVAILABLE"));}
        }
        System.out.println("PASS capture normalization: unicode/exact/fuzzy/unknown, default disabled vector, validated optional recall and fallback");
    }
}
