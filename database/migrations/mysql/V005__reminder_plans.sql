create table reminder_plan (
  id varchar(64) primary key, patient_id bigint not null, version int not null default 1,
  status varchar(16) not null, definition json not null,
  created_at datetime(6) not null default (utc_timestamp(6)),
  updated_at datetime(6) not null default (utc_timestamp(6)),
  foreign key(patient_id) references patient(id), index idx_plan_patient(patient_id,status)
);
create table plan_medication (
  plan_id varchar(64) not null, medication_id bigint not null,
  primary key(plan_id,medication_id), foreign key(plan_id) references reminder_plan(id),
  foreign key(medication_id) references patient_medication(id)
);
alter table reminder_item
  add column plan_id varchar(64), add column plan_version int,
  add column execution_status varchar(16) not null default 'PENDING',
  add column version int not null default 1, add column skip_reason varchar(500),
  add column medication_snapshot json,
  add foreign key(plan_id) references reminder_plan(id),
  add unique key uq_occurrence_generation(patient_id,plan_id,plan_version,planned_at);
-- Legacy rows remain available for audit; REAL queries use only plan-backed occurrences.
update reminder_item set execution_status=case
  when status in ('SUCCESS','DONE') then 'DONE'
  when status in ('SKIPPED','CANCELLED') then status else 'PENDING' end;
