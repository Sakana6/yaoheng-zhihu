package com.yaoheng.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.*;
import java.time.LocalDate;
import java.util.*;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

/** Identity and medication transaction boundary; legacy routes remain thin adapters. */
final class R1Service {
    static final ObjectMapper JSON = new ObjectMapper();
    private final DatabaseRepository db;
    R1Service(DatabaseRepository db) { this.db = db; }
    record Actor(int userId, String role) {}
    static final class Failure extends RuntimeException {
        final int status;
        final ObjectNode data;
        Failure(int status, String message) { this(status,message,null); }
        Failure(int status, String message, ObjectNode data) { super(message); this.status = status; this.data=data; }
    }
    static String hash(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
    static JsonNode parse(String body) {
        try {
            JsonNode node = JSON.readTree(body);
            if (node == null || !node.isObject()) throw new Failure(400,"JSON_OBJECT_REQUIRED");
            return node;
        } catch (Failure e) { throw e; }
        catch (Exception e) { throw new Failure(400,"INVALID_JSON"); }
    }
    static JsonNode canonical(JsonNode value) {
        if (value.isObject()) {
            ObjectNode result=JSON.createObjectNode();
            java.util.TreeSet<String> fields=new java.util.TreeSet<>();
            value.fieldNames().forEachRemaining(fields::add);
            for(String field:fields) result.set(field,canonical(value.get(field)));
            return result;
        }
        if(value.isArray()) {
            var result=JSON.createArrayNode();
            value.forEach(item -> result.add(canonical(item)));
            return result;
        }
        return value;
    }
    static boolean passwordMatches(String password, String encoded) {
        if (encoded == null) return false;
        try {
            String[] parts = encoded.split("\\$");
            byte[] result = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(
                new PBEKeySpec(password.toCharArray(), HexFormat.of().parseHex(parts[2]), Integer.parseInt(parts[1]),256)).getEncoded();
            return MessageDigest.isEqual(result, HexFormat.of().parseHex(parts[3]));
        } catch (Exception e) { return false; }
    }
    ObjectNode login(JsonNode input) throws SQLException {
        try (Connection c = db.openConnection(); PreparedStatement s = c.prepareStatement(
            "select id,role,password_hash from user_account where mobile=? and status='ACTIVE'")) {
            s.setString(1, input.path("mobile").asText());
            try (ResultSet r = s.executeQuery()) {
                if (!r.next() || !passwordMatches(input.path("password").asText(),r.getString("password_hash")))
                    throw new Failure(401,"INVALID_CREDENTIALS");
                byte[] bytes = new byte[32]; new SecureRandom().nextBytes(bytes);
                String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
                try (PreparedStatement insert = c.prepareStatement("insert into auth_session(token_hash,user_id,expires_at) values(?,?,date_add(utc_timestamp(),interval 8 hour))")) {
                    insert.setString(1,hash(token)); insert.setInt(2,r.getInt("id")); insert.executeUpdate();
                }
                return JSON.createObjectNode().put("token",token).put("userId",r.getInt("id")).put("role",r.getString("role"));
            }
        }
    }
    Actor authenticate(String token) throws SQLException {
        if (token == null || token.isBlank()) throw new Failure(401,"AUTHENTICATION_REQUIRED");
        try (Connection c = db.openConnection(); PreparedStatement s = c.prepareStatement(
            "select u.id,u.role from auth_session s join user_account u on u.id=s.user_id where s.token_hash=? and not s.revoked and s.expires_at>utc_timestamp() and u.status='ACTIVE'")) {
            s.setString(1,hash(token));
            try (ResultSet r=s.executeQuery()) { if (!r.next()) throw new Failure(401,"SESSION_EXPIRED"); return new Actor(r.getInt(1),r.getString(2)); }
        }
    }
    void logout(String token) throws SQLException {
        try(Connection c=db.openConnection();PreparedStatement s=c.prepareStatement("update auth_session set revoked=true where token_hash=?")) {
            s.setString(1,hash(token));s.executeUpdate();
        }
    }
    void authorize(Actor actor,int patientId,boolean write) throws SQLException {
        if (write && !"CAREGIVER".equals(actor.role())) throw new Failure(403,"ROLE_READ_ONLY");
        String table="DOCTOR".equals(actor.role())?"patient_doctor_relation":"patient_caregiver_relation";
        try(Connection c=db.openConnection();PreparedStatement s=c.prepareStatement("select 1 from "+table+" where user_id=? and patient_id=?")) {
            s.setInt(1,actor.userId());s.setInt(2,patientId);
            try(ResultSet r=s.executeQuery()) {if(!r.next()) throw new Failure(403,"PATIENT_ACCESS_DENIED");}
        }
    }
    ObjectNode patients(Actor actor, int after, int limit, String search) throws SQLException {
        String table="DOCTOR".equals(actor.role())?"patient_doctor_relation":"patient_caregiver_relation";
        var items=JSON.createArrayNode();
        try(Connection c=db.openConnection();PreparedStatement s=c.prepareStatement(
            "select p.id,p.name from patient p where p.id>? and p.name like ? and exists(select 1 from "+table+" r where r.patient_id=p.id and r.user_id=?) order by p.id limit ?")) {
            s.setInt(1,after);s.setString(2,"%"+search+"%");s.setInt(3,actor.userId());s.setInt(4,limit+1);
            try(ResultSet r=s.executeQuery()) {while(r.next()) items.add(JSON.createObjectNode().put("id",r.getInt(1)).put("name",r.getString(2)));}
        }
        ObjectNode out=JSON.createObjectNode();out.set("items",items);
        if(items.size()>limit) {items.remove(items.size()-1);out.put("nextCursor",items.get(items.size()-1).path("id").asText());}
        else out.putNull("nextCursor");
        return out;
    }
    ObjectNode medication(Connection c,int patientId,long id) throws SQLException {
        try(PreparedStatement s=c.prepareStatement("select pm.*, mm.generic_name,mm.brand_name,mm.normalized_code from patient_medication pm join medication_master mm on mm.id=pm.medication_master_id where pm.patient_id=? and pm.id=?")) {
            s.setInt(1,patientId);s.setLong(2,id);
            try(ResultSet r=s.executeQuery()) {
                if(!r.next()) throw new Failure(404,"MEDICATION_NOT_FOUND");
                ObjectNode n=JSON.createObjectNode().put("id",r.getLong("id")).put("version",r.getInt("version"))
                    .put("genericName",r.getString("generic_name")).put("brandName",r.getString("brand_name"))
                    .put("dose",r.getString("dose")).put("frequency",r.getString("frequency"))
                    .put("administrationTime",r.getString("administration_time")).put("startDate",r.getString("start_date"))
                    .put("endDate",r.getString("end_date")).put("status",r.getString("status"))
                    .put("standardizationStatus",r.getString("normalized_code")==null?"UNSTANDARDIZED":"STANDARDIZED");
                return n;
            }
        }
    }
    ObjectNode medications(int patientId, boolean history) throws SQLException {
        try(Connection c=db.openConnection();PreparedStatement s=c.prepareStatement(
            "select id from patient_medication where patient_id=?"+(history?"":" and status='ACTIVE'")+" order by id")) {
            s.setInt(1,patientId);List<Long> ids=new ArrayList<>();
            try(ResultSet r=s.executeQuery()){while(r.next())ids.add(r.getLong(1));}
            var items=JSON.createArrayNode();for(long id:ids)items.add(medication(c,patientId,id));
            ObjectNode out=JSON.createObjectNode();out.set("medications",items);return out;
        }
    }
    ObjectNode profile(int patientId) throws SQLException {
        try(Connection c=db.openConnection();PreparedStatement s=c.prepareStatement("select * from patient where id=?")) {
            s.setInt(1,patientId);
            try(ResultSet r=s.executeQuery()) {
                if(!r.next())throw new Failure(404,"PATIENT_NOT_FOUND");
                return JSON.createObjectNode().put("id",patientId).put("version",r.getInt("version"))
                    .put("name",r.getString("name")).put("gender",r.getString("gender"))
                    .put("birthday",r.getString("birthday")).put("livingStatus",r.getString("living_status"))
                    .put("digitalAbilityLevel",r.getString("digital_ability_level"));
            }
        }
    }
    static void validate(ObjectNode n) {
        for(String field:List.of("genericName","dose","frequency","administrationTime","startDate"))
            if(!n.path(field).isTextual() || n.path(field).asText().isBlank())throw new Failure(422,"REQUIRED_"+field);
        for(String field:List.of("genericName","brandName","administrationTime","dose","frequency")) {
            if(n.hasNonNull(field) && (!n.get(field).isTextual() || n.get(field).asText().length()>(field.equals("dose")||field.equals("frequency")?64:128)))
                throw new Failure(422,"INVALID_"+field);
        }
        if(!Set.of("ACTIVE","STOPPED","ARCHIVED").contains(n.path("status").asText()))throw new Failure(422,"INVALID_STATUS");
        if(n.hasNonNull("endDate") && !n.path("endDate").isTextual())throw new Failure(422,"INVALID_DATE");
        try {
            LocalDate start=LocalDate.parse(n.path("startDate").asText());
            if(n.hasNonNull("endDate")&&!n.path("endDate").asText().isBlank()&&LocalDate.parse(n.path("endDate").asText()).isBefore(start))
                throw new Failure(422,"INVALID_DATE_RANGE");
        } catch(java.time.DateTimeException e){throw new Failure(422,"INVALID_DATE");}
    }
    ObjectNode save(Actor actor,int patientId,Long id,JsonNode body,String key) throws SQLException {
        if(id==null&&(key==null||!key.matches("[A-Za-z0-9_-]{8,128}")))throw new Failure(400,"IDEMPOTENCY_KEY_REQUIRED");
        if(id!=null&&(!body.path("expectedVersion").isIntegralNumber()||!body.path("expectedVersion").canConvertToInt()||body.path("expectedVersion").asInt()<1))throw new Failure(400,"EXPECTED_VERSION_REQUIRED");
        try(Connection c=db.openConnection()) {
            c.setAutoCommit(false);
            try {
                // Serializes this patient's medication mutations and input revision atomically.
                try(PreparedStatement lock=c.prepareStatement("select id from patient where id=? for update")) {
                    lock.setInt(1,patientId);try(ResultSet r=lock.executeQuery()){if(!r.next())throw new Failure(404,"PATIENT_NOT_FOUND");}
                }
                String scope="medications:"+patientId, digest=hash(canonical(body).toString());
                if(id==null)try(PreparedStatement old=c.prepareStatement("select request_hash,response_json from idempotency_record where user_id=? and scope=? and request_key=?")) {
                    old.setInt(1,actor.userId());old.setString(2,scope);old.setString(3,key);
                    try(ResultSet r=old.executeQuery()) {
                        // Old records used raw JSON ordering; exact legacy retries remain compatible.
                        if(r.next()) {if(!digest.equals(r.getString(1))&&!hash(body.toString()).equals(r.getString(1)))throw new Failure(409,"IDEMPOTENCY_CONFLICT");ObjectNode result=(ObjectNode)parse(r.getString(2));c.commit();return result;}
                    }
                }
                if(id!=null && body.has("captureTaskId"))throw new Failure(422,"CAPTURE_CREATE_ONLY");
                ObjectNode capture=CaptureService.beforeConfirm(c,patientId,body);
                ObjectNode n=id==null?JSON.createObjectNode().put("status","ACTIVE"):medication(c,patientId,id);
                if(id!=null&&n.path("version").asInt()!=body.path("expectedVersion").asInt())throw new Failure(409,"VERSION_CONFLICT_RELOAD");
                for(String field:List.of("genericName","brandName","dose","frequency","administrationTime","startDate","endDate","status"))
                    if(body.has(field))n.set(field,body.get(field));
                validate(n);
                // Exact dictionary match only. An unknown name receives no clinical classification.
                long master;
                try(PreparedStatement s=c.prepareStatement("select id from medication_master where generic_name=? and coalesce(brand_name,'')=? limit 1")) {
                    s.setString(1,n.path("genericName").asText().trim());s.setString(2,n.path("brandName").asText(""));
                    try(ResultSet r=s.executeQuery()) {master=r.next()?r.getLong(1):0;}
                }
                if(master==0)try(PreparedStatement s=c.prepareStatement("insert into medication_master(generic_name,brand_name,source_type) values(?,?,'MANUAL')",Statement.RETURN_GENERATED_KEYS)) {
                    s.setString(1,n.path("genericName").asText().trim());s.setString(2,n.path("brandName").asText(""));s.executeUpdate();
                    try(ResultSet r=s.getGeneratedKeys()){r.next();master=r.getLong(1);}
                }
                boolean create=id==null;
                String query=create?"insert into patient_medication(medication_master_id,dose,frequency,administration_time,start_date,end_date,status,patient_id,confirmed_by_user) values(?,?,?,?,?,?,?,?,true)":
                    "update patient_medication set medication_master_id=?,dose=?,frequency=?,administration_time=?,start_date=?,end_date=?,status=?,version=version+1,updated_at=utc_timestamp() where patient_id=? and id=?";
                try(PreparedStatement s=c.prepareStatement(query,Statement.RETURN_GENERATED_KEYS)) {
                    s.setLong(1,master);s.setString(2,n.path("dose").asText());s.setString(3,n.path("frequency").asText());s.setString(4,n.path("administrationTime").asText());
                    s.setString(5,n.path("startDate").asText());s.setString(6,n.hasNonNull("endDate")&&!n.path("endDate").asText().isBlank()?n.path("endDate").asText():null);
                    s.setString(7,n.path("status").asText());s.setInt(8,patientId);if(!create)s.setLong(9,id);s.executeUpdate();
                    if(create)try(ResultSet r=s.getGeneratedKeys()){r.next();id=r.getLong(1);}
                }
                ObjectNode result=medication(c,patientId,id);
                if(!create) ReminderService.medicationChanged(c,patientId,id);
                try(PreparedStatement s=c.prepareStatement("update medication_revision set valid_to=utc_timestamp(6) where medication_id=? and valid_to is null")) {s.setLong(1,id);s.executeUpdate();}
                try(PreparedStatement s=c.prepareStatement("insert into medication_revision(medication_id,version,patient_id,actor_id,snapshot,valid_from) values(?,?,?,?,?,utc_timestamp(6))")) {
                    s.setLong(1,id);s.setInt(2,result.path("version").asInt());s.setInt(3,patientId);s.setInt(4,actor.userId());s.setString(5,result.toString());s.executeUpdate();
                }
                try(PreparedStatement s=c.prepareStatement("update patient set input_revision=input_revision+1 where id=?")){s.setInt(1,patientId);s.executeUpdate();}
                try(PreparedStatement s=c.prepareStatement("insert into audit_log(actor_id,patient_id,action,resource_id) values(?,?,?,?)")) {
                    s.setInt(1,actor.userId());s.setInt(2,patientId);s.setString(3,create?"MEDICATION_CREATE":"MEDICATION_REVISE");s.setLong(4,id);s.executeUpdate();
                }
                if(create)try(PreparedStatement s=c.prepareStatement("insert into idempotency_record(user_id,scope,request_key,request_hash,response_json) values(?,?,?,?,?)")) {
                    s.setInt(1,actor.userId());s.setString(2,scope);s.setString(3,key);s.setString(4,digest);s.setString(5,result.toString());s.executeUpdate();
                }
                CaptureService.confirmed(c,actor,patientId,capture,result,body);
                c.commit();return result;
            } catch(SQLException|RuntimeException e){c.rollback();throw e;}
            finally{c.setAutoCommit(true);}
        }
    }
}
