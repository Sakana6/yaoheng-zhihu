-- Additive evidence boundary. Candidate data never creates medication facts.
create table if not exists capture_task (
  task_id varchar(48) primary key,
  patient_id bigint not null,
  actor_id bigint not null,
  kind varchar(16) not null,
  content_hash char(64) not null,
  original_name varchar(180) null,
  mime_type varchar(40) null,
  byte_size int not null default 0,
  raw_text text null,
  status varchar(24) not null default 'PENDING',
  version int not null default 1,
  candidate_json json null,
  failure_code varchar(64) null,
  medication_id bigint null,
  confirmed_json json null,
  file_deleted boolean not null default false,
  created_at datetime(6) not null default current_timestamp(6),
  updated_at datetime(6) not null default current_timestamp(6),
  unique key uq_capture_content(patient_id,kind,content_hash),
  key idx_capture_patient(patient_id,created_at)
);
create table if not exists capture_audit (
  id bigint primary key auto_increment,
  task_id varchar(48) not null,
  patient_id bigint not null,
  actor_id bigint not null,
  action varchar(40) not null,
  task_version int not null,
  created_at datetime(6) not null default current_timestamp(6),
  key idx_capture_audit(task_id,id)
);
