package com.yaoheng.backend;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class DatabaseRepository {
    private static final ZoneId APP_ZONE = ZoneId.of("Asia/Shanghai");
    private static final DateTimeFormatter MYSQL_DATETIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private final DbConfig config;
    private final HikariDataSource dataSource;
    private volatile boolean connectionErrorLogged;
    private volatile boolean auxSchemaEnsured;
    private volatile String startupStatus;

    DatabaseRepository(DbConfig config) {
        this.config = config;
        this.dataSource = createDataSource(config);
        this.connectionErrorLogged = false;
        this.auxSchemaEnsured = false;
        this.startupStatus = "UNKNOWN";
        warmUpDataSource();
        validateStartup();
    }

    static DatabaseRepository fromEnv() {
        return new DatabaseRepository(DbConfig.fromEnv());
    }

    boolean isConfigured() {
        return dataSource != null;
    }

    boolean isReady() {
        return "READY".equals(startupStatus);
    }

    String startupStatus() {
        return startupStatus;
    }

    private HikariDataSource createDataSource(DbConfig dbConfig) {
        if (!dbConfig.enabled() || isBlank(dbConfig.jdbcUrl()) || isBlank(dbConfig.username()) || isBlank(dbConfig.password())) {
            return null;
        }

        try {
            HikariConfig hikariConfig = new HikariConfig();
            hikariConfig.setJdbcUrl(dbConfig.jdbcUrl());
            hikariConfig.setUsername(dbConfig.username());
            hikariConfig.setPassword(dbConfig.password());
            hikariConfig.setMaximumPoolSize(dbConfig.maxPoolSize());
            hikariConfig.setMinimumIdle(dbConfig.minIdle());
            hikariConfig.setConnectionTimeout(dbConfig.connectionTimeoutMs());
            hikariConfig.setIdleTimeout(dbConfig.idleTimeoutMs());
            hikariConfig.setMaxLifetime(dbConfig.maxLifetimeMs());
            hikariConfig.setPoolName("yaoheng-db-pool");
            hikariConfig.addDataSourceProperty("cachePrepStmts", "true");
            hikariConfig.addDataSourceProperty("prepStmtCacheSize", "250");
            hikariConfig.addDataSourceProperty("prepStmtCacheSqlLimit", "2048");
            hikariConfig.addDataSourceProperty("useServerPrepStmts", "true");
            return new HikariDataSource(hikariConfig);
        } catch (RuntimeException ex) {
            logConnectionError(ex);
            return null;
        }
    }

    private void warmUpDataSource() {
        if (dataSource == null) {
            return;
        }

        try (Connection connection = dataSource.getConnection()) {
            ensureAuxSchema(connection);
        } catch (SQLException ex) {
            logConnectionError(ex);
        }
    }

    private void validateStartup() {
        if (!config.enabled()) {
            startupStatus = "DISABLED: set DB_ENABLED=true and provide DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD";
            System.err.println("[DB] startup validation failed: " + startupStatus);
            return;
        }

        if (isBlank(config.jdbcUrl()) || isBlank(config.username()) || isBlank(config.password())) {
            startupStatus = "INVALID_CONFIG: missing jdbcUrl/username/password, please check DB_* env vars";
            System.err.println("[DB] startup validation failed: " + startupStatus);
            return;
        }

        if (dataSource == null) {
            startupStatus = "DATASOURCE_INIT_FAILED: unable to initialize DB datasource";
            System.err.println("[DB] startup validation failed: " + startupStatus);
            return;
        }

        try (Connection connection = dataSource.getConnection()) {
            ensureAuxSchema(connection);
            startupStatus = "READY";
            System.out.println("[DB] startup validation passed: READY");
        } catch (SQLException ex) {
            startupStatus = "CONNECTION_FAILED: " + ex.getMessage();
            logConnectionError(ex);
            System.err.println("[DB] startup validation failed: " + startupStatus);
        }
    }

    Optional<String> findPatientName(int patientId) {
        return withConnection(connection -> {
            try (PreparedStatement statement = connection.prepareStatement("select name from patient where id = ? limit 1")) {
                statement.setInt(1, patientId);
                try (ResultSet rs = statement.executeQuery()) {
                    if (!rs.next()) {
                        return null;
                    }
                    return rs.getString("name");
                }
            }
        });
    }

    boolean patientExists(int patientId) {
        Optional<Boolean> exists = withConnection(connection -> {
            try (PreparedStatement statement = connection.prepareStatement("select 1 from patient where id = ? limit 1")) {
                statement.setInt(1, patientId);
                try (ResultSet rs = statement.executeQuery()) {
                    return rs.next();
                }
            }
        });

        return exists.orElse(false);
    }

    Optional<AuthUser> authenticate(String mobile) {
        return withConnection(connection -> {
            try (PreparedStatement statement = connection.prepareStatement(
                "select id, role from user_account where mobile = ? and status = 'ACTIVE' limit 1"
            )) {
                statement.setString(1, mobile);
                try (ResultSet rs = statement.executeQuery()) {
                    if (!rs.next()) {
                        return null;
                    }

                    int userId = rs.getInt("id");
                    String role = rs.getString("role");
                    Integer patientId = resolvePatientIdForUser(connection, userId, role);
                    return new AuthUser(userId, role, patientId);
                }
            }
        });
    }

    Optional<String> createPatientJson(String name, String gender, String birthday, String livingStatus, String digitalAbilityLevel) {
        return withConnection(connection -> {
            long patientId;
            try (PreparedStatement statement = connection.prepareStatement(
                """
                insert into patient(name, gender, birthday, living_status, digital_ability_level)
                values (?, ?, ?, ?, ?)
                """,
                Statement.RETURN_GENERATED_KEYS
            )) {
                statement.setString(1, name);
                statement.setString(2, gender);
                statement.setString(3, birthday);
                statement.setString(4, livingStatus);
                statement.setString(5, digitalAbilityLevel);
                statement.executeUpdate();

                try (ResultSet keys = statement.getGeneratedKeys()) {
                    if (!keys.next()) {
                        return null;
                    }
                    patientId = keys.getLong(1);
                }
            }

            try (PreparedStatement statement = connection.prepareStatement(
                """
                select id, name, gender, birthday, living_status, digital_ability_level, created_at
                from patient
                where id = ?
                limit 1
                """
            )) {
                statement.setLong(1, patientId);
                try (ResultSet rs = statement.executeQuery()) {
                    if (!rs.next()) {
                        return null;
                    }

                    String createdAt = toIsoTimestamp(rs.getString("created_at"));
                    return profileJsonFromRs(rs, createdAt);
                }
            }
        });
    }

    boolean patchPatient(int patientId, String name, String livingStatus, String digitalAbilityLevel) {
        Optional<Boolean> patched = withConnection(connection -> {
            try (PreparedStatement statement = connection.prepareStatement(
                """
                update patient
                set name = coalesce(?, name),
                    living_status = coalesce(?, living_status),
                    digital_ability_level = coalesce(?, digital_ability_level),
                    updated_at = current_timestamp
                where id = ?
                """
            )) {
                statement.setString(1, name);
                statement.setString(2, livingStatus);
                statement.setString(3, digitalAbilityLevel);
                statement.setInt(4, patientId);
                return statement.executeUpdate() > 0;
            }
        });

        return patched.orElse(false);
    }

    Optional<String> getPatientProfileJson(int patientId) {
        return withConnection(connection -> {
            try (PreparedStatement statement = connection.prepareStatement(
                """
                select id, name, gender, birthday, living_status, digital_ability_level, created_at
                from patient
                where id = ?
                limit 1
                """
            )) {
                statement.setInt(1, patientId);
                try (ResultSet rs = statement.executeQuery()) {
                    if (!rs.next()) {
                        return null;
                    }

                    String createdAt = toIsoTimestamp(rs.getString("created_at"));
                    return profileJsonFromRs(rs, createdAt);
                }
            }
        });
    }

    Optional<String> createMedicationUploadTaskJson(int patientId, long fileAssetId, String taskKey) {
        return withConnection(connection -> {
            try (PreparedStatement statement = connection.prepareStatement(
                """
                insert into medication_upload_task(patient_id, image_file_id, task_key, ocr_status, parse_status, confirm_status, result_json)
                values (?, ?, ?, 'PENDING', 'PENDING', 'PENDING', '{"candidates": []}')
                """
            )) {
                statement.setInt(1, patientId);
                statement.setLong(2, fileAssetId);
                statement.setString(3, taskKey);
                statement.executeUpdate();
            }

            return """
                {
                  "taskId": "%s",
                  "status": "PENDING"
                }
                """.formatted(escape(taskKey));
        });
    }

    Optional<String> getMedicationUploadTaskJson(int patientId, String taskId) {
        return withConnection(connection -> {
            try (PreparedStatement statement = connection.prepareStatement(
                """
                select task_key, ocr_status, parse_status, confirm_status, result_json
                from medication_upload_task
                where patient_id = ? and task_key = ?
                limit 1
                """
            )) {
                statement.setInt(1, patientId);
                statement.setString(2, taskId);
                try (ResultSet rs = statement.executeQuery()) {
                    if (!rs.next()) {
                        return null;
                    }

                    String candidatesJson = extractCandidatesJson(rs.getString("result_json"));
                    String status = deriveUploadTaskStatus(
                        rs.getString("ocr_status"),
                        rs.getString("parse_status"),
                        rs.getString("confirm_status")
                    );

                    return """
                        {
                          "taskId": "%s",
                          "status": "%s",
                          "candidates": %s
                        }
                        """.formatted(escape(taskId), escape(status), candidatesJson);
                }
            }
        });
    }

    Optional<String> confirmMedicationsJson(int patientId, String taskId) {
        return withConnection(connection -> {
            try (PreparedStatement statement = connection.prepareStatement(
                """
                update medication_upload_task
                set confirm_status = 'SUCCESS', updated_at = current_timestamp
                where patient_id = ? and task_key = ?
                """
            )) {
                statement.setInt(1, patientId);
                statement.setString(2, taskId);
                if (statement.executeUpdate() <= 0) {
                    return null;
                }
            }
            return getMedicationsJsonUsingConnection(connection, patientId);
        });
    }

    boolean patchMedication(int patientId, int medicationId, String dose, String frequency, String administrationTime, String endDate, String status) {
        Optional<Boolean> patched = withConnection(connection -> {
            String sql = """
                update patient_medication
                set dose = coalesce(?, dose),
                    frequency = coalesce(?, frequency),
                    administration_time = coalesce(?, administration_time),
                    end_date = ?,
                    status = coalesce(?, status),
                    updated_at = current_timestamp
                where patient_id = ? and id = ?
                """;
            try (PreparedStatement statement = connection.prepareStatement(sql)) {
                statement.setString(1, dose);
                statement.setString(2, frequency);
                statement.setString(3, administrationTime);
                if (isBlank(endDate)) {
                    statement.setObject(4, null);
                } else {
                    statement.setString(4, endDate);
                }
                statement.setString(5, status);
                statement.setInt(6, patientId);
                statement.setInt(7, medicationId);
                return statement.executeUpdate() > 0;
            }
        });
        return patched.orElse(false);
    }

    Optional<String> createMedicationJson(int patientId, String genericName, String brandName, String dose,
                                           String frequency, String administrationTime, String startDate,
                                           String endDate, String status) {
        return withConnection(connection -> {
            long masterId;
            try (PreparedStatement find = connection.prepareStatement(
                "select id from medication_master where generic_name = ? limit 1")) {
                find.setString(1, genericName);
                try (ResultSet rs = find.executeQuery()) {
                    if (rs.next()) {
                        masterId = rs.getLong(1);
                    } else {
                        try (PreparedStatement insert = connection.prepareStatement(
                            "insert into medication_master(generic_name, brand_name, source_type) values (?, ?, 'MANUAL')",
                            Statement.RETURN_GENERATED_KEYS)) {
                            insert.setString(1, genericName);
                            insert.setString(2, brandName);
                            insert.executeUpdate();
                            try (ResultSet keys = insert.getGeneratedKeys()) {
                                if (!keys.next()) return null;
                                masterId = keys.getLong(1);
                            }
                        }
                    }
                }
            }
            long medicationId;
            try (PreparedStatement insert = connection.prepareStatement(
                "insert into patient_medication(patient_id, medication_master_id, dose, frequency, administration_time, start_date, end_date, status, confirmed_by_user) values (?, ?, ?, ?, ?, ?, ?, ?, true)",
                Statement.RETURN_GENERATED_KEYS)) {
                insert.setInt(1, patientId);
                insert.setLong(2, masterId);
                insert.setString(3, dose);
                insert.setString(4, frequency);
                insert.setString(5, administrationTime);
                insert.setString(6, startDate);
                insert.setString(7, isBlank(endDate) ? null : endDate);
                insert.setString(8, isBlank(status) ? "ACTIVE" : status);
                insert.executeUpdate();
                try (ResultSet keys = insert.getGeneratedKeys()) {
                    if (!keys.next()) return null;
                    medicationId = keys.getLong(1);
                }
            }
            return getMedicationJsonUsingConnection(connection, patientId, (int) medicationId);
        });
    }

    Optional<String> getMedicationJson(int patientId, int medicationId) {
        return withConnection(connection -> {
            return getMedicationJsonUsingConnection(connection, patientId, medicationId);
        });
    }

    private String getMedicationJsonUsingConnection(Connection connection, int patientId, int medicationId) throws SQLException {
            try (PreparedStatement statement = connection.prepareStatement(
                """
                select
                  pm.id,
                  pm.medication_master_id,
                  coalesce(mm.generic_name, '') as generic_name,
                  coalesce(mm.brand_name, '') as brand_name,
                  pm.dose,
                  pm.frequency,
                  pm.administration_time,
                  pm.start_date,
                  pm.end_date,
                  pm.status,
                  pm.confirmed_by_user
                from patient_medication pm
                left join medication_master mm on mm.id = pm.medication_master_id
                where pm.patient_id = ? and pm.id = ?
                limit 1
                """
            )) {
                statement.setInt(1, patientId);
                statement.setInt(2, medicationId);
                try (ResultSet rs = statement.executeQuery()) {
                    if (!rs.next()) {
                        return null;
                    }
                    return medicationJsonFromRs(rs);
                }
            }
    }

    Optional<String> getMedicationConflictsJson(int patientId) {
        return withConnection(connection -> {
            List<Long> duplicatedIds = new ArrayList<>();
            try (PreparedStatement statement = connection.prepareStatement(
                """
                select id
                from patient_medication
                where patient_id = ?
                  and medication_master_id in (
                    select medication_master_id
                    from patient_medication
                    where patient_id = ?
                    group by medication_master_id
                    having count(*) > 1
                  )
                order by id
                """
            )) {
                statement.setInt(1, patientId);
                statement.setInt(2, patientId);
                try (ResultSet rs = statement.executeQuery()) {
                    while (rs.next()) {
                        duplicatedIds.add(rs.getLong("id"));
                    }
                }
            }

            String duplicatedJson = duplicatedIds.stream()
                .map(String::valueOf)
                .reduce((a, b) -> a + ", " + b)
                .map(values -> "[" + values + "]")
                .orElse("[]");

            String conflictsJson = duplicatedIds.isEmpty()
                ? "[]"
                : "[{\"riskDirection\":\"INTERACTION\",\"message\":\"检测到重复用药\",\"medicationIds\":" + duplicatedJson + "}]";

            return "{\"duplicatedMedicationIds\": " + duplicatedJson + ", \"conflicts\": " + conflictsJson + "}";
        });
    }

    boolean createBpRecord(int patientId, String measuredAt, int systolic, int diastolic, int heartRate) {
        return insertSimpleRecord(
            "insert into bp_record(patient_id, measured_at, systolic, diastolic, heart_rate, source) values (?, ?, ?, ?, ?, 'APP')",
            statement -> {
                statement.setInt(1, patientId);
                statement.setString(2, measuredAt);
                statement.setInt(3, systolic);
                statement.setInt(4, diastolic);
                statement.setInt(5, heartRate);
            }
        );
    }

    boolean createBgRecord(int patientId, String measuredAt, double glucoseValue, String mealPhase) {
        return insertSimpleRecord(
            "insert into bg_record(patient_id, measured_at, glucose_value, meal_phase, source) values (?, ?, ?, ?, 'APP')",
            statement -> {
                statement.setInt(1, patientId);
                statement.setString(2, measuredAt);
                statement.setDouble(3, glucoseValue);
                statement.setString(4, mealPhase);
            }
        );
    }

    boolean createSymptomRecord(int patientId, String occurredAt, String symptomCode, int severity, String note) {
        return insertSimpleRecord(
            "insert into symptom_record(patient_id, occurred_at, symptom_code, severity, note) values (?, ?, ?, ?, ?)",
            statement -> {
                statement.setInt(1, patientId);
                statement.setString(2, occurredAt);
                statement.setString(3, symptomCode);
                statement.setInt(4, severity);
                statement.setString(5, note);
            }
        );
    }

    boolean createAdherenceEvent(int patientId, int medicationId, String eventTime, String eventType, String note) {
        return insertSimpleRecord(
            "insert into adherence_event(patient_id, medication_id, event_time, event_type, note) values (?, ?, ?, ?, ?)",
            statement -> {
                statement.setInt(1, patientId);
                statement.setInt(2, medicationId);
                statement.setString(3, eventTime);
                statement.setString(4, eventType);
                statement.setString(5, note);
            }
        );
    }

    boolean createMealRecord(int patientId, String occurredAt, String mealType, String intakeLevel) {
        return insertSimpleRecord(
            "insert into meal_record(patient_id, occurred_at, meal_type, intake_level) values (?, ?, ?, ?)",
            statement -> {
                statement.setInt(1, patientId);
                statement.setString(2, occurredAt);
                statement.setString(3, mealType);
                statement.setString(4, intakeLevel);
            }
        );
    }

    Optional<String> startInquirySession(int patientId, String sessionId, String triggerType, String triggerTime, List<InquiryQuestionSeed> questions) {
        return withConnection(connection -> {
            long dbSessionId;
            try (PreparedStatement statement = connection.prepareStatement(
                """
                insert into inquiry_session(patient_id, session_key, trigger_type, trigger_time, session_status, model_version)
                values (?, ?, ?, ?, 'IN_PROGRESS', 'parse_v1')
                """,
                Statement.RETURN_GENERATED_KEYS
            )) {
                statement.setInt(1, patientId);
                statement.setString(2, sessionId);
                statement.setString(3, triggerType);
                statement.setString(4, triggerTime);
                statement.executeUpdate();

                try (ResultSet keys = statement.getGeneratedKeys()) {
                    if (!keys.next()) {
                        return null;
                    }
                    dbSessionId = keys.getLong(1);
                }
            }

            int orderNo = 1;
            for (InquiryQuestionSeed question : questions) {
                try (PreparedStatement statement = connection.prepareStatement(
                    """
                    insert into inquiry_question(session_id, question_code, question_text, source_type, order_no)
                    values (?, ?, ?, 'RULE_TEMPLATE', ?)
                    """
                )) {
                    statement.setLong(1, dbSessionId);
                    statement.setString(2, question.questionCode());
                    statement.setString(3, question.questionText());
                    statement.setInt(4, orderNo++);
                    statement.executeUpdate();
                }
            }

            return """
                {
                  "sessionId": "%s",
                  "triggerType": "%s",
                  "triggerTime": "%s",
                  "sessionStatus": "IN_PROGRESS",
                  "modelVersion": "parse_v1"
                }
                """.formatted(escape(sessionId), escape(triggerType), escape(triggerTime));
        });
    }

    boolean answerInquiryQuestion(int patientId, String sessionId, String questionCode, String answerValue, String answerText) {
        Optional<Boolean> answered = withConnection(connection -> {
            Long dbSessionId = findSessionDbId(connection, patientId, sessionId);
            if (dbSessionId == null) {
                return false;
            }

            try (PreparedStatement statement = connection.prepareStatement(
                """
                insert into inquiry_answer(session_id, question_code, answer_value, answer_text, normalized_value)
                values (?, ?, ?, ?, ?)
                """
            )) {
                statement.setLong(1, dbSessionId);
                statement.setString(2, questionCode);
                statement.setString(3, answerValue);
                statement.setString(4, answerText);
                statement.setString(5, answerValue);
                statement.executeUpdate();
            }

            int totalQuestions = countBySession(connection, "inquiry_question", dbSessionId);
            int answeredQuestions = countBySession(connection, "inquiry_answer", dbSessionId);
            if (answeredQuestions >= totalQuestions && totalQuestions > 0) {
                try (PreparedStatement statement = connection.prepareStatement(
                    "update inquiry_session set session_status = 'COMPLETED', updated_at = current_timestamp where id = ?"
                )) {
                    statement.setLong(1, dbSessionId);
                    statement.executeUpdate();
                }
            }

            return true;
        });

        return answered.orElse(false);
    }

    Optional<String> getNextInquiryQuestionJson(int patientId, String sessionId) {
        return withConnection(connection -> {
            Long dbSessionId = findSessionDbId(connection, patientId, sessionId);
            if (dbSessionId == null) {
                return null;
            }

            int answered = countBySession(connection, "inquiry_answer", dbSessionId);
            try (PreparedStatement statement = connection.prepareStatement(
                """
                select question_code, question_text, order_no
                from inquiry_question
                where session_id = ?
                order by order_no asc
                limit 1 offset ?
                """
            )) {
                statement.setLong(1, dbSessionId);
                statement.setInt(2, answered);
                try (ResultSet rs = statement.executeQuery()) {
                    if (!rs.next()) {
                        return """
                            {
                              "sessionId": "%s",
                              "questionCode": "",
                              "questionText": "",
                              "sourceType": "RULE_TEMPLATE",
                              "orderNo": %d,
                              "isFinished": true
                            }
                            """.formatted(escape(sessionId), answered + 1);
                    }

                    return """
                        {
                          "sessionId": "%s",
                          "questionCode": "%s",
                          "questionText": "%s",
                          "sourceType": "RULE_TEMPLATE",
                          "orderNo": %d,
                          "isFinished": false
                        }
                        """.formatted(
                        escape(sessionId),
                        escape(rs.getString("question_code")),
                        escape(rs.getString("question_text")),
                        rs.getInt("order_no")
                    );
                }
            }
        });
    }

    Optional<String> createReportTaskJson(int patientId, String reportType) {
        return withConnection(connection -> {
            long reportId;
            try (PreparedStatement statement = connection.prepareStatement(
                "insert into report_task(patient_id, report_type, status) values (?, ?, 'PENDING')",
                Statement.RETURN_GENERATED_KEYS
            )) {
                statement.setInt(1, patientId);
                statement.setString(2, reportType);
                statement.executeUpdate();

                try (ResultSet keys = statement.getGeneratedKeys()) {
                    if (!keys.next()) {
                        return null;
                    }
                    reportId = keys.getLong(1);
                }
            }

            String taskId = "report_demo_%03d".formatted(reportId);

            return """
                {
                  "taskId": "%s",
                  "status": "PENDING"
                }
                """.formatted(escape(taskId));
        });
    }

    Optional<String> getReportTaskJson(int patientId, String reportId) {
        return withConnection(connection -> {
            long reportNumericId = parseReportId(reportId);
            if (reportNumericId <= 0) {
                return null;
            }

            try (PreparedStatement statement = connection.prepareStatement(
                """
                select id, report_type, status, generated_at, file_asset_id
                from report_task
                where id = ? and patient_id = ?
                limit 1
                """
            )) {
                statement.setLong(1, reportNumericId);
                statement.setInt(2, patientId);
                try (ResultSet rs = statement.executeQuery()) {
                    if (!rs.next()) {
                        return null;
                    }

                    String status = rs.getString("status");
                    String generatedAt = rs.getString("generated_at");
                    Long fileAssetId = rs.getLong("file_asset_id");
                    if (rs.wasNull()) {
                        fileAssetId = null;
                    }

                    if ("PENDING".equalsIgnoreCase(status)) {
                        status = "SUCCESS";
                        generatedAt = toIsoTimestamp(java.time.Instant.now().toString());
                        if (fileAssetId == null) {
                            fileAssetId = 2L;
                        }
                        try (PreparedStatement update = connection.prepareStatement(
                            "update report_task set status='SUCCESS', generated_at=current_timestamp, file_asset_id=? where id = ?"
                        )) {
                            update.setLong(1, fileAssetId);
                            update.setLong(2, reportNumericId);
                            update.executeUpdate();
                        }
                    }

                    String generatedAtJson = isBlank(generatedAt) ? "" : toIsoTimestamp(generatedAt);
                    String fileAssetIdJson = fileAssetId == null ? "null" : String.valueOf(fileAssetId);

                    return """
                        {
                          "reportId": "%s",
                          "reportType": "%s",
                          "status": "%s",
                          "generatedAt": "%s",
                          "fileAssetId": %s
                        }
                        """.formatted(
                        escape(reportId),
                        escape(rs.getString("report_type")),
                        escape(status),
                        escape(generatedAtJson),
                        fileAssetIdJson
                    );
                }
            }
        });
    }

    Optional<String> getReportDownloadJson(int patientId, String reportId) {
        return withConnection(connection -> {
            long reportNumericId = parseReportId(reportId);
            if (reportNumericId <= 0) {
                return null;
            }

            try (PreparedStatement statement = connection.prepareStatement(
                "select status from report_task where id = ? and patient_id = ? limit 1"
            )) {
                statement.setLong(1, reportNumericId);
                statement.setInt(2, patientId);
                try (ResultSet rs = statement.executeQuery()) {
                    if (!rs.next()) {
                        return null;
                    }
                    if (!"SUCCESS".equalsIgnoreCase(rs.getString("status"))) {
                        return null;
                    }
                }
            }

            String downloadUrl = "http://localhost:3000/api/patients/%d/reports/%s/download".formatted(patientId, reportId);
            String expiresAt = java.time.Instant.now().plusSeconds(7L * 24 * 60 * 60).toString();
            return """
                {
                  "reportId": "%s",
                  "downloadUrl": "%s",
                  "expiresAt": "%s"
                }
                """.formatted(escape(reportId), escape(downloadUrl), escape(expiresAt));
        });
    }

    Optional<String> getRemindersTodayJson(int patientId) {
        return withConnection(connection -> {
            Map<String, ReminderSeed> generatedSeeds = ensureTodayMedicationReminders(connection, patientId);
            LocalDate today = LocalDate.now(APP_ZONE);
            String dayStart = formatMysqlDateTime(today.atStartOfDay());
            String nextDayStart = formatMysqlDateTime(today.plusDays(1).atStartOfDay());
            List<String> reminders = new ArrayList<>();
            try (PreparedStatement statement = connection.prepareStatement(
                """
                select reminder_key, reminder_type, planned_at, title, status
                from reminder_item
                where patient_id = ?
                  and planned_at >= ?
                  and planned_at < ?
                order by planned_at asc
                """
            )) {
                statement.setInt(1, patientId);
                statement.setString(2, dayStart);
                statement.setString(3, nextDayStart);
                try (ResultSet rs = statement.executeQuery()) {
                    while (rs.next()) {
                        String reminderKey = rs.getString("reminder_key");
                        ReminderSeed generatedSeed = generatedSeeds.get(reminderKey);
                        String medicationIdsJson = generatedSeed == null ? "[]" : generatedSeed.medicationIdsJson();
                        String medicationNamesJson = generatedSeed == null ? "[]" : generatedSeed.medicationNamesJson();
                        String voicePrompt = generatedSeed == null
                            ? "现在请留意：" + rs.getString("title")
                            : generatedSeed.voicePrompt();
                        String followUpPrompt = generatedSeed == null
                            ? "您现在身体是否有什么不舒服？"
                            : generatedSeed.followUpPrompt();
                        reminders.add(
                            """
                            {
                              "reminderId": "%s",
                              "reminderType": "%s",
                              "plannedAt": "%s",
                              "title": "%s",
                              "status": "%s",
                              "medicationIds": %s,
                              "medicationNames": %s,
                              "voicePrompt": "%s",
                              "followUpPrompt": "%s"
                            }
                            """.formatted(
                            escape(reminderKey),
                            escape(rs.getString("reminder_type")),
                            escape(toIsoTimestamp(rs.getString("planned_at"))),
                            escape(rs.getString("title")),
                            escape(rs.getString("status")),
                            medicationIdsJson,
                            medicationNamesJson,
                            escape(voicePrompt),
                            escape(followUpPrompt)
                        ));
                    }
                }
            }

            return "{\"reminders\": " + joinJsonArray(reminders) + "}";
        });
    }

    private Map<String, ReminderSeed> ensureTodayMedicationReminders(Connection connection, int patientId) throws SQLException {
        LocalDate today = LocalDate.now(APP_ZONE);
        Map<String, List<ScheduledMedication>> medicationsByReminderKey = new LinkedHashMap<>();

        try (PreparedStatement statement = connection.prepareStatement(
            """
            select
              pm.id,
              coalesce(mm.generic_name, '') as generic_name,
              pm.frequency,
              pm.administration_time
            from patient_medication pm
            left join medication_master mm on mm.id = pm.medication_master_id
            where pm.patient_id = ?
              and pm.status = 'ACTIVE'
              and pm.start_date <= ?
              and (pm.end_date is null or pm.end_date >= ?)
            order by pm.id asc
            """
        )) {
            statement.setInt(1, patientId);
            statement.setString(2, today.toString());
            statement.setString(3, today.toString());
            try (ResultSet rs = statement.executeQuery()) {
                while (rs.next()) {
                    ScheduledMedication medication = new ScheduledMedication(
                        rs.getLong("id"),
                        rs.getString("generic_name"),
                        rs.getString("frequency"),
                        rs.getString("administration_time")
                    );
                    for (LocalDateTime slot : resolveReminderSlots(today, medication.administrationTime(), medication.frequency())) {
                        String reminderKey = buildReminderKey(today, slot);
                        medicationsByReminderKey.computeIfAbsent(reminderKey, ignored -> new ArrayList<>()).add(medication);
                    }
                }
            }
        }

        Map<String, ReminderSeed> seeds = new LinkedHashMap<>();
        for (Map.Entry<String, List<ScheduledMedication>> entry : medicationsByReminderKey.entrySet()) {
            List<ScheduledMedication> slotMedications = entry.getValue();
            if (slotMedications.isEmpty()) {
                continue;
            }

            LocalDateTime plannedAt = resolveSlotDateTime(today, entry.getKey());
            List<Long> medicationIds = slotMedications.stream().map(ScheduledMedication::id).toList();
            List<String> medicationNames = slotMedications.stream().map(ScheduledMedication::genericName).toList();
            String title = "请按时服药：" + String.join("、", medicationNames);
            ReminderSeed seed = new ReminderSeed(
                entry.getKey(),
                "MEDICATION",
                plannedAt,
                title,
                medicationIds,
                medicationNames,
                "现在请吃" + String.join("、", medicationNames) + "。",
                "您现在身体是否有什么不舒服？"
            );

            try (PreparedStatement statement = connection.prepareStatement(
                """
                insert into reminder_item(patient_id, reminder_key, reminder_type, planned_at, title, status)
                values (?, ?, ?, ?, ?, 'PENDING')
                on duplicate key update
                  reminder_type = values(reminder_type),
                  title = values(title)
                """
            )) {
                statement.setInt(1, patientId);
                statement.setString(2, seed.reminderKey());
                statement.setString(3, seed.reminderType());
                statement.setString(4, formatMysqlDateTime(seed.plannedAt()));
                statement.setString(5, seed.title());
                statement.executeUpdate();
            }

            seeds.put(seed.reminderKey(), seed);
        }

        return seeds;
    }

    private List<LocalDateTime> resolveReminderSlots(LocalDate date, String administrationTime, String frequency) {
        List<LocalDateTime> slots = new ArrayList<>();
        String normalizedAdministration = administrationTime == null ? "" : administrationTime.toUpperCase();
        String normalizedFrequency = frequency == null ? "" : frequency.toUpperCase();

        if (normalizedAdministration.contains("BREAKFAST")) {
            slots.add(date.atTime(normalizedAdministration.startsWith("BEFORE") ? LocalTime.of(7, 30) : LocalTime.of(8, 30)));
        }
        if (normalizedAdministration.contains("LUNCH")) {
            slots.add(date.atTime(normalizedAdministration.startsWith("BEFORE") ? LocalTime.of(11, 30) : LocalTime.of(12, 30)));
        }
        if (normalizedAdministration.contains("DINNER")) {
            slots.add(date.atTime(normalizedAdministration.startsWith("BEFORE") ? LocalTime.of(17, 30) : LocalTime.of(18, 30)));
        }
        if (slots.isEmpty()) {
            if ("TID".equals(normalizedFrequency) || normalizedAdministration.contains("BEFORE_MEAL")) {
                slots.add(date.atTime(7, 30));
                slots.add(date.atTime(11, 30));
                slots.add(date.atTime(17, 30));
            } else if ("BID".equals(normalizedFrequency)) {
                slots.add(date.atTime(8, 30));
                slots.add(date.atTime(18, 30));
            } else {
                slots.add(date.atTime(8, 30));
            }
        }

        return slots;
    }

    private String buildReminderKey(LocalDate date, LocalDateTime slot) {
        return "med_%s_%s".formatted(date, slot.toLocalTime().toString().replace(":", ""));
    }

    private LocalDateTime resolveSlotDateTime(LocalDate date, String reminderKey) {
        int lastUnderscore = reminderKey.lastIndexOf('_');
        if (lastUnderscore < 0 || lastUnderscore == reminderKey.length() - 1) {
            return date.atTime(8, 30);
        }

        String raw = reminderKey.substring(lastUnderscore + 1);
        if (raw.length() < 4) {
            return date.atTime(8, 30);
        }

        int hour = Integer.parseInt(raw.substring(0, 2));
        int minute = Integer.parseInt(raw.substring(2, 4));
        return date.atTime(hour, minute);
    }

    private String formatMysqlDateTime(LocalDateTime value) {
        return value.format(MYSQL_DATETIME);
    }

    boolean ackReminder(int patientId, String reminderId) {
        Optional<Boolean> updated = withConnection(connection -> {
            try (PreparedStatement statement = connection.prepareStatement(
                "update reminder_item set status='DONE' where patient_id = ? and reminder_key = ?"
            )) {
                statement.setInt(1, patientId);
                statement.setString(2, reminderId);
                return statement.executeUpdate() > 0;
            }
        });
        return updated.orElse(false);
    }

    Optional<String> patchReminderSettingsJson(int patientId, Boolean medicationEnabled, Boolean bpEnabled, Boolean bgEnabled, String quietStart, String quietEnd) {
        return withConnection(connection -> {
            ensureReminderSettingsRow(connection, patientId);

            try (PreparedStatement statement = connection.prepareStatement(
                """
                update reminder_settings
                set medication_reminder_enabled = coalesce(?, medication_reminder_enabled),
                    bp_reminder_enabled = coalesce(?, bp_reminder_enabled),
                    bg_reminder_enabled = coalesce(?, bg_reminder_enabled),
                    quiet_start = coalesce(?, quiet_start),
                    quiet_end = coalesce(?, quiet_end),
                    updated_at = current_timestamp
                where patient_id = ?
                """
            )) {
                if (medicationEnabled == null) {
                    statement.setObject(1, null);
                } else {
                    statement.setBoolean(1, medicationEnabled);
                }

                if (bpEnabled == null) {
                    statement.setObject(2, null);
                } else {
                    statement.setBoolean(2, bpEnabled);
                }

                if (bgEnabled == null) {
                    statement.setObject(3, null);
                } else {
                    statement.setBoolean(3, bgEnabled);
                }

                statement.setString(4, isBlank(quietStart) ? null : quietStart);
                statement.setString(5, isBlank(quietEnd) ? null : quietEnd);
                statement.setInt(6, patientId);
                statement.executeUpdate();
            }

            return "{\"success\": true}";
        });
    }

    Optional<String> getMedicationsJson(int patientId) {
        return withConnection(connection -> {
            try (PreparedStatement statement = connection.prepareStatement(
                """
                select
                  pm.id,
                  pm.medication_master_id,
                  coalesce(mm.generic_name, '') as generic_name,
                  coalesce(mm.brand_name, '') as brand_name,
                  pm.dose,
                  pm.frequency,
                  pm.administration_time,
                  pm.start_date,
                  pm.end_date,
                  pm.status,
                  pm.confirmed_by_user
                from patient_medication pm
                left join medication_master mm on mm.id = pm.medication_master_id
                where pm.patient_id = ?
                order by pm.id asc
                """
            )) {
                statement.setInt(1, patientId);
                try (ResultSet rs = statement.executeQuery()) {
                    List<String> items = new ArrayList<>();
                    while (rs.next()) {
                        String endDate = rs.getString("end_date");
                        String endDateJson = isBlank(endDate) ? "null" : "\"" + escape(endDate) + "\"";
                        String confirmedByUser = rs.getBoolean("confirmed_by_user") ? "true" : "false";

                        items.add(
                            """
                            {
                              "id": %d,
                              "medicationMasterId": %d,
                              "genericName": "%s",
                              "brandName": "%s",
                              "dose": "%s",
                              "frequency": "%s",
                              "administrationTime": "%s",
                              "startDate": "%s",
                              "endDate": %s,
                              "status": "%s",
                              "confirmedByUser": %s
                            }
                            """.formatted(
                                rs.getLong("id"),
                                rs.getLong("medication_master_id"),
                                escape(rs.getString("generic_name")),
                                escape(rs.getString("brand_name")),
                                escape(rs.getString("dose")),
                                escape(rs.getString("frequency")),
                                escape(rs.getString("administration_time")),
                                escape(rs.getString("start_date")),
                                endDateJson,
                                escape(rs.getString("status")),
                                confirmedByUser
                            )
                        );
                    }

                    return "{\"medications\": " + joinJsonArray(items) + "}";
                }
            }
        });
    }

    Optional<String> getRiskLatestJson(int patientId) {
        return withConnection(connection -> {
            try (PreparedStatement statement = connection.prepareStatement(
                """
                select
                  deintensification_score,
                  interaction_score,
                  temporal_behavior_score,
                  joint_event_score,
                  followup_priority,
                  model_version,
                  explanation_json
                from risk_score_snapshot
                where patient_id = ?
                order by score_date desc, created_at desc
                limit 1
                """
            )) {
                statement.setInt(1, patientId);
                try (ResultSet rs = statement.executeQuery()) {
                    if (!rs.next()) {
                        return null;
                    }

                    String explanationJson = rs.getString("explanation_json");
                    List<String> reasons = extractReasons(explanationJson);
                    String reasonsJson = reasons.stream()
                        .map(reason -> "\"" + escape(reason) + "\"")
                        .reduce((a, b) -> a + ", " + b)
                        .map(values -> "[" + values + "]")
                        .orElse("[]");

                    return """
                        {
                          "deintensificationScore": %d,
                          "interactionScore": %d,
                          "behaviorScore": %d,
                          "jointEventScore": %d,
                          "reviewPriority": "%s",
                          "reasons": %s,
                          "modelVersion": "%s"
                        }
                        """.formatted(
                        rs.getInt("deintensification_score"),
                        rs.getInt("interaction_score"),
                        rs.getInt("temporal_behavior_score"),
                        rs.getInt("joint_event_score"),
                        escape(rs.getString("followup_priority")),
                        reasonsJson,
                        escape(rs.getString("model_version"))
                    );
                }
            }
        });
    }

    Optional<String> getJointEventsJson(int patientId) {
        return withConnection(connection -> {
            try (PreparedStatement statement = connection.prepareStatement(
                """
                select
                  event_type,
                  event_label,
                  event_date,
                  time_window_start,
                  time_window_end,
                  severity,
                  evidence_json
                from joint_event
                where patient_id = ?
                order by event_date desc, id desc
                limit 50
                """
            )) {
                statement.setInt(1, patientId);
                try (ResultSet rs = statement.executeQuery()) {
                    List<String> items = new ArrayList<>();
                    while (rs.next()) {
                        String evidenceJson = rs.getString("evidence_json");
                        if (isBlank(evidenceJson)) {
                            evidenceJson = "{}";
                        }

                        items.add(
                            """
                            {
                              "eventType": "%s",
                              "eventLabel": "%s",
                              "eventDate": "%s",
                              "timeWindowStart": "%s",
                              "timeWindowEnd": "%s",
                              "severity": %d,
                              "evidence": %s,
                              "riskDirections": ["JOINT_EVENT"]
                            }
                            """.formatted(
                                escape(rs.getString("event_type")),
                                escape(rs.getString("event_label")),
                                escape(rs.getString("event_date")),
                                escape(toIsoTimestamp(rs.getString("time_window_start"))),
                                escape(toIsoTimestamp(rs.getString("time_window_end"))),
                                rs.getInt("severity"),
                                evidenceJson
                            )
                        );
                    }

                    return "{\"jointEvents\": " + joinJsonArray(items) + "}";
                }
            }
        });
    }

    private String getMedicationsJsonUsingConnection(Connection connection, int patientId) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
            """
            select
              pm.id,
              pm.medication_master_id,
              coalesce(mm.generic_name, '') as generic_name,
              coalesce(mm.brand_name, '') as brand_name,
              pm.dose,
              pm.frequency,
              pm.administration_time,
              pm.start_date,
              pm.end_date,
              pm.status,
              pm.confirmed_by_user
            from patient_medication pm
            left join medication_master mm on mm.id = pm.medication_master_id
            where pm.patient_id = ?
            order by pm.id asc
            """
        )) {
            statement.setInt(1, patientId);
            try (ResultSet rs = statement.executeQuery()) {
                List<String> items = new ArrayList<>();
                while (rs.next()) {
                    items.add(medicationJsonFromRs(rs));
                }
                return "{\"medications\": " + joinJsonArray(items) + "}";
            }
        }
    }

    private String profileJsonFromRs(ResultSet rs, String createdAt) throws SQLException {
        return """
            {
              "id": %d,
              "name": "%s",
              "gender": "%s",
              "birthday": "%s",
              "livingStatus": "%s",
              "digitalAbilityLevel": "%s",
              "diseaseTags": [],
              "createdAt": "%s"
            }
            """.formatted(
            rs.getLong("id"),
            escape(rs.getString("name")),
            escape(rs.getString("gender")),
            escape(rs.getString("birthday")),
            escape(rs.getString("living_status")),
            escape(rs.getString("digital_ability_level")),
            escape(createdAt)
        );
    }

    private String medicationJsonFromRs(ResultSet rs) throws SQLException {
        String endDate = rs.getString("end_date");
        String endDateJson = isBlank(endDate) ? "null" : "\"" + escape(endDate) + "\"";
        String confirmedByUser = rs.getBoolean("confirmed_by_user") ? "true" : "false";
        return """
            {
              "id": %d,
              "medicationMasterId": %d,
              "genericName": "%s",
              "brandName": "%s",
              "dose": "%s",
              "frequency": "%s",
              "administrationTime": "%s",
              "startDate": "%s",
              "endDate": %s,
              "status": "%s",
              "confirmedByUser": %s
            }
            """.formatted(
            rs.getLong("id"),
            rs.getLong("medication_master_id"),
            escape(rs.getString("generic_name")),
            escape(rs.getString("brand_name")),
            escape(rs.getString("dose")),
            escape(rs.getString("frequency")),
            escape(rs.getString("administration_time")),
            escape(rs.getString("start_date")),
            endDateJson,
            escape(rs.getString("status")),
            confirmedByUser
        );
    }

    private String deriveUploadTaskStatus(String ocrStatus, String parseStatus, String confirmStatus) {
        if ("SUCCESS".equalsIgnoreCase(confirmStatus)) {
            return "SUCCESS";
        }
        if ("FAILED".equalsIgnoreCase(ocrStatus) || "FAILED".equalsIgnoreCase(parseStatus)) {
            return "FAILED";
        }
        return "PENDING";
    }

    private String extractCandidatesJson(String resultJson) {
        if (isBlank(resultJson)) {
            return "[]";
        }

        Pattern candidatesPattern = Pattern.compile("\\\"candidates\\\"\\s*:\\s*(\\[.*])", Pattern.DOTALL);
        Matcher matcher = candidatesPattern.matcher(resultJson);
        if (!matcher.find()) {
            return "[]";
        }
        return matcher.group(1).trim();
    }

    private Integer resolvePatientIdForUser(Connection connection, int userId, String role) throws SQLException {
        if ("DOCTOR".equalsIgnoreCase(role)) {
            try (PreparedStatement statement = connection.prepareStatement("select id from patient order by id asc limit 1")) {
                try (ResultSet rs = statement.executeQuery()) {
                    if (!rs.next()) {
                        return null;
                    }
                    return rs.getInt("id");
                }
            }
        }

        try (PreparedStatement statement = connection.prepareStatement(
            """
            select patient_id
            from patient_caregiver_relation
            where user_id = ?
            order by is_primary desc, id asc
            limit 1
            """
        )) {
            statement.setInt(1, userId);
            try (ResultSet rs = statement.executeQuery()) {
                if (!rs.next()) {
                    return null;
                }
                return rs.getInt("patient_id");
            }
        }
    }

    private boolean insertSimpleRecord(String sql, StatementSetter setter) {
        Optional<Boolean> inserted = withConnection(connection -> {
            try (PreparedStatement statement = connection.prepareStatement(sql)) {
                setter.set(statement);
                return statement.executeUpdate() > 0;
            }
        });

        return inserted.orElse(false);
    }

    private Long findSessionDbId(Connection connection, int patientId, String sessionId) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
            "select id from inquiry_session where patient_id = ? and session_key = ? limit 1"
        )) {
            statement.setInt(1, patientId);
            statement.setString(2, sessionId);
            try (ResultSet rs = statement.executeQuery()) {
                if (!rs.next()) {
                    return null;
                }
                return rs.getLong("id");
            }
        }
    }

    private int countBySession(Connection connection, String tableName, long sessionId) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
            "select count(1) as c from " + tableName + " where session_id = ?"
        )) {
            statement.setLong(1, sessionId);
            try (ResultSet rs = statement.executeQuery()) {
                rs.next();
                return rs.getInt("c");
            }
        }
    }

    private long parseReportId(String reportId) {
        if (isBlank(reportId)) {
            return -1L;
        }

        String digits = reportId.replaceAll("\\D", "");
        if (isBlank(digits)) {
            return -1L;
        }
        try {
            return Long.parseLong(digits);
        } catch (NumberFormatException ex) {
            return -1L;
        }
    }

    private void ensureReminderSettingsRow(Connection connection, int patientId) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
            """
            insert into reminder_settings(patient_id, medication_reminder_enabled, bp_reminder_enabled, bg_reminder_enabled, quiet_start, quiet_end)
            values (?, true, true, true, '22:00', '07:00')
            on duplicate key update patient_id = patient_id
            """
        )) {
            statement.setInt(1, patientId);
            statement.executeUpdate();
        }
    }

    private void ensureAuxSchema(Connection connection) throws SQLException {
        try (Statement statement = connection.createStatement();
             ResultSet rs = statement.executeQuery("select version from schema_migration where version = 'V009'")) {
            if (!rs.next()) throw new SQLException("SCHEMA_VERSION_REQUIRED: run database migration V009");
        }
    }

    Connection openConnection() throws SQLException {
        if (!isReady()) throw new SQLException("Database is not ready");
        return dataSource.getConnection();
    }

    private <T> Optional<T> withConnection(SqlWork<T> work) {
        if (dataSource == null) {
            return Optional.empty();
        }

        try (Connection connection = dataSource.getConnection()) {
            ensureAuxSchema(connection);
            return Optional.ofNullable(work.run(connection));
        } catch (SQLException ex) {
            logConnectionError(ex);
            return Optional.empty();
        }
    }

    private void logConnectionError(Exception ex) {
        if (connectionErrorLogged) {
            return;
        }
        connectionErrorLogged = true;
        System.err.println("[DB] connection failed: " + ex.getMessage());
    }

    private static String joinJsonArray(List<String> items) {
        if (items == null || items.isEmpty()) {
            return "[]";
        }

        return items.stream()
            .reduce((a, b) -> a + "," + b)
            .map(values -> "[" + values + "]")
            .orElse("[]");
    }

    private static List<String> extractReasons(String explanationJson) {
        if (isBlank(explanationJson)) {
            return List.of();
        }

        Pattern reasonsPattern = Pattern.compile("\\\"reasons\\\"\\s*:\\s*\\[(.*?)]", Pattern.DOTALL);
        Matcher matcher = reasonsPattern.matcher(explanationJson);
        if (!matcher.find()) {
            return List.of();
        }

        String rawList = matcher.group(1);
        Pattern itemPattern = Pattern.compile("\\\"((?:\\\\.|[^\\\\\"])*)\\\"");
        Matcher itemMatcher = itemPattern.matcher(rawList);
        List<String> reasons = new ArrayList<>();
        while (itemMatcher.find()) {
            reasons.add(itemMatcher.group(1).replace("\\\"", "\"").replace("\\\\", "\\"));
        }
        return reasons;
    }

    private static String toIsoTimestamp(String raw) {
        if (isBlank(raw)) {
            return "";
        }
        String normalized = raw.trim().replace(' ', 'T');
        if (normalized.endsWith("Z") || normalized.matches(".*[+-]\\d\\d:\\d\\d$")) {
            return normalized;
        }
        return normalized + "Z";
    }

    private static String escape(String value) {
        if (value == null) {
            return "";
        }
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    @FunctionalInterface
    private interface SqlWork<T> {
        T run(Connection connection) throws SQLException;
    }

    @FunctionalInterface
    private interface StatementSetter {
        void set(PreparedStatement statement) throws SQLException;
    }

    record AuthUser(int userId, String role, Integer patientId) {
    }

    record InquiryQuestionSeed(String questionCode, String questionText) {
    }

    private record ScheduledMedication(long id, String genericName, String frequency, String administrationTime) {
    }

    private record ReminderSeed(
        String reminderKey,
        String reminderType,
        LocalDateTime plannedAt,
        String title,
        List<Long> medicationIds,
        List<String> medicationNames,
        String voicePrompt,
        String followUpPrompt
    ) {
        String medicationIdsJson() {
            return medicationIds.stream()
                .map(String::valueOf)
                .reduce((a, b) -> a + ", " + b)
                .map(values -> "[" + values + "]")
                .orElse("[]");
        }

        String medicationNamesJson() {
            return medicationNames.stream()
                .map(name -> "\"" + escape(name) + "\"")
                .reduce((a, b) -> a + ", " + b)
                .map(values -> "[" + values + "]")
                .orElse("[]");
        }
    }

    record DbConfig(
        boolean enabled,
        String jdbcUrl,
        String username,
        String password,
        int maxPoolSize,
        int minIdle,
        long connectionTimeoutMs,
        long idleTimeoutMs,
        long maxLifetimeMs
    ) {
        static DbConfig fromEnv() {
            String enabledRaw = readEnv("DB_ENABLED", "false");
            boolean enabled = "true".equalsIgnoreCase(enabledRaw);

            String host = readEnv("DB_HOST", "127.0.0.1");
            String port = readEnv("DB_PORT", "3306");
            String database = readEnv("DB_NAME", "yaoheng_zhihu");
            String username = readEnv("DB_USER", readEnv("SPRING_DATASOURCE_USERNAME", "root"));
            String password = readEnv("DB_PASSWORD", readEnv("SPRING_DATASOURCE_PASSWORD", ""));
            String ssl = readEnv("DB_SSL", "false");
            int maxPoolSize = readEnvInt("DB_MAX_POOL_SIZE", 12);
            int minIdle = readEnvInt("DB_MIN_IDLE", 2);
            long connectionTimeoutMs = readEnvLong("DB_CONNECTION_TIMEOUT_MS", 5000L);
            long idleTimeoutMs = readEnvLong("DB_IDLE_TIMEOUT_MS", 120000L);
            long maxLifetimeMs = readEnvLong("DB_MAX_LIFETIME_MS", 1800000L);

            String defaultUrl = "jdbc:mysql://%s:%s/%s?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&allowPublicKeyRetrieval=true&useSSL=%s&cachePrepStmts=true&prepStmtCacheSize=250&prepStmtCacheSqlLimit=2048&useServerPrepStmts=true"
                .formatted(host, port, database, ssl);
            String jdbcUrl = readEnv("DB_URL", defaultUrl);
            return new DbConfig(enabled, jdbcUrl, username, password, maxPoolSize, minIdle, connectionTimeoutMs, idleTimeoutMs, maxLifetimeMs);
        }

        private static String readEnv(String key, String fallback) {
            String value = System.getenv(key);
            if (value == null || value.isBlank()) {
                return fallback;
            }
            return value;
        }

        private static int readEnvInt(String key, int fallback) {
            String value = System.getenv(key);
            if (value == null || value.isBlank()) {
                return fallback;
            }
            try {
                return Integer.parseInt(value);
            } catch (NumberFormatException ex) {
                return fallback;
            }
        }

        private static long readEnvLong(String key, long fallback) {
            String value = System.getenv(key);
            if (value == null || value.isBlank()) {
                return fallback;
            }
            try {
                return Long.parseLong(value);
            } catch (NumberFormatException ex) {
                return fallback;
            }
        }
    }
}
