-- Forward upgrade preserves all legacy reminder rows; keys become patient scoped.
set @legacy_index = (select index_name from information_schema.statistics
  where table_schema=database() and table_name='reminder_item' and column_name='reminder_key'
    and non_unique=0 and index_name!='uq_reminder_patient_key' limit 1);
set @ddl = if(@legacy_index is null, 'select 1', concat('alter table reminder_item drop index `', @legacy_index, '`'));
prepare upgrade_statement from @ddl;
execute upgrade_statement;
deallocate prepare upgrade_statement;
set @has_scoped_index = (select count(*) from information_schema.statistics
  where table_schema=database() and table_name='reminder_item' and index_name='uq_reminder_patient_key');
set @ddl = if(@has_scoped_index>0, 'select 1', 'alter table reminder_item add unique key uq_reminder_patient_key(patient_id,reminder_key)');
prepare upgrade_statement from @ddl;
execute upgrade_statement;
deallocate prepare upgrade_statement;

-- Baseline revisions for pre-migration medications, preserving their actual fields.
insert into medication_revision(medication_id,version,patient_id,actor_id,snapshot,valid_from)
select pm.id,pm.version,pm.patient_id,coalesce(p.created_by,0),
  json_object('id',pm.id,'version',pm.version,'genericName',mm.generic_name,
    'brandName',mm.brand_name,'dose',pm.dose,'frequency',pm.frequency,
    'administrationTime',pm.administration_time,'startDate',pm.start_date,
    'endDate',pm.end_date,'status',pm.status),pm.created_at
from patient_medication pm join patient p on p.id=pm.patient_id
join medication_master mm on mm.id=pm.medication_master_id
where not exists(select 1 from medication_revision r where r.medication_id=pm.id and r.version=pm.version);
