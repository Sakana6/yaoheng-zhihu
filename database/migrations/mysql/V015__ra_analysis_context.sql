create table ra_candidate_confirmation (
 revision_id varchar(64) primary key, patient_id bigint not null, artifact_id varchar(64) not null,
 artifact_hash char(64) not null, confirmed_facts_hash char(64) not null,
 foreign key(artifact_id) references ra_candidate_artifact(id)
);
create table ra_analysis_context (
 task_id varchar(64) primary key, patient_id bigint not null, input_revision bigint not null,
 base_manifest_hash char(64) not null, context_hash char(64) not null, context_json json not null,
 created_at datetime(6) not null default current_timestamp(6),
 foreign key(task_id) references analysis_task(id)
);
