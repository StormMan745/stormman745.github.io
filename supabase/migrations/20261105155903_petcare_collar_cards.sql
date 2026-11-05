-- Public cards expose a separately confirmed snapshot, never the account JSON.
create table public.petcare_collar_cards (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 pet_id text not null check(length(pet_id) between 1 and 160),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 card jsonb not null check(jsonb_typeof(card)='object' and octet_length(card::text)<=32000),
 revoked_at timestamptz,
 updated_at timestamptz not null default now(),
 unique(user_id,pet_id)
);
alter table public.petcare_collar_cards enable row level security;
revoke all on public.petcare_collar_cards from public,anon,authenticated;
grant select,insert,update,delete on public.petcare_collar_cards to service_role;

create table petcare_private.collar_limits (
 card_id uuid primary key references public.petcare_collar_cards(id) on delete cascade,
 minute_started timestamptz not null, day_started timestamptz not null,
 minute_count integer not null default 0, day_count integer not null default 0
);
alter table petcare_private.collar_limits enable row level security;
revoke all on petcare_private.collar_limits from public,anon,authenticated;
create function petcare_private.consume_collar(p_card uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_now timestamptz:=clock_timestamp(); v_minute timestamptz:=date_trunc('minute',v_now);
 v_day timestamptz:=date_trunc('day',v_now at time zone 'UTC') at time zone 'UTC';
 v_retry integer; v_row petcare_private.collar_limits%rowtype;
begin
 perform 1 from public.petcare_collar_cards where id=p_card and revoked_at is null for update;
 if not found then return jsonb_build_object('unavailable',true);end if;
 insert into petcare_private.collar_limits(card_id,minute_started,day_started) values(p_card,v_minute,v_day) on conflict do nothing;
 select * into strict v_row from petcare_private.collar_limits where card_id=p_card for update;
 if v_row.minute_started<>v_minute then v_row.minute_count:=0;end if;
 if v_row.day_started<>v_day then v_row.day_count:=0;end if;
 if v_row.day_count>=5000 then v_retry:=greatest(1,ceil(extract(epoch from(v_day+interval '1 day'-v_now)))::integer);
 elsif v_row.minute_count>=120 then v_retry:=greatest(1,ceil(extract(epoch from(v_minute+interval '1 minute'-v_now)))::integer);end if;
 if v_retry is not null then return jsonb_build_object('allowed',false,'retryAfter',v_retry);end if;
 update petcare_private.collar_limits set minute_started=v_minute,day_started=v_day,minute_count=v_row.minute_count+1,day_count=v_row.day_count+1 where card_id=p_card;
 return jsonb_build_object('allowed',true);
end$$;
revoke all on function petcare_private.consume_collar(uuid) from public,anon,authenticated;
grant execute on function petcare_private.consume_collar(uuid) to service_role;
create function public.petcare_consume_collar(p_card uuid) returns jsonb
language sql security invoker set search_path='' as $$select petcare_private.consume_collar(p_card)$$;
revoke all on function public.petcare_consume_collar(uuid) from public,anon,authenticated;
grant execute on function public.petcare_consume_collar(uuid) to service_role;

-- Removing a pet, including via sync from another device, retires its public QR.
create function petcare_private.cleanup_collar_cards() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 delete from public.petcare_collar_cards c where c.user_id=new.user_id and not exists
  (select 1 from jsonb_array_elements(coalesce(new.data->'pets','[]'::jsonb)) p
   where coalesce(p->>'dbId',p->>'id','')=c.pet_id);
 return new;
end$$;
revoke all on function petcare_private.cleanup_collar_cards() from public,anon,authenticated;
create trigger petcare_collar_cleanup after update of data on public.petcare_data
 for each row execute function petcare_private.cleanup_collar_cards();
