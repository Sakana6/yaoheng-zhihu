create table if not exists r3_inquiry_context (
  session_key varchar(64) primary key,
  patient_id bigint not null,
  run_id varchar(64) not null,
  snapshot_id varchar(64) not null,
  projection_id varchar(96) not null,
  missing_node_id varchar(96) not null,
  record_id varchar(64) not null,
  revision_id varchar(64) not null,
  question_code varchar(32) not null,
  created_at datetime(6) not null default current_timestamp(6),
  index idx_r3_inquiry_patient (patient_id, record_id)
);
