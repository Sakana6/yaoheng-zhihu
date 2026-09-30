package com.yaoheng.backend;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.*;
import static com.yaoheng.backend.R1Service.*;

/** Executable contract checks using responses recorded by the real cross-service test. */
public final class AiBoundaryTest {
    interface Check {void run()throws Exception;}
    static void rejects(Check check)throws Exception{
        try{check.run();throw new AssertionError("Invalid AI output was accepted");}
        catch(AiServiceClient.Error expected){if(expected.retryable)throw new AssertionError("Schema failures must not auto-retry");}
    }
    public static void main(String[] args)throws Exception{
        ObjectNode fixture=(ObjectNode)JSON.readTree(Files.readString(Path.of(args[0])));
        ObjectNode output=(ObjectNode)fixture.path("output"),manifest=(ObjectNode)fixture.path("manifest");
        AiServiceClient.validate(output,manifest);
        ObjectNode wrongClock=output.deepCopy();wrongClock.put("referenceTime","2000-01-01T00:00:00Z");rejects(()->AiServiceClient.validate(wrongClock,manifest));
        ObjectNode noProfile=output.deepCopy();noProfile.remove("profile");rejects(()->AiServiceClient.validate(noProfile,manifest));
        ObjectNode badRate=output.deepCopy();((ObjectNode)badRate.path("profile")).put("responseRate",1.5);rejects(()->AiServiceClient.validate(badRate,manifest));
        ObjectNode equivalentClock=output.deepCopy();equivalentClock.put("referenceTime",java.time.OffsetDateTime.parse(output.path("referenceTime").asText()).withOffsetSameInstant(java.time.ZoneOffset.ofHours(8)).toString());AiServiceClient.validate(equivalentClock,manifest);
        ObjectNode wrongDrug=output.deepCopy();((ObjectNode)wrongDrug.path("medications").get(0)).put("dose","tampered dose");rejects(()->AiServiceClient.validate(wrongDrug,manifest));
        ObjectNode stringRevision=output.deepCopy();stringRevision.put("inputRevision",manifest.path("inputRevision").asText());rejects(()->AiServiceClient.validate(stringRevision,manifest));
        ObjectNode bad=output.deepCopy();bad.put("inputRevision",-1);rejects(()->AiServiceClient.validate(bad,manifest));
        ObjectNode badScore=output.deepCopy();((ObjectNode)badScore.path("risk")).put("jointEventScore",101);rejects(()->AiServiceClient.validate(badScore,manifest));
        ObjectNode overflowScore=output.deepCopy();((ObjectNode)overflowScore.path("risk")).put("jointEventScore",4294967301L);rejects(()->AiServiceClient.validate(overflowScore,manifest));
        ObjectNode badSource=output.deepCopy();((ObjectNode)badSource.path("evidence").get(0)).put("sourceId","another_patient");rejects(()->AiServiceClient.validate(badSource,manifest));
        ObjectNode badField=output.deepCopy();((ObjectNode)badField.path("evidence").get(0)).put("fieldPath","confirmedFacts.glucose[999]");rejects(()->AiServiceClient.validate(badField,manifest));
        ObjectNode badDate=output.deepCopy();((ObjectNode)badDate.path("evidence").get(0)).put("occurredAt","2000-01-01T00:00:00Z");rejects(()->AiServiceClient.validate(badDate,manifest));
        ObjectNode badValue=output.deepCopy();((ObjectNode)badValue.path("timeline").get(0).path("payload")).put("value",88);rejects(()->AiServiceClient.validate(badValue,manifest));
        ObjectNode badEvent=output.deepCopy();((ObjectNode)badEvent.path("jointEvents").get(0).path("evidence").get(0)).put("sourceId","foreign");rejects(()->AiServiceClient.validate(badEvent,manifest));
        ObjectNode badRule=output.deepCopy();((ObjectNode)badRule.path("evaluations").get(0).path("evidence").get(0)).put("sourceId","foreign");rejects(()->AiServiceClient.validate(badRule,manifest));
        ObjectNode report=(ObjectNode)fixture.path("report"),input=JSON.createObjectNode().put("reportType","DOCTOR");input.set("snapshot",output);
        ReportService.audit(report,input);
        ObjectNode extraPacket=report.deepCopy();ObjectNode extra=(ObjectNode)JSON.readTree(report.path("packetJson").asText());extra.put("advice","立即停药");extraPacket.put("packetJson",extra.toString());rejects(()->ReportService.audit(extraPacket,input));
        ObjectNode altered=report.deepCopy();altered.put("html",report.path("html").asText().replace("</body>","<p>立即停药</p></body>"));rejects(()->ReportService.audit(altered,input));
        ObjectNode wrongPacket=report.deepCopy();ObjectNode packet=(ObjectNode)JSON.readTree(report.path("packetJson").asText());packet.put("inputRevision",999);wrongPacket.put("packetJson",packet.toString());rejects(()->ReportService.audit(wrongPacket,input));
        System.out.println("PASS Java AI boundary: actual response, scores, revision/source/path/time, report evidence and unauthorized prose");
    }
}
