package com.yaoheng.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.*;
import java.time.*;
import java.util.*;
import static com.yaoheng.backend.FlowSupport.*;
import static com.yaoheng.backend.R1Service.*;

final class AnalysisService {
    private final FlowSupport flow;private final AiServiceClient ai=new AiServiceClient();
    AnalysisService(DatabaseRepository db){flow=new FlowSupport(db);}
    ObjectNode raContext(int patient,String task)throws SQLException{return flow.read(c->RaContextService.read(c,patient,task));}
    ObjectNode raProjection(int patient,String task)throws SQLException{try{return ai.call("/ai/ra/project",raContext(patient,task));}catch(AiServiceClient.Error e){throw new Failure(503,"RA_PROJECTION_UNAVAILABLE");}}
    ObjectNode projection(int patient,String run)throws SQLException{return new R3ProjectionService(flow.db).get(patient,run);}
    static ObjectNode manifest(Connection c,int patient,long input)throws SQLException {
        ObjectNode m=JSON.createObjectNode().put("patientId",patient).put("inputRevision",input).put("referenceTime",Instant.now().toString());
        m.set("medications",JSON.valueToTree(query(c,"select mr.snapshot from medication_revision mr join patient_medication pm on pm.id=mr.medication_id and pm.version=mr.version where pm.patient_id=? and pm.status='ACTIVE'",r->parse(r.getString(1)),patient)));
        // Persist complete latest revisions; Python owns the 14-day event-time filter, including backfilled facts.
        m.set("records",JSON.valueToTree(query(c,"select r.id,v.* from raw_record r join raw_record_revision v on v.id=r.latest_revision_id where r.patient_id=?",r->{
            ObjectNode n=JSON.createObjectNode().put("recordId",r.getString("record_id")).put("revisionId",r.getString(2)).put("rawText",r.getString("raw_text")).put("occurredAt",iso(r.getObject("occurred_at",LocalDateTime.class)));n.set("confirmedFacts",parse(r.getString("confirmed_facts")));return n;},patient)));
        m.set("reminders",JSON.valueToTree(query(c,"select planned_at,execution_status from reminder_item where patient_id=? and plan_id is not null",r->JSON.createObjectNode().put("plannedAt",iso(r.getObject(1,LocalDateTime.class))).put("executionStatus",r.getString(2)),patient)));
        return m;
    }
    static void freeze(Connection c,int patient,String task,long input)throws SQLException {ObjectNode frozen=manifest(c,patient,input);execute(c,"update analysis_task set manifest=? where id=?",frozen.toString(),task);RaContextService.freeze(c,patient,task,input,frozen);}
    ObjectNode latest(int patient)throws SQLException{return flow.read(c->{
        long input=one(c,"select input_revision from patient where id=?",r->r.getLong(1),patient);
        ObjectNode out=JSON.createObjectNode().put("inputRevision",input);
        out.set("snapshot",one(c,"select r.snapshot from analysis_latest l join analysis_run r on r.id=l.run_id where l.patient_id=?",r->parse(r.getString(1)),patient));
        out.set("pendingTask",one(c,"select * from analysis_task where patient_id=? order by input_revision desc,created_at desc limit 1",FeedbackService::taskRow,patient));return out;});}
    ObjectNode run(int patient,String id)throws SQLException{return flow.read(c->{ObjectNode n=one(c,"select snapshot from analysis_run where patient_id=? and (id=? or snapshot_id=?)",r->(ObjectNode)parse(r.getString(1)),patient,id,id);if(n==null)throw new Failure(404,"ANALYSIS_NOT_FOUND");return n;});}
    ObjectNode history(int patient)throws SQLException{return flow.read(c->list("items",query(c,"select snapshot from analysis_run where patient_id=? order by input_revision desc,created_at desc",r->parse(r.getString(1)),patient)));}
    ObjectNode retry(Actor actor,int patient,String task,JsonNode body,String key)throws SQLException{return flow.write(actor,patient,"analysis-retry:"+task,key,body,c->{
        ObjectNode n=one(c,"select * from analysis_task where patient_id=? and id=?",FeedbackService::taskRow,patient,task);if(n==null)throw new Failure(404,"TASK_NOT_FOUND");
        if(!n.path("status").asText().equals("FAILED"))throw new Failure(409,"TASK_NOT_FAILED");
        execute(c,"update analysis_task set status='PENDING',retry_base=attempt,next_attempt_at=null,error_code=null where id=?",task);
        return one(c,"select * from analysis_task where id=?",FeedbackService::taskRow,task);
    });}
    void tick()throws SQLException {
        ObjectNode candidate=flow.read(c->one(c,"select id,patient_id from analysis_task where (status='PENDING' and (next_attempt_at is null or next_attempt_at<=utc_timestamp(6))) or (status='RUNNING' and lease_until<utc_timestamp(6)) order by created_at,id limit 1",r->JSON.createObjectNode().put("id",r.getString(1)).put("patient",r.getInt(2))));
        if(candidate==null)return;int patient=candidate.path("patient").asInt();String task=candidate.path("id").asText(),lease=id("lease_");
        ObjectNode claimed=flow.transaction(patient,c->{
            ObjectNode n=one(c,"select * from analysis_task where id=? and ((status='PENDING' and (next_attempt_at is null or next_attempt_at<=utc_timestamp(6))) or (status='RUNNING' and lease_until<utc_timestamp(6))) for update",r->{ObjectNode row=FeedbackService.taskRow(r);row.put("retryBase",r.getInt("retry_base"));row.set("manifest",r.getString("manifest")==null?JSON.nullNode():parse(r.getString("manifest")));return row;},task);
            if(n==null)return null;
            execute(c,"update analysis_attempt set status='EXPIRED',finished_at=utc_timestamp(6) where task_id=? and status='RUNNING'",task);
            if(n.path("attempt").asInt()-n.path("retryBase").asInt()>=3){execute(c,"update analysis_task set status='FAILED',error_code='ATTEMPTS_EXHAUSTED',lease_until=null where id=?",task);return null;}
            if(n.path("manifest").isNull()){
                long current=one(c,"select input_revision from patient where id=?",r->r.getLong(1),patient);
                if(current!=n.path("inputRevision").asLong()){execute(c,"update analysis_task set status='FAILED',error_code='LEGACY_INPUT_NOT_FROZEN' where id=?",task);return null;}
                n.set("manifest",manifest(c,patient,current));execute(c,"update analysis_task set manifest=? where id=?",n.path("manifest").toString(),task);
            }
            int attempt=n.path("attempt").asInt()+1;n.put("attempt",attempt);
            execute(c,"update analysis_task set status='RUNNING',attempt=?,lease_token=?,lease_until=date_add(utc_timestamp(6),interval 120 second),error_code=null where id=?",attempt,lease,task);
            execute(c,"insert into analysis_attempt(task_id,attempt,lease_token,status) values(?,?,?,'RUNNING')",task,attempt,lease);return n;
        });
        if(claimed==null)return;
        // Single 15s bounded orchestration call is outside TX and below the 20s heartbeat period.
        try {
            ObjectNode output=ai.call("/ai/r1/analyze",claimed.path("manifest"));AiServiceClient.validate(output,claimed.path("manifest"));
            flow.transaction(patient,c->{
                if(one(c,"select id from analysis_task where id=? and status='RUNNING' and lease_token=? and lease_until>utc_timestamp(6) for update",r->r.getString(1),task,lease)==null)return null;
                String run=id("run_"),snapshot=id("snapshot_");output.put("runId",run).put("snapshotId",snapshot).put("patientId",patient);
                execute(c,"insert into analysis_run(id,snapshot_id,patient_id,task_id,input_revision,snapshot) values(?,?,?,?,?,?)",run,snapshot,patient,task,claimed.path("inputRevision").asLong(),output.toString());
                for(JsonNode parsedCandidate:output.path("candidates"))execute(c,"insert into parsed_event_candidate(id,revision_id,candidate,confirmation_status,parser_version) values(?,?,?,'PENDING','rules_r1_1')",id("candidate_"),parsedCandidate.path("evidence").path("revisionId").asText(),parsedCandidate.toString());
                long current=one(c,"select input_revision from patient where id=?",r->r.getLong(1),patient);
                if(current==claimed.path("inputRevision").asLong())execute(c,"insert into analysis_latest(patient_id,run_id,input_revision) values(?,?,?) on duplicate key update run_id=values(run_id),input_revision=values(input_revision)",patient,run,current);
                execute(c,"update analysis_task set status='SUCCESS',lease_until=null where id=?",task);
                execute(c,"update analysis_attempt set status='SUCCESS',finished_at=utc_timestamp(6) where task_id=? and lease_token=?",task,lease);
                return null;
            });
        }catch(AiServiceClient.Error e){fail(patient,task,lease,claimed,e.code,e.retryable);}
        catch(SQLException e){fail(patient,task,lease,claimed,"PUBLICATION_DATABASE_ERROR",true);}
    }
    private void fail(int patient,String task,String lease,ObjectNode n,String code,boolean retry)throws SQLException{
        flow.transaction(patient,c->{
            boolean again=retry&&n.path("attempt").asInt()-n.path("retryBase").asInt()<3;
            int seconds=n.path("attempt").asInt()-n.path("retryBase").asInt()==1?10:60;
            int changed=execute(c,"update analysis_task set status=?,error_code=?,lease_until=null,next_attempt_at=date_add(utc_timestamp(6),interval ? second) where id=? and lease_token=? and status='RUNNING'",again?"PENDING":"FAILED",code,seconds,task,lease);
            if(changed>0)execute(c,"update analysis_attempt set status='FAILED',error_code=?,finished_at=utc_timestamp(6) where task_id=? and lease_token=?",code,task,lease);return null;
        });
    }
}
