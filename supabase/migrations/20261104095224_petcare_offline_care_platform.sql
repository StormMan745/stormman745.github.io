-- Optimistic concurrency prevents offline devices from replacing newer profiles.
alter table public.petcare_data add column revision bigint not null default 0;
alter table public.petcare_documents add column deleted_at timestamptz;
alter table public.petcare_documents add column revision bigint not null default 1;
grant update (deleted_at) on public.petcare_documents to authenticated;
create function petcare_private.document_revision() returns trigger language plpgsql set search_path='' as $$begin new.revision:=old.revision+1;return new;end$$;
revoke all on function petcare_private.document_revision() from public,anon,authenticated;
create trigger petcare_document_revision before update on public.petcare_documents for each row execute function petcare_private.document_revision();

create table petcare_private.profile_backups (
    id bigint generated always as identity primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    revision bigint not null,
    data jsonb not null,
    payload_bytes integer not null,
    created_at timestamptz not null default now(),
    unique(user_id,revision)
);
create index profile_backups_created_idx on petcare_private.profile_backups(created_at);
alter table petcare_private.profile_backups enable row level security;
revoke all on petcare_private.profile_backups from public,anon,authenticated;
create function petcare_private.profile_revision() returns trigger
language plpgsql security definer set search_path='' as $$
begin
    new.revision := case when tg_op='UPDATE' then old.revision+1 else 1 end;
    new.updated_at := clock_timestamp();
    return new;
end $$;
create function petcare_private.backup_profile() returns trigger
language plpgsql security definer set search_path='' as $$
begin
    insert into petcare_private.profile_backups(user_id,revision,data,payload_bytes) values(new.user_id,new.revision,new.data,octet_length(new.data::text)) on conflict do nothing;
    delete from petcare_private.profile_backups where user_id=new.user_id and id not in
        (select id from petcare_private.profile_backups where user_id=new.user_id order by revision desc limit 30);
    delete from petcare_private.profile_backups where user_id=new.user_id and id in
        (select id from (select id,sum(payload_bytes) over(order by revision desc) as cumulative from petcare_private.profile_backups where user_id=new.user_id) versions where cumulative>67108864);
    return new;
end $$;
revoke all on function petcare_private.profile_revision(),petcare_private.backup_profile() from public,anon,authenticated;
create trigger petcare_revision before insert or update on public.petcare_data for each row execute function petcare_private.profile_revision();
create trigger petcare_backup after insert or update on public.petcare_data for each row execute function petcare_private.backup_profile();
insert into petcare_private.profile_backups(user_id,revision,data,payload_bytes) select user_id,revision,data,octet_length(data::text) from public.petcare_data;

create function petcare_private.sync_profile(p_revision bigint,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_row public.petcare_data%rowtype;
begin
    if v_user is null or not exists(select 1 from auth.users where id=v_user) then raise exception 'Authentication required' using errcode='42501'; end if;
    if jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>16777216 then raise exception 'Invalid profile' using errcode='22023'; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_user::text,42));
    select * into v_row from public.petcare_data where user_id=v_user for update;
    if coalesce(v_row.revision,0)<>p_revision then
        return jsonb_build_object('conflict',true,'data',coalesce(v_row.data,'{}'::jsonb),'revision',coalesce(v_row.revision,0));
    end if;
    insert into public.petcare_data(user_id,data) values(v_user,p_data)
      on conflict(user_id) do update set data=excluded.data returning * into v_row;
    return jsonb_build_object('conflict',false,'data',v_row.data,'revision',v_row.revision);
