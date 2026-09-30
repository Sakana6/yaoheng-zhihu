package com.yaoheng.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.*;
import java.time.*;
import java.util.*;
import static com.yaoheng.backend.R1Service.*;
import static com.yaoheng.backend.FlowSupport.*;

/** TX1 owns raw evidence, revisions, confirmed facts, reminder completion and queued analysis. */
final class FeedbackService {
    private final FlowSupport flow;
    FeedbackService(DatabaseRepository db){flow=new FlowSupport(db);}
    private static final List<String> ARRAYS=List.of("medications","symptoms","glucose","bloodPressure","meals");
    private static final List<String> FACT_TABLES=List.of("bp_record","bg_record","symptom_record","meal_record","adherence_event");
    private static String nullableText(JsonNode n,String key){return n.hasNonNull(key)?text(n,key,64):null;}
    static double number(JsonNode n,String key,double min,double max){
        JsonNode value=n.path(key);
        if(!value.isNumber()||!Double.isFinite(value.asDouble())||value.asDouble()<min||value.asDouble()>max)throw new Failure(422,"INVALID_"+key);
        return value.asDouble();
    }
    static int integer(JsonNode n,String key,int min,int max){
        if(!n.path(key).isIntegralNumber()||!n.path(key).canConvertToInt())throw new Failure(422,"INVALID_"+key);
        return (int)number(n,key,min,max);
    }
    static ObjectNode validateFacts(Connection c,int patient,JsonNode body,ObjectNode occurrence)throws SQLException{
        if(!body.path("confirmedFacts").isObject())throw new Failure(422,"CONFIRMED_FACTS_REQUIRED");
        ObjectNode facts=((ObjectNode)body.path("confirmedFacts")).deepCopy();
        for(String field:ARRAYS){
            if(!facts.path(field).isArray()||facts.path(field).size()>50)throw new Failure(422,"INVALID_"+field);
            for(JsonNode n:facts.path(field)){
                if(!n.isObject())throw new Failure(422,"FACT_OBJECT_REQUIRED");
                utc(text(n,"occurredAt",64));
            }
        }
        if(!facts.has("explicitNoSymptoms")||facts.hasNonNull("explicitNoSymptoms")&&!facts.path("explicitNoSymptoms").isBoolean())throw new Failure(422,"EXPLICIT_NO_SYMPTOMS_MUST_BE_BOOLEAN_OR_NULL");
        if(facts.path("explicitNoSymptoms").asBoolean(false)&&!facts.path("symptoms").isEmpty())throw new Failure(422,"SYMPTOM_CONFIRMATION_CONFLICT");
        Set<Integer> medicationIds=new HashSet<>();
        for(JsonNode n:facts.path("medications")){
            int id=integer(n,"medicationId",1,Integer.MAX_VALUE);
            if(!medicationIds.add(id))throw new Failure(422,"DUPLICATE_MEDICATION_EXECUTION");
            if(one(c,"select id from patient_medication where patient_id=? and id=?",r->r.getLong(1),patient,id)==null)throw new Failure(422,"MEDICATION_NOT_OWNED");
            if(occurrence!=null&&!occurrence.path("reminderType").asText().equals("FOLLOW_UP")){boolean found=false;for(JsonNode med:occurrence.path("medications"))if(med.path("medicationId").asInt()==id)found=true;if(!found)throw new Failure(422,"MEDICATION_NOT_IN_OCCURRENCE");}
            if(!Set.of("TAKEN","MISSED","MAKEUP","UNKNOWN").contains(n.path("executionType").asText()))throw new Failure(422,"INVALID_EXECUTION_TYPE");
        }
        for(JsonNode n:facts.path("symptoms")){text(n,"code",64);integer(n,"severity",0,5);}
        for(JsonNode n:facts.path("glucose")){number(n,"value",0.1,99);if(!n.path("unit").asText().equals("mmol/L"))throw new Failure(422,"INVALID_GLUCOSE_UNIT");}
        for(JsonNode n:facts.path("bloodPressure")){
            int systolic=integer(n,"systolic",30,300),diastolic=integer(n,"diastolic",20,200);
            if(systolic<=diastolic)throw new Failure(422,"INVALID_BP_ORDER");
            if(n.hasNonNull("heartRate"))integer(n,"heartRate",20,250);
            if(!n.path("unit").asText().equals("mmHg"))throw new Failure(422,"INVALID_BP_UNIT");
        }
        for(JsonNode n:facts.path("meals")){
            if(!Set.of("BREAKFAST","LUNCH","DINNER","SNACK","UNKNOWN").contains(n.path("mealType").asText())||!Set.of("NORMAL","INSUFFICIENT","SKIPPED","UNKNOWN").contains(n.path("intakeLevel").asText()))throw new Failure(422,"INVALID_MEAL");
        }
        return facts;
    }
    ObjectNode save(Actor actor,int patient,String record,JsonNode body,String key)throws SQLException{
        return flow.write(actor,patient,record==null?"feedback-create":"feedback-revise:"+record,key,body,c->saveWithin(c,actor,patient,record,body));
    }
    /** Compatibility endpoints still enter TX1; they cannot bypass evidence/revision/task creation. */
    ObjectNode legacy(Actor actor,int patient,String path,JsonNode body,String key)throws SQLException{
        ObjectNode facts=JSON.createObjectNode();for(String field:ARRAYS)facts.putArray(field);facts.putNull("explicitNoSymptoms");
        String time=body.path("occurredAt").asText(body.path("measuredAt").asText(body.path("eventTime").asText("")));
        ObjectNode fact=JSON.createObjectNode().put("occurredAt",time);
        String field=switch(path){case "/bp-records"->"bloodPressure";case "/bg-records"->"glucose";case "/symptom-records"->"symptoms";case "/meal-records"->"meals";default->"medications";};
        for(String name:List.of("systolic","diastolic","heartRate","unit","medicationId","executionType","severity","mealType","intakeLevel","code","value"))if(body.has(name))fact.set(name,body.get(name));
        if(body.has("glucoseValue"))fact.set("value",body.get("glucoseValue"));
        if(body.has("symptomCode"))fact.set("code",body.get("symptomCode"));
        if(body.has("eventType"))fact.set("executionType",body.get("eventType"));
        if(path.equals("/meal-records")&&fact.path("intakeLevel").asText().equals("MISSED"))fact.put("intakeLevel","SKIPPED");
        if(body.has("mealPhase"))fact.set("mealPhase",body.get("mealPhase"));
        if(body.has("note"))fact.set("note",body.get("note"));
        if(!fact.has("unit")&&path.equals("/bp-records"))fact.put("unit","mmHg");
        if(!fact.has("unit")&&path.equals("/bg-records"))fact.put("unit","mmol/L");
        ((com.fasterxml.jackson.databind.node.ArrayNode)facts.path(field)).add(fact);
        ObjectNode adapted=JSON.createObjectNode().put("source","MANUAL").put("occurredAt",time).put("rawText",body.toString()).put("textFactsReviewed",true);adapted.set("confirmedFacts",facts);
        return save(actor,patient,null,adapted,key).put("success",true);
    }
    private ObjectNode saveWithin(Connection c,Actor actor,int patient,String record,JsonNode body)throws SQLException{
        ObjectNode capture=FeedbackCapture.before(c,patient,record,body);
        ObjectNode raCandidate=RaContextService.candidate(c,patient,record,body);
        if(!body.path("rawText").isTextual()||body.path("rawText").asText().length()>10000)throw new Failure(422,"RAW_TEXT_REQUIRED_MAX_10000");
        String source=text(body,"source",32);if(!Set.of("MANUAL","REMINDER").contains(source))throw new Failure(422,"UNSUPPORTED_SOURCE");
        String followUpId=nullableText(body,"followUpId");ObjectNode follow=followUpId==null?null:FollowUpService.get(c,patient,followUpId);
        LocalDateTime occurredAt=utc(text(body,"occurredAt",64));
        String occurrenceId=nullableText(body,"occurrenceId");
        Long occurrenceDbId=null;ObjectNode occurrence=null;int nextVersion=1;
        if(record!=null){
            ObjectNode previous=detail(c,patient,record);checkVersion(body,previous.path("version").asInt());
            nextVersion=previous.path("version").asInt()+1;
            String existing=previous.hasNonNull("occurrenceId")?previous.path("occurrenceId").asText():null;
            if(!Objects.equals(occurrenceId,existing))throw new Failure(422,"OCCURRENCE_LINK_IMMUTABLE");
            if(!Objects.equals(followUpId,previous.hasNonNull("followUpId")?previous.path("followUpId").asText():null))throw new Failure(422,"FOLLOW_UP_LINK_IMMUTABLE");
            text(body,"changeReason",500);
        }
        if(occurrenceId!=null){
            occurrence=ReminderService.occurrence(c,patient,occurrenceId);
            if(!Objects.equals(followUpId,occurrence.hasNonNull("followUpId")?occurrence.path("followUpId").asText():null))throw new Failure(422,"FOLLOW_UP_LINK_REQUIRED");
            if(!source.equals("REMINDER"))throw new Failure(422,"SOURCE_MUST_BE_REMINDER");
            occurrenceDbId=one(c,"select id from reminder_item where patient_id=? and reminder_key=?",r->r.getLong(1),patient,occurrenceId);
            if(record==null){
                String existing=one(c,"select id from raw_record where patient_id=? and occurrence_id=?",r->r.getString(1),patient,occurrenceDbId);
                if(existing!=null)throw new Failure(409,"FEEDBACK_EXISTS:"+existing,JSON.createObjectNode().put("recordId",existing));
                checkVersion(body,occurrence.path("version").asInt());
                if(!occurrence.path("executionStatus").asText().equals("PENDING"))throw new Failure(409,"OCCURRENCE_NOT_PENDING");
            }
        }else if(!source.equals("MANUAL"))throw new Failure(422,"SOURCE_MUST_BE_MANUAL");
        if(follow!=null){
            if(!Objects.equals(occurrenceId,follow.path("occurrenceId").asText()))throw new Failure(409,"FOLLOW_UP_OCCURRENCE_CHANGED");
            if(record==null){checkVersion(JSON.createObjectNode().set("expectedVersion",body.path("expectedFollowUpVersion")),follow.path("version").asInt());if(!follow.path("status").asText().equals("PENDING"))throw new Failure(409,"FOLLOW_UP_NOT_PENDING");}
        }
        ObjectNode facts=validateFacts(c,patient,body,occurrence);
        if(follow!=null)FollowUpService.requireReplyFacts(follow,facts);
        boolean hasFacts=facts.hasNonNull("explicitNoSymptoms");for(String field:ARRAYS)hasFacts|=!facts.path(field).isEmpty();
        if(body.path("rawText").asText().isBlank()&&!hasFacts)throw new Failure(422,"EMPTY_FEEDBACK");
        // Preserve original text even when it differs from manually confirmed fields; require explicit review.
        if(!body.path("rawText").asText().isBlank()&&hasFacts&&!body.path("textFactsReviewed").asBoolean(false))throw new Failure(422,"REVIEW_TEXT_AND_FACTS_REQUIRED");
        boolean create=record==null;String recordId=create?FlowSupport.id("record_"):record;
        String revision=FlowSupport.id("rev_");
        if(create)execute(c,"insert into raw_record(id,patient_id,occurrence_id,version,follow_up_id) values(?,?,?,?,?)",recordId,patient,occurrenceDbId,nextVersion,followUpId);
        else{
            String old=one(c,"select latest_revision_id from raw_record where id=?",r->r.getString(1),recordId);
            for(String table:FACT_TABLES)execute(c,"update "+table+" set is_valid=false where source_revision_id=?",old);
            execute(c,"update inquiry_session set session_status='SUPERSEDED' where record_id=? and session_status='ACTIVE'",recordId);
        }
        execute(c,"insert into raw_record_revision(id,record_id,version,raw_text,confirmed_facts,source,occurred_at,actor_id,change_reason) values(?,?,?,?,?,?,?,?,?)",
            revision,recordId,nextVersion,body.path("rawText").asText(),facts.toString(),source,sqlTime(occurredAt),actor.userId(),create?"INITIAL":body.path("changeReason").asText());
        insertFacts(c,patient,revision,facts);
        execute(c,"update raw_record set latest_revision_id=?,version=? where id=?",revision,nextVersion,recordId);
        if(create&&occurrenceDbId!=null)execute(c,"update reminder_item set execution_status='DONE',status='SUCCESS',version=version+1 where id=?",occurrenceDbId);
        if(create&&follow!=null){
            execute(c,"update follow_up set status='COMPLETED',version=version+1,completed_record_id=?,updated_at=utc_timestamp(6) where id=?",recordId,followUpId);
            execute(c,"update reminder_plan set status='PAUSED' where id=?",follow.path("planId").asText());
            FollowUpService.audit(c,actor,patient,"FOLLOW_UP_COMPLETE",followUpId);
        }
        execute(c,"update patient set input_revision=input_revision+1 where id=?",patient);
        long input=one(c,"select input_revision from patient where id=?",r->r.getLong(1),patient);
        String task=FlowSupport.id("task_");
        execute(c,"insert into analysis_task(id,patient_id,revision_id,input_revision,status) values(?,?,?,?,'PENDING')",task,patient,revision,input);
        RaContextService.confirm(c,patient,revision,raCandidate,facts);
        AnalysisService.freeze(c,patient,task,input);
        execute(c,"insert into audit_log(actor_id,patient_id,action,resource_id) values(?,?,?,?)",actor.userId(),patient,create?"FEEDBACK_CREATE":"FEEDBACK_REVISE",recordId);
        ObjectNode result=detail(c,patient,recordId);
        FeedbackCapture.confirm(c,actor,patient,capture,result);
        result.set("reminder",occurrenceId==null?JSON.nullNode():ReminderService.occurrence(c,patient,occurrenceId));
        return result;
    }
    static void insertFacts(Connection c,int patient,String revision,ObjectNode f)throws SQLException{
        int i=0;for(JsonNode n:f.path("medications"))execute(c,"insert into adherence_event(patient_id,medication_id,event_time,event_type,source_revision_id,fact_key) values(?,?,?,?,?,?)",patient,n.path("medicationId").asInt(),sqlTime(utc(n.path("occurredAt").asText())),n.path("executionType").asText(),revision,"med:"+i++);
        i=0;for(JsonNode n:f.path("symptoms"))execute(c,"insert into symptom_record(patient_id,occurred_at,symptom_code,severity,source_revision_id,fact_key) values(?,?,?,?,?,?)",patient,sqlTime(utc(n.path("occurredAt").asText())),n.path("code").asText(),n.path("severity").asInt(),revision,"sym:"+i++);
        i=0;for(JsonNode n:f.path("glucose"))execute(c,"insert into bg_record(patient_id,measured_at,glucose_value,meal_phase,source,source_revision_id,fact_key) values(?,?,?,'UNKNOWN','CONFIRMED',?,?)",patient,sqlTime(utc(n.path("occurredAt").asText())),n.path("value").decimalValue(),revision,"bg:"+i++);
        i=0;for(JsonNode n:f.path("bloodPressure"))execute(c,"insert into bp_record(patient_id,measured_at,systolic,diastolic,heart_rate,source,source_revision_id,fact_key) values(?,?,?,?,?,'CONFIRMED',?,?)",patient,sqlTime(utc(n.path("occurredAt").asText())),n.path("systolic").asInt(),n.path("diastolic").asInt(),n.hasNonNull("heartRate")?n.path("heartRate").asInt():null,revision,"bp:"+i++);
        i=0;for(JsonNode n:f.path("meals"))execute(c,"insert into meal_record(patient_id,occurred_at,meal_type,intake_level,source_revision_id,fact_key) values(?,?,?,?,?,?)",patient,sqlTime(utc(n.path("occurredAt").asText())),n.path("mealType").asText(),n.path("intakeLevel").asText(),revision,"meal:"+i++);
    }
    static ObjectNode taskRow(ResultSet r)throws SQLException{
        return JSON.createObjectNode().put("taskId",r.getString("id")).put("patientId",r.getInt("patient_id")).put("revisionId",r.getString("revision_id"))
            .put("inputRevision",r.getLong("input_revision")).put("status",r.getString("status")).put("attempt",r.getInt("attempt")).put("errorCode",r.getString("error_code"));
    }
    ObjectNode task(int patient,String id)throws SQLException{return flow.read(c->{ObjectNode n=one(c,"select * from analysis_task where patient_id=? and id=?",FeedbackService::taskRow,patient,id);if(n==null)throw new Failure(404,"TASK_NOT_FOUND");return n;});}
    private static ObjectNode revisionRow(ResultSet r)throws SQLException{
        ObjectNode n=JSON.createObjectNode().put("revisionId",r.getString("id")).put("version",r.getInt("version"))
            .put("rawText",r.getString("raw_text")).put("source",r.getString("source")).put("occurredAt",iso(r.getObject("occurred_at",LocalDateTime.class)))
            .put("recordedAt",iso(r.getObject("recorded_at",LocalDateTime.class))).put("actorId",r.getInt("actor_id")).put("changeReason",r.getString("change_reason"));
        n.set("confirmedFacts",parse(r.getString("confirmed_facts")));return n;
    }
    static ObjectNode detail(Connection c,int patient,String id)throws SQLException{
        ObjectNode base=one(c,"select r.*,o.reminder_key from raw_record r left join reminder_item o on o.id=r.occurrence_id where r.patient_id=? and r.id=?",r->JSON.createObjectNode().put("recordId",r.getString("id")).put("patientId",r.getInt("patient_id")).put("version",r.getInt("version")).put("revisionId",r.getString("latest_revision_id")).put("followUpId",r.getString("follow_up_id")).put("occurrenceId",r.getString("reminder_key")),patient,id);
        if(base==null)throw new Failure(404,"RECORD_NOT_FOUND");
        List<ObjectNode> revisions=query(c,"select * from raw_record_revision where record_id=? order by version",FeedbackService::revisionRow,id);
        ObjectNode latest=revisions.get(revisions.size()-1);base.setAll(latest);base.set("revisions",JSON.valueToTree(revisions));
        base.set("analysisTask",one(c,"select * from analysis_task where revision_id=?",FeedbackService::taskRow,base.path("revisionId").asText()));
        base.put("inputRevision",base.path("analysisTask").path("inputRevision").asLong());
        base.set("reminder",base.hasNonNull("occurrenceId")?ReminderService.occurrence(c,patient,base.path("occurrenceId").asText()):JSON.nullNode());
        base.set("candidates",JSON.valueToTree(query(c,"select candidate from parsed_event_candidate where revision_id=?",r->parse(r.getString(1)),base.path("revisionId").asText())));
        FeedbackCapture.enrich(c,patient,base);
        return base;
    }
    ObjectNode detail(int patient,String id)throws SQLException{return flow.read(c->detail(c,patient,id));}
    ObjectNode daily(int patient,String date)throws SQLException{
        LocalDate day=date==null?LocalDate.now(ZONE):FlowSupport.date(date);
        String from=sqlTime(day.atStartOfDay(ZONE).withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime());
        String to=sqlTime(day.plusDays(1).atStartOfDay(ZONE).withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime());
        return flow.read(c->{List<ObjectNode> items=new ArrayList<>();for(String id:query(c,"select r.id from raw_record r join raw_record_revision v on v.id=r.latest_revision_id where r.patient_id=? and v.occurred_at>=? and v.occurred_at<? order by v.occurred_at,r.id",r->r.getString(1),patient,from,to))items.add(detail(c,patient,id));return list("items",items);});
    }
    ObjectNode acknowledge(int patient,JsonNode body)throws SQLException{
        String id=text(body,"reminderId",64);
        return flow.read(c->{ReminderService.occurrence(c,patient,id);
            if(one(c,"select r.id from raw_record r join reminder_item o on o.id=r.occurrence_id where r.patient_id=? and o.reminder_key=?",r->r.getString(1),patient,id)==null)throw new Failure(409,"FEEDBACK_REQUIRED");
            return JSON.createObjectNode().put("success",true);
        });
    }
    ObjectNode startInquiry(Actor actor,int patient,JsonNode body,String key)throws SQLException{
        return flow.write(actor,patient,"inquiry-start",key,body,c->{
            String record=text(body,"recordId",64);ObjectNode feedback=detail(c,patient,record);
            if(!feedback.path("revisionId").asText().equals(text(body,"revisionId",64)))throw new Failure(409,"REVISION_CHANGED");
            ObjectNode r3=R3ProjectionService.inquiryContext(c,patient,body);
            String session=FlowSupport.id("inq_");
            execute(c,"insert into inquiry_session(patient_id,session_key,trigger_type,trigger_time,session_status,model_version,record_id,revision_id) values(?,?,'MISSING_FIELDS',utc_timestamp(),'ACTIVE','missing-fields-v1',?,?)",patient,session,record,feedback.path("revisionId").asText());
            long sid=one(c,"select id from inquiry_session where session_key=?",r->r.getLong(1),session);int order=0;
            if(r3!=null){
                execute(c,"update inquiry_session set model_version='r3_graph_v1' where id=?",sid);
                String code=r3.path("questionCode").asText();
                String question=Map.of("BLOOD_GLUCOSE","请补充该观察时间窗内的实际血糖；没有则保留未知。","BLOOD_PRESSURE","请补充该观察时间窗内的实际血压；没有则保留未知。","SYMPTOMS","请确认该观察时间窗内的症状或明确无症状。","MEALS","请补充该观察时间窗内的进食情况；没有则保留未知。").get(code);
                execute(c,"insert into inquiry_question(session_id,question_code,question_text,source_type,order_no) values(?,?,?,'MISSING_FIELD',?)",sid,code,question,++order);
                execute(c,"insert into r3_inquiry_context(session_key,patient_id,run_id,snapshot_id,projection_id,missing_node_id,record_id,revision_id,question_code) values(?,?,?,?,?,?,?,?,?)",session,patient,r3.path("runId").asText(),r3.path("snapshotId").asText(),r3.path("projectionId").asText(),r3.path("nodeId").asText(),record,feedback.path("revisionId").asText(),code);
            }else{
                if(feedback.path("confirmedFacts").path("glucose").isEmpty())execute(c,"insert into inquiry_question(session_id,question_code,question_text,source_type,order_no) values(?,'BLOOD_GLUCOSE','是否有实际血糖测量值？没有则保留未知。','MISSING_FIELD',?)",sid,++order);
                if(!feedback.path("confirmedFacts").hasNonNull("explicitNoSymptoms")&&feedback.path("confirmedFacts").path("symptoms").isEmpty())execute(c,"insert into inquiry_question(session_id,question_code,question_text,source_type,order_no) values(?,'SYMPTOMS','请确认有症状、明确无症状或尚未记录。','MISSING_FIELD',?)",sid,++order);
            }
            if(order==0)execute(c,"update inquiry_session set session_status='COMPLETED' where id=?",sid);
            ObjectNode response=JSON.createObjectNode().put("sessionId",session).put("recordId",record).put("revisionId",feedback.path("revisionId").asText()).put("sessionStatus",order==0?"COMPLETED":"ACTIVE");
            if(r3!=null)response.set("r3Context",r3);
            return response;
        });
    }
    ObjectNode nextQuestion(int patient,String session)throws SQLException{return flow.read(c->{
        ObjectNode inq=one(c,"select id,session_status,model_version from inquiry_session where patient_id=? and session_key=?",r->JSON.createObjectNode().put("id",r.getLong(1)).put("status",r.getString(2)).put("modelVersion",r.getString(3)),patient,session);
        if(inq==null)throw new Failure(404,"INQUIRY_NOT_FOUND");
        if(inq.path("status").asText().equals("SUPERSEDED"))throw new Failure(409,"REVISION_CHANGED");
        Long sid=inq.path("id").asLong();
        ObjectNode context=inq.path("modelVersion").asText().equals("r3_graph_v1")?one(c,"select run_id,snapshot_id,projection_id,missing_node_id,record_id,revision_id,question_code from r3_inquiry_context where patient_id=? and session_key=?",r->JSON.createObjectNode().put("runId",r.getString(1)).put("snapshotId",r.getString(2)).put("projectionId",r.getString(3)).put("missingNodeId",r.getString(4)).put("recordId",r.getString(5)).put("revisionId",r.getString(6)).put("questionCode",r.getString(7)),patient,session):null;
        if(!inq.path("status").asText().equals("ACTIVE")){
            ObjectNode done=JSON.createObjectNode().put("sessionId",session).put("isFinished",true).putNull("question");if(context!=null)done.set("r3Context",context);return done;
        }
        ObjectNode q=one(c,"select question_code,question_text from inquiry_question where session_id=? order by order_no limit 1",r->JSON.createObjectNode().put("questionCode",r.getString(1)).put("questionText",r.getString(2)),sid);
        ObjectNode out=JSON.createObjectNode().put("sessionId",session).put("isFinished",q==null);if(q!=null)out.setAll(q);out.set("question",q==null?JSON.nullNode():q);if(context!=null)out.set("r3Context",context);return out;
    });}
    ObjectNode answer(Actor actor,int patient,String session,JsonNode body,String key)throws SQLException{
        return flow.write(actor,patient,"inquiry-answer:"+session,key,body,c->{
            ObjectNode inq=one(c,"select id,record_id,revision_id from inquiry_session where patient_id=? and session_key=? and session_status='ACTIVE'",r->JSON.createObjectNode().put("id",r.getLong(1)).put("recordId",r.getString(2)).put("revisionId",r.getString(3)),patient,session);
            if(inq==null)throw new Failure(409,"INQUIRY_STALE_OR_MISSING");
            String code=text(body,"questionCode",64);
            if(one(c,"select id from inquiry_question where session_id=? and question_code=?",r->r.getLong(1),inq.path("id").asLong(),code)==null)throw new Failure(422,"QUESTION_NOT_FOUND");
            ObjectNode previous=detail(c,patient,inq.path("recordId").asText());
            if(!previous.path("revisionId").asText().equals(inq.path("revisionId").asText()))throw new Failure(409,"REVISION_CHANGED");
            ObjectNode result=saveWithin(c,actor,patient,inq.path("recordId").asText(),body.path("revision"));
            execute(c,"insert into inquiry_answer(session_id,question_code,answer_text) values(?,?,?)",inq.path("id").asLong(),code,text(body,"answerText",10000));
            execute(c,"update inquiry_session set session_status='ANSWERED' where id=?",inq.path("id").asLong());return result;
        });
    }
}
