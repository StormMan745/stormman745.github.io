-- Clinics may append records only through a revocable, per-pet write token.
create table petcare_private.clinic_connections (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    pet_id text not null check (length(pet_id) between 1 and 160),
    clinic_name text not null check (length(trim(clinic_name)) between 1 and 120),
    token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default (now() + interval '1 year'),
    revoked_at timestamptz,
    last_received_at timestamptz,
    received_count integer not null default 0,
    minute_started timestamptz not null default date_trunc('minute',now()),
    minute_count integer not null default 0,
    day_started date not null default (now() at time zone 'UTC')::date,
    day_count integer not null default 0
);
create index clinic_connections_owner on petcare_private.clinic_connections(user_id,pet_id);
create table petcare_private.clinic_events (
    connection_id uuid not null references petcare_private.clinic_connections(id) on delete cascade,
    external_event_id text not null check (length(external_event_id) between 1 and 160),
    payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
    record_id text not null,
    received_at timestamptz not null default now(),
    primary key(connection_id,external_event_id)
);
alter table petcare_private.clinic_connections enable row level security;
alter table petcare_private.clinic_events enable row level security;
revoke all on petcare_private.clinic_connections,petcare_private.clinic_events from public,anon,authenticated;
grant select,insert,update,delete on petcare_private.clinic_connections,petcare_private.clinic_events to service_role;

create function public.petcare_clinic_connections(p_user uuid,p_pet text) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'clinic_name',c.clinic_name,'pet_id',c.pet_id,
   'created_at',c.created_at,'expires_at',c.expires_at,'revoked_at',c.revoked_at,
   'last_received_at',c.last_received_at,'received_count',c.received_count) order by c.created_at desc),'[]'::jsonb)
 from petcare_private.clinic_connections c where c.user_id=p_user and c.pet_id=p_pet;
$$;
create function public.petcare_clinic_connect(p_user uuid,p_pet text,p_name text,p_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_id uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,42));
 if not exists(select 1 from public.petcare_data d cross join lateral jsonb_array_elements(d.data->'pets') p
   where d.user_id=p_user and coalesce(p->>'dbId',p->>'id')=p_pet and coalesce((p->>'isPlaceholder')::boolean,false)=false) then
   return jsonb_build_object('error','pet_not_found');
 end if;
 if (select count(*) from petcare_private.clinic_connections where user_id=p_user and revoked_at is null and expires_at>now())>=50 then
   return jsonb_build_object('error','connection_limit');
 end if;
 insert into petcare_private.clinic_connections(user_id,pet_id,clinic_name,token_hash)
 values(p_user,p_pet,trim(p_name),p_hash) returning id into v_id;
 return jsonb_build_object('id',v_id);
end $$;
create function public.petcare_clinic_revoke(p_user uuid,p_id uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare v_changed integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,42));
 update petcare_private.clinic_connections set revoked_at=coalesce(revoked_at,now()) where id=p_id and user_id=p_user;
 get diagnostics v_changed=row_count; return v_changed=1;
end $$;

-- The service role cannot read auth.users. Expose only an internal boolean check.
create function petcare_private.clinic_owner_enabled(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where id=p_user and (banned_until is null or banned_until<=now()));
$$;
revoke all on function petcare_private.clinic_owner_enabled(uuid) from public,anon,authenticated;
grant execute on function petcare_private.clinic_owner_enabled(uuid) to service_role;

