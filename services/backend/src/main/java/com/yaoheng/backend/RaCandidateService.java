package com.yaoheng.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.*;
import java.sql.*;
import static com.yaoheng.backend.FlowSupport.*;
import static com.yaoheng.backend.R1Service.*;

/** Frozen draft artifacts; inference never holds a patient transaction. */
final class RaCandidateService {
    private final FlowSupport flow;
    RaCandidateService(DatabaseRepository db){flow=new FlowSupport(db);}
    static boolean enabled(){return System.getenv().getOrDefault("RA_ENABLED","false").equalsIgnoreCase("true");}
    static ObjectNode get(Connection c,int patient,String id)throws SQLException{
        ObjectNode row=one(c,"select * from ra_candidate_artifact where patient_id=? and id=?",r->{
            ObjectNode n=JSON.createObjectNode().put("artifactId",r.getString("id")).put("state",r.getString("state")).put("inputRevision",r.getLong("input_revision"))
                .put("inputHash",r.getString("input_hash")).put("artifactHash",r.getString("output_hash")).put("recordId",r.getString("record_id")).put("recordRevision",r.getString("record_revision"));
            n.set("input",parse(r.getString("input_json")));if(r.getString("result_json")!=null)n.set("result",parse(r.getString("result_json")));return n;
        },patient,id);
        if(row==null)throw new Failure(404,"RA_ARTIFACT_NOT_FOUND");
        if(row.has("result")&&!hash(canonical(row.path("result")).toString()).equals(row.path("artifactHash").asText()))throw new Failure(503,"RA_ARTIFACT_HASH_MISMATCH");
        return row;
    }
    ObjectNode get(int patient,String id)throws SQLException{return flow.read(c->get(c,patient,id));}
    ObjectNode create(Actor actor,int patient,JsonNode body,String key)throws SQLException{
        if(!enabled())throw new Failure(404,"RA_DISABLED");
        if(key==null||!key.matches("[A-Za-z0-9_-]{8,128}"))throw new Failure(400,"IDEMPOTENCY_KEY_REQUIRED");
        String raw=text(body,"rawText",10000),reference=text(body,"referenceTime",64);utc(reference);
        if(!body.path("timezone").asText().equals("Asia/Shanghai"))throw new Failure(422,"UNSUPPORTED_TIMEZONE");
        if(!body.path("inputRevision").isIntegralNumber())throw new Failure(422,"INPUT_REVISION_REQUIRED");
        String digest=hash(canonical(body).toString());boolean[] owner={false};
        ObjectNode claimed=flow.transaction(patient,c->{
            String existing=one(c,"select id from ra_candidate_artifact where patient_id=? and request_id=?",r->r.getString(1),patient,key);
            if(existing!=null){ObjectNode old=get(c,patient,existing);if(!old.path("inputHash").asText().equals(digest))throw new Failure(409,"RA_REQUEST_CONFLICT");return old;}
            long current=one(c,"select input_revision from patient where id=?",r->r.getLong(1),patient);
            if(body.path("inputRevision").asLong()!=current)throw new Failure(409,"RA_INPUT_CHANGED");
            String record=body.hasNonNull("recordId")?text(body,"recordId",64):null,revision=body.hasNonNull("recordRevision")?text(body,"recordRevision",64):null;
            if(record!=null&&!FeedbackService.detail(c,patient,record).path("revisionId").asText().equals(revision))throw new Failure(409,"RA_RECORD_CHANGED");
            if(record==null&&revision!=null)throw new Failure(422,"RA_RECORD_REQUIRED");
            String id=id("rac_");execute(c,"insert into ra_candidate_artifact(id,patient_id,request_id,input_hash,input_json,input_revision,record_id,record_revision,state) values(?,?,?,?,?,?,?,?,'RUNNING')",id,patient,key,digest,body.toString(),current,record,revision);owner[0]=true;return get(c,patient,id);
        });
        if(!owner[0])return claimed;
        ObjectNode result;
        String patientName=flow.read(c->one(c,"select name from patient where id=?",r->r.getString(1),patient));
        try{result=infer(JSON.createObjectNode().put("requestId",claimed.path("artifactId").asText()).put("rawText",raw).put("referenceTime",reference).put("timezone","Asia/Shanghai").put("allowRemote",patientName==null||!raw.contains(patientName)));}
        catch(Failure e){flow.transaction(patient,c->{execute(c,"update ra_candidate_artifact set state='FAILED' where id=? and state='RUNNING'",claimed.path("artifactId").asText());return null;});throw e;}
        return flow.transaction(patient,c->{
            execute(c,"update ra_candidate_artifact set result_json=?,output_hash=?,state='READY' where id=? and state='RUNNING'",result.toString(),hash(canonical(result).toString()),claimed.path("artifactId").asText());return get(c,patient,claimed.path("artifactId").asText());
        });
    }
    ObjectNode discard(Actor actor,int patient,String id,JsonNode body,String key)throws SQLException{
        return flow.write(actor,patient,"ra-discard:"+id,key,body,c->{
            ObjectNode artifact=get(c,patient,id);
            if(one(c,"select revision_id from ra_candidate_confirmation where artifact_id=?",r->r.getString(1),id)!=null)throw new Failure(409,"RA_ARTIFACT_CONFIRMED");
            if(!artifact.path("inputHash").asText().equals(text(body,"inputHash",64)))throw new Failure(409,"RA_ARTIFACT_CHANGED");
            execute(c,"update ra_candidate_artifact set state='DISCARDED',result_json=null,output_hash=null where id=?",id);
            return get(c,patient,id);
        });
    }
    static ObjectNode infer(ObjectNode body){
        try{
            URI base=URI.create(System.getenv().getOrDefault("AI_SERVICE_URL","http://127.0.0.1:8000"));
            if(!base.getScheme().equals("http")||!Set.of("127.0.0.1","[::1]","::1").contains(base.getHost())||base.getUserInfo()!=null||base.getQuery()!=null||base.getFragment()!=null)throw new Failure(503,"RA_ENGINE_CONFIGURATION");
            HttpRequest req=HttpRequest.newBuilder(base.resolve("/ai/ra/candidates")).timeout(Duration.ofSeconds(32)).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(body.toString())).build();
            var response=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).followRedirects(HttpClient.Redirect.NEVER).build().send(req,HttpResponse.BodyHandlers.ofInputStream());
            byte[] bytes;try(var stream=response.body()){bytes=CaptureStore.bounded(stream,200000);}
            if(response.statusCode()!=200)throw new Failure(503,"RA_ENGINE_UNAVAILABLE");
            JsonNode n=JSON.readTree(bytes);
            if(!n.isObject()||!n.path("extractorVersion").asText().equals("ra_candidates_v1")||!n.path("candidates").isArray()||n.path("candidates").size()>20||!n.path("requiresConfirmation").asBoolean())throw new Failure(503,"RA_ENGINE_INVALID");
            String raw=body.path("rawText").asText();int length=raw.codePointCount(0,raw.length());
            Set<String> ids=new HashSet<>();
            for(JsonNode v:n.path("candidates")){
                int start=v.path("span").path(0).asInt(-1),end=v.path("span").path(1).asInt(-1);
                if(start<0||end<=start||end>length||!v.path("requiresConfirmation").asBoolean()||!ids.add(v.path("candidateId").asText())||!raw.substring(raw.offsetByCodePoints(0,start),raw.offsetByCodePoints(0,end)).equals(v.path("quote").asText()))throw new Failure(503,"RA_ENGINE_INVALID_SPAN");
                if(v.path("eligibleForPrefill").asBoolean()&&(!v.path("subject").asText().equals("SELF")||!v.path("polarity").asText().equals("AFFIRMED")||v.path("conflict").asBoolean()||v.path("anchor").path("future").asBoolean()))throw new Failure(503,"RA_ENGINE_UNSAFE_PREFILL");
            }
            return (ObjectNode)n;
        }catch(Failure e){throw e;}catch(InterruptedException e){Thread.currentThread().interrupt();throw new Failure(503,"RA_ENGINE_INTERRUPTED");}catch(Exception e){throw new Failure(503,"RA_ENGINE_UNAVAILABLE");}
    }
}