end $$;
revoke all on function petcare_private.sync_profile(bigint,jsonb) from public,anon;
grant execute on function petcare_private.sync_profile(bigint,jsonb) to authenticated;
create function public.petcare_sync_profile(p_revision bigint,p_data jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select petcare_private.sync_profile(p_revision,p_data) $$;
revoke all on function public.petcare_sync_profile(bigint,jsonb) from public,anon;
grant execute on function public.petcare_sync_profile(bigint,jsonb) to authenticated;

create table public.petcare_vet_shares (
    id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
    pet_id text not null, token_hash text not null unique check(token_hash~'^[a-f0-9]{64}$'),
    snapshot jsonb not null check(octet_length(snapshot::text)<1048576), document_ids uuid[] not null default '{}',
    expires_at timestamptz not null check(expires_at<=created_at+interval '7 days'), revoked_at timestamptz,
    created_at timestamptz not null default now()
);
alter table public.petcare_vet_shares enable row level security;
revoke all on public.petcare_vet_shares from public,anon,authenticated;
grant select,insert,update,delete on public.petcare_vet_shares to service_role;
create index petcare_vet_shares_user_idx on public.petcare_vet_shares(user_id);
create table public.petcare_care_members (
    owner_id uuid not null references auth.users(id) on delete cascade, pet_id text not null,
    member_id uuid not null references auth.users(id) on delete cascade, created_at timestamptz not null default now(),
    primary key(owner_id,pet_id,member_id), check(owner_id<>member_id)
);
create index petcare_care_members_member_idx on public.petcare_care_members(member_id);
alter table public.petcare_care_members enable row level security;
revoke all on public.petcare_care_members from public,anon,authenticated;
grant all on public.petcare_care_members to service_role;
create table public.petcare_care_invites (
    id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
    pet_id text not null, token_hash text not null unique, expires_at timestamptz not null default now()+interval '7 days',
    used_by uuid references auth.users(id) on delete set null, revoked_at timestamptz, created_at timestamptz not null default now()
);
create index petcare_care_invites_owner_idx on public.petcare_care_invites(owner_id);
create index petcare_care_invites_used_idx on public.petcare_care_invites(used_by);
alter table public.petcare_care_invites enable row level security;
revoke all on public.petcare_care_invites from public,anon,authenticated;
grant all on public.petcare_care_invites to service_role;

-- Only these fields can cross a pet-sharing boundary. Chat, other pets, owner
-- profile, photos from other records, and account settings are never returned.
create function petcare_private.pet_slice(p_data jsonb,p_pet text) returns jsonb
language sql immutable set search_path='' as $$
select jsonb_build_object(
 'pet',(select pet from jsonb_array_elements(coalesce(p_data->'pets','[]')) pet where coalesce(pet->>'dbId',pet->>'id')=p_pet limit 1),
 'healthRecords',(select coalesce(jsonb_agg(r),'[]') from jsonb_array_elements(coalesce(p_data->'healthRecords','[]')) r where r->>'petId'=p_pet),
 'reminders',(select coalesce(jsonb_agg(r),'[]') from jsonb_array_elements(coalesce(p_data->'reminders','[]')) r where r->>'petId'=p_pet),
 'medicationCourses',(select coalesce(jsonb_agg(r),'[]') from jsonb_array_elements(coalesce(p_data->'medicationCourses','[]')) r where r->>'petId'=p_pet),
 'medicationIntakes',(select coalesce(jsonb_agg(r),'[]') from jsonb_array_elements(coalesce(p_data->'medicationIntakes','[]')) r where r->>'petId'=p_pet)
) $$;
revoke all on function petcare_private.pet_slice(jsonb,text) from public,anon,authenticated;

create function petcare_private.care_profile(p_owner uuid,p_pet text,p_revision bigint default null,p_data jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_row public.petcare_data%rowtype; v_next jsonb; v_key text; v_items jsonb; v_pet jsonb;
begin
 if v_user is null or not exists(select 1 from auth.users where id=v_user) or (v_user<>p_owner and not exists
   (select 1 from public.petcare_care_members where owner_id=p_owner and pet_id=p_pet and member_id=v_user)) then
   raise exception 'Access denied' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,42));
 select * into v_row from public.petcare_data where user_id=p_owner for update;
 if v_row.user_id is null or petcare_private.pet_slice(v_row.data,p_pet)->'pet'='null'::jsonb then raise exception 'Pet not found' using errcode='22023'; end if;
 if p_data is not null then
   if v_row.revision<>p_revision then return jsonb_build_object('conflict',true,'revision',v_row.revision,'data',petcare_private.pet_slice(v_row.data,p_pet)); end if;
   if jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>16777216 then raise exception 'Invalid data' using errcode='22023'; end if;
   v_next:=v_row.data;
   v_pet:=p_data->'pet';
   if v_pet is null or coalesce(v_pet->>'dbId',v_pet->>'id')<>p_pet then raise exception 'Invalid pet' using errcode='22023'; end if;
   if jsonb_typeof(v_pet->'name') is distinct from 'string' or length(trim(v_pet->>'name')) not between 1 and 160 then raise exception 'Invalid pet name' using errcode='22023';end if;
   select jsonb_agg(case when coalesce(r->>'dbId',r->>'id')=p_pet then v_pet else r end) into v_items from jsonb_array_elements(v_next->'pets') r;
   v_next:=jsonb_set(v_next,'{pets}',v_items);
   if coalesce(v_next->'pet'->>'dbId',v_next->'pet'->>'id')=p_pet then v_next:=jsonb_set(v_next,'{pet}',v_pet); end if;
   foreach v_key in array array['healthRecords','reminders','medicationCourses','medicationIntakes'] loop
     if jsonb_typeof(p_data->v_key) is distinct from 'array' or exists(select 1 from jsonb_array_elements(p_data->v_key) r where jsonb_typeof(r) is distinct from 'object' or r->>'petId' is distinct from p_pet or r->>'id' is null) then
        raise exception 'Invalid pet records' using errcode='22023'; end if;
     if v_key in ('healthRecords','reminders','medicationCourses') and exists(select 1 from jsonb_array_elements(p_data->v_key) r where jsonb_typeof(r->'name') is distinct from 'string') then raise exception 'Invalid record name' using errcode='22023';end if;
     if v_key='medicationCourses' and exists(select 1 from jsonb_array_elements(p_data->v_key) r where jsonb_typeof(r->'times') is distinct from 'array' or jsonb_typeof(r->'dosage') is distinct from 'string') then raise exception 'Invalid course' using errcode='22023';end if;
     if v_key='medicationIntakes' and exists(select 1 from jsonb_array_elements(p_data->v_key) r where r->>'status' not in ('taken','skipped')) then raise exception 'Invalid intake' using errcode='22023';end if;
     select coalesce(jsonb_agg(r),'[]') into v_items from jsonb_array_elements(coalesce(v_next->v_key,'[]')) r where r->>'petId' is distinct from p_pet;
     v_next:=jsonb_set(v_next,array[v_key],v_items||(p_data->v_key));
   end loop;
   update public.petcare_data set data=v_next where user_id=p_owner returning * into v_row;
 end if;
 return jsonb_build_object('conflict',false,'revision',v_row.revision,'data',petcare_private.pet_slice(v_row.data,p_pet));
