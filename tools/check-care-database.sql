-- Run after the platform migration. Every synthetic identity/change rolls back.
begin;
insert into auth.users(id) values('a2000000-0000-4000-8000-000000000001'),('b2000000-0000-4000-8000-000000000002');
insert into auth.sessions(id,user_id,created_at) values('c2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001',now()),('c2000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000001',now()-interval '1 hour');
do $$begin
 if not public.petcare_recent_session('a2000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001') then raise exception 'Recent session rejected';end if;
 if public.petcare_recent_session('a2000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000002') or public.petcare_recent_session('b2000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001') then raise exception 'Old or foreign session accepted for deletion';end if;
end$$;
insert into auth.sessions(id,user_id,created_at) values('a2000000-0000-4000-8000-000000000009','a2000000-0000-4000-8000-000000000001',now());
insert into auth.sessions(id,user_id,created_at) values('b2000000-0000-4000-8000-000000000009','b2000000-0000-4000-8000-000000000002',now());
set local role authenticated;
select set_config('request.jwt.claim.sub','a2000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a2000000-0000-4000-8000-000000000001","session_id":"a2000000-0000-4000-8000-000000000009"}',true);
select public.petcare_sync_profile(0,'{"pets":[{"id":"one","name":"First"},{"id":"two","name":"Private"}],"pet":{"id":"one","name":"First"},"activePetId":"one","healthRecords":[{"id":"h1","petId":"one","name":"Visit"},{"id":"h2","petId":"two","name":"Private visit"}],"reminders":[],"medicationCourses":[],"medicationIntakes":[],"assistantConversation":[{"id":"chat","content":"PRIVATE CHAT"}]}'::jsonb);
do $$ declare r jsonb; begin
 r:=public.petcare_sync_profile(0,'{"pets":[]}'::jsonb);
 if r->>'conflict'<>'true' then raise exception 'Stale write overwrote newer data';end if;
 if not public.petcare_account_active() then raise exception 'Existing account hidden';end if;
end $$;
reset role;
insert into public.petcare_care_invites(owner_id,pet_id,token_hash) values('a2000000-0000-4000-8000-000000000001','one',repeat('b',64));
set local role service_role;
do $$ begin
 if not public.petcare_accept_care('b2000000-0000-4000-8000-000000000002',repeat('b',64)) then raise exception 'Invite failed';end if;
 if public.petcare_accept_care('b2000000-0000-4000-8000-000000000002',repeat('b',64)) then raise exception 'Invite reused';end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','b2000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"b2000000-0000-4000-8000-000000000002","session_id":"b2000000-0000-4000-8000-000000000009"}',true);
do $$ declare r jsonb; draft jsonb; denied boolean:=false; begin
 r:=public.petcare_care_profile('a2000000-0000-4000-8000-000000000001','one');
 if r->'data'->'pet'->>'name'<>'First' or jsonb_array_length(r->'data'->'healthRecords')<>1 or r->'data' ? 'assistantConversation' then raise exception 'Sharing boundary leak';end if;
 begin perform public.petcare_care_profile('a2000000-0000-4000-8000-000000000001','two');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Other pet exposed';end if;
 draft:=jsonb_set(r->'data','{pet,name}','"Edited by helper"');
 r:=public.petcare_care_profile('a2000000-0000-4000-8000-000000000001','one',(r->>'revision')::bigint,draft);
 if r->>'conflict'<>'false' or r->'data'->'pet'->>'name'<>'Edited by helper' then raise exception 'Helper edit failed';end if;
 draft:=jsonb_set(draft,'{healthRecords}','[{"id":"bad","petId":"two"}]');denied:=false;
 begin perform public.petcare_care_profile('a2000000-0000-4000-8000-000000000001','one',(r->>'revision')::bigint,draft);exception when invalid_parameter_value then denied:=true;end;
 if not denied then raise exception 'Cross-pet write allowed';end if;
 if exists(select 1 from public.petcare_data where user_id='a2000000-0000-4000-8000-000000000001') then raise exception 'Owner profile exposed';end if;
 begin perform public.petcare_account_backups('a2000000-0000-4000-8000-000000000001');raise exception 'Private backups exposed';exception when insufficient_privilege then null;end;
 begin perform public.petcare_account_objects('a2000000-0000-4000-8000-000000000001');raise exception 'Private file list exposed';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ declare saved jsonb;rev bigint;begin
 select data into saved from public.petcare_data where user_id='a2000000-0000-4000-8000-000000000001';
 if saved->'pets'->1->>'name'<>'Private' or saved->'assistantConversation'->0->>'content'<>'PRIVATE CHAT' then raise exception 'Private data changed';end if;
 if (select count(*) from petcare_private.profile_backups where user_id='a2000000-0000-4000-8000-000000000001')<>2 then raise exception 'Backup missing';end if;
