begin;
insert into auth.users(id) values('a6000000-0000-4000-8000-000000000001');
insert into public.petcare_vet_shares(id,user_id,pet_id,token_hash,snapshot,expires_at)
 values('d6000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001','test',repeat('6',64),'{}',now()+interval '1 hour');
set local role anon;
do $$begin
 begin perform public.petcare_consume_vet_share('d6000000-0000-4000-8000-000000000001','view');raise exception 'Anonymous quota access';exception when insufficient_privilege then null;end;
end$$;
reset role;
set local role authenticated;
do $$begin
 begin perform public.petcare_consume_vet_share('d6000000-0000-4000-8000-000000000001','view');raise exception 'Client resets quota';exception when insufficient_privilege then null;end;
 begin delete from petcare_private.vet_share_limits;raise exception 'Client erases quota';exception when insufficient_privilege then null;end;
end$$;
reset role;
set local role service_role;
do $$declare r jsonb;begin
 for n in 1..30 loop
  r:=public.petcare_consume_vet_share('d6000000-0000-4000-8000-000000000001','download');
  if r->>'allowed'<>'true' then raise exception 'Download rejected below budget';end if;
 end loop;
 r:=public.petcare_consume_vet_share('d6000000-0000-4000-8000-000000000001','download');
 if r->>'allowed'<>'false' or (r->>'retryAfter')::integer not between 1 and 60 then raise exception 'Download flood not limited';end if;
 if public.petcare_consume_vet_share('d6000000-0000-4000-8000-000000000001','view')->>'allowed'<>'true' then raise exception 'Independent view budget rejected';end if;
 if public.petcare_consume_vet_share('d6000000-0000-4000-8000-000000000002','view')->>'unavailable'<>'true' then raise exception 'Missing share accepted';end if;
 begin perform public.petcare_consume_vet_share('d6000000-0000-4000-8000-000000000001','other');raise exception 'Unknown budget accepted';exception when invalid_parameter_value then null;end;
end$$;
reset role;
do $$begin if (select count(*) from petcare_private.vet_share_limits where share_id='d6000000-0000-4000-8000-000000000002')<>0 then raise exception 'Random share allocated storage';end if;end$$;
update petcare_private.vet_share_limits set minute_started=now()-interval '2 minutes' where action='download' and share_id='d6000000-0000-4000-8000-000000000001';
set local role service_role;
do $$begin if public.petcare_consume_vet_share('d6000000-0000-4000-8000-000000000001','download')->>'allowed'<>'true' then raise exception 'Minute budget did not recover';end if;end$$;
reset role;
update petcare_private.vet_share_limits set day_count=500 where action='download' and share_id='d6000000-0000-4000-8000-000000000001';
set local role service_role;
do $$declare r jsonb;begin
 r:=public.petcare_consume_vet_share('d6000000-0000-4000-8000-000000000001','download');
 if r->>'allowed'<>'false' or (r->>'retryAfter')::integer not between 1 and 86400 then raise exception 'Daily flood not limited';end if;
end$$;
reset role;
update public.petcare_vet_shares set revoked_at=now() where id='d6000000-0000-4000-8000-000000000001';
set local role service_role;
do $$begin if public.petcare_consume_vet_share('d6000000-0000-4000-8000-000000000001','view')->>'unavailable'<>'true' then raise exception 'Revoked share accepted';end if;end$$;
reset role;
delete from auth.users where id='a6000000-0000-4000-8000-000000000001';
do $$begin if exists(select 1 from petcare_private.vet_share_limits where share_id='d6000000-0000-4000-8000-000000000001') then raise exception 'Counters not removed with share';end if;end$$;
rollback;
