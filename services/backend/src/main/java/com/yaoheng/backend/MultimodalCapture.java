package com.yaoheng.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.sql.*;
import java.util.*;
import static com.yaoheng.backend.R1Service.*;
import static com.yaoheng.backend.FlowSupport.*;

final class MultimodalCapture {
    final FlowSupport tx;final LocalVoiceAdapter voice=LocalVoiceAdapter.configured();
    MultimodalCapture(DatabaseRepository db){tx=new FlowSupport(db);}
    ObjectNode voice(Actor actor,int patient,byte[] bytes,String mime,String key)throws SQLException{
        if(bytes.length<16)throw new Failure(422,"INVALID_AUDIO");
        boolean wav=Set.of("audio/wav","audio/x-wav").contains(mime)&&new String(bytes,0,4,StandardCharsets.US_ASCII).equals("RIFF")&&new String(bytes,8,4,StandardCharsets.US_ASCII).equals("WAVE");
        boolean webm=mime.startsWith("audio/webm")&&bytes[0]==0x1a&&bytes[1]==0x45&&bytes[2]==(byte)0xdf&&bytes[3]==(byte)0xa3;
        boolean ogg=mime.startsWith("audio/ogg")&&new String(bytes,0,4,StandardCharsets.US_ASCII).equals("OggS");
        if(!wav&&!webm&&!ogg)throw new Failure(415,"AUDIO_SIGNATURE_MISMATCH");
        String hash=CaptureStore.digest(bytes);ObjectNode transcript=null;String failure=null;
        try{transcript=voice.transcribe(bytes);}catch(Failure e){failure=e.getMessage();}
        ObjectNode result=transcript;String error=failure;
        ObjectNode body=JSON.createObjectNode().put("sha256",hash).put("mime",mime);
        return tx.write(actor,patient,"capture-voice",key,body,c->{
            String existing=one(c,"select task_id from capture_task where patient_id=? and kind='VOICE' and content_hash=?",r->r.getString(1),patient,hash);
            if(existing!=null){ObjectNode old=CaptureService.task(c,patient,existing);
                if(Set.of("CONFIRMED","CANDIDATE_READY","RUNNING").contains(old.path("status").asText()))return old;
                execute(c,"update capture_task set status=?,candidate_json=?,raw_text=?,failure_code=?,version=version+1,updated_at=utc_timestamp(6) where task_id=?",error==null?"CANDIDATE_READY":"FAILED",result==null?null:result.toString(),result==null?null:result.path("text").asText(),error,existing);
                CaptureService.audit(c,actor,patient,existing,"VOICE_REUPLOAD",old.path("version").asInt()+1);return CaptureService.task(c,patient,existing);}
            String id=id("cap_");
            execute(c,"insert into capture_task(task_id,patient_id,actor_id,kind,content_hash,mime_type,byte_size,raw_text,status,candidate_json,failure_code) values(?,?,?,'VOICE',?,?,?,?,?,?,?)",id,patient,actor.userId(),hash,mime,bytes.length,result==null?null:result.path("text").asText(),error==null?"CANDIDATE_READY":"FAILED",result==null?null:result.toString(),error);
            CaptureService.audit(c,actor,patient,id,"VOICE_TRANSCRIBE_NO_AUDIO_RETAINED",1);return CaptureService.task(c,patient,id);
        });
    }
    ObjectNode device(Connection c,int patient,String device)throws SQLException{
        return one(c,"select state,version,source_version from capture_device_session where patient_id=? and device_id=?",r->JSON.createObjectNode().put("deviceId",device).put("state",r.getString(1)).put("version",r.getInt(2)).put("sourceVersion",r.getString(3)),patient,device);
    }
    ObjectNode device(int patient,String device)throws SQLException{return tx.read(c->{ObjectNode out=device(c,patient,device);return out==null?JSON.createObjectNode().put("deviceId",device).put("state","DISCONNECTED").put("version",0).put("sourceVersion","replay-v1"):out;});}
    ObjectNode connection(Actor actor,int patient,String device,JsonNode body,String key)throws SQLException{
        if(!device.matches("[A-Za-z0-9_-]{1,64}"))throw new Failure(422,"INVALID_DEVICE_ID");
        String operation=text(body,"operation",16);if(!Set.of("connect","disconnect").contains(operation))throw new Failure(422,"INVALID_DEVICE_OPERATION");
        return tx.write(actor,patient,"device-connection:"+device,key,body,c->{
            ObjectNode current=device(c,patient,device);int version=current==null?0:current.path("version").asInt();
            if(!body.path("expectedVersion").isIntegralNumber()||!body.path("expectedVersion").canConvertToInt()||body.path("expectedVersion").asInt()!=version)throw new Failure(409,"DEVICE_VERSION_CONFLICT");
            String auditId="device_"+hash(device).substring(0,32);
            String state=operation.equals("disconnect")?"DISCONNECTED":body.path("sourceVersion").asText().equals("replay-v1")?"CONNECTED":"ERROR";
            if(operation.equals("connect"))CaptureService.audit(c,actor,patient,auditId,"DEVICE_CONNECTING",version+1);
            execute(c,"insert into capture_device_session(patient_id,device_id,state,version,source_version) values(?,?,?,?,?) on duplicate key update state=values(state),version=values(version),source_version=values(source_version),updated_at=utc_timestamp(6)",patient,device,state,version+1,"replay-v1");
            CaptureService.audit(c,actor,patient,auditId,"DEVICE_"+state,version+1);return device(c,patient,device);
        });
    }
    ObjectNode event(Actor actor,int patient,JsonNode body,String key)throws SQLException{
        String device=text(body,"deviceId",64),event=text(body,"eventId",64);
        if(!device.matches("[A-Za-z0-9_-]{1,64}")||!event.matches("[A-Za-z0-9_-]{1,64}"))throw new Failure(422,"INVALID_DEVICE_EVENT_ID");
        String digest=hash(canonical(body).toString());ObjectNode proposal;String failure=null;
        try{proposal=DeviceProtocol.parseEvent(body);}catch(Failure e){failure=e.getMessage();proposal=JSON.createObjectNode();proposal.set("rawEvent",body.deepCopy());}
        ObjectNode result=proposal;String error=failure;
        return tx.write(actor,patient,"device-event:"+hash(device+":"+event),key,body,c->{
            ObjectNode previous=one(c,"select content_hash,task_id from capture_device_event where patient_id=? and device_id=? and event_id=?",r->JSON.createObjectNode().put("hash",r.getString(1)).put("task",r.getString(2)),patient,device,event);
            if(previous!=null){if(!previous.path("hash").asText().equals(digest))throw new Failure(409,"DEVICE_EVENT_CONFLICT");return CaptureService.task(c,patient,previous.path("task").asText());}
            ObjectNode session=device(c,patient,device);if(session==null||!session.path("state").asText().equals("CONNECTED"))throw new Failure(409,"DEVICE_NOT_CONNECTED");
            String id=id("cap_");
            execute(c,"insert into capture_task(task_id,patient_id,actor_id,kind,content_hash,raw_text,status,candidate_json,failure_code) values(?,?,?,'DEVICE',?,?,?,?,?)",id,patient,actor.userId(),digest,body.toString(),error==null?"CANDIDATE_READY":"REJECTED",result.toString(),error);
            execute(c,"insert into capture_device_event(patient_id,device_id,event_id,content_hash,task_id) values(?,?,?,?,?)",patient,device,event,digest,id);
            CaptureService.audit(c,actor,patient,id,error==null?"DEVICE_CANDIDATE":"DEVICE_REJECTED",1);return CaptureService.task(c,patient,id);
        });
    }
}
