create table report_evidence (
  report_id varchar(64) primary key,
  packet json not null,
  packet_checksum varchar(64) not null,
  generation_method varchar(32) not null,
  audit_status varchar(32) not null,
  audit_stages json not null,
  enhancement_status varchar(32) not null,
  fallback_reason varchar(128),
  created_at datetime(6) not null default (utc_timestamp(6)),
  foreign key(report_id) references report_job(id)
);
