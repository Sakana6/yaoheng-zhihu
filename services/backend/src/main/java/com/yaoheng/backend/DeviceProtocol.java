package com.yaoheng.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.*;
import java.util.*;
import static com.yaoheng.backend.R1Service.*;
import static com.yaoheng.backend.FlowSupport.*;

/** replay-v1: no lid event or connection event can become a medication execution. */
final class DeviceProtocol {
    static ObjectNode parseEvent(JsonNode body){
        text(body,"deviceId",64);text(body,"eventId",64);
        if(!text(body,"sourceVersion",32).equals("replay-v1"))throw new Failure(422,"DEVICE_PROTOCOL_UNSUPPORTED");
        LocalDateTime time=utc(text(body,"observedAt",64));
        if(time.isAfter(LocalDateTime.now(ZoneOffset.UTC).plusMinutes(5))||time.isBefore(LocalDateTime.now(ZoneOffset.UTC).minusDays(30)))throw new Failure(422,"DEVICE_TIME_OUT_OF_RANGE");
        String metric=text(body,"metric",32),unit=text(body,"unit",16);
        ObjectNode facts=JSON.createObjectNode();for(String field:List.of("medications","symptoms","glucose","bloodPressure","meals"))facts.putArray(field);facts.putNull("explicitNoSymptoms");
        ObjectNode measure=JSON.createObjectNode().put("occurredAt",iso(time));
        if(metric.equals("GLUCOSE")){
            double value=FeedbackService.number(body,"value",.1,1800);
            if(unit.equals("mg/dL"))value=value/18.0;
            else if(!unit.equals("mmol/L"))throw new Failure(422,"DEVICE_UNKNOWN_UNIT");
            if(value<.1||value>99)throw new Failure(422,"DEVICE_VALUE_OUT_OF_RANGE");
            measure.put("value",value).put("unit","mmol/L");facts.withArray("glucose").add(measure);
        }else if(metric.equals("BLOOD_PRESSURE")){
            if(!unit.equals("mmHg"))throw new Failure(422,"DEVICE_UNKNOWN_UNIT");
            JsonNode value=body.path("value");
            int systolic=FeedbackService.integer(value,"systolic",30,300),diastolic=FeedbackService.integer(value,"diastolic",20,200);
            if(systolic<=diastolic)throw new Failure(422,"DEVICE_INVALID_BP_ORDER");
            measure.put("systolic",systolic).put("diastolic",diastolic).put("unit",unit);
            if(value.has("heartRate"))measure.put("heartRate",FeedbackService.integer(value,"heartRate",20,250));
            facts.withArray("bloodPressure").add(measure);
        }else throw new Failure(422,"DEVICE_METRIC_UNSUPPORTED");
        ObjectNode result=JSON.createObjectNode().put("engine","SOFTWARE_REPLAY").put("engineVersion","replay-v1")
            .put("requiresConfirmation",true).put("observedAt",iso(time));
        result.set("rawEvent",body.deepCopy());result.set("proposedFacts",facts);return result;
    }
}
