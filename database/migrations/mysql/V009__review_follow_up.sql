create table doctor_review (
  id varchar(64) primary key, patient_id bigint not null, actor_id bigint not null,
  analysis_run_id varchar(64) not null, snapshot_id varchar(64) not null,
  decision varchar(32) not null, comment text not null, reason varchar(1000) not null,
  historical boolean not null default false, created_at datetime(6) not null default (utc_timestamp(6)),
  foreign key(patient_id) references patient(id), foreign key(actor_id) references user_account(id),
  foreign key(analysis_run_id) references analysis_run(id), index idx_review_patient(patient_id,created_at)
);
create table follow_up (
  id varchar(64) primary key, patient_id bigint not null, actor_id bigint not null,
  source_review_id varchar(64) not null, analysis_run_id varchar(64) not null, snapshot_id varchar(64) not null,
  required_fields json not null, due_at datetime(6) not null, instruction varchar(1000) not null,
  status varchar(16) not null default 'PENDING', version int not null default 1,
  plan_id varchar(64) not null, occurrence_key varchar(64) not null, completed_record_id varchar(64),
  created_at datetime(6) not null default (utc_timestamp(6)),
  updated_at datetime(6) not null default (utc_timestamp(6)),
  foreign key(patient_id) references patient(id), foreign key(actor_id) references user_account(id),
  foreign key(source_review_id) references doctor_review(id), foreign key(analysis_run_id) references analysis_run(id),
  foreign key(plan_id) references reminder_plan(id), foreign key(completed_record_id) references raw_record(id),
  index idx_follow_patient(patient_id,status,due_at)
);
alter table reminder_item add column follow_up_id varchar(64), add foreign key(follow_up_id) references follow_up(id);
alter table raw_record add column follow_up_id varchar(64), add unique key uq_follow_feedback(follow_up_id), add foreign key(follow_up_id) references follow_up(id);
