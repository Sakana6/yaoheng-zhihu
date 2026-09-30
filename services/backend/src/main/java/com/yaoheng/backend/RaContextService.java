package com.yaoheng.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.*;
import java.util.Objects;
import static com.yaoheng.backend.FlowSupport.*;
import static com.yaoheng.backend.R1Service.*;

/** Same-TX frozen evidence only: never calls inference or modifies the original manifest. */
final class RaContextService {
    static ObjectNode candidate(Connection c,int patient,String record,JsonNode body)throws SQLException{
        if(!body.hasNonNull("raArtifactId"))return null;
        if(!RaCandidateService.enabled())throw new Failure(409,"RA_CONFIRMATION_DISABLED");
        ObjectNode artifact=RaCandidateService.get(c,patient,text(body,"raArtifactId",64));
        long current=one(c,"select input_revision from patient where id=?",r->r.getLong(1),patient);
        String previous=record==null?null:FeedbackService.detail(c,patient,record).path("revisionId").asText();
        if(!artifact.path("state").asText().equals("READY")||artifact.path("inputRevision").asLong()!=current||!Objects.equals(record,artifact.hasNonNull("recordId")?artifact.path("recordId").asText():null)||!Objects.equals(previous,artifact.hasNonNull("recordRevision")?artifact.path("recordRevision").asText():null))throw new Failure(409,"RA_ARTIFACT_STALE");
        if(!artifact.path("artifactHash").asText().equals(text(body,"raArtifactHash",64)))throw new Failure(422,"RA_ARTIFACT_HASH_MISMATCH");
        if(!body.path("rawText").asText().equals(artifact.path("input").path("rawText").asText()))throw new Failure(409,"RA_TEXT_CHANGED");
        if(!body.path("textFactsReviewed").asBoolean())throw new Failure(422,"RA_REVIEW_REQUIRED");
        return artifact;
    }
    static void confirm(Connection c,int patient,String revision,ObjectNode artifact,JsonNode facts)throws SQLException{
        if(artifact==null)return;
        execute(c,"insert into ra_candidate_confirmation(revision_id,patient_id,artifact_id,artifact_hash,confirmed_facts_hash) values(?,?,?,?,?)",revision,patient,artifact.path("artifactId").asText(),artifact.path("artifactHash").asText(),hash(canonical(facts).toString()));
    }
    static void freeze(Connection c,int patient,String task,long input,ObjectNode manifest)throws SQLException{
        if(!RaCandidateService.enabled())return;
        ObjectNode context=JSON.createObjectNode().put("contextVersion","ra_context_v1").put("patientId",patient).put("taskId",task).put("inputRevision",input)
            .put("referenceTime",manifest.path("referenceTime").asText()).put("baseManifestHash",hash(canonical(manifest).toString()));
        context.set("medicationHistory",JSON.valueToTree(query(c,"select * from medication_revision where patient_id=? order by medication_id,version",r->{
            ObjectNode row=JSON.createObjectNode().put("medicationId",r.getLong("medication_id")).put("version",r.getInt("version")).put("validFrom",iso(r.getObject("valid_from",java.time.LocalDateTime.class))).put("validTo",iso(r.getObject("valid_to",java.time.LocalDateTime.class)));row.set("snapshot",parse(r.getString("snapshot")));return row;
        },patient)));
        context.set("occurrences",JSON.valueToTree(query(c,"select reminder_key,planned_at,execution_status,medication_snapshot from reminder_item where patient_id=? and plan_id is not null order by reminder_key",r->{
            ObjectNode row=JSON.createObjectNode().put("occurrenceId",r.getString(1)).put("plannedAt",iso(r.getObject(2,java.time.LocalDateTime.class))).put("executionStatus",r.getString(3));row.set("medications",parse(r.getString(4)));return row;
        },patient)));
        context.set("recordLinks",JSON.valueToTree(query(c,"select r.id,r.latest_revision_id,o.reminder_key from raw_record r left join reminder_item o on o.id=r.occurrence_id where r.patient_id=? order by r.id",r->JSON.createObjectNode().put("recordId",r.getString(1)).put("revisionId",r.getString(2)).put("occurrenceId",r.getString(3)),patient)));
        context.set("candidateSources",JSON.valueToTree(query(c,"select f.revision_id,f.artifact_id,f.artifact_hash,f.confirmed_facts_hash,a.result_json from ra_candidate_confirmation f join ra_candidate_artifact a on a.id=f.artifact_id join raw_record r on r.latest_revision_id=f.revision_id where f.patient_id=? order by f.revision_id",r->{
            ObjectNode row=JSON.createObjectNode().put("revisionId",r.getString(1)).put("artifactId",r.getString(2)).put("artifactHash",r.getString(3)).put("confirmedFactsHash",r.getString(4));JsonNode result=parse(r.getString(5));
            if(!hash(canonical(result).toString()).equals(r.getString(3)))throw new Failure(503,"RA_ARTIFACT_HASH_MISMATCH");row.set("result",result);return row;
        },patient)));
        context.put("projectionVersion","ra_projection_v1").put("temporalVersion","ra_temporal_v1");
        execute(c,"insert into ra_analysis_context(task_id,patient_id,input_revision,base_manifest_hash,context_hash,context_json) values(?,?,?,?,?,?)",task,patient,input,context.path("baseManifestHash").asText(),hash(canonical(context).toString()),context.toString());
    }
    static ObjectNode read(Connection c,int patient,String task)throws SQLException{
        ObjectNode row=one(c,"select c.*,t.manifest from ra_analysis_context c join analysis_task t on t.id=c.task_id where c.patient_id=? and c.task_id=?",r->{
            ObjectNode out=JSON.createObjectNode();JsonNode context=parse(r.getString("context_json")),manifest=parse(r.getString("manifest"));
            if(!hash(canonical(context).toString()).equals(r.getString("context_hash"))||!hash(canonical(manifest).toString()).equals(r.getString("base_manifest_hash")))throw new Failure(503,"RA_CONTEXT_HASH_MISMATCH");
            if(!context.path("contextVersion").asText().equals("ra_context_v1"))throw new Failure(503,"RA_CONTEXT_VERSION_UNSUPPORTED");
            out.set("context",context);out.set("manifest",manifest);out.put("contextHash",r.getString("context_hash"));return out;
        },patient,task);
        if(row==null)throw new Failure(404,"RA_UNAVAILABLE");return row;
    }
}
