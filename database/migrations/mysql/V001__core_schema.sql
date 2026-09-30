-- 药衡智护 R1 MySQL 8.0 baseline migration V001
-- Do not run PostgreSQL database/sql/001_core_schema.sql against MySQL.
-- Apply in a dedicated synthetic-data database after taking a backup.
-- This migration is idempotent at table/index creation level.

create table if not exists schema_migration (
  version varchar(64) primary key,
  applied_at datetime(6) not null default current_timestamp(6)
);

-- 药衡智护｜冻结主干表结构 v1
-- 说明：
-- 1. 本文件对应冻结清单 v1 的核心表结构主干
-- 2. 采用 MySQL 8.0 方言；由 database/migrations/mysql/V001__core_schema.sql 执行
-- 3. 允许后续新增字段、索引、审计列，但不建议破坏已冻结主对象与主干字段

create table if not exists user_account (
  id bigint auto_increment primary key,
  mobile varchar(32) not null unique,
  nickname varchar(64),
  role varchar(32) not null,
  status varchar(32) not null default 'ACTIVE',
  created_at datetime(6) not null default current_timestamp(6),
  updated_at datetime(6) not null default current_timestamp(6)
);

create table if not exists patient (
  id bigint auto_increment primary key,
  name varchar(64) not null,
  gender varchar(16) not null,
  birthday date not null,
  living_status varchar(32) not null,
  digital_ability_level varchar(32) not null,
  created_by bigint,
  created_at datetime(6) not null default current_timestamp(6),
  updated_at datetime(6) not null default current_timestamp(6),
  foreign key (created_by) references user_account(id)
);

create table if not exists patient_caregiver_relation (
  id bigint auto_increment primary key,
  patient_id bigint not null,
  user_id bigint not null,
  relation_type varchar(32) not null,
  is_primary boolean not null default false,
  created_at datetime(6) not null default current_timestamp(6),
  foreign key (patient_id) references patient(id),
  foreign key (user_id) references user_account(id)
);

create table if not exists medication_master (
  id bigint auto_increment primary key,
  generic_name varchar(128) not null,
  brand_name varchar(128),
  dosage_form varchar(64),
  strength varchar(64),
  source_type varchar(32),
  normalized_code varchar(64),
  created_at datetime(6) not null default current_timestamp(6)
);

create table if not exists file_asset (
  id bigint auto_increment primary key,
  bucket varchar(64) not null,
  object_key varchar(255) not null,
  mime_type varchar(128) not null,
  size bigint not null default 0,
  uploader_id bigint,
  created_at datetime(6) not null default current_timestamp(6),
  foreign key (uploader_id) references user_account(id)
);

create table if not exists medication_upload_task (
  id bigint auto_increment primary key,
  patient_id bigint not null,
  image_file_id bigint not null,
  task_key varchar(64) not null unique,
  ocr_status varchar(16) not null default 'PENDING',
  parse_status varchar(16) not null default 'PENDING',
  confirm_status varchar(16) not null default 'PENDING',
  result_json json not null default (JSON_OBJECT()),
  created_at datetime(6) not null default current_timestamp(6),
  updated_at datetime(6) not null default current_timestamp(6),
  foreign key (patient_id) references patient(id),
  foreign key (image_file_id) references file_asset(id)
);

create table if not exists patient_medication (
  id bigint auto_increment primary key,
  patient_id bigint not null,
  medication_master_id bigint not null,
  source_image_id bigint,
  dose varchar(64) not null,
  frequency varchar(64) not null,
  administration_time varchar(128) not null,
  start_date date not null,
  end_date date,
  status varchar(32) not null,
  confirmed_by_user boolean not null default false,
  created_at datetime(6) not null default current_timestamp(6),
  updated_at datetime(6) not null default current_timestamp(6),
  foreign key (patient_id) references patient(id),
  foreign key (medication_master_id) references medication_master(id),
  foreign key (source_image_id) references file_asset(id)
);

create table if not exists bp_record (
  id bigint auto_increment primary key,
  patient_id bigint not null,
  measured_at datetime(6) not null,
  systolic integer not null,
  diastolic integer not null,
  heart_rate integer not null,
  source varchar(32),
  created_at datetime(6) not null default current_timestamp(6),
  foreign key (patient_id) references patient(id)
);

