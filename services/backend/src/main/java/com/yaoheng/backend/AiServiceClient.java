package com.yaoheng.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.*;
import static com.yaoheng.backend.R1Service.*;

final class AiServiceClient {
    static final class Error extends Exception {
        final boolean retryable; final String code;
        Error(String code,boolean retryable){super(code);this.code=code;this.retryable=retryable;}
    }
    private final HttpClient client=HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(3)).build();
    private final String base=System.getenv().getOrDefault("AI_SERVICE_URL","http://127.0.0.1:8000");
    ObjectNode call(String path,JsonNode input)throws Error {
        try {
            var request=HttpRequest.newBuilder(URI.create(base+path)).timeout(Duration.ofSeconds(15)).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(input.toString())).build();
            var response=client.send(request,HttpResponse.BodyHandlers.ofString());
            if(response.statusCode()!=200)throw new Error("AI_HTTP_"+response.statusCode(),response.statusCode()>=500||response.statusCode()==429);
            if(response.body().length()>8_000_000)throw new Error("AI_RESPONSE_TOO_LARGE",false);
            JsonNode result=JSON.readTree(response.body());if(!result.isObject())throw new Error("AI_SCHEMA_INVALID",false);
            return (ObjectNode)result;
        }catch(Error e){throw e;}catch(java.io.IOException e){throw new Error("AI_NETWORK_OR_JSON",!(e instanceof com.fasterxml.jackson.core.JsonProcessingException));}
        catch(InterruptedException e){Thread.currentThread().interrupt();throw new Error("AI_INTERRUPTED",true);}
        catch(RuntimeException e){throw new Error("AI_CONFIGURATION_INVALID",false);}
    }
    static void validate(ObjectNode result,JsonNode manifest)throws Error {
        if(!result.path("algorithmVersion").asText().equals("rules_r1_1")||!result.path("inputRevision").isIntegralNumber()||!result.path("inputRevision").canConvertToLong()||result.path("inputRevision").asLong(-1)!=manifest.path("inputRevision").asLong())throw new Error("AI_VERSION_INVALID",false);
        try {
            // Python datetime carries microseconds; Java Instant may include nanoseconds.
            if(!java.time.OffsetDateTime.parse(result.path("referenceTime").asText()).toInstant().truncatedTo(java.time.temporal.ChronoUnit.MICROS).equals(java.time.OffsetDateTime.parse(manifest.path("referenceTime").asText()).toInstant().truncatedTo(java.time.temporal.ChronoUnit.MICROS)))throw new Error("AI_REFERENCE_TIME_INVALID",false);
        }catch(java.time.format.DateTimeParseException e){throw new Error("AI_REFERENCE_TIME_INVALID",false);}
        for(String field:List.of("timeline","evidence","evaluations","jointEvents","missingFields","candidates","medications"))if(!result.path(field).isArray())throw new Error("AI_SCHEMA_INVALID",false);
        if(!Set.of("SUFFICIENT","PARTIAL","INSUFFICIENT").contains(result.path("dataStatus").asText())||!result.has("risk"))throw new Error("AI_SCHEMA_INVALID",false);
        if(!result.path("profile").isObject())throw new Error("AI_PROFILE_INVALID",false);
        for(String field:List.of("lowBgCount14d","lowBpCount14d","missedMedCount14d")){
            JsonNode count=result.path("profile").path(field);
            if(!count.isIntegralNumber()||!count.canConvertToLong()||count.asLong()<0)throw new Error("AI_PROFILE_INVALID",false);
        }
        JsonNode rate=result.path("profile").path("responseRate");
        if(!rate.isNull()&&(!rate.isNumber()||!Double.isFinite(rate.asDouble())||rate.asDouble()<0||rate.asDouble()>1))throw new Error("AI_PROFILE_INVALID",false);
        if(result.path("medications").size()!=manifest.path("medications").size())throw new Error("AI_MEDICATION_INVALID",false);
        for(int i=0;i<result.path("medications").size();i++){
            JsonNode medication=result.path("medications").get(i);
            if(!medication.isObject()||!medication.path("classes").isArray())throw new Error("AI_MEDICATION_INVALID",false);
            ObjectNode original=((ObjectNode)medication).deepCopy();original.remove("classes");
            if(!original.equals(manifest.path("medications").get(i)))throw new Error("AI_MEDICATION_INVALID",false);
        }
        Set<String> refs=new HashSet<>();for(JsonNode record:manifest.path("records"))refs.add(record.path("recordId").asText()+":"+record.path("revisionId").asText());
        for(JsonNode candidate:result.path("candidates"))if(!refs.contains(candidate.path("evidence").path("sourceId").asText()+":"+candidate.path("evidence").path("revisionId").asText())||!candidate.path("confirmationStatus").asText().equals("PENDING"))throw new Error("AI_CANDIDATE_INVALID",false);
        for(JsonNode evidence:result.path("evidence"))if(!refs.contains(evidence.path("sourceId").asText()+":"+evidence.path("revisionId").asText())||!evidence.path("fieldPath").asText().startsWith("confirmedFacts."))throw new Error("AI_EVIDENCE_INVALID",false);
        Map<String,JsonNode> canonicalEvidence=new HashMap<>();for(JsonNode e:result.path("evidence"))canonicalEvidence.put(e.path("factId").asText(),e);
        Map<String,JsonNode> expectedPayloads=new HashMap<>();
        for(JsonNode evidence:result.path("evidence")){
            JsonNode record=null;for(JsonNode r:manifest.path("records"))if(r.path("revisionId").equals(evidence.path("revisionId"))&&r.path("recordId").equals(evidence.path("sourceId")))record=r;
            String field=evidence.path("fieldPath").asText();
            var matcher=java.util.regex.Pattern.compile("confirmedFacts\\.(medications|symptoms|glucose|bloodPressure|meals)\\[([0-9]+)\\]").matcher(field);
            JsonNode original=null;
            if(record!=null&&matcher.matches()){try{original=record.path("confirmedFacts").path(matcher.group(1)).path(Integer.parseInt(matcher.group(2)));}catch(NumberFormatException ignored){}}
            else if(record!=null&&field.equals("confirmedFacts.explicitNoSymptoms")&&record.path("confirmedFacts").path("explicitNoSymptoms").asBoolean())original=record;
            if(original==null||original.isMissingNode()||!original.path("occurredAt").equals(evidence.path("occurredAt"))||!evidence.path("factId").asText().equals(evidence.path("revisionId").asText()+":"+field))throw new Error("AI_EVIDENCE_INVALID",false);
            expectedPayloads.put(evidence.path("factId").asText(),field.equals("confirmedFacts.explicitNoSymptoms")?JSON.createObjectNode():original);
        }
        for(JsonNode fact:result.path("timeline"))if(!fact.path("evidence").equals(canonicalEvidence.get(fact.path("evidence").path("factId").asText()))||!fact.path("payload").equals(expectedPayloads.get(fact.path("evidence").path("factId").asText()))||!fact.path("time").equals(fact.path("evidence").path("occurredAt")))throw new Error("AI_TIMELINE_INVALID",false);
        for(JsonNode event:result.path("jointEvents")){
            if(!event.path("eventType").asText().matches("JE00[1-5]")||!event.path("evidence").isArray()||event.path("evidence").isEmpty())throw new Error("AI_EVENT_INVALID",false);
            for(JsonNode e:event.path("evidence"))if(!e.equals(canonicalEvidence.get(e.path("factId").asText())))throw new Error("AI_EVIDENCE_INVALID",false);
        }
        Set<String> rules=new HashSet<>();
        for(JsonNode evaluation:result.path("evaluations"))if(!evaluation.path("ruleId").asText().matches("JE00[1-9]|JE010")||!rules.add(evaluation.path("ruleId").asText())||!Set.of("MATCHED","NOT_MATCHED","INSUFFICIENT","NOT_APPLICABLE").contains(evaluation.path("status").asText()))throw new Error("AI_EVALUATION_INVALID",false);
        if(rules.size()!=10)throw new Error("AI_EVALUATION_INVALID",false);
        for(JsonNode evaluation:result.path("evaluations")){
            if(!evaluation.path("missingFields").isArray()||!evaluation.path("evidence").isArray())throw new Error("AI_EVALUATION_INVALID",false);
            for(JsonNode e:evaluation.path("evidence"))if(!e.equals(canonicalEvidence.get(e.path("factId").asText())))throw new Error("AI_EVIDENCE_INVALID",false);
        }
        JsonNode risk=result.path("risk");if(!risk.isNull()){
            for(String field:List.of("deintensificationScore","interactionScore","behaviorScore","jointEventScore"))if(!risk.path(field).isIntegralNumber()||!risk.path(field).canConvertToInt()||risk.path(field).asInt()<0||risk.path(field).asInt()>100)throw new Error("AI_SCORE_INVALID",false);
            if(!Set.of("OBSERVE","RETEST_SOON","CLINIC_REVIEW","HIGH_PRIORITY").contains(risk.path("reviewPriority").asText()))throw new Error("AI_PRIORITY_INVALID",false);
        }
    }
}
