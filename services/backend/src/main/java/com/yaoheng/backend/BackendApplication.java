package com.yaoheng.backend;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.Executors;

public class BackendApplication {
    public static void main(String[] args) throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", Integer.parseInt(System.getenv().getOrDefault("PORT", "3000"))), 0);
        server.createContext("/", new ApiHandler());
        server.setExecutor(Executors.newCachedThreadPool());
        server.start();
        var scheduler=Executors.newSingleThreadScheduledExecutor(r->{Thread t=new Thread(r,"reminder-expansion");t.setDaemon(true);return t;});
        scheduler.scheduleWithFixedDelay(()->{try{if(ApiHandler.DB.isReady()){ApiHandler.REMINDERS.replenish();System.out.println("REMINDER_EXPANSION_COMPLETE");}}catch(Exception e){System.err.println("Reminder expansion failed; retry next hour: "+e.getClass().getSimpleName());}},0,1,java.util.concurrent.TimeUnit.HOURS);
        Runtime.getRuntime().addShutdownHook(new Thread(()->{scheduler.shutdownNow();server.stop(0);}));
        if(!System.getenv().getOrDefault("AI_WORKER_ENABLED","true").equalsIgnoreCase("false")){
            var worker=Executors.newSingleThreadScheduledExecutor(r->{Thread t=new Thread(r,"analysis-worker");t.setDaemon(true);return t;});
            worker.scheduleWithFixedDelay(()->{try{if(ApiHandler.DB.isReady())ApiHandler.ANALYSIS.tick();}catch(Exception e){System.err.println("Analysis worker paused: "+e.getClass().getSimpleName());}},1,1,java.util.concurrent.TimeUnit.SECONDS);
            var reports=Executors.newSingleThreadScheduledExecutor(r->{Thread t=new Thread(r,"report-worker");t.setDaemon(true);return t;});
            reports.scheduleWithFixedDelay(()->{try{if(ApiHandler.DB.isReady())ApiHandler.REPORTS.tick();}catch(Exception e){System.err.println("Report worker paused: "+e.getClass().getSimpleName());}},1,1,java.util.concurrent.TimeUnit.SECONDS);
            Runtime.getRuntime().addShutdownHook(new Thread(()->{worker.shutdownNow();reports.shutdownNow();}));
        }
        System.out.println("Java backend listening on http://localhost:3000");
    }

    static class ApiHandler implements HttpHandler {
        private static final DatabaseRepository DB = DatabaseRepository.fromEnv();
        private static final ObjectMapper MAPPER = new ObjectMapper();
        private static final String AI_MODEL_VERSION = "ai-io-v1-java-mock";
        private static final Set<String> JOINT_EVENT_TYPES = Set.of(
            "JE001", "JE002", "JE003", "JE004", "JE005", "JE006", "JE007", "JE008", "JE009", "JE010"
        );
        private static final Set<String> RISK_DIRECTIONS = Set.of(
            "DEINTENSIFICATION", "INTERACTION", "TEMPORAL_BEHAVIOR", "JOINT_EVENT"
        );
        private static final Set<String> REVIEW_PRIORITIES = Set.of(
            "OBSERVE", "RETEST_SOON", "CLINIC_REVIEW", "HIGH_PRIORITY"
        );
        private static final R1Service R1 = new R1Service(DB);
        private static final ReminderService REMINDERS = new ReminderService(DB);
        private static final FeedbackService FEEDBACK = new FeedbackService(DB);
        private static final AnalysisService ANALYSIS = new AnalysisService(DB);
        private static final ReportService REPORTS = new ReportService(DB);
        private static final FollowUpService FOLLOWUPS = new FollowUpService(DB);
        private static final RaCandidateService RA_CANDIDATES = new RaCandidateService(DB);
        private static final CaptureHttp CAPTURES = new CaptureHttp(DB);

        @Override
        public void handle(HttpExchange exchange) throws IOException {
            Headers headers = exchange.getResponseHeaders();
            headers.set("Content-Type", "application/json; charset=utf-8");
            headers.set("Access-Control-Allow-Origin", "*");
            headers.set("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
            headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization,Idempotency-Key,X-File-Name");

            if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
                exchange.sendResponseHeaders(204, -1);
                exchange.close();
                return;
            }

            if (CAPTURES.handle(exchange)) return;
            String method = exchange.getRequestMethod();
            String path = exchange.getRequestURI().getPath();
            String requestBody = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            RouteResult result;
            try {
                result = routeR1(exchange, method, path, requestBody);
            } catch (R1Service.Failure e) {
                ObjectNode error=(ObjectNode)MAPPER.readTree(ApiEnvelope.errorEnvelope(e.status,e.getMessage()));
                if(e.data!=null)error.set("data",e.data);
                result = new RouteResult(e.status, error.toString());
            } catch (java.sql.SQLException e) {
                result = RouteResult.serviceUnavailable(ApiEnvelope.errorEnvelope(50302, "DATABASE_OPERATION_FAILED"));
            }

            if (result == null) {
                write(exchange, 404, "{\"code\":404,\"message\":\"not found\",\"data\":{}}");
                return;
            }

            write(exchange, result.status, result.body);
        }

        private RouteResult routeR1(HttpExchange exchange, String method, String path, String body) throws java.sql.SQLException {
            Headers requestHeaders = exchange.getRequestHeaders();
            if (path.equals("/api/health")) return route(method,path,body,requestHeaders);
            if (path.equals("/api/capabilities") && method.equals("GET")) return RouteResult.ok(ApiEnvelope.syncEnvelope(
                MAPPER.createObjectNode().put("raCandidates",RaCandidateService.enabled()).put("manualMedication",true).put("reminders",true).put("feedback",true).put("analysis",true).put("doctorRead",true).put("reports",true).put("followups",true).put("ocr",true).put("voice",true).put("device",true).put("ocrEngine",System.getenv().getOrDefault("CAPTURE_OCR_MODE","disabled")).put("voiceEngine",System.getenv().getOrDefault("CAPTURE_VOICE_MODE","disabled")).put("deviceMode","software-replay").put("audioRetention",false).toString()));
            if (path.equals("/api/auth/login")) throw new R1Service.Failure(403,"USE_PASSWORD_LOGIN");
            if (!DB.isReady()) return RouteResult.serviceUnavailable(ApiEnvelope.errorEnvelope(50301,"DATABASE_NOT_READY"));
            if (path.equals("/api/auth/password-login") && method.equals("POST"))
                return RouteResult.ok(ApiEnvelope.syncEnvelope(R1.login(R1Service.parse(body)).toString()));
            String auth = requestHeaders.getFirst("Authorization");
            String token = auth != null && auth.startsWith("Bearer ") ? auth.substring(7).trim() : "";
            R1Service.Actor actor = R1.authenticate(token);
            if (path.equals("/api/auth/logout") && method.equals("POST")) {
                R1.logout(token); return RouteResult.ok(ApiEnvelope.success());
            }
            var query = new java.util.HashMap<String,String>();
            String rawQuery=exchange.getRequestURI().getRawQuery();
            if(rawQuery!=null) for(String pair:rawQuery.split("&")) {
                String[] parts=pair.split("=",2);
                query.put(parts[0],parts.length>1?java.net.URLDecoder.decode(parts[1],StandardCharsets.UTF_8):"");
            }
            if(path.equals("/api/patients") && method.equals("GET")) {
                int limit=20,after=0;
                try {limit=Math.min(100,Math.max(1,Integer.parseInt(query.getOrDefault("limit","20"))));after=Integer.parseInt(query.getOrDefault("cursor","0"));}
                catch(NumberFormatException e){throw new R1Service.Failure(400,"INVALID_PAGINATION");}
                return RouteResult.ok(ApiEnvelope.syncEnvelope(R1.patients(actor,after,limit,query.getOrDefault("search","")).toString()));
            }
            if(path.equals("/api/patients/current") && method.equals("GET")) {
                var items=R1.patients(actor,0,1,"").path("items");
                ObjectNode context=MAPPER.createObjectNode().put("userId",actor.userId()).put("role",actor.role());
                if(items.isEmpty()) {context.putNull("patientId");context.putNull("patientName");}
                else {context.put("patientId",items.get(0).path("id").asInt());context.put("patientName",items.get(0).path("name").asText());}
                return RouteResult.ok(ApiEnvelope.syncEnvelope(context.toString()));
            }
            int patientId=extractPatientIdFromAnyPath(path);
            if(patientId<=0) throw new R1Service.Failure(403,"RESOURCE_NOT_ENABLED");
            boolean reportWrite=method.equals("POST")&&(path.equals("/api/patients/"+patientId+"/reports")||path.equals("/api/patients/"+patientId+"/reports/generate"));
            boolean doctorWrite=path.matches("/api/patients/[0-9]+/(reviews|follow-ups)(/[^/]+)?")&&(method.equals("POST")||method.equals("PATCH"));
            R1.authorize(actor,patientId,!method.equals("GET")&&!reportWrite&&!doctorWrite);
            String suffix=path.substring(("/api/patients/"+patientId).length());
            if(suffix.equals("/reports/generate"))suffix="/reports";
            if(suffix.equals("/feedback-records"))suffix="/feedback";
            else if(suffix.matches("/analyses/[^/]+"))suffix="/analysis/runs/"+suffix.split("/")[2];
            else if(suffix.startsWith("/feedback-records/"))suffix="/records/"+suffix.substring(18);
            if(query.containsKey("timezone")&&!query.get("timezone").equals("Asia/Shanghai"))throw new R1Service.Failure(422,"UNSUPPORTED_TIMEZONE");
            String key=requestHeaders.getFirst("Idempotency-Key");
            JsonNode result=null;
            if(suffix.matches("/reports/[^/]+/(content|download)")&&method.equals("GET")){
                String html=REPORTS.content(patientId,suffix.split("/")[2]);
                exchange.getResponseHeaders().set("Content-Type","text/html; charset=utf-8");
                exchange.getResponseHeaders().set("Content-Security-Policy","default-src 'none'; style-src 'unsafe-inline'; sandbox");
                exchange.getResponseHeaders().set("X-Content-Type-Options","nosniff");
                exchange.getResponseHeaders().set("Content-Disposition","attachment; filename=care-report.html");
                return RouteResult.ok(html);
            }
            if(suffix.matches("/ra/contexts/task_[a-f0-9-]{36}/projection")&&method.equals("GET"))result=ANALYSIS.raProjection(patientId,suffix.split("/")[3]);
            else if(suffix.matches("/ra/contexts/task_[a-f0-9-]{36}")&&method.equals("GET"))result=ANALYSIS.raContext(patientId,suffix.split("/")[3]);
            else if(suffix.equals("/ra/candidates")&&method.equals("POST"))result=RA_CANDIDATES.create(actor,patientId,R1Service.parse(body),key);
            else if(suffix.matches("/ra/candidates/rac_[a-f0-9-]{36}/discard")&&method.equals("POST"))result=RA_CANDIDATES.discard(actor,patientId,suffix.split("/")[3],R1Service.parse(body),key);
            else if(suffix.matches("/ra/candidates/rac_[a-f0-9-]{36}")&&method.equals("GET"))result=RA_CANDIDATES.get(patientId,suffix.split("/")[3]);
            else if(suffix.equals("/reviews")&&method.equals("GET"))result=FOLLOWUPS.reviews(patientId);
            else if(suffix.equals("/reviews")&&method.equals("POST"))result=FOLLOWUPS.review(actor,patientId,R1Service.parse(body),key);
            else if(suffix.equals("/follow-ups")&&method.equals("GET"))result=FOLLOWUPS.listFollowUps(patientId);
            else if(suffix.equals("/follow-ups")&&method.equals("POST"))result=FOLLOWUPS.create(actor,patientId,R1Service.parse(body),key);
            else if(suffix.matches("/follow-ups/[^/]+")&&method.equals("GET"))result=FOLLOWUPS.get(patientId,suffix.split("/")[2]);
            else if(suffix.matches("/follow-ups/[^/]+")&&method.equals("PATCH"))result=FOLLOWUPS.patch(actor,patientId,suffix.split("/")[2],R1Service.parse(body),key);
            else if(suffix.equals("/analysis/latest")&&method.equals("GET"))result=ANALYSIS.latest(patientId);
            else if(suffix.equals("/analysis/runs")&&method.equals("GET"))result=ANALYSIS.history(patientId);
            else if(suffix.matches("/analyses/[^/]+/projection")&&method.equals("GET"))result=ANALYSIS.projection(patientId,suffix.split("/")[2]);
            else if(suffix.matches("/analysis/runs/[^/]+")&&method.equals("GET"))result=ANALYSIS.run(patientId,suffix.split("/")[3]);
            else if(suffix.matches("/analysis-tasks/[^/]+/retry")&&method.equals("POST"))result=ANALYSIS.retry(actor,patientId,suffix.split("/")[2],R1Service.parse(body),key);
            else if(suffix.equals("/risk/latest")&&method.equals("GET"))result=ANALYSIS.latest(patientId);
            else if(suffix.equals("/joint-events")&&method.equals("GET")){ObjectNode latest=ANALYSIS.latest(patientId);ObjectNode events=MAPPER.createObjectNode();events.set("items",latest.path("snapshot").path("jointEvents").isArray()?latest.path("snapshot").path("jointEvents"):MAPPER.createArrayNode());events.set("snapshotId",latest.path("snapshot").path("snapshotId"));result=events;}
            else if(suffix.equals("/reports")&&method.equals("POST"))result=REPORTS.create(actor,patientId,R1Service.parse(body),key);
            else if(suffix.equals("/reports")&&method.equals("GET"))result=REPORTS.listReports(patientId);
            else if(suffix.matches("/reports/[^/]+")&&method.equals("GET"))result=REPORTS.get(patientId,suffix.split("/")[2]);
            if(suffix.equals("/reminder-plans")) {
                if(method.equals("GET"))result=REMINDERS.plans(patientId);
                if(method.equals("POST"))result=REMINDERS.save(actor,patientId,null,R1Service.parse(body),key);
            } else if(suffix.matches("/reminder-plans/[^/]+")&&method.equals("PATCH"))result=REMINDERS.save(actor,patientId,suffix.substring(16),R1Service.parse(body),key);
            else if(Set.of("/reminders/today","/reminders","/reminders/upcoming").contains(suffix)&&method.equals("GET"))result=REMINDERS.occurrences(patientId,query.get("date"),suffix.endsWith("upcoming"));
            else if(suffix.matches("/reminders/[^/]+/skip")&&method.equals("POST"))result=REMINDERS.skip(actor,patientId,suffix.split("/")[2],R1Service.parse(body),key);
            else if(suffix.equals("/reminders/ack")&&method.equals("POST"))result=FEEDBACK.acknowledge(patientId,R1Service.parse(body));
            else if(suffix.equals("/feedback")&&method.equals("POST"))result=FEEDBACK.save(actor,patientId,null,R1Service.parse(body),key);
            else if(suffix.matches("/records/[^/]+")&&method.equals("GET"))result=FEEDBACK.detail(patientId,suffix.split("/")[2]);
            else if(suffix.matches("/records/[^/]+/revisions")&&method.equals("POST"))result=FEEDBACK.save(actor,patientId,suffix.split("/")[2],R1Service.parse(body),key);
            else if(suffix.equals("/daily-events")&&method.equals("GET"))result=FEEDBACK.daily(patientId,query.get("date"));
            else if(suffix.matches("/analysis-tasks/[^/]+")&&method.equals("GET"))result=FEEDBACK.task(patientId,suffix.split("/")[2]);
            else if(suffix.equals("/inquiry-sessions/start")&&method.equals("POST"))result=FEEDBACK.startInquiry(actor,patientId,R1Service.parse(body),key);
            else if(suffix.matches("/inquiry-sessions/[^/]+/next-question")&&method.equals("GET"))result=FEEDBACK.nextQuestion(patientId,suffix.split("/")[2]);
            else if(suffix.matches("/inquiry-sessions/[^/]+/answer")&&method.equals("POST"))result=FEEDBACK.answer(actor,patientId,suffix.split("/")[2],R1Service.parse(body),key);
            else if(Set.of("/bp-records","/bg-records","/symptom-records","/meal-records","/adherence-events").contains(suffix)&&method.equals("POST"))result=FEEDBACK.legacy(actor,patientId,suffix,R1Service.parse(body),key);
            if(result!=null){
                if(result.path("items").isArray()){
                    int limit,cursor;
                    try{limit=Integer.parseInt(query.getOrDefault("limit","20"));cursor=Integer.parseInt(query.getOrDefault("cursor","0"));}
                    catch(NumberFormatException e){throw new R1Service.Failure(400,"INVALID_PAGINATION");}
                    if(limit<1||limit>100||cursor<0)throw new R1Service.Failure(400,"INVALID_PAGINATION");
                    JsonNode all=result.path("items");ArrayNode page=MAPPER.createArrayNode();
                    int end=(int)Math.min((long)cursor+limit,all.size());for(int i=cursor;i<end;i++)page.add(all.get(i));
                    ((ObjectNode)result).set("items",page);
                    if(end<all.size())((ObjectNode)result).put("nextCursor",Integer.toString(end));else ((ObjectNode)result).putNull("nextCursor");
                }
                return RouteResult.ok(ApiEnvelope.syncEnvelope(result.toString()));
            }
            if(path.equals("/api/patients/"+patientId+"/medications")) {
                if(method.equals("GET"))return RouteResult.ok(ApiEnvelope.syncEnvelope(R1.medications(patientId,"true".equals(query.get("history"))).toString()));
                if(method.equals("POST"))return RouteResult.ok(ApiEnvelope.syncEnvelope(R1.save(actor,patientId,null,R1Service.parse(body),requestHeaders.getFirst("Idempotency-Key")).toString()));
            }
            PathPatientMedication med=extractMedicationPath(path);
            if(med!=null && method.equals("PATCH"))return RouteResult.ok(ApiEnvelope.syncEnvelope(R1.save(actor,patientId,(long)med.medicationId(),R1Service.parse(body),null).toString()));
            // Unfinished domains cannot expose legacy fake success or writes in REAL.
            if(path.equals("/api/patients/"+patientId+"/profile") && method.equals("GET"))
                return RouteResult.ok(ApiEnvelope.syncEnvelope(R1.profile(patientId).toString()));
            throw new R1Service.Failure(503,"CAPABILITY_NOT_READY");
        }

        private RouteResult route(String method, String path, String requestBody, Headers headers) {
            RouteResult dbReadiness = requireDatabaseReadiness(method, path);
            if (dbReadiness != null) {
                return dbReadiness;
            }

            if ("POST".equals(method) && "/api/patients".equals(path)) {
                return handleCreatePatient(requestBody);
            }

            Integer patientIdFromPath = extractPatientIdFromProfilePath(path);
            if (patientIdFromPath != null) {
                if ("GET".equals(method)) {
                    return handleGetPatientProfile(patientIdFromPath);
                }
                if ("PATCH".equals(method)) {
                    return handlePatchPatient(patientIdFromPath, requestBody);
                }
            }

            Integer medicationUploadPatientId = extractPatientIdFromSuffixPath(path, "/medication-uploads");
            if (medicationUploadPatientId != null && "POST".equals(method)) {
                return handleCreateMedicationUpload(medicationUploadPatientId, requestBody);
            }

            PathPatientTask medicationUploadTaskPath = extractMedicationUploadTaskPath(path);
            if (medicationUploadTaskPath != null && "GET".equals(method)) {
                return handleGetMedicationUploadTask(medicationUploadTaskPath.patientId(), medicationUploadTaskPath.taskId());
            }

            Integer confirmPatientId = extractPatientIdFromSuffixPath(path, "/medications/confirm");
            if (confirmPatientId != null && "POST".equals(method)) {
                return handleConfirmMedications(confirmPatientId, requestBody);
            }

            Integer medicationsPatientId = extractPatientIdFromSuffixPath(path, "/medications");
            if (medicationsPatientId != null && "POST".equals(method)) {
                return handleCreateMedication(medicationsPatientId, requestBody);
            }
            if (medicationsPatientId != null && "GET".equals(method)) {
                return handleGetMedications(medicationsPatientId);
            }

            PathPatientMedication medicationPath = extractMedicationPath(path);
            if (medicationPath != null && "PATCH".equals(method)) {
                return handlePatchMedication(medicationPath.patientId(), medicationPath.medicationId(), requestBody);
            }

            Integer checkConflictPatientId = extractPatientIdFromSuffixPath(path, "/medications/check-conflicts");
            if (checkConflictPatientId != null && "POST".equals(method)) {
                return handleCheckMedicationConflicts(checkConflictPatientId);
            }

            Integer bpPatientId = extractPatientIdFromSuffixPath(path, "/bp-records");
            if (bpPatientId != null && "POST".equals(method)) {
                return handleCreateBpRecord(bpPatientId, requestBody);
            }

            Integer bgPatientId = extractPatientIdFromSuffixPath(path, "/bg-records");
            if (bgPatientId != null && "POST".equals(method)) {
                return handleCreateBgRecord(bgPatientId, requestBody);
            }

            Integer symptomPatientId = extractPatientIdFromSuffixPath(path, "/symptom-records");
            if (symptomPatientId != null && "POST".equals(method)) {
                return handleCreateSymptomRecord(symptomPatientId, requestBody);
            }

            Integer adherencePatientId = extractPatientIdFromSuffixPath(path, "/adherence-events");
            if (adherencePatientId != null && "POST".equals(method)) {
                return handleCreateAdherenceEvent(adherencePatientId, requestBody);
            }

            Integer mealPatientId = extractPatientIdFromSuffixPath(path, "/meal-records");
            if (mealPatientId != null && "POST".equals(method)) {
                return handleCreateMealRecord(mealPatientId, requestBody);
            }

            Integer inquiryStartPatientId = extractPatientIdFromSuffixPath(path, "/inquiry-sessions/start");
            if (inquiryStartPatientId != null && "POST".equals(method)) {
                return handleStartInquirySession(inquiryStartPatientId, requestBody);
            }

            PathPatientSession inquirySessionPath = extractInquirySessionPath(path);
            if (inquirySessionPath != null) {
                if ("POST".equals(method) && "answer".equals(inquirySessionPath.action())) {
                    return handleInquiryAnswer(inquirySessionPath.patientId(), inquirySessionPath.sessionId(), requestBody);
                }
                if ("GET".equals(method) && "next-question".equals(inquirySessionPath.action())) {
                    return handleInquiryNextQuestion(inquirySessionPath.patientId(), inquirySessionPath.sessionId());
                }
            }

            Integer riskPatientId = extractPatientIdFromSuffixPath(path, "/risk/latest");
            if (riskPatientId != null && "GET".equals(method)) {
                return handleGetRiskLatest(riskPatientId);
            }

            Integer jointEventPatientId = extractPatientIdFromSuffixPath(path, "/joint-events");
            if (jointEventPatientId != null && "GET".equals(method)) {
                return handleGetJointEvents(jointEventPatientId);
            }

            Integer reportGeneratePatientId = extractPatientIdFromSuffixPath(path, "/reports/generate");
            if (reportGeneratePatientId != null && "POST".equals(method)) {
                return handleGenerateReport(reportGeneratePatientId, requestBody);
            }

            PathPatientReport reportPath = extractReportPath(path);
            if (reportPath != null && "GET".equals(method)) {
                return handleGetReportTask(reportPath.patientId(), reportPath.reportId());
            }

            PathPatientReportDownload reportDownloadPath = extractReportDownloadPath(path);
            if (reportDownloadPath != null && "GET".equals(method)) {
                return handleGetReportDownload(reportDownloadPath.patientId(), reportDownloadPath.reportId());
            }

            Integer reminderTodayPatientId = extractPatientIdFromSuffixPath(path, "/reminders/today");
            if (reminderTodayPatientId != null && "GET".equals(method)) {
                return handleGetRemindersToday(reminderTodayPatientId);
            }

            Integer reminderAckPatientId = extractPatientIdFromSuffixPath(path, "/reminders/ack");
            if (reminderAckPatientId != null && "POST".equals(method)) {
                return handleAckReminder(reminderAckPatientId, requestBody);
            }

            Integer reminderSettingsPatientId = extractPatientIdFromSuffixPath(path, "/reminder-settings");
            if (reminderSettingsPatientId != null && "PATCH".equals(method)) {
                return handlePatchReminderSettings(reminderSettingsPatientId, requestBody);
            }

            return switch (method + " " + path) {
                case "GET /api/health" -> RouteResult.ok(ApiEnvelope.health(DB.isReady(), DB.startupStatus()));
                case "POST /api/ai/parse-event", "POST /ai/parse-event" -> handleAiParseEvent(requestBody);
                case "POST /api/ai/detect-joint-events", "POST /ai/detect-joint-events" -> handleAiDetectJointEvents(requestBody);
                case "POST /api/ai/score-risk", "POST /ai/score-risk" -> handleAiScoreRisk(requestBody);
                case "POST /api/ai/generate-report", "POST /ai/generate-report" -> handleAiGenerateReport(requestBody);
                default -> null;
            };
        }

        private RouteResult requireDatabaseReadiness(String method, String path) {
            if (path == null || !DB.isReady()) {
                boolean requiresDb = path != null
                    && (path.startsWith("/api/patients") || ("POST".equals(method) && "/api/auth/login".equals(path)));
                if (requiresDb) {
                    return RouteResult.serviceUnavailable(
                        ApiEnvelope.errorEnvelope(
                            50301,
                            "database is not ready",
                            DB.startupStatus()
                        )
                    );
                }
            }
            return null;
        }

        private RouteResult handleCreatePatient(String requestBody) {
            String name = extractJsonString(requestBody, "name");
            String gender = extractJsonString(requestBody, "gender");
            String birthday = extractJsonString(requestBody, "birthday");
            String livingStatus = extractJsonString(requestBody, "livingStatus");
            String digitalAbilityLevel = extractJsonString(requestBody, "digitalAbilityLevel");

            if (isBlank(name) || isBlank(gender) || isBlank(birthday) || isBlank(livingStatus) || isBlank(digitalAbilityLevel)) {
                return RouteResult.badRequest(
                    ApiEnvelope.errorEnvelope(40002, "name, gender, birthday, livingStatus, digitalAbilityLevel are required")
                );
            }

            String profileJson = DB.createPatientJson(name, gender, birthday, livingStatus, digitalAbilityLevel).orElse(null);
            if (profileJson == null) {
                return RouteResult.badRequest(ApiEnvelope.errorEnvelope(50001, "failed to create patient"));
            }

            return RouteResult.ok(ApiEnvelope.syncEnvelope(profileJson));
        }

        private RouteResult handleGetPatientProfile(int patientId) {
            return DB.getPatientProfileJson(patientId)
                .map(profileJson -> RouteResult.ok(ApiEnvelope.syncEnvelope(profileJson)))
                .orElse(RouteResult.notFound(ApiEnvelope.errorEnvelope(40401, "patient not found")));
        }

        private RouteResult handlePatchPatient(int patientId, String requestBody) {
            if (!DB.patientExists(patientId)) {
                return RouteResult.notFound(ApiEnvelope.errorEnvelope(40401, "patient not found"));
            }

            String name = extractJsonString(requestBody, "name");
            String livingStatus = extractJsonString(requestBody, "livingStatus");
            String digitalAbilityLevel = extractJsonString(requestBody, "digitalAbilityLevel");
            boolean ok = DB.patchPatient(patientId, name, livingStatus, digitalAbilityLevel);
            if (!ok) {
                return RouteResult.badRequest(ApiEnvelope.errorEnvelope(50002, "failed to patch patient"));
            }

            return DB.getPatientProfileJson(patientId)
                .map(profileJson -> RouteResult.ok(ApiEnvelope.syncEnvelope(profileJson)))
                .orElse(RouteResult.notFound(ApiEnvelope.errorEnvelope(40401, "patient not found")));
        }

        private RouteResult handleCreateMedicationUpload(int patientId, String requestBody) {
            if (!DB.patientExists(patientId)) {
                return RouteResult.notFound(ApiEnvelope.errorEnvelope(40401, "patient not found"));
            }

            String fileAssetId = extractJsonString(requestBody, "fileAssetId");
            if (isBlank(fileAssetId)) {
                fileAssetId = extractJsonNumber(requestBody, "fileAssetId");
            }
            if (isBlank(fileAssetId)) {
                return RouteResult.badRequest(ApiEnvelope.errorEnvelope(40003, "fileAssetId is required"));
            }

            String taskId = "task_demo_med_%d".formatted(System.currentTimeMillis());
            String taskJson = DB.createMedicationUploadTaskJson(patientId, Long.parseLong(fileAssetId), taskId).orElse(null);
            if (taskJson == null) {
                return RouteResult.badRequest(ApiEnvelope.errorEnvelope(50003, "failed to create medication upload task"));
            }
            return RouteResult.accepted(ApiEnvelope.asyncEnvelope(taskJson));
        }

        private RouteResult handleGetMedicationUploadTask(int patientId, String taskId) {
            return DB.getMedicationUploadTaskJson(patientId, taskId)
                .map(json -> RouteResult.ok(ApiEnvelope.syncEnvelope(json)))
                .orElse(RouteResult.notFound(ApiEnvelope.errorEnvelope(40402, "medication upload task not found")));
        }

        private RouteResult handleConfirmMedications(int patientId, String requestBody) {
            if (!DB.patientExists(patientId)) {
                return RouteResult.notFound(ApiEnvelope.errorEnvelope(40401, "patient not found"));
            }

            String taskId = extractJsonString(requestBody, "taskId");
            if (isBlank(taskId)) {
                return RouteResult.badRequest(ApiEnvelope.errorEnvelope(40004, "taskId is required"));
            }

            String json = DB.confirmMedicationsJson(patientId, taskId).orElse(null);
            if (json == null) {
                return RouteResult.notFound(ApiEnvelope.errorEnvelope(40402, "medication upload task not found"));
            }

            return RouteResult.ok(ApiEnvelope.syncEnvelope(json));
        }

        private RouteResult handleGetMedications(int patientId) {
            if (!DB.patientExists(patientId)) {
                return RouteResult.notFound(ApiEnvelope.errorEnvelope(40401, "patient not found"));
            }

            String medicationsJson = DB.getMedicationsJson(patientId).orElse("{\"medications\": []}");
            return RouteResult.ok(ApiEnvelope.syncEnvelope(medicationsJson));
        }

        private RouteResult handlePatchMedication(int patientId, int medicationId, String requestBody) {
            if (!DB.patientExists(patientId)) {
                return RouteResult.notFound(ApiEnvelope.errorEnvelope(40401, "patient not found"));
            }

            String dose = extractJsonString(requestBody, "dose");
            String frequency = extractJsonString(requestBody, "frequency");
            String administrationTime = extractJsonString(requestBody, "administrationTime");
            String endDate = extractJsonString(requestBody, "endDate");
            String status = extractJsonString(requestBody, "status");

            boolean patched = DB.patchMedication(patientId, medicationId, dose, frequency, administrationTime, endDate, status);
            if (!patched) {
                return RouteResult.notFound(ApiEnvelope.errorEnvelope(40403, "medication not found"));
            }

            String json = DB.getMedicationJson(patientId, medicationId).orElse(null);
            if (json == null) {
                return RouteResult.notFound(ApiEnvelope.errorEnvelope(40403, "medication not found"));
            }
            return RouteResult.ok(ApiEnvelope.syncEnvelope(json));
        }

        private RouteResult handleCreateMedication(int patientId, String requestBody) {
            if (!DB.patientExists(patientId)) {
                return RouteResult.notFound(ApiEnvelope.errorEnvelope(40401, "patient not found"));
            }
            String genericName = extractJsonString(requestBody, "genericName");
            String brandName = extractJsonString(requestBody, "brandName");
            String dose = extractJsonString(requestBody, "dose");
            String frequency = extractJsonString(requestBody, "frequency");
            String administrationTime = extractJsonString(requestBody, "administrationTime");
            String startDate = extractJsonString(requestBody, "startDate");
            String endDate = extractJsonString(requestBody, "endDate");
            String status = extractJsonString(requestBody, "status");
            if (isBlank(genericName) || isBlank(dose) || isBlank(frequency)
                || isBlank(administrationTime) || isBlank(startDate)) {
                return RouteResult.badRequest(ApiEnvelope.errorEnvelope(40006,
                    "genericName, dose, frequency, administrationTime and startDate are required"));
            }
            String json = DB.createMedicationJson(patientId, genericName, brandName, dose, frequency,
                administrationTime, startDate, endDate, status).orElse(null);
            return json == null
                ? RouteResult.badRequest(ApiEnvelope.errorEnvelope(50004, "failed to create medication"))
                : RouteResult.ok(ApiEnvelope.syncEnvelope(json));
        }

        private RouteResult handleCheckMedicationConflicts(int patientId) {
            if (!DB.patientExists(patientId)) {
                return RouteResult.notFound(ApiEnvelope.errorEnvelope(40401, "patient not found"));
            }

            String json = DB.getMedicationConflictsJson(patientId).orElse("{\"duplicatedMedicationIds\": [], \"conflicts\": []}");
            return RouteResult.ok(ApiEnvelope.syncEnvelope(json));
        }

        private RouteResult handleCreateBpRecord(int patientId, String requestBody) {
            if (!DB.patientExists(patientId)) {
                return RouteResult.notFound(ApiEnvelope.errorEnvelope(40401, "patient not found"));
            }

            String measuredAt = extractJsonString(requestBody, "measuredAt");
            String systolic = extractJsonNumber(requestBody, "systolic");
            String diastolic = extractJsonNumber(requestBody, "diastolic");
            String heartRate = extractJsonNumber(requestBody, "heartRate");

            if (isBlank(measuredAt) || isBlank(systolic) || isBlank(diastolic) || isBlank(heartRate)) {
                return RouteResult.badRequest(ApiEnvelope.errorEnvelope(40010, "measuredAt, systolic, diastolic, heartRate are required"));
            }

            if (!DB.createBpRecord(patientId, measuredAt, Integer.parseInt(systolic), Integer.parseInt(diastolic), Integer.parseInt(heartRate))) {
                return RouteResult.badRequest(ApiEnvelope.errorEnvelope(50010, "failed to save bp record"));
            }
            return RouteResult.ok(ApiEnvelope.success());
        }

        private RouteResult handleCreateBgRecord(int patientId, String requestBody) {
            if (!DB.patientExists(patientId)) {
                return RouteResult.notFound(ApiEnvelope.errorEnvelope(40401, "patient not found"));
            }

            String measuredAt = extractJsonString(requestBody, "measuredAt");
            String glucoseValue = extractJsonNumeric(requestBody, "glucoseValue");
            String mealPhase = extractJsonString(requestBody, "mealPhase");

            if (isBlank(measuredAt) || isBlank(glucoseValue) || isBlank(mealPhase)) {
                return RouteResult.badRequest(ApiEnvelope.errorEnvelope(40011, "measuredAt, glucoseValue, mealPhase are required"));
            }

            if (!DB.createBgRecord(patientId, measuredAt, Double.parseDouble(glucoseValue), mealPhase)) {
                return RouteResult.badRequest(ApiEnvelope.errorEnvelope(50011, "failed to save bg record"));
            }
            return RouteResult.ok(ApiEnvelope.success());
        }

        private RouteResult handleCreateSymptomRecord(int patientId, String requestBody) {
            if (!DB.patientExists(patientId)) {
                return RouteResult.notFound(ApiEnvelope.errorEnvelope(40401, "patient not found"));
            }

            String occurredAt = extractJsonString(requestBody, "occurredAt");
            String symptomCode = extractJsonString(requestBody, "symptomCode");
            String severity = extractJsonNumber(requestBody, "severity");
            String note = extractJsonString(requestBody, "note");

            if (isBlank(occurredAt) || isBlank(symptomCode) || isBlank(severity)) {
                return RouteResult.badRequest(ApiEnvelope.errorEnvelope(40012, "occurredAt, symptomCode, severity are required"));
            }

            if (!DB.createSymptomRecord(patientId, occurredAt, symptomCode, Integer.parseInt(severity), note)) {
                return RouteResult.badRequest(ApiEnvelope.errorEnvelope(50012, "failed to save symptom record"));
            }
            return RouteResult.ok(ApiEnvelope.success());
        }

        private RouteResult handleCreateAdherenceEvent(int patientId, String requestBody) {
            if (!DB.patientExists(patientId)) {
                return RouteResult.notFound(ApiEnvelope.errorEnvelope(40401, "patient not found"));
            }

            String medicationId = extractJsonNumber(requestBody, "medicationId");
            String eventTime = extractJsonString(requestBody, "eventTime");
            String eventType = extractJsonString(requestBody, "eventType");
            String note = extractJsonString(requestBody, "note");

            if (isBlank(medicationId) || isBlank(eventTime) || isBlank(eventType)) {
                return RouteResult.badRequest(ApiEnvelope.errorEnvelope(40013, "medicationId, eventTime, eventType are required"));
            }

            if (!DB.createAdherenceEvent(patientId, Integer.parseInt(medicationId), eventTime, eventType, note)) {
                return RouteResult.notFound(ApiEnvelope.errorEnvelope(40403, "medication not found"));
            }
            return RouteResult.ok(ApiEnvelope.success());
        }

        private RouteResult handleCreateMealRecord(int patientId, String requestBody) {
            if (!DB.patientExists(patientId)) {
                return RouteResult.notFound(ApiEnvelope.errorEnvelope(40401, "patient not found"));
            }

            String occurredAt = extractJsonString(requestBody, "occurredAt");
            String mealType = extractJsonString(requestBody, "mealType");
            String intakeLevel = extractJsonString(requestBody, "intakeLevel");

            if (isBlank(occurredAt) || isBlank(mealType) || isBlank(intakeLevel)) {
                return RouteResult.badRequest(ApiEnvelope.errorEnvelope(40014, "occurredAt, mealType, intakeLevel are required"));
            }

            if (!DB.createMealRecord(patientId, occurredAt, mealType, intakeLevel)) {
                return RouteResult.badRequest(ApiEnvelope.errorEnvelope(50014, "failed to save meal record"));
            }
            return RouteResult.ok(ApiEnvelope.success());
        }

        private RouteResult handleStartInquirySession(int patientId, String requestBody) {
            if (!DB.patientExists(patientId)) {
                return RouteResult.notFound(ApiEnvelope.errorEnvelope(40401, "patient not found"));
            }

            String triggerType = extractJsonString(requestBody, "triggerType");
            String triggerTime = extractJsonString(requestBody, "triggerTime");
            if (isBlank(triggerType) || isBlank(triggerTime)) {
                return RouteResult.badRequest(ApiEnvelope.errorEnvelope(40020, "triggerType and triggerTime are required"));
            }

            String sessionId = "inq_demo_%d".formatted(System.currentTimeMillis());
            List<DatabaseRepository.InquiryQuestionSeed> seeds = INQUIRY_QUESTIONS.stream()
                .map(item -> new DatabaseRepository.InquiryQuestionSeed(item.questionCode(), item.questionText()))
                .toList();
            String json = DB.startInquirySession(patientId, sessionId, triggerType, triggerTime, seeds).orElse(null);
            if (json == null) {
                return RouteResult.badRequest(ApiEnvelope.errorEnvelope(50020, "failed to start inquiry session"));
            }

            return RouteResult.ok(ApiEnvelope.syncEnvelope(json));
        }

        private RouteResult handleInquiryAnswer(int patientId, String sessionId, String requestBody) {
            String questionCode = extractJsonString(requestBody, "questionCode");
            if (isBlank(questionCode)) {
                return RouteResult.badRequest(ApiEnvelope.errorEnvelope(40021, "questionCode is required"));
            }

            String answerValue = extractJsonString(requestBody, "answerValue");
            String answerText = extractJsonString(requestBody, "answerText");

            if (!DB.answerInquiryQuestion(patientId, sessionId, questionCode, answerValue, answerText)) {
                return RouteResult.notFound(ApiEnvelope.errorEnvelope(40404, "inquiry session not found"));
            }

            return RouteResult.ok(ApiEnvelope.success());
        }

        private RouteResult handleInquiryNextQuestion(int patientId, String sessionId) {
            return DB.getNextInquiryQuestionJson(patientId, sessionId)
                .map(json -> RouteResult.ok(ApiEnvelope.syncEnvelope(json)))
                .orElse(RouteResult.notFound(ApiEnvelope.errorEnvelope(40404, "inquiry session not found")));
        }

        private RouteResult handleGetRiskLatest(int patientId) {
            return DB.getRiskLatestJson(patientId)
                .map(riskJson -> RouteResult.ok(ApiEnvelope.syncEnvelope(riskJson)))
                .orElse(RouteResult.notFound(ApiEnvelope.errorEnvelope(40401, "patient not found")));
        }

        private RouteResult handleGetJointEvents(int patientId) {
            if (!DB.patientExists(patientId)) {
                return RouteResult.notFound(ApiEnvelope.errorEnvelope(40401, "patient not found"));
            }

            String jointEventsJson = DB.getJointEventsJson(patientId).orElse("{\"jointEvents\": []}");
            return RouteResult.ok(ApiEnvelope.syncEnvelope(jointEventsJson));
        }

        private RouteResult handleGenerateReport(int patientId, String requestBody) {
            if (!DB.patientExists(patientId)) {
                return RouteResult.notFound(ApiEnvelope.errorEnvelope(40401, "patient not found"));
            }

            String reportType = extractJsonString(requestBody, "reportType");
            if (isBlank(reportType)) {
                return RouteResult.badRequest(ApiEnvelope.errorEnvelope(40030, "reportType is required"));
            }

            if (!"DOCTOR".equals(reportType) && !"FAMILY".equals(reportType)) {
                return RouteResult.badRequest(ApiEnvelope.errorEnvelope(40031, "reportType must be FAMILY or DOCTOR"));
            }

            String json = DB.createReportTaskJson(patientId, reportType).orElse(null);
            if (json == null) {
                return RouteResult.badRequest(ApiEnvelope.errorEnvelope(50030, "failed to create report task"));
            }
            return RouteResult.accepted(ApiEnvelope.asyncEnvelope(json));
        }

        private RouteResult handleGetReportTask(int patientId, String reportId) {
            return DB.getReportTaskJson(patientId, reportId)
                .map(json -> RouteResult.ok(ApiEnvelope.syncEnvelope(json)))
                .orElse(RouteResult.notFound(ApiEnvelope.errorEnvelope(40405, "report task not found")));
        }

        private RouteResult handleGetReportDownload(int patientId, String reportId) {
            String json = DB.getReportDownloadJson(patientId, reportId).orElse(null);
            if (json == null) {
                return RouteResult.badRequest(ApiEnvelope.errorEnvelope(40032, "report is not ready"));
            }
            return RouteResult.ok(ApiEnvelope.syncEnvelope(json));
        }

        private RouteResult handleGetRemindersToday(int patientId) {
            if (!DB.patientExists(patientId)) {
                return RouteResult.notFound(ApiEnvelope.errorEnvelope(40401, "patient not found"));
            }

            String json = DB.getRemindersTodayJson(patientId).orElse("{\"reminders\": []}");
            return RouteResult.ok(ApiEnvelope.syncEnvelope(json));
        }

        private RouteResult handleAckReminder(int patientId, String requestBody) {
            if (!DB.patientExists(patientId)) {
                return RouteResult.notFound(ApiEnvelope.errorEnvelope(40401, "patient not found"));
            }

            String reminderId = extractJsonString(requestBody, "reminderId");
            if (isBlank(reminderId)) {
                return RouteResult.badRequest(ApiEnvelope.errorEnvelope(40040, "reminderId is required"));
            }

            if (!DB.ackReminder(patientId, reminderId)) {
                return RouteResult.notFound(ApiEnvelope.errorEnvelope(40406, "reminder not found"));
            }
            return RouteResult.ok(ApiEnvelope.success());
        }

        private RouteResult handlePatchReminderSettings(int patientId, String requestBody) {
            if (!DB.patientExists(patientId)) {
                return RouteResult.notFound(ApiEnvelope.errorEnvelope(40401, "patient not found"));
            }

            Boolean medicationReminderEnabled = extractJsonBoolean(requestBody, "medicationReminderEnabled");
            Boolean bpReminderEnabled = extractJsonBoolean(requestBody, "bpReminderEnabled");
            Boolean bgReminderEnabled = extractJsonBoolean(requestBody, "bgReminderEnabled");

            String start = extractNestedJsonString(requestBody, "quietHours", "start");
            String end = extractNestedJsonString(requestBody, "quietHours", "end");

            String json = DB.patchReminderSettingsJson(patientId, medicationReminderEnabled, bpReminderEnabled, bgReminderEnabled, start, end).orElse(null);
            if (json == null) {
                return RouteResult.badRequest(ApiEnvelope.errorEnvelope(50040, "failed to patch reminder settings"));
            }
            return RouteResult.ok(ApiEnvelope.success());
        }

        private RouteResult handleAiParseEvent(String requestBody) {
            JsonNode body;
            try {
                body = MAPPER.readTree(requestBody);
            } catch (JsonProcessingException ex) {
                return RouteResult.badRequest(ApiEnvelope.errorEnvelope(40050, "invalid json body"));
            }

            if (!isIntegerField(body, "patientId")
                || !isTextField(body, "triggerType")
                || !isTextField(body, "rawText")
                || !isObjectField(body, "context")) {
                return RouteResult.badRequest(
                    ApiEnvelope.errorEnvelope(40051, "patientId, triggerType, rawText, context are required")
                );
            }

            String rawText = body.get("rawText").asText().toLowerCase();
            boolean tookMeal = !(rawText.contains("没吃") || rawText.contains("未吃"));
            String mealAmount = rawText.contains("半") ? "HALF" : (rawText.contains("少") ? "LITTLE" : "NORMAL");
            boolean missedMed = rawText.contains("漏服") || rawText.contains("忘记吃药");
            boolean makeupMed = rawText.contains("补服") || rawText.contains("补吃");

            ArrayNode symptoms = MAPPER.createArrayNode();
            if (rawText.contains("头晕")) {
                symptoms.add("DIZZINESS");
            }
            if (rawText.contains("心慌")) {
                symptoms.add("PALPITATION");
            }
            if (rawText.contains("乏力")) {
                symptoms.add("FATIGUE");
            }

            ObjectNode structuredEvent = MAPPER.createObjectNode();
            structuredEvent.set("symptoms", symptoms);
            ObjectNode meal = MAPPER.createObjectNode();
            meal.put("taken", tookMeal);
            meal.put("amount", mealAmount);
            structuredEvent.set("meal", meal);

            ObjectNode adherence = MAPPER.createObjectNode();
            adherence.put("makeupMed", makeupMed);
            adherence.put("missedMed", missedMed);
            structuredEvent.set("adherence", adherence);
            structuredEvent.put("timeHint", rawText.contains("早上") ? "MORNING" : (rawText.contains("晚上") ? "EVENING" : "UNKNOWN"));

            ObjectNode response = MAPPER.createObjectNode();
            response.set("structuredEvent", structuredEvent);
            response.put("confidence", symptoms.isEmpty() ? 0.72 : 0.86);
            response.put("modelVersion", AI_MODEL_VERSION);
            return RouteResult.ok(response.toString());
        }

        private RouteResult handleAiDetectJointEvents(String requestBody) {
            JsonNode body;
            try {
                body = MAPPER.readTree(requestBody);
            } catch (JsonProcessingException ex) {
                return RouteResult.badRequest(ApiEnvelope.errorEnvelope(40052, "invalid json body"));
            }

            if (!isIntegerField(body, "patientId")
                || !isObjectField(body, "timeWindow")
                || !isArrayField(body, "events")
                || !isArrayField(body, "medications")
                || !isObjectField(body, "profile")) {
                return RouteResult.badRequest(
                    ApiEnvelope.errorEnvelope(40053, "patientId, timeWindow, events, medications, profile are required")
                );
            }

            JsonNode timeWindow = body.get("timeWindow");
            if (!isTextField(timeWindow, "start") || !isTextField(timeWindow, "end")) {
                return RouteResult.badRequest(ApiEnvelope.errorEnvelope(40054, "timeWindow.start and timeWindow.end are required"));
            }
            if (!isDateTime(timeWindow.get("start").asText()) || !isDateTime(timeWindow.get("end").asText())) {
                return RouteResult.unprocessableEntity(ApiEnvelope.errorEnvelope(42250, "timeWindow.start/end must be date-time"));
            }

            ArrayNode jointEvents = MAPPER.createArrayNode();
            JsonNode events = body.get("events");
            if (!events.isEmpty()) {
                ObjectNode item = MAPPER.createObjectNode();
                item.put("eventType", "JE003");
                item.put("severity", Math.min(5, Math.max(1, events.size())));
                ObjectNode evidence = MAPPER.createObjectNode();
                evidence.put("eventCount", events.size());
                evidence.put("windowStart", timeWindow.get("start").asText());
                evidence.put("windowEnd", timeWindow.get("end").asText());
                item.set("evidence", evidence);
                ArrayNode directions = MAPPER.createArrayNode();
                directions.add("JOINT_EVENT");
                if (events.size() >= 2) {
                    directions.add("TEMPORAL_BEHAVIOR");
                }
                item.set("riskDirections", directions);
                jointEvents.add(item);
            }

            ObjectNode response = MAPPER.createObjectNode();
            response.set("jointEvents", jointEvents);
            response.put("modelVersion", AI_MODEL_VERSION);
            return RouteResult.ok(response.toString());
        }

        private RouteResult handleAiScoreRisk(String requestBody) {
            JsonNode body;
            try {
                body = MAPPER.readTree(requestBody);
            } catch (JsonProcessingException ex) {
                return RouteResult.badRequest(ApiEnvelope.errorEnvelope(40055, "invalid json body"));
            }

            if (!isIntegerField(body, "patientId") || !isArrayField(body, "jointEvents") || !isObjectField(body, "profile")) {
                return RouteResult.badRequest(ApiEnvelope.errorEnvelope(40056, "patientId, jointEvents, profile are required"));
            }

            JsonNode jointEvents = body.get("jointEvents");
            for (JsonNode item : jointEvents) {
                if (!isTextField(item, "eventType") || !JOINT_EVENT_TYPES.contains(item.get("eventType").asText())
                    || !isIntegerField(item, "severity")
                    || !isObjectField(item, "evidence")
                    || !isArrayField(item, "riskDirections")) {
                    return RouteResult.unprocessableEntity(ApiEnvelope.errorEnvelope(42251, "jointEvents item shape is invalid"));
                }
                for (JsonNode direction : item.get("riskDirections")) {
                    if (!direction.isTextual() || !RISK_DIRECTIONS.contains(direction.asText())) {
                        return RouteResult.unprocessableEntity(ApiEnvelope.errorEnvelope(42252, "riskDirections contains invalid value"));
                    }
                }
            }

            int deintensification = 10;
            int interaction = 10;
            int behavior = 10;
            int jointEvent = 10;
            Set<String> reasons = new HashSet<>();

            for (JsonNode item : jointEvents) {
                int severity = item.get("severity").asInt();
                for (JsonNode direction : item.get("riskDirections")) {
                    switch (direction.asText()) {
                        case "DEINTENSIFICATION" -> {
                            deintensification += severity * 8;
                            reasons.add("检测到疑似减药/漏药相关联合事件");
                        }
                        case "INTERACTION" -> {
                            interaction += severity * 8;
                            reasons.add("检测到潜在药物相互作用线索");
                        }
                        case "TEMPORAL_BEHAVIOR" -> {
                            behavior += severity * 8;
                            reasons.add("检测到时间与行为模式异常");
                        }
                        case "JOINT_EVENT" -> {
                            jointEvent += severity * 8;
                            reasons.add("检测到多事件耦合风险");
                        }
                        default -> {
                        }
                    }
                }
            }

            deintensification = Math.min(100, deintensification);
            interaction = Math.min(100, interaction);
            behavior = Math.min(100, behavior);
            jointEvent = Math.min(100, jointEvent);

            int maxScore = Math.max(Math.max(deintensification, interaction), Math.max(behavior, jointEvent));
            String priority = maxScore >= 80
                ? "HIGH_PRIORITY"
                : maxScore >= 60 ? "CLINIC_REVIEW" : maxScore >= 35 ? "RETEST_SOON" : "OBSERVE";
            if (!REVIEW_PRIORITIES.contains(priority)) {
                return RouteResult.unprocessableEntity(ApiEnvelope.errorEnvelope(42253, "reviewPriority is invalid"));
            }

            ObjectNode response = MAPPER.createObjectNode();
            response.put("deintensificationScore", deintensification);
            response.put("interactionScore", interaction);
            response.put("behaviorScore", behavior);
            response.put("jointEventScore", jointEvent);
            response.put("reviewPriority", priority);
            ArrayNode reasonArray = MAPPER.createArrayNode();
            if (reasons.isEmpty()) {
                reasonArray.add("未检测到显著异常，建议持续观察");
            } else {
                reasons.forEach(reasonArray::add);
            }
            response.set("reasons", reasonArray);
            response.put("modelVersion", AI_MODEL_VERSION);
            return RouteResult.ok(response.toString());
        }

        private RouteResult handleAiGenerateReport(String requestBody) {
            JsonNode body;
            try {
                body = MAPPER.readTree(requestBody);
            } catch (JsonProcessingException ex) {
                return RouteResult.badRequest(ApiEnvelope.errorEnvelope(40057, "invalid json body"));
            }

            if (!isIntegerField(body, "patientId") || !isObjectField(body, "risk") || !isArrayField(body, "jointEvents")) {
                return RouteResult.badRequest(ApiEnvelope.errorEnvelope(40058, "patientId, risk, jointEvents are required"));
            }
            JsonNode risk = body.get("risk");
            if (!isIntegerField(risk, "deintensificationScore")
                || !isIntegerField(risk, "interactionScore")
                || !isIntegerField(risk, "behaviorScore")
                || !isIntegerField(risk, "jointEventScore")
                || !isTextField(risk, "reviewPriority")
                || !isArrayField(risk, "reasons")
                || !isTextField(risk, "modelVersion")) {
                return RouteResult.unprocessableEntity(ApiEnvelope.errorEnvelope(42254, "risk object shape is invalid"));
            }

            String priority = risk.get("reviewPriority").asText();
            if (!REVIEW_PRIORITIES.contains(priority)) {
                return RouteResult.unprocessableEntity(ApiEnvelope.errorEnvelope(42255, "risk.reviewPriority is invalid"));
            }

            ObjectNode familyVersion = MAPPER.createObjectNode();
            familyVersion.put("title", "用药与症状联合风险提醒");
            ArrayNode familyActions = MAPPER.createArrayNode();
            familyActions.add("按时记录血压、血糖与服药情况");
            familyActions.add("若出现头晕/心慌等症状，优先复测并联系医生");
            if ("HIGH_PRIORITY".equals(priority) || "CLINIC_REVIEW".equals(priority)) {
                familyActions.add("建议尽快到门诊复核当前治疗方案");
            }
            familyVersion.set("actions", familyActions);

            ObjectNode doctorVersion = MAPPER.createObjectNode();
            doctorVersion.put("title", "AI 风险评估摘要");
            ArrayNode summary = MAPPER.createArrayNode();
            summary.add("reviewPriority=" + priority);
            summary.add("jointEvents=" + body.get("jointEvents").size());
            summary.add("scores: deintensification=" + risk.get("deintensificationScore").asInt()
                + ", interaction=" + risk.get("interactionScore").asInt()
                + ", behavior=" + risk.get("behaviorScore").asInt()
                + ", jointEvent=" + risk.get("jointEventScore").asInt());
            doctorVersion.set("summary", summary);

            ArrayNode evidence = MAPPER.createArrayNode();
            for (JsonNode reason : risk.get("reasons")) {
                if (reason.isTextual()) {
                    evidence.add(reason.asText());
                }
            }
            if (evidence.isEmpty()) {
                evidence.add("暂无明显证据，建议继续观察");
            }
            doctorVersion.set("evidence", evidence);

            ObjectNode response = MAPPER.createObjectNode();
            response.set("familyVersion", familyVersion);
            response.set("doctorVersion", doctorVersion);
            response.put("modelVersion", AI_MODEL_VERSION);
            return RouteResult.ok(response.toString());
        }

        private boolean isTextField(JsonNode body, String key) {
            return body != null && body.has(key) && body.get(key).isTextual() && !body.get(key).asText().isBlank();
        }

        private boolean isIntegerField(JsonNode body, String key) {
            return body != null && body.has(key) && body.get(key).isIntegralNumber();
        }

        private boolean isObjectField(JsonNode body, String key) {
            return body != null && body.has(key) && body.get(key).isObject();
        }

        private boolean isArrayField(JsonNode body, String key) {
            return body != null && body.has(key) && body.get(key).isArray();
        }

        private boolean isDateTime(String value) {
            try {
                OffsetDateTime.parse(value);
                return true;
            } catch (DateTimeParseException ex) {
                return false;
            }
        }

        private Integer extractPatientIdFromProfilePath(String path) {
            String prefix = "/api/patients/";
            String suffix = "/profile";
            if (path == null || !path.startsWith(prefix) || !path.endsWith(suffix)) {
                return null;
            }
            String rawId = path.substring(prefix.length(), path.length() - suffix.length());
            if (rawId.isBlank()) {
                return null;
            }
            try {
                return Integer.parseInt(rawId);
            } catch (NumberFormatException ex) {
                return null;
            }
        }

        private Integer extractPatientIdFromSuffixPath(String path, String suffix) {
            String prefix = "/api/patients/";
            if (path == null || !path.startsWith(prefix) || !path.endsWith(suffix)) {
                return null;
            }
            String rawId = path.substring(prefix.length(), path.length() - suffix.length());
            return parseInt(rawId);
        }

        private int extractPatientIdFromAnyPath(String path) {
            String prefix = "/api/patients/";
            if (path == null || !path.startsWith(prefix)) return -1;
            String raw = path.substring(prefix.length()).split("/", 2)[0];
            return parseInt(raw) == null ? -1 : parseInt(raw);
        }

        private PathPatientTask extractMedicationUploadTaskPath(String path) {
            if (path == null) {
                return null;
            }
            String[] parts = path.split("/");
            if (parts.length != 6 || !"api".equals(parts[1]) || !"patients".equals(parts[2]) || !"medication-uploads".equals(parts[4])) {
                return null;
            }

            Integer patientId = parseInt(parts[3]);
            if (patientId == null || isBlank(parts[5])) {
                return null;
            }
            return new PathPatientTask(patientId, parts[5]);
        }

        private PathPatientMedication extractMedicationPath(String path) {
            if (path == null) {
                return null;
            }
            String[] parts = path.split("/");
            if (parts.length != 6 || !"api".equals(parts[1]) || !"patients".equals(parts[2]) || !"medications".equals(parts[4])) {
                return null;
            }

            Integer patientId = parseInt(parts[3]);
            Integer medicationId = parseInt(parts[5]);
            if (patientId == null || medicationId == null) {
                return null;
            }

            return new PathPatientMedication(patientId, medicationId);
        }

        private PathPatientSession extractInquirySessionPath(String path) {
            if (path == null) {
                return null;
            }
            String[] parts = path.split("/");
            if (parts.length != 7 || !"api".equals(parts[1]) || !"patients".equals(parts[2]) || !"inquiry-sessions".equals(parts[4])) {
                return null;
            }

            Integer patientId = parseInt(parts[3]);
            String sessionId = parts[5];
            String action = parts[6];
            if (patientId == null || isBlank(sessionId) || isBlank(action)) {
                return null;
            }

            if (!"answer".equals(action) && !"next-question".equals(action)) {
                return null;
            }

            return new PathPatientSession(patientId, sessionId, action);
        }

        private PathPatientReport extractReportPath(String path) {
            if (path == null) {
                return null;
            }
            String[] parts = path.split("/");
            if (parts.length != 6 || !"api".equals(parts[1]) || !"patients".equals(parts[2]) || !"reports".equals(parts[4])) {
                return null;
            }

            Integer patientId = parseInt(parts[3]);
            String reportId = parts[5];
            if (patientId == null || isBlank(reportId)) {
                return null;
            }

            return new PathPatientReport(patientId, reportId);
        }

        private PathPatientReportDownload extractReportDownloadPath(String path) {
            if (path == null) {
                return null;
            }
            String[] parts = path.split("/");
            if (parts.length != 7 || !"api".equals(parts[1]) || !"patients".equals(parts[2]) || !"reports".equals(parts[4]) || !"download".equals(parts[6])) {
                return null;
            }

            Integer patientId = parseInt(parts[3]);
            String reportId = parts[5];
            if (patientId == null || isBlank(reportId)) {
                return null;
            }

            return new PathPatientReportDownload(patientId, reportId);
        }

        private Integer parseInt(String value) {
            if (isBlank(value)) {
                return null;
            }
            try {
                return Integer.parseInt(value);
            } catch (NumberFormatException ex) {
                return null;
            }
        }

        private String resolvePatientName(int patientId) {
            return DB.findPatientName(patientId).orElse("");
        }

        private boolean isBlank(String value) {
            return value == null || value.isBlank();
        }

        private String extractJsonString(String body, String key) {
            if (body == null || body.isBlank()) {
                return null;
            }
            String marker = "\"" + key + "\"";
            int keyIndex = body.indexOf(marker);
            if (keyIndex < 0) {
                return null;
            }

            int colonIndex = body.indexOf(':', keyIndex + marker.length());
            if (colonIndex < 0) {
                return null;
            }

            int valueStart = colonIndex + 1;
            while (valueStart < body.length() && Character.isWhitespace(body.charAt(valueStart))) {
                valueStart++;
            }
            if (valueStart >= body.length() || body.charAt(valueStart) != '"') {
                return null;
            }

            int valueEnd = valueStart + 1;
            while (valueEnd < body.length()) {
                char c = body.charAt(valueEnd);
                if (c == '"' && body.charAt(valueEnd - 1) != '\\') {
                    break;
                }
                valueEnd++;
            }

            if (valueEnd >= body.length()) {
                return null;
            }

            return body.substring(valueStart + 1, valueEnd).trim();
        }

        private String extractJsonNumber(String body, String key) {
            if (body == null || body.isBlank()) {
                return null;
            }
            String marker = "\"" + key + "\"";
            int keyIndex = body.indexOf(marker);
            if (keyIndex < 0) {
                return null;
            }

            int colonIndex = body.indexOf(':', keyIndex + marker.length());
            if (colonIndex < 0) {
                return null;
            }

            int start = colonIndex + 1;
            while (start < body.length() && Character.isWhitespace(body.charAt(start))) {
                start++;
            }
            if (start >= body.length() || !Character.isDigit(body.charAt(start))) {
                return null;
            }

            int end = start + 1;
            while (end < body.length() && Character.isDigit(body.charAt(end))) {
                end++;
            }

            return body.substring(start, end);
        }

        private String extractJsonNumeric(String body, String key) {
            if (body == null || body.isBlank()) {
                return null;
            }
            String marker = "\"" + key + "\"";
            int keyIndex = body.indexOf(marker);
            if (keyIndex < 0) {
                return null;
            }

            int colonIndex = body.indexOf(':', keyIndex + marker.length());
            if (colonIndex < 0) {
                return null;
            }

            int start = colonIndex + 1;
            while (start < body.length() && Character.isWhitespace(body.charAt(start))) {
                start++;
            }
            if (start >= body.length() || (!Character.isDigit(body.charAt(start)) && body.charAt(start) != '-')) {
                return null;
            }

            int end = start + 1;
            while (end < body.length()) {
                char c = body.charAt(end);
                if (!(Character.isDigit(c) || c == '.')) {
                    break;
                }
                end++;
            }

            return body.substring(start, end);
        }

        private Boolean extractJsonBoolean(String body, String key) {
            if (body == null || body.isBlank()) {
                return null;
            }
            String marker = "\"" + key + "\"";
            int keyIndex = body.indexOf(marker);
            if (keyIndex < 0) {
                return null;
            }

            int colonIndex = body.indexOf(':', keyIndex + marker.length());
            if (colonIndex < 0) {
                return null;
            }

            int start = colonIndex + 1;
            while (start < body.length() && Character.isWhitespace(body.charAt(start))) {
                start++;
            }

            if (start + 4 <= body.length() && "true".equals(body.substring(start, start + 4))) {
                return true;
            }
            if (start + 5 <= body.length() && "false".equals(body.substring(start, start + 5))) {
                return false;
            }
            return null;
        }

        private String extractNestedJsonString(String body, String objectKey, String key) {
            if (body == null || body.isBlank()) {
                return null;
            }
            String objectMarker = "\"" + objectKey + "\"";
            int objectIndex = body.indexOf(objectMarker);
            if (objectIndex < 0) {
                return null;
            }
            int objectStart = body.indexOf('{', objectIndex + objectMarker.length());
            int objectEnd = body.indexOf('}', objectStart + 1);
            if (objectStart < 0 || objectEnd < 0) {
                return null;
            }

            String nested = body.substring(objectStart, objectEnd + 1);
            return extractJsonString(nested, key);
        }

        private record RouteResult(int status, String body) {
            private static RouteResult ok(String body) {
                return new RouteResult(200, body);
            }

            private static RouteResult accepted(String body) {
                return new RouteResult(202, body);
            }

            private static RouteResult badRequest(String body) {
                return new RouteResult(400, body);
            }

            private static RouteResult unprocessableEntity(String body) {
                return new RouteResult(422, body);
            }

            private static RouteResult notFound(String body) {
                return new RouteResult(404, body);
            }

            private static RouteResult serviceUnavailable(String body) {
                return new RouteResult(503, body);
            }

            private static RouteResult unauthorized(String body) {
                return new RouteResult(401, body);
            }

            private static RouteResult forbidden(String body) {
                return new RouteResult(403, body);
            }
        }

        private record CurrentPatientContext(int userId, String role, int patientId, String patientName) {
            private String toJson() {
                return """
                    {
                      "userId": %d,
                      "role": "%s",
                      "patientId": %d,
                      "patientName": "%s"
                    }
                    """.formatted(userId, role, patientId, patientName.replace("\"", "\\\""));
            }
        }

        private record PathPatientTask(int patientId, String taskId) {
        }

        private record PathPatientMedication(int patientId, int medicationId) {
        }

        private static final List<InquiryQuestionTemplate> INQUIRY_QUESTIONS = List.of(
            new InquiryQuestionTemplate("MEAL_AMOUNT", "今天早餐有没有正常吃完？"),
            new InquiryQuestionTemplate("MED_TAKEN_TIME", "这次不适是在吃药前还是吃药后出现的？")
        );

        private record PathPatientSession(int patientId, String sessionId, String action) {
        }

        private record PathPatientReport(int patientId, String reportId) {
        }

        private record PathPatientReportDownload(int patientId, String reportId) {
        }

        private record InquiryQuestionTemplate(String questionCode, String questionText) {
        }


        private void write(HttpExchange exchange, int status, String body) throws IOException {
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, bytes.length);
            try (OutputStream outputStream = exchange.getResponseBody()) {
                outputStream.write(bytes);
            }
        }
    }
}
