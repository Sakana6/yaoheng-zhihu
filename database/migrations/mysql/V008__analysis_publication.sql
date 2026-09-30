alter table analysis_task add column manifest json, add column retry_base int not null default 0;
create table analysis_attempt (
 id bigint auto_increment primary key, task_id varchar(64) not null, attempt int not null,
 lease_token varchar(64) not null, status varchar(16) not null, error_code varchar(64),
 started_at datetime(6) not null default (utc_timestamp(6)), finished_at datetime(6),
 unique key uq_attempt(task_id,attempt), foreign key(task_id) references analysis_task(id)
);
create table analysis_run (
 id varchar(64) primary key, snapshot_id varchar(64) not null unique, patient_id bigint not null,
 task_id varchar(64) not null unique, input_revision bigint not null, snapshot json not null,
 created_at datetime(6) not null default (utc_timestamp(6)),
 foreign key(patient_id) references patient(id),foreign key(task_id) references analysis_task(id)
);
create table analysis_latest (
 patient_id bigint primary key, run_id varchar(64) not null, input_revision bigint not null,
 foreign key(patient_id) references patient(id),foreign key(run_id) references analysis_run(id)
);
create table report_job (
 id varchar(64) primary key, patient_id bigint not null, snapshot_id varchar(64) not null,
 report_type varchar(16) not null, template_version varchar(32) not null,
 status varchar(16) not null default 'PENDING', attempt int not null default 0,
 lease_token varchar(64),lease_until datetime(6),error_code varchar(64),
 html longtext,checksum char(64),created_at datetime(6) not null default (utc_timestamp(6)),
 unique key uq_report_snapshot(snapshot_id,report_type,template_version),
 foreign key(snapshot_id) references analysis_run(snapshot_id), foreign key(patient_id) references patient(id)
);
