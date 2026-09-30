-- 药衡智护｜冻结主干表结构 v1
-- 说明：
-- 1. 本文件对应冻结清单 v1 的核心表结构主干
-- 2. 采用 PostgreSQL 方言
-- 3. 允许后续新增字段、索引、审计列，但不建议破坏已冻结主对象与主干字段

create table if not exists "user" (
  id bigserial primary key,
  mobile varchar(32) not null unique,
  nickname varchar(64),
  role varchar(32) not null,
  status varchar(32) not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists patient (
  id bigserial primary key,
  name varchar(64) not null,
  gender varchar(16) not null,
  birthday date not null,
  living_status varchar(32) not null,
  digital_ability_level varchar(32) not null,
  created_by bigint references "user"(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists patient_caregiver_relation (
  id bigserial primary key,
  patient_id bigint not null references patient(id),
  user_id bigint not null references "user"(id),
  relation_type varchar(32) not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists medication_master (
  id bigserial primary key,
  generic_name varchar(128) not null,
  brand_name varchar(128),
  dosage_form varchar(64),
  strength varchar(64),
  source_type varchar(32),
  normalized_code varchar(64),
  created_at timestamptz not null default now()
);

create table if not exists file_asset (
  id bigserial primary key,
  bucket varchar(64) not null,
  object_key varchar(255) not null,
  mime_type varchar(128) not null,
  size bigint not null default 0,
  uploader_id bigint references "user"(id),
  created_at timestamptz not null default now()
);

create table if not exists medication_upload_task (
  id bigserial primary key,
  patient_id bigint not null references patient(id),
  image_file_id bigint not null references file_asset(id),
  task_key varchar(64) not null unique,
  ocr_status varchar(16) not null default 'PENDING',
  parse_status varchar(16) not null default 'PENDING',
  confirm_status varchar(16) not null default 'PENDING',
  result_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists patient_medication (
  id bigserial primary key,
  patient_id bigint not null references patient(id),
  medication_master_id bigint not null references medication_master(id),
  source_image_id bigint references file_asset(id),
  dose varchar(64) not null,
  frequency varchar(64) not null,
  administration_time varchar(128) not null,
  start_date date not null,
  end_date date,
  status varchar(32) not null,
  confirmed_by_user boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists bp_record (
  id bigserial primary key,
  patient_id bigint not null references patient(id),
  measured_at timestamptz not null,
  systolic integer not null,
  diastolic integer not null,
  heart_rate integer not null,
  source varchar(32),
  created_at timestamptz not null default now()
);

create table if not exists bg_record (
  id bigserial primary key,
  patient_id bigint not null references patient(id),
  measured_at timestamptz not null,
  glucose_value numeric(5,2) not null,
  meal_phase varchar(32) not null,
  source varchar(32),
  created_at timestamptz not null default now()
);

create table if not exists symptom_record (
  id bigserial primary key,
  patient_id bigint not null references patient(id),
  occurred_at timestamptz not null,
  symptom_code varchar(64) not null,
  severity integer not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists meal_record (
  id bigserial primary key,
  patient_id bigint not null references patient(id),
  occurred_at timestamptz not null,
  meal_type varchar(32) not null,
  intake_level varchar(32) not null,
  created_at timestamptz not null default now()
);

create table if not exists adherence_event (
  id bigserial primary key,
  patient_id bigint not null references patient(id),
  medication_id bigint not null references patient_medication(id),
  event_time timestamptz not null,
  event_type varchar(32) not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists inquiry_session (
  id bigserial primary key,
  patient_id bigint not null references patient(id),
  session_key varchar(64) not null unique,
  trigger_type varchar(32) not null,
  trigger_time timestamptz not null,
  session_status varchar(32) not null,
  model_version varchar(64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists inquiry_question (
  id bigserial primary key,
  session_id bigint not null references inquiry_session(id),
  question_code varchar(64) not null,
  question_text text not null,
  source_type varchar(32),
  order_no integer not null,
  created_at timestamptz not null default now()
);

create table if not exists inquiry_answer (
  id bigserial primary key,
  session_id bigint not null references inquiry_session(id),
  question_code varchar(64) not null,
  answer_value varchar(128),
  answer_text text,
  normalized_value varchar(128),
  created_at timestamptz not null default now()
);

create table if not exists joint_event (
  id bigserial primary key,
  patient_id bigint not null references patient(id),
  event_date date not null,
  time_window_start timestamptz not null,
  time_window_end timestamptz not null,
  event_type varchar(16) not null,
  event_label varchar(128) not null,
  severity integer not null,
  evidence_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists risk_score_snapshot (
  id bigserial primary key,
  patient_id bigint not null references patient(id),
  score_date date not null,
  deintensification_score integer not null,
  interaction_score integer not null,
  temporal_behavior_score integer not null,
  joint_event_score integer not null,
  followup_priority varchar(32) not null,
  model_version varchar(64),
  explanation_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists report_task (
  id bigserial primary key,
  patient_id bigint not null references patient(id),
  report_type varchar(32) not null,
  status varchar(16) not null default 'PENDING',
  generated_at timestamptz,
  source_score_snapshot_id bigint references risk_score_snapshot(id),
  file_asset_id bigint references file_asset(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_patient_medication_patient on patient_medication(patient_id);
create index if not exists idx_bp_record_patient_time on bp_record(patient_id, measured_at desc);
create index if not exists idx_bg_record_patient_time on bg_record(patient_id, measured_at desc);
create index if not exists idx_symptom_record_patient_time on symptom_record(patient_id, occurred_at desc);
create index if not exists idx_adherence_event_patient_time on adherence_event(patient_id, event_time desc);
create index if not exists idx_joint_event_patient_date on joint_event(patient_id, event_date desc);
create index if not exists idx_risk_snapshot_patient_date on risk_score_snapshot(patient_id, score_date desc);
