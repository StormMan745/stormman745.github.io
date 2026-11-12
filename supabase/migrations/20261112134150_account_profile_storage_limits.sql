-- Application profile quota: 20 MiB by default. The server-owned Auth app_metadata
-- flag petcare_unlimited_profile exempts a configured account; JWT/user metadata
-- and fields inside the profile cannot grant that exemption.
-- Account-specific configuration is applied separately, never committed here.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function petcare_private.assert_profile_payload(p_owner uuid, p_data jsonb)
returns void language plpgsql stable security invoker set search_path = '' as $quota$
declare v_unlimited boolean;
begin
    if p_owner is null or jsonb_typeof(p_data) is distinct from 'object' then
        raise exception 'Invalid profile' using errcode = '22023';
    end if;
    select u.raw_app_meta_data -> 'petcare_unlimited_profile' = 'true'::jsonb
      into v_unlimited from auth.users u where u.id = p_owner;
    if not coalesce(v_unlimited, false) and octet_length(p_data::text) > 20971520 then
        raise exception 'Profile data exceeds account limit (20 MiB)' using errcode = '22023';
    end if;
end $quota$;
revoke all on function petcare_private.assert_profile_payload(uuid,jsonb) from public,anon,authenticated;
grant execute on function petcare_private.assert_profile_payload(uuid,jsonb) to service_role;

CREATE OR REPLACE FUNCTION petcare_private.profile_revision()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
    perform petcare_private.assert_profile_payload(new.user_id,new.data);
    new.revision := case when tg_op='UPDATE' then old.revision+1 else 1 end;
    new.updated_at := clock_timestamp();
    return new;
end $function$;

