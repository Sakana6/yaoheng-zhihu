package com.yaoheng.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.*;
import java.util.*;
import static com.yaoheng.backend.R1Service.*;
import static com.yaoheng.backend.FlowSupport.*;

/** TX1 hook: preserves workflow source and independently records acquisition provenance. */
final class FeedbackCapture {
    static ObjectNode before(Connection c,int patient,String record,JsonNode body)throws SQLException{
        if(body.has("captureSource"))throw new Failure(422,"CAPTURE_SOURCE_SERVER_OWNED");
        if(!body.has("captureTaskId")){
            // Revisions retain acquisition provenance, so they must retain its fact boundary too.
            if(record!=null){
                String linked=one(c,"select task_id from feedback_capture_link where patient_id=? and record_id=? and capture_source='DEVICE'",r->r.getString(1),patient,record);
                if(linked!=null)validateDevice(CaptureService.task(c,patient,linked),body);
            }
            return null;
        }
        if(record!=null)throw new Failure(422,"CAPTURE_CREATE_ONLY");
        ObjectNode task=CaptureService.task(c,patient,text(body,"captureTaskId",48));
        if(!body.path("captureVersion").isIntegralNumber()||!body.path("captureVersion").canConvertToInt()||body.path("captureVersion").asInt()!=task.path("version").asInt())throw new Failure(409,"CAPTURE_VERSION_CONFLICT");
        String kind=task.path("kind").asText(),status=task.path("status").asText();
        if(!Set.of("VOICE","DEVICE").contains(kind))throw new Failure(422,"CAPTURE_KIND_MISMATCH");
        if(!status.equals("CANDIDATE_READY"))throw new Failure(409,"CAPTURE_NOT_READY_FOR_FEEDBACK");
        if(!body.path("textFactsReviewed").asBoolean())throw new Failure(422,"REVIEW_CAPTURE_REQUIRED");
        if(kind.equals("DEVICE"))validateDevice(task,body);
        return task;
    }
    private static void validateDevice(ObjectNode task,JsonNode body){
            if(body.hasNonNull("occurrenceId")||body.hasNonNull("followUpId")||!body.path("source").asText().equals("MANUAL"))throw new Failure(422,"DEVICE_STANDALONE_MEASUREMENT_REQUIRED");
            JsonNode facts=body.path("confirmedFacts"),proposed=task.path("result").path("proposedFacts");
            for(String group:List.of("medications","symptoms","meals"))if(!facts.path(group).isArray()||!facts.path(group).isEmpty())throw new Failure(422,"DEVICE_MEASUREMENTS_ONLY");
            if(facts.hasNonNull("explicitNoSymptoms"))throw new Failure(422,"DEVICE_MEASUREMENTS_ONLY");
            for(String group:List.of("glucose","bloodPressure")){
                if(facts.path(group).size()!=proposed.path(group).size())throw new Failure(422,"DEVICE_MEASUREMENT_REQUIRED");
                // Measurement edits remain explicit in the final revision; the untouched raw event is retained.
            }
    }
    static void confirm(Connection c,Actor actor,int patient,ObjectNode task,ObjectNode result)throws SQLException{
        if(task==null)return;
        execute(c,"insert into feedback_capture_link(record_id,task_id,patient_id,capture_source) values(?,?,?,?)",result.path("recordId").asText(),task.path("taskId").asText(),patient,task.path("kind").asText());
        execute(c,"update capture_task set status='CONFIRMED',confirmed_json=?,version=version+1,updated_at=utc_timestamp(6) where task_id=?",result.toString(),task.path("taskId").asText());
        CaptureService.audit(c,actor,patient,task.path("taskId").asText(),"CONFIRM_FEEDBACK",task.path("version").asInt()+1);
        result.put("captureTaskId",task.path("taskId").asText()).put("captureSource",task.path("kind").asText());
    }
    static void enrich(Connection c,int patient,ObjectNode result)throws SQLException{
        ObjectNode link=one(c,"select task_id,capture_source from feedback_capture_link where patient_id=? and record_id=?",r->JSON.createObjectNode().put("captureTaskId",r.getString(1)).put("captureSource",r.getString(2)),patient,result.path("recordId").asText());
        if(link!=null)result.setAll(link);
    }
}
