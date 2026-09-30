package com.yaoheng.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.*;
import java.util.function.Consumer;
import static com.yaoheng.backend.R1Service.*;

public final class R3BoundaryTest {
    static void rejects(ObjectNode original,JsonNode manifest,Consumer<ObjectNode> tamper){
        ObjectNode changed=original.deepCopy();tamper.accept(changed);
        try{R3ProjectionService.validate(changed,manifest);throw new AssertionError("Tampered R3 accepted");}
        catch(Failure expected){}
    }
    public static void main(String[] args)throws Exception {
        JsonNode fixture=JSON.readTree(Files.readString(Path.of(args[0])));ObjectNode out=(ObjectNode)fixture.path("projection");JsonNode manifest=fixture.path("manifest");
        R3ProjectionService.validate(out,manifest);
        rejects(out,manifest,n->{for(JsonNode node:n.path("nodes"))if(node.path("nodeType").asText().equals("EVENT")){((ObjectNode)node).put("kind","INVENTED");break;}});
        rejects(out,manifest,n->((ObjectNode)n.path("edges").get(0)).put("relation","INVENTED"));
        rejects(out,manifest,n->{String pending="";for(JsonNode e:n.path("events"))if(e.path("kind").asText().equals("TEXT_NOTE"))pending=e.path("eventId").asText();((ObjectNode)n.path("edges").get(0)).put("source",pending);});
        rejects(out,manifest,n->{for(JsonNode node:n.path("nodes"))if(node.path("nodeType").asText().equals("MISSING")){((ObjectNode)node).put("questionCode","INVENTED");break;}});
        rejects(out,manifest,n->{for(JsonNode edge:n.path("edges"))if(edge.path("relation").asText().equals("OVERLAP")){((ObjectNode)edge).put("relation","BEFORE");break;}});
        rejects(out,manifest,n->((ObjectNode)n.path("chains").get(0)).put("status","MATCHED"));
        rejects(out,manifest,n->n.put("patientId",999));
        rejects(out,manifest,n->n.put("inputRevision",999));
        rejects(out,manifest,n->n.put("graphVersion","wrong"));
        rejects(out,manifest,n->((ObjectNode)n.path("edges").get(0)).put("target","missing-node"));
        rejects(out,manifest,n->((ObjectNode)n.path("events").get(0).path("evidence")).put("revisionId","other-revision"));
        rejects(out,manifest,n->((ObjectNode)n.path("anchors").get(0)).put("start","1900-01-01T00:00:00Z"));
        rejects(out,manifest,n->((ObjectNode)n.path("missingNodes").get(0)).put("questionCode","INVENTED"));
        rejects(out,manifest,n->((ObjectNode)n.path("chains").get(0)).put("causalClaim",true));
        rejects(out,manifest,n->((com.fasterxml.jackson.databind.node.ArrayNode)n.path("events")).remove(0));
        for(int i=0;i<out.path("events").size();i++)if(out.path("events").get(i).path("kind").asText().equals("SYMPTOM")){
            int index=i;rejects(out,manifest,n->((ObjectNode)n.path("events").get(index).path("payload")).put("severity",5));
        }
        System.out.println("PASS R3 output boundary rejects wrong version/patient/input, missing event, foreign references, changed payload/time, invalid edge/question and causal claim");
    }
}
