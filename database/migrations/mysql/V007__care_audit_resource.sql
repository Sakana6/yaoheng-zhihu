-- Existing numeric medication resource IDs remain readable; new domain IDs are opaque strings.
alter table audit_log modify resource_id varchar(64) not null;
