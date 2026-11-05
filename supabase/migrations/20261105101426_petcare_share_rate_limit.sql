-- Bound work for already-valid public veterinary links. Invalid/random tokens
-- never allocate counters. Budgets are shared across all Edge Function instances.
create table petcare_private.vet_share_limits (
 share_id uuid not null references public.petcare_vet_shares(id) on delete cascade,
 action text not null check(action in ('view','download')),
 minute_started timestamptz not null, day_started timestamptz not null,
 minute_count integer not null default 0, day_count integer not null default 0,
 primary key(share_id,action)
);
alter table petcare_private.vet_share_limits enable row level security;
revoke all on petcare_private.vet_share_limits from public,anon,authenticated;

create function petcare_private.consume_vet_share(p_share uuid,p_action text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_now timestamptz:=clock_timestamp();
 v_minute timestamptz:=date_trunc('minute',v_now);
 v_day timestamptz:=date_trunc('day',v_now at time zone 'UTC') at time zone 'UTC';
 v_minute_limit integer; v_day_limit integer; v_retry integer;
 v_row petcare_private.vet_share_limits%rowtype;
begin
 case p_action
  when 'view' then v_minute_limit:=120;v_day_limit:=5000;
  when 'download' then v_minute_limit:=30;v_day_limit:=500;
  else raise exception 'Invalid share action' using errcode='22023';
 end case;
 -- Recheck revocation and expiry while serializing quota updates and revocation.
 perform 1 from public.petcare_vet_shares where id=p_share and revoked_at is null and expires_at>v_now for update;
 if not found then return jsonb_build_object('unavailable',true);end if;
 insert into petcare_private.vet_share_limits(share_id,action,minute_started,day_started)
  values(p_share,p_action,v_minute,v_day) on conflict do nothing;
 select * into strict v_row from petcare_private.vet_share_limits where share_id=p_share and action=p_action for update;
 if v_row.minute_started<>v_minute then v_row.minute_count:=0;end if;
 if v_row.day_started<>v_day then v_row.day_count:=0;end if;
 if v_row.day_count>=v_day_limit then
  v_retry:=greatest(1,ceil(extract(epoch from (v_day+interval '1 day'-v_now)))::integer);
 elsif v_row.minute_count>=v_minute_limit then
  v_retry:=greatest(1,ceil(extract(epoch from (v_minute+interval '1 minute'-v_now)))::integer);
 end if;
 if v_retry is not null then return jsonb_build_object('allowed',false,'retryAfter',v_retry);end if;
 update petcare_private.vet_share_limits set minute_started=v_minute,day_started=v_day,
  minute_count=v_row.minute_count+1,day_count=v_row.day_count+1 where share_id=p_share and action=p_action;
 return jsonb_build_object('allowed',true);
end$$;
revoke all on function petcare_private.consume_vet_share(uuid,text) from public,anon,authenticated;
grant execute on function petcare_private.consume_vet_share(uuid,text) to service_role;
create function public.petcare_consume_vet_share(p_share uuid,p_action text) returns jsonb
language sql security invoker set search_path='' as $$select petcare_private.consume_vet_share(p_share,p_action)$$;
revoke all on function public.petcare_consume_vet_share(uuid,text) from public,anon,authenticated;
grant execute on function public.petcare_consume_vet_share(uuid,text) to service_role;
