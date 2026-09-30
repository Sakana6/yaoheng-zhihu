package com.yaoheng.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.sql.*;
import java.util.*;
import static com.yaoheng.backend.FlowSupport.*;
import static com.yaoheng.backend.R1Service.*;

/** Local presentation only: Python remains the sole inference engine. */
final class R3ReportService {
    static final String VERSION="html_r3_1", PACKET="r3_report_packet_v1";
    interface Rewriter {String rewrite(String type,List<String> allowed)throws Exception;}
    static boolean enabled(){return !"false".equalsIgnoreCase(System.getenv("R3_REPORT_ENABLED"));}
    static List<String> phrases(String type){return type.equals("FAMILY")?
        List.of("请核对实际测量和缺失资料，复查时携带记录与医生沟通。","请带上记录复查，并与医生核对实际测量及尚缺资料。"):
        List.of("请结合冻结药历、确认事实和时间窗复核以下规则线索。","请核对以下规则线索的时间窗、确认事实与冻结药历。");}
    static Rewriter configuredRewriter(){
        String url=System.getenv("R3_REPORT_REWRITE_URL");if(url==null||url.isBlank())return null;
        return localRewriter(url);
    }
    static Rewriter localRewriter(String url){
        return (type,allowed)->{
            URI uri=URI.create(url);
            if(!"http".equals(uri.getScheme())||!Set.of("127.0.0.1","localhost","[::1]").contains(uri.getHost())||uri.getUserInfo()!=null)throw new IllegalArgumentException("local only");
            ObjectNode request=JSON.createObjectNode().put("reportType",type);request.set("allowedPhrases",JSON.valueToTree(allowed));
            var response=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(1)).build().send(
                HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(2)).header("Content-Type","application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(request.toString())).build(),HttpResponse.BodyHandlers.ofString());
            if(response.statusCode()!=200||response.body().length()>4096)throw new IllegalStateException("rewrite unavailable");
            return JSON.readTree(response.body()).path("guidance").asText();
        };
    }
    static ObjectNode generate(Connection c,int patient,ObjectNode input)throws SQLException,AiServiceClient.Error {
        JsonNode snapshot=input.path("snapshot");String run=snapshot.path("runId").asText();
        JsonNode manifest=one(c,"select t.manifest from analysis_run r join analysis_task t on t.id=r.task_id where r.patient_id=? and r.id=? and r.snapshot_id=?",r->parse(r.getString(1)),patient,run,snapshot.path("snapshotId").asText());
        if(manifest==null)throw new AiServiceClient.Error("R3_REPORT_SOURCE_MISSING",false);
        ObjectNode graph=null;String reason=null;
        try{graph=R3ProjectionService.compute(c,patient,run);}catch(Failure unavailable){reason="R3_ENHANCEMENT_UNAVAILABLE";}
        ObjectNode packet=packet(patient,snapshot,manifest,graph,reason);
        return render(packet,input.path("reportType").asText(),configuredRewriter());
    }
    static ObjectNode packet(int patient,JsonNode snapshot,JsonNode manifest,JsonNode graph,String reason)throws AiServiceClient.Error {
        check(manifest.path("patientId").asInt()==patient&&snapshot.path("inputRevision").equals(manifest.path("inputRevision")),"R3_REPORT_SOURCE_INVALID");
        if(graph!=null){
            R3ProjectionService.validate((ObjectNode)graph,manifest);
            check(graph.path("runId").equals(snapshot.path("runId"))&&graph.path("snapshotId").equals(snapshot.path("snapshotId")),"R3_REPORT_SOURCE_INVALID");
        }
        ObjectNode packet=JSON.createObjectNode().put("packetVersion",PACKET).put("patientId",patient)
            .put("runId",snapshot.path("runId").asText()).put("snapshotId",snapshot.path("snapshotId").asText())
            .put("manifestHash",hash(manifest.toString())).put("manifestHashMethod","SHA256_JACKSON_STORED_MANIFEST")
            .put("enhancementStatus",graph==null?"UNAVAILABLE":"AVAILABLE");
        packet.set("inputRevision",manifest.path("inputRevision"));packet.set("snapshot",snapshot.deepCopy());
        packet.set("frozenMedications",manifest.path("medications").deepCopy());
        var sources=packet.putArray("sources");
        for(JsonNode record:manifest.path("records")){
            ObjectNode source=JSON.createObjectNode();for(String key:List.of("recordId","revisionId","occurredAt","confirmedFacts"))source.set(key,record.path(key).deepCopy());sources.add(source);
        }
        if(graph==null){packet.putNull("projection");packet.put("enhancementReason",reason);}
        else{
            ObjectNode projection=packet.putObject("projection");
            for(String key:List.of("projectionVersion","graphVersion","chainVersion","projectionId","graphId","inputHash","referenceTime","chains","missingNodes","ranking"))projection.set(key,graph.path(key).deepCopy());
            var facts=projection.putArray("events");for(JsonNode event:graph.path("events"))if(event.path("confirmationStatus").asText().equals("CONFIRMED"))facts.add(event.deepCopy());
            // Chains carry versioned local citations and frozen medication context; raw text is never a generated claim.
        }
        return packet;
    }
    static ObjectNode render(ObjectNode packet,String type,Rewriter rewriter)throws AiServiceClient.Error {
        check(Set.of("FAMILY","DOCTOR").contains(type),"R3_REPORT_TYPE_INVALID");
        String guidance=phrases(type).get(0),method="TEMPLATE",fallback=null;
        if(rewriter!=null)try{
            String candidate=rewriter.rewrite(type,phrases(type));
            if(phrases(type).contains(candidate)){guidance=candidate;method="ALLOWLIST_REWRITE";}else fallback="REWRITE_CONTENT_REJECTED";
        }catch(InterruptedException e){Thread.currentThread().interrupt();fallback="REWRITE_UNAVAILABLE";}
        catch(Exception e){fallback="REWRITE_UNAVAILABLE";}
        ObjectNode out=JSON.createObjectNode().put("snapshotId",packet.path("snapshotId").asText()).put("reportType",type)
            .put("templateVersion",VERSION).put("guidance",guidance).put("generationMethod",method).put("auditStatus","PASS");
        out.set("packet",packet.deepCopy());out.put("html",html(packet,type,guidance));
        out.put("fallbackReason",fallback==null?packet.path("enhancementReason").asText(null):fallback);
        audit(out,packet,type);
        out.set("auditStages",JSON.valueToTree(List.of("SOURCE_PASS","EVIDENCE_PASS","CONTENT_PASS")));return out;
    }
    static void check(boolean condition,String reason)throws AiServiceClient.Error{if(!condition)throw new AiServiceClient.Error(reason,false);}
    static void audit(ObjectNode output,ObjectNode trusted,String type)throws AiServiceClient.Error {
        JsonNode packet=output.path("packet");
        check(packet.isObject()&&packet.path("packetVersion").asText().equals(PACKET)&&output.path("reportType").asText().equals(type)&&output.path("templateVersion").asText().equals(VERSION),"R3_AUDIT_STRUCTURE");
        for(String key:List.of("patientId","runId","snapshotId","inputRevision"))check(packet.path(key).equals(trusted.path(key)),"R3_AUDIT_SOURCE");
        check(output.path("snapshotId").equals(trusted.path("snapshotId")),"R3_AUDIT_SOURCE");
        Set<String> sources=new HashSet<>();for(JsonNode s:trusted.path("sources"))sources.add(s.path("recordId").asText()+":"+s.path("revisionId").asText());
        for(JsonNode event:packet.path("projection").path("events"))checkRef(event.path("evidence"),sources);
        for(JsonNode chain:packet.path("projection").path("chains"))for(JsonNode ref:chain.path("evidence"))checkRef(ref,sources);
        // Full equality rejects changed units, values, IDs, versions, citations, omissions and added advice fields.
        check(packet.equals(trusted),"R3_AUDIT_EVIDENCE");
        String guidance=output.path("guidance").asText();
        check(phrases(type).contains(guidance)&&output.path("html").asText().equals(html(trusted,type,guidance)),"R3_AUDIT_CONTENT");
    }
    static void checkRef(JsonNode ref,Set<String> sources)throws AiServiceClient.Error{
        check(sources.contains(ref.path("sourceId").asText()+":"+ref.path("revisionId").asText()),"R3_AUDIT_SOURCE");
    }
    static String html(JsonNode packet,String type,String guidance){
        boolean family=type.equals("FAMILY");String title=family?"家属照护记录":"医生复查证据摘要";
        StringBuilder summary=new StringBuilder("<h2>观察与缺失资料</h2>");
        JsonNode projection=packet.path("projection");
        if(projection.isNull())summary.append("<p>增强解释暂不可用，以下保留已保存的快照证据。</p>");
        else if(projection.path("chains").isEmpty())summary.append("<p>当前观察范围没有可展示的规则链，请核对记录是否齐全。</p>");
        else for(JsonNode chain:projection.path("chains")){
            String kind=Map.of("G","餐食、血糖与症状","B","血压与症状","C","两类线索共现").getOrDefault(chain.path("chainType").asText(),"规则线索");
            String status=Map.of("MATCHED","存在需要复核的规则线索，不代表诊断或因果","INSUFFICIENT","资料不足，保留未知","NOT_MATCHED","当前资料未匹配该规则，不代表排除风险","NOT_APPLICABLE","冻结药历未覆盖该规则的适用药类").getOrDefault(chain.path("status").asText(),"需要复核");
            summary.append("<p>").append(ReportService.escape(kind+"："+status)).append("</p>");
            if(!chain.path("missingFields").isEmpty()){
                List<String> fields=new ArrayList<>();for(JsonNode field:chain.path("missingFields"))fields.add(Map.of("glucose","血糖","bloodPressure","血压","symptoms","症状","meals","进食").getOrDefault(field.asText(),"待核对资料"));
                summary.append("<p>尚缺：").append(ReportService.escape(String.join("、",fields))).append("。</p>");
            }
            if(!family)summary.append("<p style=\"overflow-wrap:anywhere\">来源链：").append(ReportService.escape(chain.path("chainId").asText())).append("；时间：").append(ReportService.escape(chain.path("referenceTime").asText())).append("</p>");
        }
        return "<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>"+title+"</title><body><h1>"+title+"</h1><p>本地合成规则辅助记录，不是诊断或处方。请携带记录与医生核对，不自行调整药物。</p><p>"+ReportService.escape(guidance)+"</p>"+summary+"<h2>快照及证据</h2><pre style=\"white-space:pre-wrap;overflow-wrap:anywhere\">"+ReportService.escape(packet.toString())+"</pre></body></html>";
    }
}