end $$;
revoke all on function petcare_private.care_profile(uuid,text,bigint,jsonb) from public,anon;
grant execute on function petcare_private.care_profile(uuid,text,bigint,jsonb) to authenticated;
create function public.petcare_care_profile(p_owner uuid,p_pet text,p_revision bigint default null,p_data jsonb default null) returns jsonb
language sql security invoker set search_path='' as $$ select petcare_private.care_profile(p_owner,p_pet,p_revision,p_data) $$;
revoke all on function public.petcare_care_profile(uuid,text,bigint,jsonb) from public,anon;
grant execute on function public.petcare_care_profile(uuid,text,bigint,jsonb) to authenticated;

create table public.petcare_support_reports (
    id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
    message text not null check(length(message) between 1 and 3000), diagnostics jsonb not null check(octet_length(diagnostics::text)<8192),
    created_at timestamptz not null default now()
);
alter table public.petcare_support_reports enable row level security;
revoke all on public.petcare_support_reports from public,anon,authenticated;
grant all on public.petcare_support_reports to service_role;
create index petcare_support_reports_user_idx on public.petcare_support_reports(user_id);
create table public.petcare_analytics_consent (user_id uuid primary key references auth.users(id) on delete cascade,enabled boolean not null default false);
create table public.petcare_product_events (
    user_id uuid not null references auth.users(id) on delete cascade,
    event text not null check(event in ('pet_added','reminder_created','active')),
    day date not null default current_date, primary key(user_id,event,day)
);
alter table public.petcare_analytics_consent enable row level security;
alter table public.petcare_product_events enable row level security;
revoke all on public.petcare_analytics_consent,public.petcare_product_events from public,anon,authenticated;
grant all on public.petcare_analytics_consent,public.petcare_product_events to service_role;
create index petcare_product_events_day_idx on public.petcare_product_events(day);
create table public.petcare_error_events (
 user_id uuid not null references auth.users(id) on delete cascade,day date not null default current_date,
 code text not null check(code in ('script_error','unhandled_promise','file_sync_failed','file_list_unavailable','document_conflict','document_deleted','care_conflict','care_access_denied','profile_sync_failed','local_write_failed')),
 version text not null check(length(version)<=50),primary key(user_id,day,code)
);
alter table public.petcare_error_events enable row level security;
revoke all on public.petcare_error_events from public,anon,authenticated;
grant all on public.petcare_error_events to service_role;
create index petcare_error_events_day_idx on public.petcare_error_events(day);
create table petcare_private.health_checks (name text primary key,checked_at timestamptz not null default now(),ok boolean not null,detail jsonb not null default '{}');
alter table petcare_private.health_checks enable row level security;
revoke all on petcare_private.health_checks from public,anon,authenticated;

