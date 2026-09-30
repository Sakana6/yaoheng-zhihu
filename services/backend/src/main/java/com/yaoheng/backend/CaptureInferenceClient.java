package com.yaoheng.backend;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.Base64;
import static com.yaoheng.backend.R1Service.*;

/** Internal loopback only. Supplier keys and remote URLs never enter Java or the UI. */
final class CaptureInferenceClient {
    static ObjectNode call(boolean image, byte[] bytes, String requestId) {
        try {
            if(bytes.length>(image?4:2)*1024*1024)throw new Failure(413,"CAPTURE_TOO_LARGE");
            String setting=image?"AI_SERVICE_URL":"LOCAL_ASR_URL";
            URI base=URI.create(System.getenv().getOrDefault(setting,image?"http://127.0.0.1:8000":"http://127.0.0.1:8011"));
            if(!"http".equals(base.getScheme())||!("127.0.0.1".equals(base.getHost())||"[::1]".equals(base.getHost())||"::1".equals(base.getHost()))||base.getUserInfo()!=null||base.getQuery()!=null||base.getFragment()!=null||!(base.getPath().isEmpty()||base.getPath().equals("/")))throw new Failure(503,"CAPTURE_ENGINE_CONFIGURATION");
            ObjectNode input=JSON.createObjectNode().put("requestId",requestId)
                .put(image?"imageBase64":"audioBase64",Base64.getEncoder().encodeToString(bytes));
            var client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).followRedirects(HttpClient.Redirect.NEVER).build();
            var request=HttpRequest.newBuilder(base.resolve(image?"/ai/ra/ocr-candidates":"/asr/transcribe"))
                .timeout(Duration.ofSeconds(image?32:62)).header("Content-Type","application/json")
                .POST(HttpRequest.BodyPublishers.ofString(input.toString())).build();
            var response=client.send(request,HttpResponse.BodyHandlers.ofInputStream());
            byte[] data;try(var stream=response.body()){data=CaptureStore.bounded(stream,64000);}
            if(response.statusCode()!=200)throw new Failure(503,image?"OCR_ENGINE_UNAVAILABLE":"VOICE_ENGINE_UNAVAILABLE");
            var parsed=JSON.readTree(data);
            if(!parsed.isObject()||!parsed.path("text").isTextual()||parsed.path("text").asText().length()>2000||!parsed.path("requiresConfirmation").asBoolean(false)
                ||!parsed.path("engine").asText().equals(image?"DEEPSEEK":"LOCAL_SENSEVOICE")||!parsed.path("inputHash").asText().equals(CaptureStore.digest(bytes))
                ||!parsed.path("engineVersion").isTextual()||parsed.path("engineVersion").asText().length()>160)throw new Failure(503,"CAPTURE_ENGINE_INVALID_OUTPUT");
            return (ObjectNode)parsed;
        }catch(Failure e){throw e;}catch(InterruptedException e){Thread.currentThread().interrupt();throw new Failure(503,"CAPTURE_ENGINE_INTERRUPTED");}
        catch(Exception e){throw new Failure(503,"CAPTURE_ENGINE_UNAVAILABLE");}
    }
}
