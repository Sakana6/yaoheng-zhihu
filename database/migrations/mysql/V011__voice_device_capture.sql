create table if not exists feedback_capture_link (
  record_id varchar(64) primary key,
  task_id varchar(48) not null unique,
  patient_id bigint not null,
  capture_source varchar(32) not null,
  created_at datetime(6) not null default current_timestamp(6)
);
create table if not exists capture_device_session (
  patient_id bigint not null,
  device_id varchar(64) not null,
  state varchar(24) not null default 'DISCONNECTED',
  version int not null default 1,
  source_version varchar(32) not null default 'replay-v1',
  updated_at datetime(6) not null default current_timestamp(6),
  primary key(patient_id,device_id)
);
create table if not exists capture_device_event (
  patient_id bigint not null,
  device_id varchar(64) not null,
  event_id varchar(64) not null,
  content_hash char(64) not null,
  task_id varchar(48) not null,
  primary key(patient_id,device_id,event_id)
);