-- Service-only operations for the authenticated privacy function. No owner IDs
-- supplied by a browser are trusted; the function verifies the JWT first.
create function public.petcare_account_objects(p_user uuid) returns table(bucket_id text,name text)
language sql security invoker set search_path='' as $$
 select o.bucket_id,o.name from storage.objects o where o.owner_id=p_user::text or o.owner=p_user or split_part(o.name,'/',1)=p_user::text
$$;
revoke all on function public.petcare_account_objects(uuid) from public,anon,authenticated;
grant execute on function public.petcare_account_objects(uuid) to service_role;
create function public.petcare_account_backups(p_user uuid,p_id bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if p_id is null then return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision,'created_at',created_at) order by revision desc),'[]') from petcare_private.profile_backups where user_id=p_user); end if;
 return (select jsonb_build_object('data',data,'revision',revision) from petcare_private.profile_backups where user_id=p_user and id=p_id);
end $$;
revoke all on function public.petcare_account_backups(uuid,bigint) from public,anon,authenticated;
grant execute on function public.petcare_account_backups(uuid,bigint) to service_role;
create function petcare_private.check_backups() returns void
language plpgsql security definer set search_path='' as $$
begin
 insert into petcare_private.health_checks(name,ok,detail) values('profile_backups',
   not exists(select 1 from public.petcare_data d left join petcare_private.profile_backups b on b.user_id=d.user_id and b.revision=d.revision where b.id is null or b.data is distinct from d.data),
   jsonb_build_object('profiles',(select count(*) from public.petcare_data),'backups',(select count(*) from petcare_private.profile_backups)))
 on conflict(name) do update set checked_at=now(),ok=excluded.ok,detail=excluded.detail;
 delete from public.petcare_product_events where day<current_date-90;
 delete from public.petcare_error_events where day<current_date-90;
 delete from public.petcare_vet_shares where expires_at<now()-interval '30 days';
 delete from public.petcare_care_invites where expires_at<now()-interval '30 days';
