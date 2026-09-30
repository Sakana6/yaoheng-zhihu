package com.yaoheng.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.*;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.regex.*;
import static com.yaoheng.backend.FlowSupport.*;
import static com.yaoheng.backend.R1Service.*;

/** Derived explanations only. Does not publish analysis_latest or change confirmed facts. */
final class R3ProjectionService {
    private final FlowSupport flow;
    R3ProjectionService(DatabaseRepository db){flow=new FlowSupport(db);}
    ObjectNode get(int patient,String run)throws SQLException{return flow.read(c->compute(c,patient,run));}
    static ObjectNode compute(Connection c,int patient,String run)throws SQLException {
        ObjectNode stored=one(c,"select r.id,r.snapshot_id,t.manifest from analysis_run r join analysis_task t on t.id=r.task_id where r.patient_id=? and r.id=?",r->{
            ObjectNode n=JSON.createObjectNode().put("runId",r.getString(1)).put("snapshotId",r.getString(2));n.set("manifest",parse(r.getString(3)));return n;
        },patient,run);
        if(stored==null)throw new Failure(404,"ANALYSIS_NOT_FOUND");
        JsonNode manifest=stored.path("manifest");
        try {
            ObjectNode output=new AiServiceClient().call("/ai/r3/graph",manifest);
            validate(output,manifest);
            output.put("runId",stored.path("runId").asText()).put("snapshotId",stored.path("snapshotId").asText());
            return output;
        }catch(AiServiceClient.Error e){throw new Failure(e.code.equals("AI_HTTP_422")?422:503,"R3_PROJECTION_UNAVAILABLE");}
    }
    static final Map<String,String> QUESTIONS=Map.of("glucose","BLOOD_GLUCOSE","bloodPressure","BLOOD_PRESSURE","symptoms","SYMPTOMS","meals","MEALS");
    static void require(boolean condition){if(!condition)throw new Failure(503,"R3_PROJECTION_INVALID");}
    static void validate(ObjectNode out,JsonNode manifest){
        try {
            require(out.path("projectionVersion").asText().equals("r3_projection_v1")&&out.path("graphVersion").asText().equals("r3_graph_v1")&&out.path("chainVersion").asText().equals("r3_chain_v1"));
            require(out.path("patientId").isIntegralNumber()&&out.path("patientId").asLong()==manifest.path("patientId").asLong()&&out.path("inputRevision").isIntegralNumber()&&out.path("inputRevision").asLong()==manifest.path("inputRevision").asLong());
            require(OffsetDateTime.parse(out.path("referenceTime").asText()).toInstant().truncatedTo(java.time.temporal.ChronoUnit.MICROS).equals(OffsetDateTime.parse(manifest.path("referenceTime").asText()).toInstant().truncatedTo(java.time.temporal.ChronoUnit.MICROS)));
            require(out.path("inputHash").asText().matches("[a-f0-9]{64}")&&out.path("projectionId").asText().matches("projection_[a-f0-9]{64}"));
            for(String field:List.of("events","anchors","nodes","edges","chains","missingNodes"))require(out.path(field).isArray());
            Map<String,JsonNode> records=new HashMap<>(),anchors=new HashMap<>(),evidence=new HashMap<>();
            for(JsonNode r:manifest.path("records"))records.put(r.path("recordId").asText(),r);
            for(JsonNode a:out.path("anchors"))require(anchors.put(a.path("anchorId").asText(),a)==null);
            Set<String> eventIds=new HashSet<>(),factIds=new HashSet<>();
            int expected=0;for(JsonNode r:records.values()){
                for(String field:List.of("medications","glucose","bloodPressure","symptoms","meals"))expected+=r.path("confirmedFacts").path(field).size();
                if(r.path("confirmedFacts").path("explicitNoSymptoms").asBoolean(false))expected++;
                if(!r.path("rawText").asText().isEmpty())expected++;
            }
            require(out.path("events").size()==expected&&out.path("anchors").size()==expected);
            for(JsonNode event:out.path("events")){
                require(eventIds.add(event.path("eventId").asText()));
                JsonNode ref=event.path("evidence"),record=records.get(ref.path("sourceId").asText());
                require(record!=null&&record.path("revisionId").equals(ref.path("revisionId")));
                String field=ref.path("fieldPath").asText();require(ref.path("factId").asText().equals(record.path("revisionId").asText()+":"+field));
                require(factIds.add(ref.path("factId").asText()));
                JsonNode anchor=anchors.get(event.path("anchorId").asText());require(anchor!=null);
                if(field.equals("rawText")){
                    require(event.path("kind").asText().equals("TEXT_NOTE")&&event.path("confirmationStatus").asText().equals("PENDING"));
                    require(event.path("payload").path("text").asText().equals(record.path("rawText").asText())&&anchor.path("start").isNull()&&anchor.path("end").isNull());
                    require(event.path("eligibility").asText().equals("UNCONFIRMED"));
                }else {
                    require(event.path("confirmationStatus").asText().equals("CONFIRMED"));
                    String time;
                    if(field.equals("confirmedFacts.explicitNoSymptoms")){
                        require(record.path("confirmedFacts").path("explicitNoSymptoms").asBoolean(false)&&event.path("kind").asText().equals("NO_SYMPTOMS"));time=record.path("occurredAt").asText();
                    }else{
                        Matcher m=Pattern.compile("confirmedFacts\\.(medications|glucose|bloodPressure|symptoms|meals)\\[(\\d+)\\]").matcher(field);require(m.matches());
                        JsonNode payload=record.path("confirmedFacts").path(m.group(1)).path(Integer.parseInt(m.group(2)));
                        require(!payload.isMissingNode()&&payload.equals(event.path("payload")));
                        require(event.path("kind").asText().equals(Map.of("medications","ADHERENCE","glucose","BG","bloodPressure","BP","symptoms","SYMPTOM","meals","MEAL").get(m.group(1))));time=payload.path("occurredAt").asText();
                    }
                    require(OffsetDateTime.parse(anchor.path("start").asText()).toInstant().equals(OffsetDateTime.parse(time).toInstant())&&anchor.path("start").equals(anchor.path("end")));
                    var occurred=OffsetDateTime.parse(time).toInstant();var reference=OffsetDateTime.parse(manifest.path("referenceTime").asText()).toInstant().truncatedTo(java.time.temporal.ChronoUnit.MICROS);
                    String eligibility=occurred.isAfter(reference)?"FUTURE":occurred.isBefore(reference.minusSeconds(14*86400))?"OUTSIDE_WINDOW":"IN_WINDOW";
                    require(event.path("eligibility").asText().equals(eligibility));
                    if(eligibility.equals("IN_WINDOW"))evidence.put(ref.path("factId").asText(),ref);
                }
            }
            Set<String> nodes=new HashSet<>();for(JsonNode n:out.path("nodes"))require(nodes.add(n.path("id").asText()));
            require(nodes.containsAll(eventIds));
            Map<String,JsonNode> nodeMap=new HashMap<>();for(JsonNode n:out.path("nodes"))nodeMap.put(n.path("id").asText(),n);
            for(JsonNode event:out.path("events")){
                ObjectNode expectedNode=((ObjectNode)event).deepCopy();expectedNode.put("id",event.path("eventId").asText()).put("nodeType","EVENT");
                require(expectedNode.equals(nodeMap.get(event.path("eventId").asText())));
            }
            for(JsonNode e:out.path("edges")){
                require(nodes.contains(e.path("source").asText())&&nodes.contains(e.path("target").asText()));checkRefs(e.path("evidence"),evidence);
                JsonNode left=nodeMap.get(e.path("source").asText()),right=nodeMap.get(e.path("target").asText());
                for(JsonNode endpoint:List.of(left,right))if(endpoint.path("nodeType").asText().equals("EVENT"))
                    require(endpoint.path("confirmationStatus").asText().equals("CONFIRMED")&&endpoint.path("eligibility").asText().equals("IN_WINDOW"));
                String relation=e.path("relation").asText(),lt=left.path("nodeType").asText(),rt=right.path("nodeType").asText();
                require(e.path("ruleVersion").asText().equals("r3_graph_v1"));
                switch(relation){
                    case "BEFORE", "AFTER", "OVERLAP" -> {
                        require(lt.equals("EVENT")&&rt.equals("EVENT"));
                        int order=OffsetDateTime.parse(anchors.get(left.path("anchorId").asText()).path("start").asText()).toInstant().compareTo(OffsetDateTime.parse(anchors.get(right.path("anchorId").asText()).path("start").asText()).toInstant());
                        require(relation.equals("BEFORE")?order<0:relation.equals("AFTER")?order>0:order==0);
                    }
                    case "WITHIN" -> {
                        require(lt.equals("EVENT")&&rt.equals("WINDOW"));
                        var time=OffsetDateTime.parse(anchors.get(left.path("anchorId").asText()).path("start").asText()).toInstant();
                        require(!time.isBefore(OffsetDateTime.parse(right.path("start").asText()).toInstant())&&!time.isAfter(OffsetDateTime.parse(right.path("end").asText()).toInstant()));
                    }
                    case "SUPPORTS" -> require(lt.equals("EVENT")&&rt.equals("CHAIN"));
                    case "HAS_MISSING" -> require(lt.equals("CHAIN")&&rt.equals("MISSING")&&right.path("chainId").asText().equals(e.path("source").asText()));
                    case "CO_OCCURS" -> require(lt.equals("CHAIN")&&rt.equals("CHAIN")&&Set.of("G","B").contains(left.path("chainType").asText())&&right.path("chainType").asText().equals("C")&&left.path("status").asText().equals("MATCHED"));
                    default -> require(false);
                }
            }
            Set<String> missing=new HashSet<>();
            for(JsonNode gap:out.path("missingNodes")){
                require(nodes.contains(gap.path("nodeId").asText())&&missing.add(gap.path("nodeId").asText()));
                ObjectNode gapNode=((ObjectNode)gap).deepCopy();gapNode.put("id",gap.path("nodeId").asText());require(gapNode.equals(nodeMap.get(gap.path("nodeId").asText())));
                JsonNode r=records.get(gap.path("recordId").asText());require(r!=null&&r.path("revisionId").equals(gap.path("revisionId")));
                require(gap.path("questionCode").asText().equals(QUESTIONS.get(gap.path("field").asText())));
                String kind=Map.of("glucose","BG","bloodPressure","BP","symptoms","SYMPTOM","meals","MEAL").get(gap.path("field").asText());
                var center=OffsetDateTime.parse(r.path("occurredAt").asText()).toInstant();
                for(JsonNode event:out.path("events"))if(event.path("eligibility").asText().equals("IN_WINDOW")){
                    String eventKind=event.path("kind").asText();
                    if(!eventKind.equals(kind)&&!(kind.equals("SYMPTOM")&&eventKind.equals("NO_SYMPTOMS")))continue;
                    if(kind.equals("MEAL")&&event.path("payload").path("intakeLevel").asText().equals("UNKNOWN"))continue;
                    var time=OffsetDateTime.parse(anchors.get(event.path("anchorId").asText()).path("start").asText()).toInstant();
                    require(time.isBefore(center.minusSeconds(7200))||time.isAfter(center.plusSeconds(7200)));
                }
            }
            for(JsonNode chain:out.path("chains")){
                require(nodes.contains(chain.path("chainId").asText())&&chain.path("causalClaim").isBoolean()&&!chain.path("causalClaim").asBoolean());
                JsonNode chainNode=nodeMap.get(chain.path("chainId").asText());
                require(chainNode.path("nodeType").asText().equals("CHAIN")&&chainNode.path("chainType").equals(chain.path("chainType"))&&chainNode.path("status").equals(chain.path("status")));
                checkRefs(chain.path("evidence"),evidence);
                require(chain.path("medicationContext").isArray());
                for(JsonNode context:chain.path("medicationContext")){
                    boolean found=false;for(JsonNode med:manifest.path("medications"))if(med.equals(context.path("snapshot")))found=true;
                    require(found&&context.path("classes").isArray()&&context.path("dictionaryHash").asText().matches("[a-f0-9]{64}"));
                }
                for(JsonNode gap:chain.path("missingNodeIds"))require(missing.contains(gap.asText()));
            }
        }catch(Failure e){throw e;}catch(RuntimeException e){throw new Failure(503,"R3_PROJECTION_INVALID");}
    }
    static void checkRefs(JsonNode refs,Map<String,JsonNode> known){
        require(refs.isArray());for(JsonNode ref:refs)require(ref.equals(known.get(ref.path("factId").asText())));
    }
    static ObjectNode inquiryContext(Connection c,int patient,JsonNode body)throws SQLException {
        JsonNode context=body.path("r3Context");if(context.isMissingNode()||context.isNull())return null;
        ObjectNode projection=compute(c,patient,text(context,"runId",64));
        long current=one(c,"select input_revision from patient where id=?",r->r.getLong(1),patient);
        if(current!=projection.path("inputRevision").asLong())throw new Failure(409,"R3_INPUT_CHANGED");
        if(!projection.path("projectionId").asText().equals(text(context,"projectionId",96)))throw new Failure(409,"R3_PROJECTION_CHANGED");
        String id=text(context,"missingNodeId",96);
        for(JsonNode gap:projection.path("missingNodes"))if(gap.path("nodeId").asText().equals(id)){
            if(!gap.path("recordId").asText().equals(text(body,"recordId",64))||!gap.path("revisionId").asText().equals(text(body,"revisionId",64)))throw new Failure(409,"R3_SOURCE_CHANGED");
            ObjectNode result=((ObjectNode)gap).deepCopy();result.put("runId",projection.path("runId").asText()).put("snapshotId",projection.path("snapshotId").asText()).put("projectionId",projection.path("projectionId").asText());return result;
        }
        throw new Failure(422,"R3_MISSING_NODE_NOT_FOUND");
    }
}