end $$;
delete from public.petcare_care_members where owner_id='a2000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
 begin perform public.petcare_care_profile('a2000000-0000-4000-8000-000000000001','one');raise exception 'Revoked access still works';exception when insufficient_privilege then null;end;
end $$;
reset role;
-- Restore a real backup through the same concurrency-checked RPC as the UI.
select set_config('request.jwt.claim.sub','a2000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a2000000-0000-4000-8000-000000000001","session_id":"a2000000-0000-4000-8000-000000000009"}',true);
do $$ declare original jsonb;revision bigint;result jsonb;begin
 select b.data into original from petcare_private.profile_backups b where b.user_id='a2000000-0000-4000-8000-000000000001' order by b.revision limit 1;
 select d.revision into revision from public.petcare_data d where user_id='a2000000-0000-4000-8000-000000000001';
 result:=public.petcare_sync_profile(revision,original);
 if result->'data' is distinct from original or result->>'conflict'<>'false' then raise exception 'Restore roundtrip failed';end if;
end $$;
select petcare_private.check_backups();
do $$ begin if not (select ok from petcare_private.health_checks where name='profile_backups') then raise exception 'Backup integrity probe failed';end if;end $$;
set local role service_role;
do $$ declare attempt smallint;begin
 attempt:=public.petcare_claim_push_delivery(repeat('c',64),'care-test','a2000000-0000-4000-8000-000000000001','medicine-test',current_date);
 if attempt<>1 then raise exception 'Initial push lease failed';end if;
 if public.petcare_claim_push_delivery(repeat('c',64),'care-test','a2000000-0000-4000-8000-000000000001','medicine-test',current_date) is not null then raise exception 'Duplicate push lease allowed';end if;
 update public.petcare_push_delivery_log set status='failed',last_attempt_at=now()-interval '3 minutes' where notification_key='care-test' and endpoint_hash=repeat('c',64);
 if public.petcare_claim_push_delivery(repeat('c',64),'care-test','a2000000-0000-4000-8000-000000000001','medicine-test',current_date)<>2 then raise exception 'Push retry lease failed';end if;
 update public.petcare_push_delivery_log set status='sent' where notification_key='care-test' and endpoint_hash=repeat('c',64);
 if public.petcare_claim_push_delivery(repeat('c',64),'care-test','a2000000-0000-4000-8000-000000000001','medicine-test',current_date) is not null then raise exception 'Sent push retried';end if;
end $$;
reset role;
set local role authenticated;
insert into public.petcare_documents(id,user_id,pet_id,title,category,document_date,file_name,mime_type,file_size,storage_path)
 values('d2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','one','Revision test','analysis',current_date,'test.pdf','application/pdf',20,'a2000000-0000-4000-8000-000000000001/d2000000-0000-4000-8000-000000000001/original.pdf');
update public.petcare_documents set title='Changed' where id='d2000000-0000-4000-8000-000000000001' and revision=1;
do $$begin
 if (select revision from public.petcare_documents where id='d2000000-0000-4000-8000-000000000001')<>2 then raise exception 'Document revision missing';end if;
 begin delete from public.petcare_documents where id='d2000000-0000-4000-8000-000000000001';raise exception 'Permanent document deletion allowed';exception when insufficient_privilege then null;end;
end$$;
reset role;
delete from auth.users where id='a2000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin if public.petcare_account_active() then raise exception 'Deleted JWT still has storage access';end if;end $$;
reset role;
rollback;
