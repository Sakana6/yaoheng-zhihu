package com.yaoheng.backend;

import com.sun.net.httpserver.HttpExchange;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.net.URLDecoder;
import java.util.Set;
import java.util.Objects;
import static com.yaoheng.backend.R1Service.*;

/** A narrow binary ingress; authorization always precedes reading request bytes. */
final class CaptureHttp {
    final DatabaseRepository db;final R1Service identity;final CaptureService capture;final MultimodalCapture multimodal;
    CaptureHttp(DatabaseRepository db){this.db=db;identity=new R1Service(db);capture=new CaptureService(db);multimodal=new MultimodalCapture(db);}
    boolean handle(HttpExchange exchange)throws IOException{
        String path=exchange.getRequestURI().getPath();
        if(!path.matches("/api/patients/[0-9]+/capture-tasks(?:/.*)?"))return false;
        try{
            if(!db.isReady())throw new Failure(503,"DATABASE_NOT_READY");
            String[] segments=path.split("/");int patient;
            try{patient=Integer.parseInt(segments[3]);}catch(NumberFormatException e){throw new Failure(400,"INVALID_PATIENT");}
            String method=exchange.getRequestMethod();String auth=exchange.getRequestHeaders().getFirst("Authorization");
            Actor actor=identity.authenticate(auth!=null&&auth.startsWith("Bearer ")?auth.substring(7):"");
            identity.authorize(actor,patient,!method.equals("GET"));
            String suffix=path.substring(("/api/patients/"+patient+"/capture-tasks").length());
            String key=exchange.getRequestHeaders().getFirst("Idempotency-Key");
            Object result;
            if(suffix.equals("/voice")&&method.equals("POST")){
                if(key==null||!key.matches("[A-Za-z0-9_-]{8,128}"))throw new Failure(400,"IDEMPOTENCY_KEY_REQUIRED");
                result=multimodal.voice(actor,patient,CaptureStore.bounded(exchange.getRequestBody(),2*1024*1024),Objects.toString(exchange.getRequestHeaders().getFirst("Content-Type"),""),key);
            }else if(suffix.equals("/device-events")&&method.equals("POST")){
                result=multimodal.event(actor,patient,body(exchange),key);
            }else if(suffix.matches("/devices/[A-Za-z0-9_-]{1,64}")&&Set.of("GET","POST").contains(method)){
                String device=suffix.split("/")[2];result=method.equals("GET")?multimodal.device(patient,device):multimodal.connection(actor,patient,device,body(exchange),key);
            }else if(suffix.isEmpty()&&method.equals("POST")){
                if(key==null||!key.matches("[A-Za-z0-9_-]{8,128}"))throw new Failure(400,"IDEMPOTENCY_KEY_REQUIRED");
                String length=exchange.getRequestHeaders().getFirst("Content-Length");
                if(length!=null)try{if(Long.parseLong(length)>CaptureStore.MAX_BYTES)throw new Failure(413,"CAPTURE_TOO_LARGE");}catch(NumberFormatException e){throw new Failure(400,"INVALID_CONTENT_LENGTH");}
                String name;try{name=URLDecoder.decode(exchange.getRequestHeaders().getFirst("X-File-Name"),StandardCharsets.UTF_8);}catch(Exception e){throw new Failure(422,"INVALID_CAPTURE_FILENAME");}
                byte[] bytes=CaptureStore.bounded(exchange.getRequestBody(),CaptureStore.MAX_BYTES);
                result=capture.upload(actor,patient,bytes,name,exchange.getRequestHeaders().getFirst("Content-Type"),key);
            }else if(suffix.equals("/text")&&method.equals("POST")){
                result=capture.textTask(actor,patient,body(exchange),key);
            }else if(suffix.isEmpty()&&method.equals("GET")){result=capture.listTasks(patient);}
            else if(suffix.matches("/cap_[a-f0-9-]{36}")&&method.equals("GET")){result=capture.get(patient,suffix.substring(1));}
            else if(suffix.matches("/cap_[a-f0-9-]{36}/content")&&method.equals("GET")){
                String id=suffix.split("/")[1];byte[] bytes=capture.download(actor,patient,id);
                exchange.getResponseHeaders().set("Content-Type",capture.get(patient,id).path("mimeType").asText());
                exchange.getResponseHeaders().set("X-Content-Type-Options","nosniff");
                exchange.getResponseHeaders().set("Content-Disposition","attachment; filename=capture-image");
                exchange.getResponseHeaders().set("Cache-Control","no-store");
                exchange.sendResponseHeaders(200,bytes.length);try(var out=exchange.getResponseBody()){out.write(bytes);}return true;
            }else if(suffix.matches("/cap_[a-f0-9-]{36}/(process|cancel|reject|purge)")&&method.equals("POST")){
                String[] parts=suffix.split("/");var input=body(exchange);
                result=parts[2].equals("process")?capture.process(actor,patient,parts[1],input,key):capture.action(actor,patient,parts[1],parts[2],input,key);
                if(parts[2].equals("purge")){var current=capture.get(patient,parts[1]);
                    if(current.path("kind").asText().equals("IMAGE"))capture.store.delete(patient,current.path("sha256").asText());}
            }else throw new Failure(404,"CAPTURE_ROUTE_NOT_FOUND");
            send(exchange,200,JSON.createObjectNode().put("code",0).put("message","ok").set("data",JSON.valueToTree(result)).toString());
        }catch(Failure e){send(exchange,e.status,JSON.createObjectNode().put("code",e.status).put("message",e.getMessage()).toString());}
        catch(java.sql.SQLException e){send(exchange,503,"{\"code\":503,\"message\":\"DATABASE_OPERATION_FAILED\"}");}
        return true;
    }
    private static com.fasterxml.jackson.databind.JsonNode body(HttpExchange e)throws IOException{
        return parse(new String(CaptureStore.bounded(e.getRequestBody(),16384),StandardCharsets.UTF_8));
    }
    private static void send(HttpExchange e,int status,String body)throws IOException{
        byte[] bytes=body.getBytes(StandardCharsets.UTF_8);e.getResponseHeaders().set("Cache-Control","no-store");
        e.sendResponseHeaders(status,bytes.length);try(var out=e.getResponseBody()){out.write(bytes);}
    }
}
