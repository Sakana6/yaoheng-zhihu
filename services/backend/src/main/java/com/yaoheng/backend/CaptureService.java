package com.yaoheng.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.*;
import java.util.*;
import static com.yaoheng.backend.R1Service.*;
import static com.yaoheng.backend.FlowSupport.*;

/** Evidence lifecycle is separate from R1 facts; only R1 save can confirm a task. */
final class CaptureService {
    final FlowSupport tx;final CaptureStore store=new CaptureStore();
    final MedicationNormalizer normalizer=new MedicationNormalizer();
    final LocalOcrAdapter ocr=LocalOcrAdapter.configured();
    CaptureService(DatabaseRepository db){tx=new FlowSupport(db);}
    static ObjectNode task(Connection c,int patient,String id)throws SQLException{
        ObjectNode n=one(c,"select * from capture_task where patient_id=? and task_id=?",r->{
            ObjectNode out=JSON.createObjectNode().put("taskId",r.getString("task_id")).put("patientId",patient)
                .put("kind",r.getString("kind")).put("sha256",r.getString("content_hash"))
                .put("originalName",r.getString("original_name")).put("mimeType",r.getString("mime_type"))
                .put("byteSize",r.getInt("byte_size")).put("rawText",r.getString("raw_text"))
                .put("status",r.getString("status")).put("version",r.getInt("version"))
                .put("failureCode",r.getString("failure_code")).put("fileDeleted",r.getBoolean("file_deleted"))
                .put("createdAt",r.getString("created_at")).put("updatedAt",r.getString("updated_at"));
            long med=r.getLong("medication_id");if(r.wasNull())out.putNull("medicationId");else out.put("medicationId",med);
            for(String[] f:new String[][]{{"candidate_json","result"},{"confirmed_json","confirmation"}}){
                String value=r.getString(f[0]);if(value==null)out.putNull(f[1]);else out.set(f[1],parse(value));
            }return out;
        },patient,id);
        if(n==null)throw new Failure(404,"CAPTURE_NOT_FOUND");return n;
    }
    ObjectNode get(int patient,String id)throws SQLException{return tx.read(c->task(c,patient,id));}
    ObjectNode listTasks(int patient)throws SQLException{return tx.read(c->list("items",query(c,"select task_id from capture_task where patient_id=? order by created_at desc",r->task(c,patient,r.getString(1)),patient)));}
    static void audit(Connection c,Actor actor,int patient,String id,String action,int version)throws SQLException{
        execute(c,"insert into capture_audit(task_id,patient_id,actor_id,action,task_version) values(?,?,?,?,?)",id,patient,actor.userId(),action,version);
    }
    ObjectNode upload(Actor actor,int patient,byte[] bytes,String name,String mime,String key)throws SQLException{
        CaptureStore.validate(bytes,name,mime);String digest=CaptureStore.digest(bytes);
        ObjectNode body=JSON.createObjectNode().put("sha256",digest).put("name",name).put("mime",mime);
        return tx.write(actor,patient,"capture-upload",key,body,c->{
            String existing=one(c,"select task_id from capture_task where patient_id=? and kind='IMAGE' and content_hash=?",r->r.getString(1),patient,digest);
            if(existing!=null)return task(c,patient,existing);
            store.put(patient,digest,bytes);String id=id("cap_");
            execute(c,"insert into capture_task(task_id,patient_id,actor_id,kind,content_hash,original_name,mime_type,byte_size) values(?,?,?,'IMAGE',?,?,?,?)",id,patient,actor.userId(),digest,name,mime,bytes.length);
            audit(c,actor,patient,id,"UPLOAD",1);return task(c,patient,id);
        });
    }
    ObjectNode textTask(Actor actor,int patient,JsonNode body,String key)throws SQLException{
        String raw=text(body,"rawText",2000);String hash=hash(raw);ObjectNode candidates=normalizer.candidates(raw);
        candidates.put("engine","LOCAL_RULES").put("engineVersion","name-rules-1");
        return tx.write(actor,patient,"capture-text",key,body,c->{
            String existing=one(c,"select task_id from capture_task where patient_id=? and kind='TEXT' and content_hash=?",r->r.getString(1),patient,hash);
            if(existing!=null)return task(c,patient,existing);String id=id("cap_");
            execute(c,"insert into capture_task(task_id,patient_id,actor_id,kind,content_hash,raw_text,status,candidate_json) values(?,?,?,'TEXT',?,?,'CANDIDATE_READY',?)",id,patient,actor.userId(),hash,raw,candidates.toString());
            audit(c,actor,patient,id,"NORMALIZE",1);return task(c,patient,id);
        });
    }
    ObjectNode process(Actor actor,int patient,String id,JsonNode body,String key)throws SQLException{
        // Only the transaction that creates the claim may invoke a paid provider.
        // Cached idempotency responses must not invoke inference again, even across JVMs.
        boolean[] owner={false};
        ObjectNode claimed=tx.write(actor,patient,"capture-process:"+id,key,body,c->{
            ObjectNode current=task(c,patient,id);checkVersion(body,current.path("version").asInt());
            if(!Set.of("IMAGE","TEXT").contains(current.path("kind").asText()))throw new Failure(422,"CAPTURE_REUPLOAD_REQUIRED");
            if(!Set.of("PENDING","FAILED","CANCELLED","REJECTED").contains(current.path("status").asText()))throw new Failure(409,"CAPTURE_STATE_CONFLICT");
            if(current.path("fileDeleted").asBoolean())throw new Failure(410,"CAPTURE_FILE_UNAVAILABLE");
            execute(c,"update capture_task set status='RUNNING',version=version+1,failure_code=null,updated_at=utc_timestamp(6) where task_id=?",id);
            audit(c,actor,patient,id,"PROCESS_START",current.path("version").asInt()+1);owner[0]=true;return task(c,patient,id);
        });
        // A retry of the same HTTP key must never reset a newer/terminal task.
        ObjectNode latest=get(patient,id);if(!owner[0]||latest.path("version").asInt()!=claimed.path("version").asInt())return latest;
        ObjectNode result=null;String error=null;
        try{
            if(claimed.path("kind").asText().equals("TEXT"))result=normalizer.candidates(claimed.path("rawText").asText()).put("engine","LOCAL_RULES").put("engineVersion","name-rules-1");
            else{ObjectNode evidence=ocr.recognize(store.get(patient,claimed.path("sha256").asText()),id+":"+claimed.path("version").asInt());
                if(evidence.path("text").asText().isBlank())throw new Failure(422,"OCR_NO_MEDICINE_TEXT");
                result=normalizer.candidates(evidence.path("text").asText());result.set("ocr",evidence);
                result.put("engine",evidence.path("engine").asText()).put("engineVersion",evidence.path("engineVersion").asText());}
        }catch(Failure e){error=e.getMessage();}catch(RuntimeException e){error="OCR_PROCESSING_FAILED";}
        ObjectNode output=result;String failure=error;
        return tx.transaction(patient,c->{
            ObjectNode current=task(c,patient,id);
            if(!current.path("status").asText().equals("RUNNING")||current.path("version").asInt()!=claimed.path("version").asInt())return current;
            execute(c,"update capture_task set status=?,candidate_json=?,failure_code=?,version=version+1,updated_at=utc_timestamp(6) where task_id=?",failure==null?"CANDIDATE_READY":"FAILED",output==null?null:output.toString(),failure,id);
            audit(c,actor,patient,id,failure==null?"CANDIDATE_READY":"PROCESS_FAILED",current.path("version").asInt()+1);return task(c,patient,id);
        });
    }
    ObjectNode action(Actor actor,int patient,String id,String action,JsonNode body,String key)throws SQLException{
        return tx.write(actor,patient,"capture-"+action+":"+id,key,body,c->{
            ObjectNode current=task(c,patient,id);checkVersion(body,current.path("version").asInt());
            String status=current.path("status").asText();
            if(action.equals("purge")){
                if(status.equals("RUNNING"))throw new Failure(409,"CAPTURE_STATE_CONFLICT");
                // Mark inaccessible first; retaining metadata supports audit after physical cleanup.
                execute(c,"update capture_task set file_deleted=true,version=version+1,updated_at=utc_timestamp(6) where task_id=?",id);
            }else{
                if(status.equals("CONFIRMED")||action.equals("reject")&&!status.equals("CANDIDATE_READY"))throw new Failure(409,"CAPTURE_STATE_CONFLICT");
                execute(c,"update capture_task set status=?,version=version+1,updated_at=utc_timestamp(6) where task_id=?",action.equals("cancel")?"CANCELLED":"REJECTED",id);
            }
            audit(c,actor,patient,id,action.toUpperCase(Locale.ROOT),current.path("version").asInt()+1);return task(c,patient,id);
        });
    }
    byte[] download(Actor actor,int patient,String id)throws SQLException{
        return tx.transaction(patient,c->{ObjectNode n=task(c,patient,id);
            if(!n.path("kind").asText().equals("IMAGE")||n.path("fileDeleted").asBoolean())throw new Failure(410,"CAPTURE_FILE_UNAVAILABLE");
            byte[] bytes=store.get(patient,n.path("sha256").asText());audit(c,actor,patient,id,"DOWNLOAD",n.path("version").asInt());return bytes;});
    }
    static ObjectNode beforeConfirm(Connection c,int patient,JsonNode body)throws SQLException{
        if(!body.has("captureTaskId"))return null;
        ObjectNode task=task(c,patient,text(body,"captureTaskId",48));
        if(!Set.of("IMAGE","TEXT").contains(task.path("kind").asText()))throw new Failure(422,"CAPTURE_KIND_MISMATCH");
        if(!body.path("captureVersion").isIntegralNumber()||!body.path("captureVersion").canConvertToInt()||body.path("captureVersion").asInt()!=task.path("version").asInt())throw new Failure(409,"CAPTURE_VERSION_CONFLICT");
        if(!Set.of("CANDIDATE_READY","FAILED","CANCELLED","REJECTED").contains(task.path("status").asText()))throw new Failure(409,"CAPTURE_STATE_CONFLICT");
        return task;
    }
    static void confirmed(Connection c,Actor actor,int patient,ObjectNode task,ObjectNode medication,JsonNode body)throws SQLException{
        if(task==null)return;
        ObjectNode finalValue=medication.deepCopy();finalValue.put("captureSource",task.path("kind").asText())
            .put("previousCaptureStatus",task.path("status").asText()).put("confirmedBy",actor.userId());
        execute(c,"update capture_task set status='CONFIRMED',medication_id=?,confirmed_json=?,version=version+1,updated_at=utc_timestamp(6) where task_id=?",medication.path("id").asLong(),finalValue.toString(),task.path("taskId").asText());
        audit(c,actor,patient,task.path("taskId").asText(),"CONFIRM_MEDICATION",task.path("version").asInt()+1);
    }
}