CREATE OR REPLACE FUNCTION petcare_private.sync_profile(p_revision bigint, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid:=auth.uid(); v_row public.petcare_data%rowtype;
begin
    if not petcare_private.account_active() then raise exception 'Authentication required' using errcode='42501'; end if;
    if p_revision is null or p_revision<0 then raise exception 'Invalid profile' using errcode='22023'; end if;
    perform petcare_private.assert_profile_payload(v_user,p_data);
    perform pg_advisory_xact_lock(hashtextextended(v_user::text,42));
    select * into v_row from public.petcare_data where user_id=v_user for update;
    if coalesce(v_row.revision,0)<>p_revision then
        return jsonb_build_object('conflict',true,'data',coalesce(v_row.data,'{}'::jsonb),'revision',coalesce(v_row.revision,0));
    end if;
    insert into public.petcare_data(user_id,data) values(v_user,p_data)
      on conflict(user_id) do update set data=excluded.data returning * into v_row;
    return jsonb_build_object('conflict',false,'data',v_row.data,'revision',v_row.revision);
end $function$;

CREATE OR REPLACE FUNCTION petcare_private.care_profile(p_owner uuid, p_pet text, p_revision bigint DEFAULT NULL::bigint, p_data jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid:=auth.uid(); v_row public.petcare_data%rowtype; v_next jsonb; v_key text; v_items jsonb; v_pet jsonb;
begin
 if not petcare_private.account_active() or (v_user<>p_owner and not exists
   (select 1 from public.petcare_care_members where owner_id=p_owner and pet_id=p_pet and member_id=v_user)) then
   raise exception 'Access denied' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,42));
 select * into v_row from public.petcare_data where user_id=p_owner for update;
 if v_row.user_id is null or petcare_private.pet_slice(v_row.data,p_pet)->'pet'='null'::jsonb then raise exception 'Pet not found' using errcode='22023'; end if;
 if p_data is not null then
   if p_revision is null or p_revision<0 then raise exception 'Invalid revision' using errcode='22023'; end if;
   if v_row.revision<>p_revision then return jsonb_build_object('conflict',true,'revision',v_row.revision,'data',petcare_private.pet_slice(v_row.data,p_pet)); end if;
   perform petcare_private.assert_profile_payload(p_owner,p_data);
   v_next:=v_row.data;
   v_pet:=p_data->'pet';
   if jsonb_typeof(v_pet) is distinct from 'object' or coalesce(v_pet->>'dbId',v_pet->>'id') is distinct from p_pet then raise exception 'Invalid pet' using errcode='22023'; end if;
   if jsonb_typeof(v_pet->'name') is distinct from 'string' or length(trim(v_pet->>'name')) not between 1 and 160 then raise exception 'Invalid pet name' using errcode='22023';end if;
   select jsonb_agg(case when coalesce(r->>'dbId',r->>'id')=p_pet then v_pet else r end) into v_items from jsonb_array_elements(v_next->'pets') r;
   v_next:=jsonb_set(v_next,'{pets}',v_items);
   if coalesce(v_next->'pet'->>'dbId',v_next->'pet'->>'id')=p_pet then v_next:=jsonb_set(v_next,'{pet}',v_pet); end if;
   foreach v_key in array array['healthRecords','reminders','medicationCourses','medicationIntakes'] loop
     if jsonb_typeof(p_data->v_key) is distinct from 'array' or exists(select 1 from jsonb_array_elements(p_data->v_key) r where jsonb_typeof(r) is distinct from 'object' or r->>'petId' is distinct from p_pet or r->>'id' is null) then
        raise exception 'Invalid pet records' using errcode='22023'; end if;
     if v_key in ('healthRecords','reminders','medicationCourses') and exists(select 1 from jsonb_array_elements(p_data->v_key) r where jsonb_typeof(r->'name') is distinct from 'string') then raise exception 'Invalid record name' using errcode='22023';end if;
     if v_key='medicationCourses' and exists(select 1 from jsonb_array_elements(p_data->v_key) r where jsonb_typeof(r->'times') is distinct from 'array' or jsonb_typeof(r->'dosage') is distinct from 'string') then raise exception 'Invalid course' using errcode='22023';end if;
     if v_key='medicationIntakes' and exists(select 1 from jsonb_array_elements(p_data->v_key) r where coalesce(r->>'status','') not in ('taken','skipped')) then raise exception 'Invalid intake' using errcode='22023';end if;
     select coalesce(jsonb_agg(r),'[]') into v_items from jsonb_array_elements(coalesce(v_next->v_key,'[]')) r where r->>'petId' is distinct from p_pet;
     v_next:=jsonb_set(v_next,array[v_key],v_items||(p_data->v_key));
   end loop;
   update public.petcare_data set data=v_next where user_id=p_owner returning * into v_row;
 end if;
 return jsonb_build_object('conflict',false,'revision',v_row.revision,'data',petcare_private.pet_slice(v_row.data,p_pet));
end $function$;

CREATE OR REPLACE FUNCTION petcare_private.backup_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
    insert into petcare_private.profile_backups(user_id,revision,data,payload_bytes) values(new.user_id,new.revision,new.data,octet_length(new.data::text)) on conflict do nothing;
    delete from petcare_private.profile_backups where user_id=new.user_id and id not in
        (select id from petcare_private.profile_backups where user_id=new.user_id order by revision desc limit 30);
    delete from petcare_private.profile_backups where user_id=new.user_id and id in
        (select id from (select id,revision,sum(payload_bytes) over(order by revision desc) as cumulative from petcare_private.profile_backups where user_id=new.user_id) versions where cumulative>67108864 and revision<>new.revision);
    return new;
end $function$;

-- The existing BEFORE trigger now enforces the account-aware size guard.
-- Keep shape validation even for accounts exempt from the byte quota.
alter table public.petcare_data
    drop constraint petcare_data_payload_guard,
    drop constraint petcare_profile_payload,
    add constraint petcare_data_payload_guard check (jsonb_typeof(data) = 'object'),
    add constraint petcare_profile_payload check (jsonb_typeof(data) = 'object');
