-- Safe hosted verification: only temporary rows are written; all work rolls back.
begin;
set local statement_timeout = '30s';
create temporary table quota_probe (like public.petcare_data including defaults including constraints);
create trigger quota_probe_guard before insert or update on quota_probe
    for each row execute function petcare_private.profile_revision();

do $test$
declare
    v_unlimited uuid;
    v_regular uuid;
    v_boundary jsonb;
    v_large jsonb;
    v_rejected boolean;
begin
    select id into strict v_unlimited from auth.users
        where raw_app_meta_data -> 'petcare_unlimited_profile' = 'true'::jsonb;
    select id into v_regular from auth.users where id <> v_unlimited
        and coalesce(raw_app_meta_data -> 'petcare_unlimited_profile' = 'true'::jsonb, false) = false limit 1;
    v_regular := coalesce(v_regular, '00000000-0000-4000-8000-000000000001'::uuid);
    v_boundary := jsonb_build_object('padding', repeat('a', 20971520 - octet_length(jsonb_build_object('padding','')::text)));
    if octet_length(v_boundary::text) <> 20971520 then raise exception 'Bad boundary fixture'; end if;
    insert into quota_probe(user_id,data) values(v_regular,v_boundary);
    -- The old 16 MiB guard is gone; exactly 20 MiB saves for an ordinary account.
    if (select revision from quota_probe where user_id=v_regular) <> 1 then raise exception 'Revision trigger failed'; end if;
    v_large := jsonb_build_object('padding', repeat('b', 20971521 - octet_length(jsonb_build_object('padding','')::text)));
    v_rejected := false;
    begin update quota_probe set data=v_large where user_id=v_regular;
    exception when sqlstate '22023' then v_rejected := true; end;
    if not v_rejected then raise exception 'Ordinary account bypassed the 20 MiB quota'; end if;
    insert into quota_probe(user_id,data) values(v_unlimited,v_large);
    -- Replayed/self-edited JWT metadata cannot grant the server-side exception.
    perform set_config('request.jwt.claims',jsonb_build_object('sub',v_regular,'role','authenticated',
        'user_metadata',jsonb_build_object('petcare_unlimited_profile',true),
        'app_metadata',jsonb_build_object('petcare_unlimited_profile',true))::text,true);
    v_rejected := false;
    begin perform petcare_private.assert_profile_payload(v_regular,v_large);
    exception when sqlstate '22023' then v_rejected := true; end;
    if not v_rejected then raise exception 'JWT metadata bypassed the quota'; end if;
    foreach v_large in array array['[]'::jsonb, 'null'::jsonb, '"text"'::jsonb] loop
        v_rejected := false;
        begin update quota_probe set data=v_large where user_id=v_unlimited;
        exception when sqlstate '22023' then v_rejected := true; end;
        if not v_rejected then raise exception 'Unlimited account bypassed object validation'; end if;
    end loop;
    if has_function_privilege('authenticated','petcare_private.assert_profile_payload(uuid,jsonb)','execute')
        or has_function_privilege('anon','petcare_private.assert_profile_payload(uuid,jsonb)','execute') then
        raise exception 'Quota helper exposed to client roles';
    end if;
    if not (select relrowsecurity from pg_class where oid='public.petcare_data'::regclass) then
        raise exception 'Profile RLS disabled';
    end if;
end $test$;

-- Invalid/expired sessions must still be rejected before either write RPC runs.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"petcare_unlimited_profile":true}}',true);
set local role authenticated;
do $auth_test$
declare v_rejected boolean := false;
begin
    begin perform public.petcare_sync_profile(0,'{}'::jsonb);
    exception when sqlstate '42501' then v_rejected := true; end;
    if not v_rejected then raise exception 'Unauthenticated profile write was accepted'; end if;
    v_rejected := false;
    begin perform public.petcare_care_profile('00000000-0000-4000-8000-000000000002'::uuid,'pet',0,'{}'::jsonb);
    exception when sqlstate '42501' then v_rejected := true; end;
    if not v_rejected then raise exception 'Unauthorized shared-care write was accepted'; end if;
end $auth_test$;
reset role;
rollback;
select 'PASS: 20 MiB boundary, ordinary overflow denial, account exemption, invalid JSON, metadata forgery, private helper, RLS and authenticated RPC guards. Temporary data rolled back.' as result;
