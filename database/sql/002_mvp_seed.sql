-- 药衡智护｜MVP 演示种子数据
-- 默认围绕 JE001 链路构造。

insert into "user" (id, mobile, nickname, role, status)
values
  (1, '13800000001', '张阿姨家属', 'CAREGIVER', 'ACTIVE'),
  (2, '13800000002', '社区医生', 'DOCTOR', 'ACTIVE')
on conflict (id) do nothing;

insert into patient (id, name, gender, birthday, living_status, digital_ability_level, created_by)
values
  (1, '张桂英', 'FEMALE', '1948-06-12', 'WITH_FAMILY', 'LOW', 1)
on conflict (id) do nothing;

insert into patient_caregiver_relation (id, patient_id, user_id, relation_type, is_primary)
values
  (1, 1, 1, 'DAUGHTER', true)
on conflict (id) do nothing;

insert into medication_master (id, generic_name, brand_name, dosage_form, strength, source_type, normalized_code)
values
  (101, '二甲双胍', '格华止', 'TABLET', '0.5g', 'MANUAL', 'RXNORM_METFORMIN'),
  (201, '缬沙坦', '代文', 'TABLET', '80mg', 'MANUAL', 'RXNORM_VALSARTAN')
on conflict (id) do nothing;

insert into file_asset (id, bucket, object_key, mime_type, size, uploader_id)
values
  (1, 'demo', 'medication/zhang-guiying-box.jpg', 'image/jpeg', 102400, 1),
  (2, 'demo', 'reports/doctor-summary-1.pdf', 'application/pdf', 20480, 2)
on conflict (id) do nothing;

insert into medication_upload_task (id, patient_id, image_file_id, task_key, ocr_status, parse_status, confirm_status, result_json)
values
  (
    1,
    1,
    1,
    'task_demo_med_001',
    'SUCCESS',
    'SUCCESS',
    'SUCCESS',
    '{
      "candidates": [
        {"genericName": "二甲双胍", "brandName": "格华止", "strength": "0.5g", "confidence": 0.96},
        {"genericName": "缬沙坦", "brandName": "代文", "strength": "80mg", "confidence": 0.92}
      ]
    }'::jsonb
  )
on conflict (id) do nothing;

insert into patient_medication (
  id,
  patient_id,
  medication_master_id,
  source_image_id,
  dose,
  frequency,
  administration_time,
  start_date,
  end_date,
  status,
  confirmed_by_user
)
values
  (1001, 1, 101, 1, '0.5g', 'BID', 'AFTER_BREAKFAST_AFTER_DINNER', '2026-03-01', null, 'ACTIVE', true),
  (1002, 1, 201, 1, '80mg', 'QD', 'AFTER_BREAKFAST', '2026-03-01', null, 'ACTIVE', true)
on conflict (id) do nothing;

insert into meal_record (id, patient_id, occurred_at, meal_type, intake_level)
values
  (1, 1, '2026-03-31T08:00:00+08:00', 'BREAKFAST', 'INSUFFICIENT')
on conflict (id) do nothing;

insert into adherence_event (id, patient_id, medication_id, event_time, event_type, note)
values
  (1, 1, 1001, '2026-03-31T08:10:00+08:00', 'TAKEN', '早餐未吃完后仍按时服药')
on conflict (id) do nothing;

insert into symptom_record (id, patient_id, occurred_at, symptom_code, severity, note)
values
  (1, 1, '2026-03-31T09:00:00+08:00', 'DIZZINESS', 3, '今天早上头晕'),
  (2, 1, '2026-03-31T09:00:00+08:00', 'SWEATING', 3, '伴有出汗'),
  (3, 1, '2026-03-31T09:00:00+08:00', 'TREMOR', 3, '伴有手抖')
on conflict (id) do nothing;

insert into bg_record (id, patient_id, measured_at, glucose_value, meal_phase, source)
values
  (1, 1, '2026-03-31T09:05:00+08:00', 3.80, 'POST_BREAKFAST', 'APP')
on conflict (id) do nothing;

insert into inquiry_session (id, patient_id, session_key, trigger_type, trigger_time, session_status, model_version)
values
  (1, 1, 'inq_demo_001', 'symptom', '2026-03-31T09:01:00+08:00', 'COMPLETED', 'parse_v1')
on conflict (id) do nothing;

insert into inquiry_question (id, session_id, question_code, question_text, source_type, order_no)
values
  (1, 1, 'MEAL_AMOUNT', '今天早餐有没有正常吃完？', 'RULE_TEMPLATE', 1),
  (2, 1, 'MED_TAKEN_TIME', '这次不适是在吃药前还是吃药后出现的？', 'RULE_TEMPLATE', 2)
on conflict (id) do nothing;

insert into inquiry_answer (id, session_id, question_code, answer_value, answer_text, normalized_value)
values
  (1, 1, 'MEAL_AMOUNT', 'INSUFFICIENT', '早餐没吃完', 'INSUFFICIENT'),
  (2, 1, 'MED_TAKEN_TIME', 'AFTER_MED', '药后出现不适', 'AFTER_MED')
on conflict (id) do nothing;

insert into joint_event (
  id,
  patient_id,
  event_date,
  time_window_start,
  time_window_end,
  event_type,
  event_label,
  severity,
  evidence_json
)
values
  (
    1,
    1,
    '2026-03-31',
    '2026-03-31T08:00:00+08:00',
    '2026-03-31T09:10:00+08:00',
    'JE001',
    '降糖药+进食不足+手抖出汗+低糖',
    82,
    '{
      "meal": "INSUFFICIENT",
      "symptoms": ["DIZZINESS", "SWEATING", "TREMOR"],
      "glucose": 3.8,
      "medication": "二甲双胍"
    }'::jsonb
  )
on conflict (id) do nothing;

insert into risk_score_snapshot (
  id,
  patient_id,
  score_date,
  deintensification_score,
  interaction_score,
  temporal_behavior_score,
  joint_event_score,
  followup_priority,
  model_version,
  explanation_json
)
values
  (
    1,
    1,
    '2026-03-31',
    82,
    20,
    61,
    88,
    'CLINIC_REVIEW',
    'risk_v1',
    '{
      "reasons": [
        "早餐摄入不足后仍服用降糖药",
        "近7天出现手抖/出汗并伴血糖低值"
      ]
    }'::jsonb
  )
on conflict (id) do nothing;

insert into report_task (id, patient_id, report_type, status, generated_at, source_score_snapshot_id, file_asset_id)
values
  (1, 1, 'DOCTOR', 'SUCCESS', '2026-03-31T10:00:00+08:00', 1, 2)
on conflict (id) do nothing;
