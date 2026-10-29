-- This cache contains public clinic listings, never pet profiles or account IDs.
create table public.petcare_clinic_api_state (
  id text primary key check (id = 'directory'),
  endpoint text not null default 'https://nominatim.openstreetmap.org/search',
  next_allowed_at timestamptz not null default '-infinity',
  lease uuid
);
insert into public.petcare_clinic_api_state (id) values ('directory');
create table public.petcare_clinic_search_cache (
  cache_key text primary key check (length(cache_key) <= 80),
  payload jsonb not null check (octet_length(payload::text) < 250000),
  expires_at timestamptz not null
);
create index petcare_clinic_cache_expiry on public.petcare_clinic_search_cache (expires_at);
alter table public.petcare_clinic_api_state enable row level security;
alter table public.petcare_clinic_search_cache enable row level security;
revoke all on public.petcare_clinic_api_state, public.petcare_clinic_search_cache from public, anon, authenticated;
grant select, insert, update, delete on public.petcare_clinic_api_state, public.petcare_clinic_search_cache to service_role;
create policy clinic_state_server_only on public.petcare_clinic_api_state for all to service_role using (true) with check (true);
create policy clinic_cache_server_only on public.petcare_clinic_search_cache for all to service_role using (true) with check (true);

-- A shared lease serializes requests across all Edge instances and all users.
create function public.petcare_reserve_clinic_search(p_key text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare cached jsonb; cfg public.petcare_clinic_api_state; reservation uuid;
begin
  if length(p_key) > 80 then raise exception 'Invalid cache key'; end if;
  select payload into cached from public.petcare_clinic_search_cache where cache_key = p_key and expires_at > clock_timestamp();
  if cached is not null then return jsonb_build_object('cached', cached); end if;
  select * into cfg from public.petcare_clinic_api_state where id = 'directory' for update;
  if not found then raise exception 'Directory configuration missing'; end if;
  if cfg.next_allowed_at > clock_timestamp() then return jsonb_build_object('busy', true); end if;
  reservation := gen_random_uuid();
  update public.petcare_clinic_api_state set next_allowed_at = clock_timestamp() + interval '60 seconds', lease = reservation where id = 'directory';
  delete from public.petcare_clinic_search_cache where expires_at < clock_timestamp();
  return jsonb_build_object('lease', reservation, 'endpoint', cfg.endpoint);
end $$;

create function public.petcare_finish_clinic_search(p_key text, p_lease uuid, p_payload jsonb, p_backoff integer default 2)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.petcare_clinic_api_state
     set next_allowed_at = clock_timestamp() + make_interval(secs => greatest(2, least(p_backoff, 300))), lease = null
   where id = 'directory' and lease = p_lease;
  if found and p_payload is not null then
    insert into public.petcare_clinic_search_cache (cache_key, payload, expires_at)
    values (p_key, p_payload, clock_timestamp() + interval '15 minutes')
    on conflict (cache_key) do update set payload = excluded.payload, expires_at = excluded.expires_at;
  end if;
end $$;
revoke all on function public.petcare_reserve_clinic_search(text) from public, anon, authenticated;
revoke all on function public.petcare_finish_clinic_search(text, uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function public.petcare_reserve_clinic_search(text) to service_role;
grant execute on function public.petcare_finish_clinic_search(text, uuid, jsonb, integer) to service_role;