create table if not exists bg_record (
  id bigint auto_increment primary key,
  patient_id bigint not null,
  measured_at datetime(6) not null,
  glucose_value numeric(5,2) not null,
  meal_phase varchar(32) not null,
  source varchar(32),
  created_at datetime(6) not null default current_timestamp(6),
  foreign key (patient_id) references patient(id)
);

create table if not exists symptom_record (
  id bigint auto_increment primary key,
  patient_id bigint not null,
  occurred_at datetime(6) not null,
  symptom_code varchar(64) not null,
  severity integer not null,
  note text,
  created_at datetime(6) not null default current_timestamp(6),
  foreign key (patient_id) references patient(id)
);

create table if not exists meal_record (
  id bigint auto_increment primary key,
  patient_id bigint not null,
  occurred_at datetime(6) not null,
  meal_type varchar(32) not null,
  intake_level varchar(32) not null,
  created_at datetime(6) not null default current_timestamp(6),
  foreign key (patient_id) references patient(id)
);

create table if not exists adherence_event (
  id bigint auto_increment primary key,
  patient_id bigint not null,
  medication_id bigint not null,
  event_time datetime(6) not null,
  event_type varchar(32) not null,
  note text,
  created_at datetime(6) not null default current_timestamp(6),
  foreign key (patient_id) references patient(id),
  foreign key (medication_id) references patient_medication(id)
);

create table if not exists inquiry_session (
  id bigint auto_increment primary key,
  patient_id bigint not null,
  session_key varchar(64) not null unique,
  trigger_type varchar(32) not null,
  trigger_time datetime(6) not null,
  session_status varchar(32) not null,
  model_version varchar(64),
  created_at datetime(6) not null default current_timestamp(6),
  updated_at datetime(6) not null default current_timestamp(6),
  foreign key (patient_id) references patient(id)
);

create table if not exists inquiry_question (
  id bigint auto_increment primary key,
  session_id bigint not null,
  question_code varchar(64) not null,
  question_text text not null,
  source_type varchar(32),
  order_no integer not null,
  created_at datetime(6) not null default current_timestamp(6),
  foreign key (session_id) references inquiry_session(id)
);

create table if not exists inquiry_answer (
  id bigint auto_increment primary key,
  session_id bigint not null,
  question_code varchar(64) not null,
  answer_value varchar(128),
  answer_text text,
  normalized_value varchar(128),
  created_at datetime(6) not null default current_timestamp(6),
  foreign key (session_id) references inquiry_session(id)
);

create table if not exists joint_event (
  id bigint auto_increment primary key,
  patient_id bigint not null,
  event_date date not null,
  time_window_start datetime(6) not null,
  time_window_end datetime(6) not null,
  event_type varchar(16) not null,
  event_label varchar(128) not null,
  severity integer not null,
  evidence_json json not null default (JSON_OBJECT()),
  created_at datetime(6) not null default current_timestamp(6),
  foreign key (patient_id) references patient(id)
);

create table if not exists risk_score_snapshot (
  id bigint auto_increment primary key,
  patient_id bigint not null,
  score_date date not null,
  deintensification_score integer not null,
  interaction_score integer not null,
  temporal_behavior_score integer not null,
  joint_event_score integer not null,
  followup_priority varchar(32) not null,
  model_version varchar(64),
  explanation_json json not null default (JSON_OBJECT()),
  created_at datetime(6) not null default current_timestamp(6),
  foreign key (patient_id) references patient(id)
);

create table if not exists report_task (
  id bigint auto_increment primary key,
  patient_id bigint not null,
  report_type varchar(32) not null,
  status varchar(16) not null default 'PENDING',
  generated_at datetime(6),
  source_score_snapshot_id bigint,
  file_asset_id bigint,
  created_at datetime(6) not null default current_timestamp(6),
  foreign key (patient_id) references patient(id),
  foreign key (source_score_snapshot_id) references risk_score_snapshot(id),
  foreign key (file_asset_id) references file_asset(id)
);

create index idx_patient_medication_patient on patient_medication(patient_id);
create index idx_bp_record_patient_time on bp_record(patient_id, measured_at);
create index idx_bg_record_patient_time on bg_record(patient_id, measured_at);
create index idx_symptom_record_patient_time on symptom_record(patient_id, occurred_at);
create index idx_adherence_event_patient_time on adherence_event(patient_id, event_time);
create index idx_joint_event_patient_date on joint_event(patient_id, event_date);
create index idx_risk_snapshot_patient_date on risk_score_snapshot(patient_id, score_date);
