-- Keep privileged implementations outside the Data API's public schema.
create schema if not exists petcare_private;
revoke all on schema petcare_private from public, anon, authenticated;
grant usage on schema petcare_private to authenticated, service_role;

create table petcare_private.request_limits (
    user_id uuid not null references auth.users(id) on delete cascade,
    action text not null check (action in ('chat', 'profile-status', 'push-register')),
    minute_started timestamptz not null,
    day_started timestamptz not null,
    minute_count integer not null default 0,
    day_count integer not null default 0,
    primary key (user_id, action)
);
alter table petcare_private.request_limits enable row level security;
revoke all on petcare_private.request_limits from public, anon, authenticated;

create function petcare_private.consume_request(p_action text) returns jsonb
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
    if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
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
revoke all on function petcare_private.consume_request(text) from public, anon;
grant execute on function petcare_private.consume_request(text) to authenticated;

create function public.petcare_consume_request(p_action text) returns jsonb
language sql security invoker set search_path = '' as $$
    select petcare_private.consume_request(p_action);
$$;
revoke all on function public.petcare_consume_request(text) from public, anon;
grant execute on function public.petcare_consume_request(text) to authenticated;

create function petcare_private.register_push(p_subscription jsonb, p_timezone_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
    v_user uuid := auth.uid();
    v_endpoint text := p_subscription ->> 'endpoint';
    v_timezone text := coalesce(nullif(p_timezone_name, ''), 'UTC');
    v_limit jsonb;
begin
    if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
    if p_subscription is null or jsonb_typeof(p_subscription) <> 'object'
       or octet_length(p_subscription::text) > 8192
       or v_endpoint is null or length(v_endpoint) > 2048
       or v_endpoint !~ '^https://(fcm[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|([a-z0-9-]+[.])+push[.]apple[.]com|([a-z0-9-]+[.])+notify[.]windows[.]com)(:443)?/[^[:space:]#]*$'
       or jsonb_typeof(p_subscription -> 'keys') is distinct from 'object'
       or coalesce(p_subscription #>> '{keys,p256dh}', '') !~ '^[A-Za-z0-9_-]{87}=?$'
       or coalesce(p_subscription #>> '{keys,auth}', '') !~ '^[A-Za-z0-9_-]{22}={0,2}$' then
        raise exception 'Invalid push subscription' using errcode = '22023';
    end if;
    v_limit := petcare_private.consume_request('push-register');
    if not (v_limit ->> 'allowed')::boolean then raise exception 'Too many subscription requests' using errcode = 'P0001'; end if;
    perform pg_advisory_xact_lock(hashtextextended('petcare-push:' || v_user::text, 0));
    if exists(select 1 from public.petcare_push_subscriptions where endpoint = v_endpoint and user_id <> v_user) then
        raise exception 'Subscription belongs to another account' using errcode = '42501';
    end if;
    if not exists(select 1 from public.petcare_push_subscriptions where endpoint = v_endpoint)
       and (select count(*) from public.petcare_push_subscriptions where user_id = v_user) >= 20 then
        raise exception 'Device limit reached' using errcode = '22023';
    end if;
    if not exists(select 1 from pg_catalog.pg_timezone_names where name = v_timezone) then v_timezone := 'UTC'; end if;
    insert into public.petcare_push_subscriptions(endpoint, user_id, subscription, timezone_name, updated_at)
        values(v_endpoint, v_user, jsonb_build_object('endpoint',v_endpoint,'keys',p_subscription->'keys'),v_timezone,now())
        on conflict(endpoint) do update set subscription = excluded.subscription,
            timezone_name = excluded.timezone_name, updated_at = excluded.updated_at
        where public.petcare_push_subscriptions.user_id = v_user;
    if not found then raise exception 'Subscription belongs to another account' using errcode = '42501'; end if;
end;
$$;
create function petcare_private.unregister_push(p_endpoint text) returns void
language plpgsql security definer set search_path = '' as $$
begin
    if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
    delete from public.petcare_push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end;
$$;
create function petcare_private.has_push(p_endpoint text) returns boolean
language sql stable security definer set search_path = '' as $$
    select exists(select 1 from public.petcare_push_subscriptions where endpoint = p_endpoint and user_id = auth.uid());
$$;
revoke all on function petcare_private.register_push(jsonb,text), petcare_private.unregister_push(text), petcare_private.has_push(text) from public, anon;
grant execute on function petcare_private.register_push(jsonb,text), petcare_private.unregister_push(text), petcare_private.has_push(text) to authenticated, service_role;

create or replace function public.petcare_register_push_subscription(p_subscription jsonb, p_timezone_name text) returns void
language sql security invoker set search_path = '' as $$ select petcare_private.register_push(p_subscription,p_timezone_name); $$;
create or replace function public.petcare_unregister_push_subscription(p_endpoint text) returns void
language sql security invoker set search_path = '' as $$ select petcare_private.unregister_push(p_endpoint); $$;
create or replace function public.petcare_has_push_subscription(p_endpoint text) returns boolean
language sql stable security invoker set search_path = '' as $$ select petcare_private.has_push(p_endpoint); $$;
revoke all on function public.petcare_register_push_subscription(jsonb,text), public.petcare_unregister_push_subscription(text), public.petcare_has_push_subscription(text) from public, anon;
grant execute on function public.petcare_register_push_subscription(jsonb,text), public.petcare_unregister_push_subscription(text), public.petcare_has_push_subscription(text) to authenticated, service_role;

-- Existing private photos/videos keep their current ownership policies.
-- This legacy bucket is empty and has no references in current account profiles.
update storage.buckets set public = false, file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg','image/png','image/webp']::text[] where id = 'Photo';

-- Deny over-sized or malformed profile payloads at the database boundary.
alter table public.petcare_data add constraint petcare_data_payload_guard
    check(jsonb_typeof(data) = 'object' and octet_length(data::text) <= 16777216) not valid;
alter table public.petcare_data validate constraint petcare_data_payload_guard;

-- New objects must be explicitly granted, rather than inheriting public access.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema petcare_private revoke execute on functions from public, anon, authenticated;
revoke create on schema public from public, anon, authenticated;
