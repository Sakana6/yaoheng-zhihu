package com.yaoheng.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.text.Normalizer;
import java.util.*;
import static com.yaoheng.backend.R1Service.*;

/** Candidate retrieval only: scores are lexical similarity, never clinical confidence. */
final class MedicationNormalizer {
    interface VectorRecall { List<ObjectNode> recall(String text); }
    private final VectorRecall optionalVector;
    private final JsonNode catalog;
    MedicationNormalizer(){this(null);}
    MedicationNormalizer(VectorRecall optionalVector) {
        this.optionalVector=optionalVector;
        try(var in=getClass().getResourceAsStream("/capture/medication-catalog-v1.json")){
            catalog=JSON.readTree(in);
        }catch(Exception e){throw new IllegalStateException("CAPTURE_CATALOG_MISSING",e);}
    }
    static String normalize(String text) {
        return Normalizer.normalize(text,Normalizer.Form.NFKC).toLowerCase(Locale.ROOT)
            .replaceAll("[\\s\\p{Punct}]+","").replaceAll("(缓释片|胶囊|片剂|片|颗粒)$","");
    }
    static int distance(String a,String b){
        int[] row=new int[b.length()+1];for(int j=0;j<row.length;j++)row[j]=j;
        for(int i=1;i<=a.length();i++){int prev=row[0];row[0]=i;
            for(int j=1;j<=b.length();j++){int old=row[j];row[j]=Math.min(Math.min(row[j]+1,row[j-1]+1),prev+(a.charAt(i-1)==b.charAt(j-1)?0:1));prev=old;}}
        return row[b.length()];
    }
    ObjectNode candidates(String raw) {
        if(raw==null||raw.isBlank()||raw.length()>2000)throw new Failure(422,"INVALID_CAPTURE_TEXT");
        String text=normalize(raw);List<ObjectNode> results=new ArrayList<>();
        for(JsonNode entry:catalog.path("entries")){
            double best=0;int bestDistance=999;String method="EDIT_DISTANCE",matched="";
            for(JsonNode alias:entry.path("aliases")){
                String a=normalize(alias.asText());int d=distance(text,a);
                double score=1.0-(double)d/Math.max(1,Math.max(text.length(),a.length()));
                String m="EDIT_DISTANCE";
                if(text.equals(a)){score=1;m="EXACT_ALIAS";}
                else if(a.length()>=2&&text.contains(a)){score=.9;m="ALIAS_IN_TEXT";d=0;}
                if(score>best){best=score;bestDistance=d;method=m;matched=alias.asText();}
            }
            if(best>=.6){
                ObjectNode n=JSON.createObjectNode().put("code",entry.path("code").asText())
                    .put("genericName",entry.path("genericName").asText()).put("brandName",entry.path("brandName").asText())
                    .put("strength",entry.path("strength").asText()).put("method",method).put("distance",bestDistance)
                    .put("score",best).put("confidenceLevel",best==1?"HIGH":best>=.85?"MEDIUM":"LOW")
                    .put("matchedAlias",matched).put("explanation","词形匹配，仅供人工核对；不推断剂量或服法");
                results.add(n);
            }
        }
        String vectorStatus="DISABLED";
        if(optionalVector!=null){try{
            // A caller-supplied adapter may recall known catalog IDs only; names stay server-owned.
            var extra=optionalVector.recall(raw);vectorStatus="ENABLED";
            for(ObjectNode hit:extra){
                String code=hit.path("code").asText();double score=hit.path("score").asDouble(-1);
                if(!Double.isFinite(score)||score<.6||score>1||results.stream().anyMatch(n->n.path("code").asText().equals(code)))continue;
                for(JsonNode entry:catalog.path("entries"))if(entry.path("code").asText().equals(code)){
                    ObjectNode n=JSON.createObjectNode().put("code",code).put("genericName",entry.path("genericName").asText()).put("brandName",entry.path("brandName").asText()).put("strength",entry.path("strength").asText())
                        .put("method","VECTOR_RECALL").put("distance",-1).put("score",Math.min(.84,score)).put("confidenceLevel","LOW").put("matchedAlias","").put("explanation","可选召回候选，必须人工核对；不推断剂量或服法");results.add(n);
                }
            }
        }catch(RuntimeException e){vectorStatus="RULE_FALLBACK";}}
        results.sort(Comparator.<ObjectNode>comparingDouble(n->n.path("score").asDouble()).reversed().thenComparing(n->n.path("code").asText()));
        ObjectNode out=JSON.createObjectNode().put("rawText",raw).put("normalizedText",text)
            .put("dictionaryVersion",catalog.path("version").asText()).put("vectorStatus",vectorStatus)
            .put("unknown",results.isEmpty()).put("requiresConfirmation",true);
        out.set("candidates",JSON.valueToTree(results.stream().limit(5).toList()));return out;
    }
}
