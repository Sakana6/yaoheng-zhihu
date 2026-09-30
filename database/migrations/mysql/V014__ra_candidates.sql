create table ra_candidate_artifact (
 id varchar(64) primary key, patient_id bigint not null, request_id varchar(128) not null,
 input_hash char(64) not null, input_json json not null, input_revision bigint not null,
 record_id varchar(64), record_revision varchar(64), state varchar(16) not null,
 result_json json, output_hash char(64), created_at datetime(6) not null default current_timestamp(6),
 unique key ra_candidate_request(patient_id,request_id), foreign key(patient_id) references patient(id)
);
