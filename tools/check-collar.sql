begin;
insert into auth.users(id) values('a7000000-0000-4000-8000-000000000001');
insert into public.petcare_collar_cards(id,user_id,pet_id,token_hash,card)
 values('d7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000001','test',repeat('7',64),'{"name":"Test","kind":"phone","contact":"+79001234567"}');
set local role anon;
do $$begin
 begin perform 1 from public.petcare_collar_cards;raise exception 'Anonymous lists contact cards';exception when insufficient_privilege then null;end;
 begin perform public.petcare_consume_collar('d7000000-0000-4000-8000-000000000001');raise exception 'Anonymous quota access';exception when insufficient_privilege then null;end;
end$$;
reset role;
set local role authenticated;
do $$begin
 begin update public.petcare_collar_cards set card='{}';raise exception 'Client edits public cards directly';exception when insufficient_privilege then null;end;
 begin delete from petcare_private.collar_limits;raise exception 'Client resets quotas';exception when insufficient_privilege then null;end;
 begin perform public.petcare_consume_collar('d7000000-0000-4000-8000-000000000001');raise exception 'Client invokes service function';exception when insufficient_privilege then null;end;
end$$;
reset role;
set local role service_role;
do $$declare r jsonb;begin
 for n in 1..120 loop
  if public.petcare_consume_collar('d7000000-0000-4000-8000-000000000001')->>'allowed'<>'true' then raise exception 'Valid read rejected';end if;
 end loop;
 r:=public.petcare_consume_collar('d7000000-0000-4000-8000-000000000001');
 if r->>'allowed'<>'false' or (r->>'retryAfter')::integer not between 1 and 60 then raise exception 'No minute limit';end if;
 if public.petcare_consume_collar('d7000000-0000-4000-8000-000000000002')->>'unavailable'<>'true' then raise exception 'Unknown card accepted';end if;
end$$;
reset role;
update petcare_private.collar_limits set minute_started=now()-interval '2 minutes',day_count=5000 where card_id='d7000000-0000-4000-8000-000000000001';
set local role service_role;
do $$begin
 if public.petcare_consume_collar('d7000000-0000-4000-8000-000000000001')->>'allowed'<>'false' then raise exception 'No daily limit';end if;
end$$;
reset role;
update public.petcare_collar_cards set revoked_at=now() where id='d7000000-0000-4000-8000-000000000001';
set local role service_role;
do $$begin if public.petcare_consume_collar('d7000000-0000-4000-8000-000000000001')->>'unavailable'<>'true' then raise exception 'Revoked card readable';end if;end$$;
reset role;
insert into public.petcare_data(user_id,data) values('a7000000-0000-4000-8000-000000000001','{"pets":[{"id":"test","name":"Synthetic"}]}');
update public.petcare_data set data='{"pets":[]}' where user_id='a7000000-0000-4000-8000-000000000001';
do $$begin if exists(select 1 from public.petcare_collar_cards where id='d7000000-0000-4000-8000-000000000001') then raise exception 'Pet deletion leaves public card';end if;end$$;
delete from auth.users where id='a7000000-0000-4000-8000-000000000001';
do $$begin if exists(select 1 from petcare_private.collar_limits where card_id='d7000000-0000-4000-8000-000000000001') then raise exception 'Account deletion leaves card';end if;end$$;
rollback;
