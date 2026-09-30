package com.yaoheng.backend;

import java.time.Instant;

public final class ApiEnvelope {
  private ApiEnvelope() {
    }

    public static String syncEnvelope(String dataJson) {
        return """
            {
              "code": 0,
              "message": "ok",
              "data": %s,
              "requestId": "req_%d",
              "timestamp": "%s"
            }
            """.formatted(dataJson, System.currentTimeMillis(), Instant.now().toString());
    }

    public static String asyncEnvelope(String dataJson) {
        return """
            {
              "code": 0,
              "message": "accepted",
              "data": %s
            }
            """.formatted(dataJson);
    }

    public static String health(boolean dbReady, String dbStatus) {
        return """
            {
              "service": "backend-java",
              "status": "ok",
              "stage": "skeleton",
              "database": {
                "ready": %s,
                "status": "%s"
              },
              "timestamp": "%s"
            }
            """.formatted(dbReady, escapeJson(dbStatus), Instant.now().toString());
    }

    public static String login(String token, int userId, String role, Integer patientId) {
        String patientIdJson = patientId == null ? "null" : patientId.toString();
        return syncEnvelope("""
            {
              "token": "%s",
              "userId": %d,
              "role": "%s",
              "patientId": %s
            }
            """.formatted(token, userId, role, patientIdJson));
    }

    public static String errorEnvelope(int code, String message) {
        return """
            {
              "code": %d,
              "message": "%s",
              "data": {},
              "requestId": "req_%d",
              "timestamp": "%s"
            }
            """.formatted(code, message, System.currentTimeMillis(), Instant.now().toString());
    }

    public static String errorEnvelope(int code, String message, String detail) {
        return """
            {
              "code": %d,
              "message": "%s",
              "data": {
                "detail": "%s"
              },
              "requestId": "req_%d",
              "timestamp": "%s"
            }
            """.formatted(code, escapeJson(message), escapeJson(detail), System.currentTimeMillis(), Instant.now().toString());
    }

    private static String escapeJson(String value) {
        if (value == null) {
            return "";
        }
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    public static String success() {
        return syncEnvelope("""
            {
              "success": true
            }
            """);
    }
}
