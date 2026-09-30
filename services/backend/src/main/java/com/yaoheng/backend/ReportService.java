package com.yaoheng.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.*;
import java.util.*;
import static com.yaoheng.backend.FlowSupport.*;
import static com.yaoheng.backend.R1Service.*;

final class ReportService {
    private final FlowSupport flow;private final AiServiceClient ai=new AiServiceClient();
    ReportService(DatabaseRepository db){flow=new FlowSupport(db);}
    static String escape(String s){return s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace("\"","&quot;").replace("'","&#x27;");}
    static void audit(ObjectNode output,ObjectNode input)throws AiServiceClient.Error {
        String packet=output.path("packetJson").asText();JsonNode parsed;
        try{parsed=JSON.readTree(packet);}catch(Exception e){throw new AiServiceClient.Error("REPORT_EVIDENCE_INVALID",false);}
        if(parsed==null||!parsed.isObject()||parsed.size()!=13)throw new AiServiceClient.Error("REPORT_EVIDENCE_INVALID",false);
        for(String key:List.of("runId","snapshotId","inputRevision","algorithmVersion","referenceTime","risk","dataStatus","medications","timeline","jointEvents","evaluations","missingFields","profile"))if(!input.path("snapshot").path(key).equals(parsed.path(key)))throw new AiServiceClient.Error("REPORT_EVIDENCE_INVALID",false);
        boolean family=input.path("reportType").asText().equals("FAMILY");String title=family?"家属照护记录":"医生复查证据摘要";
        String guidance=family?"请核对记录中的药品、实际测量和缺失项，复查时出示本报告。":"请复核以下规则覆盖范围、原始事实引用、输入水位和历史药历版本。";
        String expected="<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>"+title+"</title><body><h1>"+title+"</h1><p>本地合成规则辅助记录，不是诊断或处方。请携带记录与医生核对，不自行调整药物。</p><p>"+guidance+"</p><p>数据状态："+escape(input.path("snapshot").path("dataStatus").asText())+"</p><h2>快照及证据</h2><pre style=\"white-space:pre-wrap;overflow-wrap:anywhere\">"+escape(packet)+"</pre></body></html>";
        if(!expected.equals(output.path("html").asText()))throw new AiServiceClient.Error("REPORT_UNCONTROLLED_CONTENT",false);
    }
    static ObjectNode row(ResultSet r)throws SQLException{return JSON.createObjectNode().put("reportId",r.getString("id")).put("snapshotId",r.getString("snapshot_id")).put("reportType",r.getString("report_type")).put("templateVersion",r.getString("template_version")).put("status",r.getString("status")).put("attempt",r.getInt("attempt")).put("errorCode",r.getString("error_code")).put("checksum",r.getString("checksum"));}
    ObjectNode create(Actor actor,int patient,JsonNode body,String key)throws SQLException {
        if(!actor.role().equals("DOCTOR"))throw new Failure(403,"DOCTOR_REQUIRED");
        return flow.write(actor,patient,"report-create",key,body,c->{
            String snapshot=text(body,"snapshotId",64),type=text(body,"reportType",16);
            if(!Set.of("FAMILY","DOCTOR").contains(type))throw new Failure(422,"INVALID_REPORT_TYPE");
            if(one(c,"select id from analysis_run where patient_id=? and snapshot_id=?",r->r.getString(1),patient,snapshot)==null)throw new Failure(404,"SNAPSHOT_NOT_FOUND");
            String version=R3ReportService.enabled()?R3ReportService.VERSION:"html_r1_1";
            ObjectNode old=one(c,"select * from report_job where patient_id=? and snapshot_id=? and report_type=? and template_version=?",ReportService::row,patient,snapshot,type,version);
            if(old!=null){if(old.path("status").asText().equals("FAILED")){execute(c,"update report_job set status='PENDING',error_code=null where id=?",old.path("reportId").asText());old.put("status","PENDING").putNull("errorCode");}return old;}
            String id=id("report_");execute(c,"insert into report_job(id,patient_id,snapshot_id,report_type,template_version) values(?,?,?,?,?)",id,patient,snapshot,type,version);
            execute(c,"insert into audit_log(actor_id,patient_id,action,resource_id) values(?,?,'REPORT_CREATE',?)",actor.userId(),patient,id);
            return one(c,"select * from report_job where id=?",ReportService::row,id);
        });
    }
    ObjectNode get(int patient,String id)throws SQLException{return flow.read(c->{ObjectNode n=one(c,"select * from report_job where patient_id=? and id=?",ReportService::row,patient,id);if(n==null)throw new Failure(404,"REPORT_NOT_FOUND");
        if(n.path("templateVersion").asText().equals(R3ReportService.VERSION)){
            ObjectNode metadata=one(c,"select generation_method,audit_status,audit_stages,enhancement_status,fallback_reason,packet_checksum from report_evidence where report_id=?",r->{ObjectNode m=JSON.createObjectNode().put("generationMethod",r.getString(1)).put("auditStatus",r.getString(2)).put("enhancementStatus",r.getString(4)).put("fallbackReason",r.getString(5)).put("packetChecksum",r.getString(6));try{m.set("auditStages",JSON.readTree(r.getString(3)));}catch(java.io.IOException e){throw new SQLException("Invalid persisted report audit stages",e);}return m;},id);
            if(metadata!=null)n.set("r3Report",metadata);
        }return n;});}
    ObjectNode listReports(int patient)throws SQLException{return flow.read(c->list("items",query(c,"select * from report_job where patient_id=? order by (template_version=?) desc,created_at desc",ReportService::row,patient,R3ReportService.enabled()?R3ReportService.VERSION:"html_r1_1")));}
    String content(int patient,String id)throws SQLException{return flow.read(c->{String html=one(c,"select html,checksum,status from report_job where patient_id=? and id=?",r->{if(!r.getString(3).equals("SUCCESS"))throw new Failure(409,"REPORT_NOT_READY");String h=r.getString(1);if(h==null||!hash(h).equals(r.getString(2)))throw new Failure(503,"REPORT_CHECKSUM_INVALID");return h;},patient,id);if(html==null)throw new Failure(404,"REPORT_NOT_FOUND");return html;});}
    void tick()throws SQLException {
        ObjectNode candidate=flow.read(c->one(c,"select id,patient_id from report_job where status='PENDING' or (status='RUNNING' and lease_until<utc_timestamp(6)) order by created_at limit 1",r->JSON.createObjectNode().put("id",r.getString(1)).put("patient",r.getInt(2))));if(candidate==null)return;
        String id=candidate.path("id").asText(),lease=id("reportlease_");int patient=candidate.path("patient").asInt();
        ObjectNode input=flow.transaction(patient,c->{
            ObjectNode job=one(c,"select * from report_job where id=? and (status='PENDING' or (status='RUNNING' and lease_until<utc_timestamp(6))) for update",ReportService::row,id);if(job==null)return null;
            execute(c,"update report_job set status='RUNNING',attempt=attempt+1,lease_token=?,lease_until=date_add(utc_timestamp(6),interval 120 second) where id=?",lease,id);
            ObjectNode n=JSON.createObjectNode().put("reportType",job.path("reportType").asText()).put("templateVersion",job.path("templateVersion").asText());n.set("snapshot",one(c,"select snapshot from analysis_run where patient_id=? and snapshot_id=?",r->parse(r.getString(1)),patient,job.path("snapshotId").asText()));return n;
        });if(input==null)return;
        try {
            if(input.path("templateVersion").asText().equals(R3ReportService.VERSION)){
                ObjectNode output;
                try{output=flow.read(c->{try{return R3ReportService.generate(c,patient,input);}catch(AiServiceClient.Error e){throw new Failure(503,e.code);}});}
                catch(Failure e){throw new AiServiceClient.Error(e.getMessage(),false);}
                String html=output.path("html").asText(),packet=output.path("packet").toString();
                flow.transaction(patient,c->{
                    int updated=execute(c,"update report_job set status='SUCCESS',html=?,checksum=?,lease_until=null,error_code=null where id=? and lease_token=? and status='RUNNING' and lease_until>utc_timestamp(6)",html,hash(html),id,lease);
                    if(updated==1)execute(c,"insert into report_evidence(report_id,packet,packet_checksum,generation_method,audit_status,audit_stages,enhancement_status,fallback_reason) values(?,?,?,?,?,?,?,?)",id,packet,hash(packet),output.path("generationMethod").asText(),output.path("auditStatus").asText(),output.path("auditStages").toString(),output.path("packet").path("enhancementStatus").asText(),output.path("fallbackReason").asText(null));
                    return null;
                });return;
            }
            ObjectNode output=ai.call("/ai/r1/report",input);
            audit(output,input);
            String html=output.path("html").asText();
            if(!output.path("snapshotId").equals(input.path("snapshot").path("snapshotId"))||!output.path("reportType").equals(input.path("reportType"))||!output.path("templateVersion").asText().equals("html_r1_1")||!html.startsWith("<!doctype html>")||html.contains("<script")||html.contains("javascript:")||!html.contains(input.path("snapshot").path("snapshotId").asText()))throw new AiServiceClient.Error("REPORT_AUDIT_FAILED",false);
            flow.transaction(patient,c->{execute(c,"update report_job set status='SUCCESS',html=?,checksum=?,lease_until=null,error_code=null where id=? and lease_token=? and status='RUNNING' and lease_until>utc_timestamp(6)",html,hash(html),id,lease);return null;});
        }catch(AiServiceClient.Error e){flow.transaction(patient,c->{execute(c,"update report_job set status='FAILED',error_code=?,lease_until=null where id=? and lease_token=? and status='RUNNING'",e.code,id,lease);return null;});}
    }
}
