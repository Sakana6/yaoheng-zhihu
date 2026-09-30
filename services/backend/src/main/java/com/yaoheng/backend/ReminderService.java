package com.yaoheng.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.*;
import java.time.*;
import java.util.*;
import static com.yaoheng.backend.R1Service.*;
import static com.yaoheng.backend.FlowSupport.*;

final class ReminderService {
    private final FlowSupport flow;
    ReminderService(DatabaseRepository db){flow=new FlowSupport(db);}
    static ObjectNode planRow(ResultSet r)throws SQLException{
        ObjectNode p=(ObjectNode)parse(r.getString("definition"));
        return p.put("planId",r.getString("id")).put("patientId",r.getInt("patient_id")).put("version",r.getInt("version")).put("status",r.getString("status"));
    }
    static ObjectNode plan(Connection c,int patient,String id)throws SQLException{
        ObjectNode p=one(c,"select * from reminder_plan where patient_id=? and id=?",ReminderService::planRow,patient,id);
        if(p==null)throw new Failure(404,"PLAN_NOT_FOUND");return p;
    }
    ObjectNode plans(int patient)throws SQLException{return flow.read(c->list("items",query(c,"select p.*, exists(select 1 from follow_up f where f.plan_id=p.id) as managed_by_doctor from reminder_plan p where p.patient_id=? order by p.created_at,p.id",r->planRow(r).put("managedByDoctor",r.getBoolean("managed_by_doctor")),patient)));}
    static void validatePlan(Connection c,int patient,ObjectNode p)throws SQLException{
        text(p,"title",255);text(p,"localTime",5);text(p,"startDate",10);
        if(!Set.of("ONCE","DAILY").contains(p.path("frequency").asText())||!p.path("timezone").asText().equals("Asia/Shanghai"))throw new Failure(422,"INVALID_SCHEDULE");
        if(!Set.of("MEDICATION","BP","BG","FOLLOW_UP").contains(p.path("reminderType").asText()))throw new Failure(422,"INVALID_REMINDER_TYPE");
        if(!Set.of("ACTIVE","PAUSED").contains(p.path("status").asText()))throw new Failure(422,"INVALID_PLAN_STATUS");
        if(!p.path("localTime").asText().matches("([01][0-9]|2[0-3]):[0-5][0-9]"))throw new Failure(422,"INVALID_LOCAL_TIME");
        LocalDate start=date(p.path("startDate").asText());
        if(p.hasNonNull("endDate")&&date(p.path("endDate").asText()).isBefore(start))throw new Failure(422,"INVALID_DATE_RANGE");
        if(!p.path("medicationIds").isArray()||p.path("medicationIds").size()>30)throw new Failure(422,"MEDICATION_IDS_REQUIRED");
        Set<Long> ids=new HashSet<>();
        for(JsonNode med:p.path("medicationIds")){
            if(!med.isIntegralNumber()||!med.canConvertToInt()||med.asInt()<1||!ids.add(med.asLong()))throw new Failure(422,"INVALID_MEDICATION_IDS");
            if(one(c,"select id from patient_medication where id=? and patient_id=? and status='ACTIVE'",r->r.getLong(1),med.asLong(),patient)==null)throw new Failure(422,"MEDICATION_NOT_ACTIVE_OR_OWNED");
        }
        if(p.path("status").asText().equals("ACTIVE")&&p.path("reminderType").asText().equals("MEDICATION")&&ids.isEmpty())throw new Failure(422,"MEDICATION_REQUIRED");
        if(p.hasNonNull("voicePrompt")&&(!p.path("voicePrompt").isTextual()||p.path("voicePrompt").asText().length()>500))throw new Failure(422,"INVALID_VOICE_PROMPT");
    }
    ObjectNode save(Actor actor,int patient,String id,JsonNode body,String key)throws SQLException{
        Work<ObjectNode> work=c->{
            ObjectNode p=id==null?JSON.createObjectNode().put("reminderType","MEDICATION").put("status","ACTIVE").putNull("endDate"):plan(c,patient,id);
            if(id!=null){checkVersion(body,p.path("version").asInt());if(one(c,"select id from follow_up where plan_id=?",r->r.getString(1),id)!=null)throw new Failure(403,"FOLLOW_UP_PLAN_MANAGED_BY_DOCTOR");}
            for(String f:List.of("title","frequency","timezone","localTime","startDate","endDate","medicationIds","status","reminderType","voicePrompt"))if(body.has(f))p.set(f,body.get(f));
            validatePlan(c,patient,p);
            String planId=id==null?FlowSupport.id("plan_"):id;
            int version=id==null?1:p.path("version").asInt()+1;
            LocalDateTime now=LocalDateTime.now(ZoneOffset.UTC);
            p.put("effectiveFrom",iso(id==null?LocalDate.now(ZONE).atStartOfDay(ZONE).withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime():now));
            p.put("planId",planId).put("patientId",patient).put("version",version);
            if(id==null)execute(c,"insert into reminder_plan(id,patient_id,version,status,definition) values(?,?,?,?,?)",planId,patient,version,p.path("status").asText(),p.toString());
            else{cancelFuture(c,planId,now);execute(c,"update reminder_plan set version=?,status=?,definition=?,updated_at=utc_timestamp(6) where id=?",version,p.path("status").asText(),p.toString(),planId);}
            replaceLinks(c,p);expand(c,p,now);
            execute(c,"insert into audit_log(actor_id,patient_id,action,resource_id) values(?,?,?,?)",actor.userId(),patient,id==null?"PLAN_CREATE":"PLAN_REVISE",planId);
            ObjectNode out=JSON.createObjectNode();out.set("plan",p);
            out.set("occurrenceIds",JSON.valueToTree(query(c,"select reminder_key from reminder_item where plan_id=? and plan_version=? order by planned_at",r->r.getString(1),planId,version)));
            return out;
        };
        return id==null?flow.write(actor,patient,"plan-create",key,body,work):flow.transaction(patient,work);
    }
    static void replaceLinks(Connection c,ObjectNode p)throws SQLException{
        String id=p.path("planId").asText();execute(c,"delete from plan_medication where plan_id=?",id);
        for(JsonNode med:p.path("medicationIds"))execute(c,"insert into plan_medication values(?,?)",id,med.asLong());
    }
    static void cancelFuture(Connection c,String plan,LocalDateTime now)throws SQLException{
        execute(c,"update reminder_item set execution_status='CANCELLED',version=version+1 where plan_id=? and planned_at>? and execution_status='PENDING'",plan,sqlTime(now));
    }
    static void expand(Connection c,ObjectNode p,LocalDateTime now)throws SQLException{
        if(!p.path("status").asText().equals("ACTIVE"))return;
        LocalDate today=now.atOffset(ZoneOffset.UTC).atZoneSameInstant(ZONE).toLocalDate();
        LocalDate start=date(p.path("startDate").asText());
        LocalDate end=p.hasNonNull("endDate")?date(p.path("endDate").asText()):today.plusDays(6);
        LocalDateTime effective=utc(p.path("effectiveFrom").asText());
        for(int i=0;i<7;i++){
            LocalDate day=today.plusDays(i);
            if(day.isBefore(start)||day.isAfter(end)||p.path("frequency").asText().equals("ONCE")&&!day.equals(start))continue;
            LocalDateTime at=day.atTime(LocalTime.parse(p.path("localTime").asText())).atZone(ZONE).withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime();
            if(at.isBefore(effective))continue;
            if(one(c,"select id from reminder_item where plan_id=? and planned_at=? and execution_status<>'CANCELLED' limit 1",r->r.getLong(1),p.path("planId").asText(),sqlTime(at))!=null)continue;
            var snapshots=JSON.createArrayNode();
            for(JsonNode med:p.path("medicationIds")){
                ObjectNode snapshot=one(c,"select pm.id,pm.version,pm.dose,mm.generic_name from patient_medication pm join medication_master mm on mm.id=pm.medication_master_id where pm.id=? and pm.patient_id=? and pm.status='ACTIVE' and pm.start_date<=? and (pm.end_date is null or pm.end_date>=?)",r->JSON.createObjectNode().put("medicationId",r.getLong(1)).put("version",r.getInt(2)).put("dose",r.getString(3)).put("genericName",r.getString(4)),med.asLong(),p.path("patientId").asInt(),day.toString(),day.toString());
                if(snapshot!=null)snapshots.add(snapshot);
            }
            if(p.path("reminderType").asText().equals("MEDICATION")&&snapshots.isEmpty())continue;
            execute(c,"insert into reminder_item(patient_id,reminder_key,reminder_type,planned_at,title,status,plan_id,plan_version,execution_status,medication_snapshot) values(?,?,?,?,?,'PENDING',?,?,'PENDING',?) on duplicate key update id=id",
                p.path("patientId").asInt(),FlowSupport.id("occ_"),p.path("reminderType").asText(),sqlTime(at),p.path("title").asText(),p.path("planId").asText(),p.path("version").asInt(),snapshots.toString());
        }
    }
    /** Same transaction as drug revision. Past instances retain their medication snapshots. */
    static void medicationChanged(Connection c,int patient,long medication)throws SQLException{
        List<String> plans=query(c,"select p.id from reminder_plan p join plan_medication pm on pm.plan_id=p.id where p.patient_id=? and pm.medication_id=?",r->r.getString(1),patient,medication);
        for(String id:plans){
            ObjectNode p=plan(c,patient,id);var meds=JSON.createArrayNode();
            for(JsonNode m:p.path("medicationIds"))if(one(c,"select id from patient_medication where id=? and patient_id=? and status='ACTIVE'",r->r.getLong(1),m.asLong(),patient)!=null)meds.add(m);
            p.set("medicationIds",meds);if(meds.isEmpty()&&p.path("reminderType").asText().equals("MEDICATION"))p.put("status","PAUSED");
            LocalDateTime now=LocalDateTime.now(ZoneOffset.UTC);cancelFuture(c,id,now);
            p.put("version",p.path("version").asInt()+1).put("effectiveFrom",iso(now));
            execute(c,"update reminder_plan set definition=?,version=?,status=?,updated_at=utc_timestamp(6) where id=?",p.toString(),p.path("version").asInt(),p.path("status").asText(),id);
            replaceLinks(c,p);expand(c,p,now);
        }
    }
    void replenish()throws SQLException{
        List<Integer> patients=flow.read(c->query(c,"select distinct patient_id from reminder_plan where status='ACTIVE'",r->r.getInt(1)));
        for(int patient:patients)flow.transaction(patient,c->{for(ObjectNode p:query(c,"select * from reminder_plan where patient_id=? and status='ACTIVE'",ReminderService::planRow,patient))expand(c,p,LocalDateTime.now(ZoneOffset.UTC));return null;});
    }
    static ObjectNode occurrenceRow(ResultSet r)throws SQLException{
        String status=r.getString("execution_status");LocalDateTime at=r.getObject("planned_at",LocalDateTime.class);
        ObjectNode n=JSON.createObjectNode().put("occurrenceId",r.getString("reminder_key")).put("reminderId",r.getString("reminder_key"))
            .put("feedbackRecordId",r.getString("feedback_record_id")).put("followUpId",r.getString("follow_up_id")).put("planId",r.getString("plan_id")).put("planVersion",r.getInt("plan_version")).put("version",r.getInt("version"))
            .put("reminderType",r.getString("reminder_type")).put("title",r.getString("title")).put("plannedAt",iso(at))
            .put("executionStatus",status).put("status",status.equals("DONE")?"SUCCESS":"PENDING")
            .put("displayStatus",status.equals("PENDING")&&at.isBefore(LocalDateTime.now(ZoneOffset.UTC))?"OVERDUE":status).put("skipReason",r.getString("skip_reason"));
        try{n.set("medications",JSON.readTree(r.getString("medication_snapshot")));}catch(Exception e){throw new SQLException("Invalid occurrence snapshot",e);}return n;
    }
    static ObjectNode occurrence(Connection c,int patient,String id)throws SQLException{
        ObjectNode n=one(c,"select o.*,r.id feedback_record_id from reminder_item o left join raw_record r on r.occurrence_id=o.id and r.patient_id=o.patient_id where o.patient_id=? and o.reminder_key=? and o.plan_id is not null",ReminderService::occurrenceRow,patient,id);
        if(n==null)throw new Failure(404,"OCCURRENCE_NOT_FOUND");return n;
    }
    ObjectNode occurrences(int patient,String day,boolean upcoming)throws SQLException{
        LocalDate date=day==null?LocalDate.now(ZONE):date(day);
        String start=sqlTime(date.atStartOfDay(ZONE).withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime());
        String end=sqlTime(date.plusDays(upcoming?7:1).atStartOfDay(ZONE).withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime());
        return flow.read(c->list("items",query(c,"select o.*,r.id feedback_record_id from reminder_item o left join raw_record r on r.occurrence_id=o.id and r.patient_id=o.patient_id where o.patient_id=? and o.plan_id is not null and o.planned_at>=? and o.planned_at<? order by o.planned_at,o.id",ReminderService::occurrenceRow,patient,start,end)));
    }
    ObjectNode skip(Actor actor,int patient,String id,JsonNode body,String key)throws SQLException{
        return flow.write(actor,patient,"skip:"+id,key,body,c->{
            ObjectNode n=occurrence(c,patient,id);if(n.hasNonNull("followUpId"))throw new Failure(409,"FOLLOW_UP_REPLY_REQUIRED");checkVersion(body,n.path("version").asInt());
            if(!n.path("executionStatus").asText().equals("PENDING"))throw new Failure(409,"OCCURRENCE_NOT_PENDING");
            execute(c,"update reminder_item set execution_status='SKIPPED',skip_reason=?,version=version+1 where patient_id=? and reminder_key=?",text(body,"reason",500),patient,id);
            execute(c,"insert into audit_log(actor_id,patient_id,action,resource_id) values(?,?,'OCCURRENCE_SKIP',?)",actor.userId(),patient,id);
            return occurrence(c,patient,id);
        });
    }
}
