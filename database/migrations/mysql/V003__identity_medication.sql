create table if not exists reminder_item (
  id bigint auto_increment primary key, patient_id bigint not null,
  reminder_key varchar(64) not null, reminder_type varchar(32) not null,
  planned_at datetime not null, title varchar(255) not null,
  status varchar(16) not null default 'PENDING',
  created_at datetime not null default current_timestamp,
  updated_at datetime not null default current_timestamp on update current_timestamp,
  unique key uq_reminder_patient_key(patient_id, reminder_key),
  index idx_reminder_item_patient_time(patient_id, planned_at)
);
create table if not exists reminder_settings (
  patient_id bigint primary key,
  medication_reminder_enabled boolean not null default true,
  bp_reminder_enabled boolean not null default true,
  bg_reminder_enabled boolean not null default true,
  quiet_start varchar(8) not null default '22:00', quiet_end varchar(8) not null default '07:00',
  created_at datetime not null default current_timestamp,
  updated_at datetime not null default current_timestamp on update current_timestamp
);
alter table user_account add column password_hash varchar(255);
create table patient_doctor_relation (
  patient_id bigint not null, user_id bigint not null,
  created_at datetime not null default current_timestamp,
  primary key(patient_id,user_id),
  foreign key(patient_id) references patient(id), foreign key(user_id) references user_account(id)
);
create table auth_session (
  token_hash char(64) primary key, user_id bigint not null,
  expires_at datetime not null, revoked boolean not null default false,
  foreign key(user_id) references user_account(id)
);
alter table patient add column version int not null default 1, add column input_revision bigint not null default 0;
alter table patient_medication add column version int not null default 1;
create table medication_revision (
  medication_id bigint not null, version int not null, patient_id bigint not null,
  actor_id bigint not null, snapshot json not null, valid_from datetime(6) not null,
  valid_to datetime(6), primary key(medication_id,version),
  foreign key(medication_id) references patient_medication(id)
);
create table idempotency_record (
  user_id bigint not null, scope varchar(128) not null, request_key varchar(128) not null,
  request_hash char(64) not null, response_json json not null,
  created_at datetime not null default current_timestamp,
  primary key(user_id,scope,request_key)
);
create table audit_log (
  id bigint auto_increment primary key, actor_id bigint not null, patient_id bigint not null,
  action varchar(64) not null, resource_id bigint not null,
  created_at datetime not null default current_timestamp
);
