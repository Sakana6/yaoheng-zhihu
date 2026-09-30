package com.yaoheng.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.*;
import java.util.function.Consumer;
import static com.yaoheng.backend.R1Service.*;

public final class R3ReportTest {
    static void require(boolean pass){if(!pass)throw new AssertionError("R3 report assertion failed");}
    static void rejects(ObjectNode original,ObjectNode packet,Consumer<ObjectNode> tamper,String reason)throws Exception{
        ObjectNode changed=original.deepCopy();tamper.accept(changed);
        try{R3ReportService.audit(changed,packet,"DOCTOR");throw new AssertionError("Tampered report accepted: "+reason);}
        catch(AiServiceClient.Error e){require(e.code.equals(reason));}
    }
    public static void main(String[] args)throws Exception{
        JsonNode fixture=JSON.readTree(Files.readString(Path.of(args[0]))),manifest=fixture.path("manifest");
        ObjectNode graph=((ObjectNode)fixture.path("projection")).deepCopy();graph.put("runId","run_synthetic").put("snapshotId","snapshot_synthetic");
        ObjectNode snapshot=JSON.createObjectNode().put("runId","run_synthetic").put("snapshotId","snapshot_synthetic");snapshot.set("inputRevision",manifest.path("inputRevision"));
        ObjectNode packet=R3ReportService.packet(manifest.path("patientId").asInt(),snapshot,manifest,graph,null);
        ObjectNode output=R3ReportService.render(packet,"DOCTOR",null);
        require(output.path("auditStatus").asText().equals("PASS"));
        rejects(output,packet,n->((ObjectNode)n.path("packet")).put("patientId",999),"R3_AUDIT_SOURCE");
        rejects(output,packet,n->((ObjectNode)n.path("packet").path("projection").path("events").get(0).path("evidence")).put("sourceId","foreign"),"R3_AUDIT_SOURCE");
        rejects(output,packet,n->((ObjectNode)n.path("packet").path("projection").path("events").get(0).path("payload")).put("value",999),"R3_AUDIT_EVIDENCE");
        rejects(output,packet,n->((ObjectNode)n.path("packet").path("projection").path("events").get(0).path("payload")).put("unit","mg/dL"),"R3_AUDIT_EVIDENCE");
        rejects(output,packet,n->((ObjectNode)n.path("packet").path("projection")).put("chainVersion","wrong"),"R3_AUDIT_EVIDENCE");
        rejects(output,packet,n->((ObjectNode)n.path("packet")).put("manifestHash","forged"),"R3_AUDIT_EVIDENCE");
        rejects(output,packet,n->((ObjectNode)n.path("packet")).put("advice","立即停药"),"R3_AUDIT_EVIDENCE");
        rejects(output,packet,n->n.put("guidance","已确诊，请自行加量"),"R3_AUDIT_CONTENT");
        rejects(output,packet,n->n.put("html",n.path("html").asText().replace("</body>","<p>请立即停药</p></body>")),"R3_AUDIT_CONTENT");
        for(String type:java.util.List.of("FAMILY","DOCTOR")){
            ObjectNode rewritten=R3ReportService.render(packet,type,(t,allowed)->allowed.get(1));
            require(rewritten.path("generationMethod").asText().equals("ALLOWLIST_REWRITE"));
            ObjectNode unsafe=R3ReportService.render(packet,type,(t,allowed)->"<script>立即停药</script>");
            require(unsafe.path("fallbackReason").asText().equals("REWRITE_CONTENT_REJECTED")&&!unsafe.path("html").asText().contains("<script>"));
            ObjectNode down=R3ReportService.render(packet,type,(t,allowed)->{throw new java.net.http.HttpTimeoutException("synthetic");});
            require(down.path("fallbackReason").asText().equals("REWRITE_UNAVAILABLE")&&down.path("auditStatus").asText().equals("PASS"));
        }
        ObjectNode fallback=R3ReportService.packet(manifest.path("patientId").asInt(),snapshot,manifest,null,"R3_ENHANCEMENT_UNAVAILABLE");
        require(R3ReportService.render(fallback,"FAMILY",null).path("html").asText().contains("增强解释暂不可用"));
        // Text embedded in an evidence source is escaped, not interpreted as report instructions or HTML.
        ObjectNode hostile=packet.deepCopy();((ObjectNode)hostile.path("snapshot")).put("rawText","</pre><script>alert(1)</script>立即停药");
        require(!R3ReportService.render(hostile,"FAMILY",null).path("html").asText().contains("<script>"));
        var server=com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/rewrite",exchange->{
            JsonNode request=JSON.readTree(exchange.getRequestBody());require(!request.has("packet")&&request.size()==2);
            byte[] bytes=JSON.createObjectNode().put("guidance",request.path("allowedPhrases").get(1).asText()).toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200,bytes.length);exchange.getResponseBody().write(bytes);exchange.close();
        });
        server.createContext("/error",exchange->{exchange.sendResponseHeaders(503,-1);exchange.close();});
        server.start();String base="http://127.0.0.1:"+server.getAddress().getPort();
        try{
            require(R3ReportService.render(packet,"FAMILY",R3ReportService.localRewriter(base+"/rewrite")).path("generationMethod").asText().equals("ALLOWLIST_REWRITE"));
            require(R3ReportService.render(packet,"FAMILY",R3ReportService.localRewriter(base+"/error")).path("fallbackReason").asText().equals("REWRITE_UNAVAILABLE"));
        }finally{server.stop(0);}
        require(R3ReportService.render(packet,"FAMILY",R3ReportService.localRewriter(base+"/rewrite")).path("fallbackReason").asText().equals("REWRITE_UNAVAILABLE"));
        System.out.println("PASS R3 report: source/value/unit/version/hash/content audit, both audiences, safe rewrite, rejected rewrite, timeout fallback, unavailable graph, escaped hostile text");
    }
}