create function public.petcare_clinic_receive(p_hash text,p_event text,p_payload_hash text,p_record jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_user uuid;v_connection petcare_private.clinic_connections%rowtype;v_account public.petcare_data%rowtype;
 v_existing petcare_private.clinic_events%rowtype;v_id text;v_now timestamptz:=clock_timestamp();v_record jsonb;
begin
 if p_hash !~ '^[a-f0-9]{64}$' or length(p_event) not between 1 and 160 or p_payload_hash !~ '^[a-f0-9]{64}$'
   or jsonb_typeof(p_record) is distinct from 'object' or octet_length(p_record::text)>65536 then
   return jsonb_build_object('error','invalid_record');
 end if;
 select user_id into v_user from petcare_private.clinic_connections where token_hash=p_hash and revoked_at is null and expires_at>v_now;
 if v_user is null then return jsonb_build_object('error','connection_unavailable');end if;
 -- Match the existing profile sync lock order; a concurrent edit cannot be lost.
 perform pg_advisory_xact_lock(hashtextextended(v_user::text,42));
 select * into v_connection from petcare_private.clinic_connections where token_hash=p_hash for update;
 if v_connection.revoked_at is not null or v_connection.expires_at<=v_now or not petcare_private.clinic_owner_enabled(v_user) then
   return jsonb_build_object('error','connection_unavailable');
 end if;
 select * into v_account from public.petcare_data where user_id=v_user for update;
 if not exists(select 1 from jsonb_array_elements(coalesce(v_account.data->'pets','[]')) p
   where coalesce(p->>'dbId',p->>'id')=v_connection.pet_id) then
   return jsonb_build_object('error','connection_unavailable');
 end if;
 if (v_connection.minute_started=date_trunc('minute',v_now) and v_connection.minute_count>=60)
   or (v_connection.day_started=(v_now at time zone 'UTC')::date and v_connection.day_count>=1000) then
   return jsonb_build_object('error','rate_limited');
 end if;
 update petcare_private.clinic_connections set
   minute_count=case when minute_started=date_trunc('minute',v_now) then minute_count+1 else 1 end,
   minute_started=date_trunc('minute',v_now),day_count=case when day_started=(v_now at time zone 'UTC')::date then day_count+1 else 1 end,
   day_started=(v_now at time zone 'UTC')::date where id=v_connection.id;
 select * into v_existing from petcare_private.clinic_events where connection_id=v_connection.id and external_event_id=p_event;
 if found then
   if v_existing.payload_hash<>p_payload_hash then return jsonb_build_object('error','event_conflict');end if;
   return jsonb_build_object('accepted',true,'duplicate',true,'recordId',v_existing.record_id);
 end if;
 if not coalesce(p_record->>'type' in ('Ветеринар','Анализы'),false) or jsonb_typeof(p_record->'name') is distinct from 'string'
   or length(trim(p_record->>'name')) not between 1 and 160 or jsonb_typeof(p_record->'date') is distinct from 'string' or p_record->>'date' !~ '^\d{4}-\d{2}-\d{2}$' then
   return jsonb_build_object('error','invalid_record');
 end if;
 perform (p_record->>'date')::date;
 v_id:='clinic-'||gen_random_uuid()::text;
 v_record:=p_record||jsonb_build_object('id',v_id,'petId',v_connection.pet_id,'photos','[]'::jsonb,
   'clinic',v_connection.clinic_name,'importedAt',v_now,'source',jsonb_build_object('kind','clinic-connection',
   'connectionId',v_connection.id,'clinicName',v_connection.clinic_name,'eventId',p_event));
 begin
   update public.petcare_data set data=jsonb_set(data,'{healthRecords}',coalesce(data->'healthRecords','[]'::jsonb)||jsonb_build_array(v_record)) where user_id=v_user;
 exception when sqlstate '22023' or check_violation then
   -- Keep the attempt counter, but roll back the profile write and its triggers.
   return jsonb_build_object('error','profile_limit_or_invalid_record');
 end;
 insert into petcare_private.clinic_events(connection_id,external_event_id,payload_hash,record_id)
   values(v_connection.id,p_event,p_payload_hash,v_id);
 update petcare_private.clinic_connections set last_received_at=v_now,received_count=received_count+1 where id=v_connection.id;
 return jsonb_build_object('accepted',true,'duplicate',false,'recordId',v_id);
end $$;
revoke all on function public.petcare_clinic_connections(uuid,text),public.petcare_clinic_connect(uuid,text,text,text),
 public.petcare_clinic_revoke(uuid,uuid),public.petcare_clinic_receive(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.petcare_clinic_connections(uuid,text),public.petcare_clinic_connect(uuid,text,text,text),
 public.petcare_clinic_revoke(uuid,uuid),public.petcare_clinic_receive(text,text,text,jsonb) to service_role;

-- Pet deletion revokes its clinic consent in the same profile transaction.
create or replace function petcare_private.revoke_removed_pet_access() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_pet jsonb;v_key text;begin
 for v_pet in select value from jsonb_array_elements(coalesce(old.data->'pets','[]')) loop
  v_key:=coalesce(v_pet->>'dbId',v_pet->>'id');
  if not exists(select 1 from jsonb_array_elements(coalesce(new.data->'pets','[]')) p where coalesce(p->>'dbId',p->>'id')=v_key) then
   delete from public.petcare_care_members where owner_id=new.user_id and pet_id=v_key;
   update public.petcare_care_invites set revoked_at=now() where owner_id=new.user_id and pet_id=v_key and revoked_at is null;
   update public.petcare_vet_shares set revoked_at=now() where user_id=new.user_id and pet_id=v_key and revoked_at is null;
   update petcare_private.clinic_connections set revoked_at=now() where user_id=new.user_id and pet_id=v_key and revoked_at is null;
  end if;
 end loop;return new;
end $$;
