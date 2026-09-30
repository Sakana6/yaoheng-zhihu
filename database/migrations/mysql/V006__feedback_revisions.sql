create table raw_record (
  id varchar(64) primary key, patient_id bigint not null, occurrence_id bigint,
  version int not null, latest_revision_id varchar(64),
  created_at datetime(6) not null default (utc_timestamp(6)),
  unique key uq_occurrence_feedback(patient_id,occurrence_id),
  foreign key(patient_id) references patient(id), foreign key(occurrence_id) references reminder_item(id)
);
create table raw_record_revision (
  id varchar(64) primary key, record_id varchar(64) not null, version int not null,
  raw_text text not null, confirmed_facts json not null, source varchar(32) not null,
  occurred_at datetime(6) not null, recorded_at datetime(6) not null default (utc_timestamp(6)),
  actor_id bigint not null, change_reason varchar(500) not null,
  unique key uq_record_version(record_id,version), foreign key(record_id) references raw_record(id)
);
create table parsed_event_candidate (
  id varchar(64) primary key, revision_id varchar(64) not null, candidate json not null,
  confirmation_status varchar(32) not null default 'PENDING', parser_version varchar(64) not null,
  foreign key(revision_id) references raw_record_revision(id)
);
create table analysis_task (
  id varchar(64) primary key, patient_id bigint not null, revision_id varchar(64) not null,
  input_revision bigint not null, status varchar(16) not null default 'PENDING',
  attempt int not null default 0, next_attempt_at datetime(6), lease_until datetime(6),
  lease_token varchar(64), error_code varchar(64), created_at datetime(6) not null default (utc_timestamp(6)),
  unique key uq_task_revision(revision_id), index idx_task_pending(status,next_attempt_at),
  foreign key(revision_id) references raw_record_revision(id), foreign key(patient_id) references patient(id)
);
alter table bp_record add column source_revision_id varchar(64), add column fact_key varchar(64), add column is_valid boolean not null default true,
  add unique key uq_bp_fact(source_revision_id,fact_key), add foreign key(source_revision_id) references raw_record_revision(id);
alter table bp_record modify heart_rate integer null;
alter table bg_record add column source_revision_id varchar(64), add column fact_key varchar(64), add column is_valid boolean not null default true,
  add unique key uq_bg_fact(source_revision_id,fact_key), add foreign key(source_revision_id) references raw_record_revision(id);
alter table symptom_record add column source_revision_id varchar(64), add column fact_key varchar(64), add column is_valid boolean not null default true,
  add unique key uq_symptom_fact(source_revision_id,fact_key), add foreign key(source_revision_id) references raw_record_revision(id);
alter table meal_record add column source_revision_id varchar(64), add column fact_key varchar(64), add column is_valid boolean not null default true,
  add unique key uq_meal_fact(source_revision_id,fact_key), add foreign key(source_revision_id) references raw_record_revision(id);
alter table adherence_event add column source_revision_id varchar(64), add column fact_key varchar(64), add column is_valid boolean not null default true,
  add unique key uq_adherence_fact(source_revision_id,fact_key), add foreign key(source_revision_id) references raw_record_revision(id);
alter table inquiry_session add column record_id varchar(64), add column revision_id varchar(64),
  add foreign key(record_id) references raw_record(id), add foreign key(revision_id) references raw_record_revision(id);
