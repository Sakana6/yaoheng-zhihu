package com.yaoheng.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.*;
import java.time.*;
import java.util.*;
import static com.yaoheng.backend.R1Service.*;

/** Shared transaction and validation primitives; no domain decisions or runtime DDL. */
final class FlowSupport {
    static final ZoneId ZONE=ZoneId.of("Asia/Shanghai");
    final DatabaseRepository db;
    FlowSupport(DatabaseRepository db){this.db=db;}
    interface Work<T>{T run(Connection c)throws SQLException;}
    interface Row<T>{T read(ResultSet r)throws SQLException;}
    static PreparedStatement statement(Connection c,String sql,Object... args)throws SQLException{
        PreparedStatement s=c.prepareStatement(sql);
        for(int i=0;i<args.length;i++)s.setObject(i+1,args[i]);
        return s;
    }
    static int execute(Connection c,String sql,Object...args)throws SQLException{
        try(PreparedStatement s=statement(c,sql,args)){return s.executeUpdate();}
    }
    static <T> List<T> query(Connection c,String sql,Row<T> read,Object...args)throws SQLException{
        try(PreparedStatement s=statement(c,sql,args);ResultSet r=s.executeQuery()){
            List<T> rows=new ArrayList<>();while(r.next())rows.add(read.read(r));return rows;
        }
    }
    static <T> T one(Connection c,String sql,Row<T> read,Object...args)throws SQLException{
        List<T> rows=query(c,sql,read,args);return rows.isEmpty()?null:rows.get(0);
    }
    <T>T read(Work<T> work)throws SQLException{try(Connection c=db.openConnection()){
        c.setReadOnly(true);c.setAutoCommit(false);
        try{T result=work.run(c);c.commit();return result;}catch(SQLException|RuntimeException e){c.rollback();throw e;}
    }}
    <T>T transaction(int patient,Work<T> work)throws SQLException{
        try(Connection c=db.openConnection()){
            c.setAutoCommit(false);
            try{
                if(one(c,"select id from patient where id=? for update",r->r.getInt(1),patient)==null)throw new Failure(404,"PATIENT_NOT_FOUND");
                T result=work.run(c);c.commit();return result;
            }catch(SQLException|RuntimeException e){c.rollback();throw e;}
            finally{c.setAutoCommit(true);}
        }
    }
    ObjectNode write(Actor actor,int patient,String scope,String key,JsonNode body,Work<ObjectNode> work)throws SQLException{
        if(key==null||!key.matches("[A-Za-z0-9_-]{8,128}"))throw new Failure(400,"IDEMPOTENCY_KEY_REQUIRED");
        String scoped=patient+":"+scope;
        String digest=hash(canonical(body).toString());
        return transaction(patient,c->{
            ObjectNode old=one(c,"select request_hash,response_json from idempotency_record where user_id=? and scope=? and request_key=?",r->{
                if(!digest.equals(r.getString(1)))throw new Failure(409,"IDEMPOTENCY_CONFLICT");
                return (ObjectNode)parse(r.getString(2));
            },actor.userId(),scoped,key);
            if(old!=null)return old;
            ObjectNode result=work.run(c);
            execute(c,"insert into idempotency_record(user_id,scope,request_key,request_hash,response_json) values(?,?,?,?,?)",actor.userId(),scoped,key,digest,result.toString());
            return result;
        });
    }
    static String id(String prefix){return prefix+UUID.randomUUID();}
    static String text(JsonNode node,String key,int max){
        JsonNode n=node.path(key);if(!n.isTextual()||n.asText().isBlank()||n.asText().length()>max)throw new Failure(422,"INVALID_"+key);
        return n.asText();
    }
    static int version(JsonNode node){
        JsonNode n=node.path("expectedVersion");
        if(!n.isIntegralNumber()||!n.canConvertToInt()||n.asInt()<1)throw new Failure(400,"EXPECTED_VERSION_REQUIRED");
        return n.asInt();
    }
    static LocalDate date(String value){try{return LocalDate.parse(value);}catch(Exception e){throw new Failure(422,"INVALID_DATE");}}
    static LocalDateTime utc(String value){try{return OffsetDateTime.parse(value).withOffsetSameInstant(ZoneOffset.UTC).toLocalDateTime();}catch(Exception e){throw new Failure(422,"OFFSET_DATETIME_REQUIRED");}}
    static String iso(LocalDateTime value){return value==null?null:value.atOffset(ZoneOffset.UTC).toString();}
    static String sqlTime(LocalDateTime value){return value.toString().replace('T',' ');}
    static ObjectNode list(String name,List<? extends JsonNode> values){ObjectNode out=JSON.createObjectNode();out.set(name,JSON.valueToTree(values));out.putNull("nextCursor");return out;}
    static void checkVersion(JsonNode body,int current){if(version(body)!=current)throw new Failure(409,"VERSION_CONFLICT_RELOAD");}
}