end $$;
revoke all on function petcare_private.check_backups() from public,anon,authenticated;
select cron.schedule('petcare-backup-check','15 * * * *','select petcare_private.check_backups();');
select petcare_private.check_backups();

create table public.petcare_file_trash (
 user_id uuid not null references auth.users(id) on delete cascade,bucket_id text not null,path text not null,
 delete_after timestamptz not null default now()+interval '30 days',primary key(user_id,bucket_id,path)
);
alter table public.petcare_file_trash enable row level security;
revoke all on public.petcare_file_trash from public,anon,authenticated;
grant all on public.petcare_file_trash to service_role;
create index petcare_file_trash_due_idx on public.petcare_file_trash(delete_after);
create function public.petcare_accept_care(p_user uuid,p_hash text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare v public.petcare_care_invites%rowtype;
begin
 select * into v from public.petcare_care_invites where token_hash=p_hash and used_by is null and revoked_at is null and expires_at>now() for update;
 if v.id is null or v.owner_id=p_user then return false;end if;
 if not exists(select 1 from public.petcare_data where user_id=v.owner_id and exists(select 1 from jsonb_array_elements(data->'pets') p where coalesce(p->>'dbId',p->>'id')=v.pet_id)) then return false;end if;
 insert into public.petcare_care_members(owner_id,pet_id,member_id) values(v.owner_id,v.pet_id,p_user) on conflict do nothing;
 update public.petcare_care_invites set used_by=p_user where id=v.id;
 return true;
end $$;
revoke all on function public.petcare_accept_care(uuid,text) from public,anon,authenticated;
grant execute on function public.petcare_accept_care(uuid,text) to service_role;
create function petcare_private.account_active() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where id=auth.uid())
$$;
revoke all on function petcare_private.account_active() from public,anon;
grant execute on function petcare_private.account_active() to authenticated;
create function public.petcare_account_active() returns boolean language sql stable security invoker set search_path='' as $$select petcare_private.account_active()$$;
revoke all on function public.petcare_account_active() from public,anon;
grant execute on function public.petcare_account_active() to authenticated;
create policy "Deleted accounts cannot access storage" on storage.objects as restrictive for all to authenticated
 using ((select public.petcare_account_active())) with check ((select public.petcare_account_active()));
-- Old clients also cannot bypass the recoverable document trash.
revoke delete on public.petcare_documents from authenticated;
create policy "Medical originals use recoverable deletion" on storage.objects as restrictive for delete to authenticated
 using (bucket_id not in ('petcare-documents','petcare-stories'));
select cron.schedule('petcare-file-retention','20 3 * * *',$job$
 select net.http_post(
   url:='https://qexiyikdmdbdxgusqnee.supabase.co/functions/v1/petcare-platform',
   headers:=jsonb_build_object('Content-Type','application/json','x-petcare-cron-token',
      (select decrypted_secret from vault.decrypted_secrets where name='petcare_push_cron_token')),
   body:='{"action":"maintenance"}'::jsonb,timeout_milliseconds:=60000);
$job$);

create function public.petcare_claim_push_delivery(p_endpoint_hash text,p_notification_key text,p_user_id uuid,p_reminder_id text,p_due_date date) returns smallint
language sql security invoker set search_path='' as $$
 insert into public.petcare_push_delivery_log as log(endpoint_hash,notification_key,user_id,reminder_id,due_date,status,attempt_count,last_attempt_at)
 values(p_endpoint_hash,p_notification_key,p_user_id,p_reminder_id,p_due_date,'sending',1,clock_timestamp())
 on conflict(endpoint_hash,notification_key) do update set status='sending',attempt_count=log.attempt_count+1,last_attempt_at=clock_timestamp(),last_error=null
 where log.status in ('failed','sending') and log.attempt_count<5 and log.last_attempt_at<clock_timestamp()-interval '2 minutes'
 returning attempt_count;
