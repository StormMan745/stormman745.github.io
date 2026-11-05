-- Synthetic accounts only; all changes, including session revocation, roll back.
begin;
insert into auth.users(id) values ('a5000000-0000-4000-8000-000000000001'),('b5000000-0000-4000-8000-000000000002');
insert into auth.sessions(id,user_id,created_at) values ('c5000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001',now());
set local role authenticated;
select set_config('request.jwt.claim.sub','a5000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a5000000-0000-4000-8000-000000000001","session_id":"c5000000-0000-4000-8000-000000000001"}',true);
select public.petcare_sync_profile(0,'{"pets":[{"id":"test","name":"Test"}],"healthRecords":[],"reminders":[],"medicationCourses":[],"medicationIntakes":[]}');
insert into storage.objects(bucket_id,name) values ('petcare-documents','a5000000-0000-4000-8000-000000000001/test.pdf');
do $$ declare draft jsonb;begin
 if not public.petcare_account_active() then raise exception 'Valid session rejected';end if;
 if not exists(select 1 from public.petcare_data) then raise exception 'Valid profile invisible';end if;
 begin update public.petcare_data set data='{}';raise exception 'Direct write bypassed revision';exception when insufficient_privilege then null;end;
 begin insert into public.petcare_data(user_id,data) values(auth.uid(),'{}');raise exception 'Direct insert allowed';exception when insufficient_privilege then null;end;
 begin perform public.petcare_sync_profile(null,'{}');raise exception 'Null revision accepted';exception when invalid_parameter_value then null;end;
 begin perform public.petcare_sync_profile(1,null);raise exception 'Null profile accepted';exception when invalid_parameter_value then null;end;
 begin perform public.petcare_sync_profile(1,'[]');raise exception 'Array profile accepted';exception when invalid_parameter_value then null;end;
 draft:=public.petcare_care_profile(auth.uid(),'test')->'data';
 begin perform public.petcare_care_profile(auth.uid(),'test',null,draft);raise exception 'Shared null revision accepted';exception when invalid_parameter_value then null;end;
 begin perform public.petcare_care_profile(auth.uid(),'test',1,jsonb_set(draft,'{pet}','{"name":"Missing id"}'));raise exception 'Missing pet id accepted';exception when invalid_parameter_value then null;end;
end$$;
-- Expired sessions cannot read data even with a still-valid access JWT.
reset role;
update auth.sessions set not_after=now()-interval '1 second' where id='c5000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$begin
 if public.petcare_account_active() then raise exception 'Expired session accepted';end if;
 begin perform * from public.petcare_data;raise exception 'Expired session reads profile';exception when insufficient_privilege then null;end;
end$$;
reset role;
update auth.sessions set not_after=null where id='c5000000-0000-4000-8000-000000000001';
-- Pairing someone else's session with a user ID must fail.
set local role authenticated;
select set_config('request.jwt.claim.sub','b5000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"b5000000-0000-4000-8000-000000000002","session_id":"c5000000-0000-4000-8000-000000000001"}',true);
do $$begin if public.petcare_account_active() then raise exception 'Foreign session accepted';end if;end$$;
select set_config('request.jwt.claim.sub','a5000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a5000000-0000-4000-8000-000000000001"}',true);
do $$begin if public.petcare_account_active() then raise exception 'Missing session accepted';end if;end$$;
select set_config('request.jwt.claims','{"sub":"a5000000-0000-4000-8000-000000000001","session_id":"c5000000-0000-4000-8000-000000000001"}',true);
reset role;
delete from auth.sessions where id='c5000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$begin
 if public.petcare_account_active() then raise exception 'Revoked session accepted';end if;
 begin perform * from public.petcare_data;raise exception 'Revoked session reads profile';exception when insufficient_privilege then null;end;
 if exists(select 1 from storage.objects where name='a5000000-0000-4000-8000-000000000001/test.pdf') then raise exception 'Revoked session reads private file';end if;
 begin perform public.petcare_sync_profile(1,'{}');raise exception 'Revoked session writes';exception when insufficient_privilege then null;end;
 begin perform public.petcare_care_profile(auth.uid(),'test');raise exception 'Revoked session reads share';exception when insufficient_privilege then null;end;
 begin perform public.petcare_consume_request('chat');raise exception 'Revoked session consumes AI';exception when insufficient_privilege then null;end;
 begin perform public.petcare_unregister_push_subscription('https://fcm.googleapis.com/test');raise exception 'Revoked session mutates push';exception when insufficient_privilege then null;end;
end$$;
reset role;
rollback;
