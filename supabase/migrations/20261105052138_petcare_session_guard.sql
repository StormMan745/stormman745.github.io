-- A valid signature alone does not imply a session still exists after sign-out.
-- auth.sessions belongs to Auth; this migration only reads it.
create or replace function petcare_private.account_active() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.sessions s where s.user_id=auth.uid()
   and s.id::text=coalesce(auth.jwt()->>'session_id','')
   and (s.not_after is null or s.not_after>now()));
$$;

-- Signal revoked sessions as errors, never as an empty profile/document list.
-- Otherwise an offline client could mistake access denial for remote deletion.
create function petcare_private.require_session() returns boolean
language plpgsql stable security definer set search_path='' as $$begin
 if not petcare_private.account_active() then raise exception 'Authentication required' using errcode='42501'; end if;
 return true;
end$$;
revoke all on function petcare_private.require_session() from public,anon;
grant execute on function petcare_private.require_session() to authenticated;
create function public.petcare_require_session() returns boolean
language sql stable security invoker set search_path='' as $$select petcare_private.require_session()$$;
revoke all on function public.petcare_require_session() from public,anon;
grant execute on function public.petcare_require_session() to authenticated;

-- Owner RLS still applies. This additional restrictive gate also covers Storage
-- through the existing petcare_account_active policy. Service cron remains exempt.
create policy "Require active session" on public.petcare_data as restrictive for all to authenticated
 using ((select public.petcare_require_session())) with check ((select public.petcare_require_session()));
create policy "Require active session" on public.petcare_documents as restrictive for all to authenticated
 using ((select public.petcare_require_session())) with check ((select public.petcare_require_session()));
create policy "Require active session" on public.pets as restrictive for all to authenticated
 using ((select public.petcare_require_session())) with check ((select public.petcare_require_session()));

-- All client profile writes must carry the observed revision through the RPC.
revoke insert,update on public.petcare_data from authenticated;
alter table public.petcare_data add constraint petcare_profile_payload
 check(jsonb_typeof(data)='object' and octet_length(data::text)<=16777216) not valid;
alter table public.petcare_data validate constraint petcare_profile_payload;

create or replace function petcare_private.sync_profile(p_revision bigint,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_row public.petcare_data%rowtype;
begin
    if not petcare_private.account_active() then raise exception 'Authentication required' using errcode='42501'; end if;
    if p_revision is null or p_revision<0 or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>16777216 then raise exception 'Invalid profile' using errcode='22023'; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_user::text,42));
    select * into v_row from public.petcare_data where user_id=v_user for update;
    if coalesce(v_row.revision,0)<>p_revision then
        return jsonb_build_object('conflict',true,'data',coalesce(v_row.data,'{}'::jsonb),'revision',coalesce(v_row.revision,0));
    end if;
    insert into public.petcare_data(user_id,data) values(v_user,p_data)
      on conflict(user_id) do update set data=excluded.data returning * into v_row;
    return jsonb_build_object('conflict',false,'data',v_row.data,'revision',v_row.revision);
end $$;

create or replace function petcare_private.care_profile(p_owner uuid,p_pet text,p_revision bigint default null,p_data jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
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
   if jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>16777216 then raise exception 'Invalid data' using errcode='22023'; end if;
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
end $$;

create or replace function petcare_private.consume_request(p_action text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
    v_user uuid := auth.uid();
    v_now timestamptz := clock_timestamp();
    v_minute timestamptz := date_trunc('minute', v_now);
    v_day timestamptz := date_trunc('day', v_now at time zone 'UTC') at time zone 'UTC';
    v_minute_limit integer;
    v_day_limit integer;
    v_row petcare_private.request_limits%rowtype;
    v_retry integer;
begin
    if not petcare_private.account_active() then raise exception 'Authentication required' using errcode = '42501'; end if;
    case p_action
        when 'chat' then v_minute_limit := 12; v_day_limit := 250;
        when 'profile-status' then v_minute_limit := 60; v_day_limit := 3000;
        when 'push-register' then v_minute_limit := 30; v_day_limit := 500;
        else raise exception 'Invalid request action' using errcode = '22023';
    end case;
    insert into petcare_private.request_limits(user_id, action, minute_started, day_started)
        values(v_user, p_action, v_minute, v_day) on conflict do nothing;
    select * into strict v_row from petcare_private.request_limits
        where user_id = v_user and action = p_action for update;
    if v_row.minute_started <> v_minute then v_row.minute_count := 0; end if;
    if v_row.day_started <> v_day then v_row.day_count := 0; end if;
    if v_row.day_count >= v_day_limit then
        v_retry := greatest(1, ceil(extract(epoch from (v_day + interval '1 day' - v_now)))::integer);
    elsif v_row.minute_count >= v_minute_limit then
        v_retry := greatest(1, ceil(extract(epoch from (v_minute + interval '1 minute' - v_now)))::integer);
    end if;
    if v_retry is not null then return jsonb_build_object('allowed', false, 'retryAfter', v_retry); end if;
    update petcare_private.request_limits set minute_started = v_minute, day_started = v_day,
        minute_count = v_row.minute_count + 1, day_count = v_row.day_count + 1
        where user_id = v_user and action = p_action;
    return jsonb_build_object('allowed', true, 'retryAfter', 0);
end;
$$;

create or replace function petcare_private.unregister_push(p_endpoint text) returns void
language plpgsql security definer set search_path = '' as $$
begin
    if not petcare_private.account_active() then raise exception 'Authentication required' using errcode = '42501'; end if;
    delete from public.petcare_push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end;
$$;

create or replace function petcare_private.has_push(p_endpoint text) returns boolean
language sql stable security definer set search_path = '' as $$
    select petcare_private.account_active() and exists(select 1 from public.petcare_push_subscriptions where endpoint = p_endpoint and user_id = auth.uid());
$$;