$$;
revoke all on function public.petcare_claim_push_delivery(text,text,uuid,text,date) from public,anon,authenticated;
grant execute on function public.petcare_claim_push_delivery(text,text,uuid,text,date) to service_role;
do $$ declare v_id bigint;v_command text;begin
 select jobid,command into v_id,v_command from cron.job where jobname='petcare-push-reminders';
 if v_id is not null then perform cron.alter_job(v_id,command:=replace(v_command,'timeout_milliseconds := 10000','timeout_milliseconds := 60000'));end if;
end $$;
create function petcare_private.check_push_health() returns void language plpgsql security definer set search_path='' as $$
declare v_failed bigint;v_http_failed bigint;begin
 select count(*) into v_failed from public.petcare_push_delivery_log where status='failed' and last_attempt_at>now()-interval '24 hours';
 select count(*) into v_http_failed from net._http_response where created>now()-interval '15 minutes' and (timed_out or status_code>=400 or error_msg is not null);
 insert into petcare_private.health_checks(name,ok,detail) values('push_delivery',v_failed=0 and v_http_failed=0,jsonb_build_object('failed_24h',v_failed,'http_failures_15m',v_http_failed))
 on conflict(name) do update set checked_at=now(),ok=excluded.ok,detail=excluded.detail;
end $$;
revoke all on function petcare_private.check_push_health() from public,anon,authenticated;
select cron.schedule('petcare-push-health','*/5 * * * *','select petcare_private.check_push_health();');

create function public.petcare_revoke_care_invite(p_owner uuid,p_id uuid) returns boolean language plpgsql security invoker set search_path='' as $$
declare v public.petcare_care_invites%rowtype;begin
 select * into v from public.petcare_care_invites where id=p_id and owner_id=p_owner for update;
 if v.id is null then return false;end if;
 update public.petcare_care_invites set revoked_at=now() where id=v.id;
 if v.used_by is not null then delete from public.petcare_care_members where owner_id=p_owner and pet_id=v.pet_id and member_id=v.used_by;end if;
 return true;
end $$;
revoke all on function public.petcare_revoke_care_invite(uuid,uuid) from public,anon,authenticated;
grant execute on function public.petcare_revoke_care_invite(uuid,uuid) to service_role;
create function petcare_private.revoke_removed_pet_access() returns trigger language plpgsql security definer set search_path='' as $$
declare v_pet jsonb;v_key text;begin
 for v_pet in select value from jsonb_array_elements(coalesce(old.data->'pets','[]')) loop
  v_key:=coalesce(v_pet->>'dbId',v_pet->>'id');
  if not exists(select 1 from jsonb_array_elements(coalesce(new.data->'pets','[]')) p where coalesce(p->>'dbId',p->>'id')=v_key) then
   delete from public.petcare_care_members where owner_id=new.user_id and pet_id=v_key;
   update public.petcare_care_invites set revoked_at=now() where owner_id=new.user_id and pet_id=v_key and revoked_at is null;
   update public.petcare_vet_shares set revoked_at=now() where user_id=new.user_id and pet_id=v_key and revoked_at is null;
  end if;
 end loop;return new;
end $$;
revoke all on function petcare_private.revoke_removed_pet_access() from public,anon,authenticated;
create trigger petcare_removed_pet_access after update on public.petcare_data for each row execute function petcare_private.revoke_removed_pet_access();
create function petcare_private.recent_session(p_user uuid,p_session uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.sessions where id=p_session and user_id=p_user and created_at>now()-interval '2 minutes' and (not_after is null or not_after>now()))
$$;
revoke all on function petcare_private.recent_session(uuid,uuid) from public,anon,authenticated;
grant execute on function petcare_private.recent_session(uuid,uuid) to service_role;
create function public.petcare_recent_session(p_user uuid,p_session uuid) returns boolean language sql security invoker set search_path='' as $$select petcare_private.recent_session(p_user,p_session)$$;
revoke all on function public.petcare_recent_session(uuid,uuid) from public,anon,authenticated;
grant execute on function public.petcare_recent_session(uuid,uuid) to service_role;
