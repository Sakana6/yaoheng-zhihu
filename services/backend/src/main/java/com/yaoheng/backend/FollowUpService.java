package com.yaoheng.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.*;
import java.time.*;
import java.util.*;
import static com.yaoheng.backend.FlowSupport.*;
import static com.yaoheng.backend.R1Service.*;

/** Doctor-only append-only reviews and TX3 follow-up lifecycle. Replies reuse FeedbackService TX1. */
final class FollowUpService {
    private final FlowSupport flow;
    FollowUpService(DatabaseRepository db){flow=new FlowSupport(db);}
    static void doctor(Actor actor){if(!actor.role().equals("DOCTOR"))throw new Failure(403,"DOCTOR_REQUIRED");}
    static void fields(JsonNode body,String... allowed){Set<String> keys=Set.of(allowed);body.fieldNames().forEachRemaining(k->{if(!keys.contains(k))throw new Failure(422,"UNSUPPORTED_FIELD:"+k);});}
    static ObjectNode reviewRow(ResultSet r)throws SQLException{return JSON.createObjectNode().put("reviewId",r.getString("id")).put("patientId",r.getInt("patient_id")).put("actorId",r.getInt("actor_id")).put("analysisRunId",r.getString("analysis_run_id")).put("snapshotId",r.getString("snapshot_id")).put("status",r.getString("decision")).put("comment",r.getString("comment")).put("reason",r.getString("reason")).put("historical",r.getBoolean("historical")).put("createdAt",iso(r.getObject("created_at",LocalDateTime.class)));}
    ObjectNode reviews(int patient)throws SQLException{return flow.read(c->list("items",query(c,"select * from doctor_review where patient_id=? order by created_at desc,id",FollowUpService::reviewRow,patient)));}
    ObjectNode review(Actor actor,int patient,JsonNode body,String key)throws SQLException{
        doctor(actor);fields(body,"analysisRunId","snapshotId","expectedSnapshotId","allowHistorical","status","comment","reason");
        return flow.write(actor,patient,"review-create",key,body,c->{
            String run=text(body,"analysisRunId",64),snapshot=text(body,"snapshotId",64),expected=text(body,"expectedSnapshotId",64);
            if(one(c,"select id from analysis_run where patient_id=? and id=? and snapshot_id=?",r->r.getString(1),patient,run,snapshot)==null)throw new Failure(404,"SNAPSHOT_NOT_FOUND");
            String latest=one(c,"select r.snapshot_id from analysis_latest l join analysis_run r on r.id=l.run_id where l.patient_id=?",r->r.getString(1),patient);
            if(!expected.equals(latest))throw new Failure(409,"LATEST_SNAPSHOT_CHANGED");
            if(body.has("allowHistorical")&&!body.path("allowHistorical").isBoolean())throw new Failure(422,"INVALID_HISTORICAL_FLAG");
            boolean historical=!snapshot.equals(latest);
            if(historical&&!body.path("allowHistorical").asBoolean())throw new Failure(409,"HISTORICAL_REVIEW_CONFIRMATION_REQUIRED");
            String status=text(body,"status",32);if(!Set.of("REVIEWED","NEEDS_MORE_DATA","DISAGREED").contains(status))throw new Failure(422,"INVALID_REVIEW_STATUS");
            String id=id("review_");execute(c,"insert into doctor_review(id,patient_id,actor_id,analysis_run_id,snapshot_id,decision,comment,reason,historical) values(?,?,?,?,?,?,?,?,?)",id,patient,actor.userId(),run,snapshot,status,text(body,"comment",2000),text(body,"reason",1000),historical);
            audit(c,actor,patient,"REVIEW_CREATE",id);return one(c,"select * from doctor_review where id=?",FollowUpService::reviewRow,id);
        });
    }
    static ObjectNode row(ResultSet r)throws SQLException{
        ObjectNode n=JSON.createObjectNode().put("followUpId",r.getString("id")).put("patientId",r.getInt("patient_id")).put("actorId",r.getInt("actor_id")).put("sourceReviewId",r.getString("source_review_id")).put("analysisRunId",r.getString("analysis_run_id")).put("snapshotId",r.getString("snapshot_id")).put("dueAt",iso(r.getObject("due_at",LocalDateTime.class))).put("instruction",r.getString("instruction")).put("status",r.getString("status")).put("version",r.getInt("version")).put("planId",r.getString("plan_id")).put("occurrenceId",r.getString("occurrence_key")).put("completedRecordId",r.getString("completed_record_id"));
        try{n.set("requiredFields",JSON.readTree(r.getString("required_fields")));}catch(java.io.IOException e){throw new SQLException("Invalid required fields",e);}return n;
    }
    static ObjectNode get(Connection c,int patient,String id)throws SQLException{
        ObjectNode n=one(c,"select * from follow_up where patient_id=? and id=?",FollowUpService::row,patient,id);if(n==null)throw new Failure(404,"FOLLOW_UP_NOT_FOUND");
        n.set("reminder",ReminderService.occurrence(c,patient,n.path("occurrenceId").asText()));return n;
    }
    ObjectNode get(int patient,String id)throws SQLException{return flow.read(c->get(c,patient,id));}
    ObjectNode listFollowUps(int patient)throws SQLException{return flow.read(c->{List<ObjectNode> out=new ArrayList<>();for(String id:query(c,"select id from follow_up where patient_id=? order by created_at desc,id",r->r.getString(1),patient))out.add(get(c,patient,id));return list("items",out);});}
    private static LocalDateTime due(JsonNode body){LocalDateTime at=utc(text(body,"dueAt",64));if(!at.isAfter(LocalDateTime.now(ZoneOffset.UTC)))throw new Failure(422,"DUE_MUST_BE_FUTURE");return at;}
    static ObjectNode definition(int patient,String plan,LocalDateTime due,int version,String status){
        ZonedDateTime local=due.atOffset(ZoneOffset.UTC).atZoneSameInstant(ZONE);
        ObjectNode p=JSON.createObjectNode().put("planId",plan).put("patientId",patient).put("version",version).put("status",status).put("reminderType","FOLLOW_UP").put("title","医生随访补充记录").put("frequency","ONCE").put("timezone","Asia/Shanghai").put("localTime",local.toLocalTime().withSecond(0).withNano(0).toString()).put("startDate",local.toLocalDate().toString()).put("endDate",local.toLocalDate().toString()).put("effectiveFrom",iso(due));p.putArray("medicationIds");return p;
    }
    private static void instance(Connection c,int patient,String follow,String plan,String occurrence,int version,LocalDateTime due)throws SQLException{
        execute(c,"insert into reminder_item(patient_id,reminder_key,reminder_type,planned_at,title,status,plan_id,plan_version,execution_status,medication_snapshot,follow_up_id) values(?,?,'FOLLOW_UP',?,'医生随访补充记录','PENDING',?,?,'PENDING','[]',?)",patient,occurrence,sqlTime(due),plan,version,follow);
    }
    ObjectNode create(Actor actor,int patient,JsonNode body,String key)throws SQLException{
        doctor(actor);fields(body,"sourceReviewId","analysisRunId","snapshotId","requiredFields","dueAt","instruction");
        return flow.write(actor,patient,"followup-create",key,body,c->{
            String review=text(body,"sourceReviewId",64),run=text(body,"analysisRunId",64),snapshot=text(body,"snapshotId",64);
            if(one(c,"select id from doctor_review where patient_id=? and id=? and analysis_run_id=? and snapshot_id=?",r->r.getString(1),patient,review,run,snapshot)==null)throw new Failure(404,"REVIEW_NOT_FOUND");
            JsonNode required=body.path("requiredFields");Set<String> seen=new HashSet<>();
            if(!required.isArray()||required.isEmpty()||required.size()>4)throw new Failure(422,"REQUIRED_FIELDS_INVALID");
            for(JsonNode f:required)if(!Set.of("BLOOD_GLUCOSE","BLOOD_PRESSURE","SYMPTOM","ADHERENCE").contains(f.asText())||!seen.add(f.asText()))throw new Failure(422,"REQUIRED_FIELDS_INVALID");
            LocalDateTime at=due(body);String instruction=text(body,"instruction",1000),id=id("follow_"),plan=id("plan_"),occurrence=id("occ_");
            ObjectNode p=definition(patient,plan,at,1,"ACTIVE");execute(c,"insert into reminder_plan(id,patient_id,version,status,definition) values(?,?,1,'ACTIVE',?)",plan,patient,p.toString());
            execute(c,"insert into follow_up(id,patient_id,actor_id,source_review_id,analysis_run_id,snapshot_id,required_fields,due_at,instruction,plan_id,occurrence_key) values(?,?,?,?,?,?,?,?,?,?,?)",id,patient,actor.userId(),review,run,snapshot,required.toString(),sqlTime(at),instruction,plan,occurrence);
            instance(c,patient,id,plan,occurrence,1,at);audit(c,actor,patient,"FOLLOW_UP_CREATE",id);return get(c,patient,id);
        });
    }
    ObjectNode patch(Actor actor,int patient,String id,JsonNode body,String key)throws SQLException{
        doctor(actor);fields(body,"expectedVersion","status","dueAt","instruction");
        return flow.write(actor,patient,"followup-patch:"+id,key,body,c->{
            ObjectNode old=get(c,patient,id);checkVersion(body,old.path("version").asInt());
            if(!old.path("status").asText().equals("PENDING"))throw new Failure(409,"FOLLOW_UP_NOT_PENDING");
            String status=body.has("status")?text(body,"status",16):"PENDING";if(!Set.of("PENDING","CANCELLED").contains(status))throw new Failure(422,"INVALID_FOLLOW_UP_STATUS");
            LocalDateTime at=body.has("dueAt")?due(body):utc(old.path("dueAt").asText());String instruction=body.has("instruction")?text(body,"instruction",1000):old.path("instruction").asText();
            if(!body.has("status")&&!body.has("dueAt")&&!body.has("instruction"))throw new Failure(422,"EMPTY_PATCH");
            String plan=old.path("planId").asText(),occurrence=old.path("occurrenceId").asText();int version=old.path("version").asInt()+1;
            execute(c,"update reminder_item set execution_status='CANCELLED',version=version+1 where follow_up_id=? and execution_status='PENDING'",id);
            ObjectNode p=definition(patient,plan,at,version,status.equals("PENDING")?"ACTIVE":"PAUSED");
            execute(c,"update reminder_plan set definition=?,version=?,status=?,updated_at=utc_timestamp(6) where id=?",p.toString(),version,p.path("status").asText(),plan);
            if(status.equals("PENDING")){occurrence=id("occ_");instance(c,patient,id,plan,occurrence,version,at);}
            execute(c,"update follow_up set version=?,status=?,due_at=?,instruction=?,occurrence_key=?,updated_at=utc_timestamp(6) where id=?",version,status,sqlTime(at),instruction,occurrence,id);
            audit(c,actor,patient,status.equals("CANCELLED")?"FOLLOW_UP_CANCEL":"FOLLOW_UP_UPDATE",id);return get(c,patient,id);
        });
    }
    static void requireReplyFacts(ObjectNode follow,JsonNode facts){
        for(JsonNode field:follow.path("requiredFields")){
            boolean present=switch(field.asText()){
                case "BLOOD_GLUCOSE"->!facts.path("glucose").isEmpty();case "BLOOD_PRESSURE"->!facts.path("bloodPressure").isEmpty();
                case "SYMPTOM"->!facts.path("symptoms").isEmpty()||facts.path("explicitNoSymptoms").asBoolean(false);
                default->{boolean known=false;for(JsonNode m:facts.path("medications"))known|=!m.path("executionType").asText().equals("UNKNOWN");yield known;}
            };if(!present)throw new Failure(422,"FOLLOW_UP_FACT_REQUIRED:"+field.asText());
        }
    }
    static void audit(Connection c,Actor actor,int patient,String action,String resource)throws SQLException{execute(c,"insert into audit_log(actor_id,patient_id,action,resource_id) values(?,?,?,?)",actor.userId(),patient,action,resource);}
}
