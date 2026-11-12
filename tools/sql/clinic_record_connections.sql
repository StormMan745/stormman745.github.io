-- Isolated fixtures, no existing account records are touched. Always roll back.
begin;
set local statement_timeout='30s';
do $test$
declare a uuid:='e1000000-0000-4000-8000-000000000001';b uuid:='e1000000-0000-4000-8000-000000000002';
 c uuid;reply jsonb;payload jsonb:='{"type":"Ветеринар","name":"Test visit","date":"2026-11-12","petId":"wrong","id":"wrong","source":{"kind":"forged"}}';
 h text:=repeat('a',64);ph text:=repeat('b',64);n integer;
begin
 if exists(select 1 from auth.users where id in(a,b)) then raise exception 'Fixture IDs already exist';end if;
 insert into auth.users(id,raw_app_meta_data,created_at,updated_at) values(a,'{}',now(),now()),(b,'{}',now(),now());
 insert into public.petcare_data(user_id,data) values(a,'{"pets":[{"id":"pet-a","name":"Test pet"}],"healthRecords":[]}'),(b,'{"pets":[{"id":"pet-b","name":"Other"}],"healthRecords":[]}');
 -- Exercise the same restricted role as the deployed endpoint, not postgres.
 perform set_config('role','service_role',true);
 reply:=public.petcare_clinic_connect(a,'pet-a','Test clinic',h);c:=(reply->>'id')::uuid;
 if c is null then raise exception 'Creation failed';end if;
 if public.petcare_clinic_connect(b,'pet-a','Foreign',repeat('c',64))->>'error' is distinct from 'pet_not_found' then raise exception 'Foreign pet accepted';end if;
 reply:=public.petcare_clinic_receive(h,'visit-1',ph,payload);
 if reply->>'accepted' is distinct from 'true' or reply->>'duplicate'<>'false' then raise exception 'Event not received';end if;
 if not exists(select 1 from public.petcare_data where user_id=a and data->'healthRecords'->0->>'petId'='pet-a'
   and data->'healthRecords'->0->>'id'<>'wrong' and data->'healthRecords'->0->'source'->>'kind'='clinic-connection') then raise exception 'Scope not enforced';end if;
 if exists(select 1 from public.petcare_data where user_id=b and jsonb_array_length(data->'healthRecords')<>0) then raise exception 'Foreign account changed';end if;
 reply:=public.petcare_clinic_receive(h,'visit-1',ph,payload);if reply->>'duplicate'<>'true' then raise exception 'Duplicate accepted twice';end if;
 if public.petcare_clinic_receive(h,'visit-1',repeat('d',64),payload)->>'error' is distinct from 'event_conflict' then raise exception 'Conflicting event not rejected';end if;
 -- Removing an imported record must not cause a retry to resurrect it.
 update public.petcare_data set data=jsonb_set(data,'{healthRecords}','[]') where user_id=a;
 perform public.petcare_clinic_receive(h,'visit-1',ph,payload);
 if exists(select 1 from public.petcare_data where user_id=a and jsonb_array_length(data->'healthRecords')<>0) then raise exception 'Deleted record resurrected';end if;
 if public.petcare_clinic_revoke(b,c) then raise exception 'Other account revoked consent';end if;
 update petcare_private.clinic_connections set minute_started=date_trunc('minute',now()),minute_count=60 where id=c;
 if public.petcare_clinic_receive(h,'visit-2',ph,payload)->>'error' is distinct from 'rate_limited' then raise exception 'Rate limit failed';end if;
 update petcare_private.clinic_connections set minute_count=0 where id=c;
 perform public.petcare_clinic_revoke(a,c);
 if public.petcare_clinic_receive(h,'visit-2',ph,payload)->>'error' is distinct from 'connection_unavailable' then raise exception 'Revoked key still active';end if;
 reply:=public.petcare_clinic_connect(a,'pet-a','Second clinic',repeat('e',64));c:=(reply->>'id')::uuid;
 update public.petcare_data set data=jsonb_set(data,'{pets}','[]') where user_id=a;
 if (select revoked_at from petcare_private.clinic_connections where id=c) is null then raise exception 'Pet deletion failed to revoke';end if;
 if public.petcare_clinic_receive(repeat('e',64),'visit-2',ph,payload)->>'error' is distinct from 'connection_unavailable' then raise exception 'Deleted pet key active';end if;
 if has_function_privilege('authenticated','public.petcare_clinic_receive(text,text,text,jsonb)','execute')
 or has_function_privilege('anon','public.petcare_clinic_connect(uuid,text,text,text)','execute')
 or has_table_privilege('authenticated','petcare_private.clinic_connections','select') then raise exception 'Client access exposed';end if;
 if public.petcare_clinic_connections(a,'pet-a')::text like '%token_hash%' then raise exception 'Owner listing exposed token hash';end if;
 if has_table_privilege('service_role','auth.users','select') then raise exception 'Service role gained broad Auth access';end if;
end $test$;
rollback;
select 'PASS: scoped consent, automatic record save, duplicate/conflict handling, deletion tombstones, revocation, quotas, pet cleanup, private keys and client privileges. Fixture data rolled back.' as result;
