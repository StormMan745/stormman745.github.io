begin;
-- Run inside BEGIN/ROLLBACK: fake records are never committed or delivered.
do $test$
declare
    a uuid; b uuid; n integer; result jsonb; v_endpoint_test text := 'https://fcm.googleapis.com/fcm/send/petcare-security-transaction-test';
    subscription jsonb; bad text; failure boolean;
begin
    select user_id into a from public.petcare_data order by user_id limit 1;
    select user_id into b from public.petcare_data where user_id <> a order by user_id limit 1;
    if a is null or b is null then raise exception 'Two existing accounts required for isolation check'; end if;
    if exists(select 1 from public.petcare_push_subscriptions where petcare_push_subscriptions.endpoint = v_endpoint_test) then raise exception 'Test v_endpoint_test collision'; end if;
    delete from petcare_private.request_limits where user_id in (a,b);
    subscription := jsonb_build_object('endpoint',v_endpoint_test,'keys',jsonb_build_object('p256dh',repeat('A',87),'auth',repeat('A',22)));
    perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
    set local role authenticated;
    select count(*) into n from public.petcare_data where user_id = a;
    if n <> 1 then raise exception 'Own profile unavailable'; end if;
    select count(*) into n from public.petcare_data where user_id = b;
    if n <> 0 then raise exception 'Cross-account profile visible'; end if;
    update public.petcare_data set updated_at = now() where user_id = b;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'Cross-account profile updated'; end if;
    failure := false;
    begin
        insert into public.pets(user_id,name) values(b,'Security transaction test');
    exception when insufficient_privilege then failure := true; end;
    if not failure then raise exception 'Cross-account insert accepted'; end if;
    update public.petcare_data set data = data || '{"security_test":true}'::jsonb where user_id = a;
    get diagnostics n = row_count;
    if n <> 1 then raise exception 'Own write denied'; end if;
    failure := false;
    begin update public.petcare_data set data = '[]'::jsonb where user_id=a;
    exception when check_violation then failure := true; end;
    if not failure then raise exception 'Malformed profile accepted'; end if;
    failure := false;
    begin update public.petcare_data set data = jsonb_build_object('too_large',repeat('x',16777216)) where user_id=a;
    exception when check_violation then failure := true; end;
    if not failure then raise exception 'Oversize profile accepted'; end if;
    for i in 1..12 loop
        result := public.petcare_consume_request('chat');
        if not (result->>'allowed')::boolean then raise exception 'Normal chat denied'; end if;
    end loop;
    result := public.petcare_consume_request('chat');
    if (result->>'allowed')::boolean or (result->>'retryAfter')::integer < 1 then raise exception 'Chat burst limit bypassed'; end if;
    perform public.petcare_register_push_subscription(subscription,'Europe/Moscow');
    if not public.petcare_has_push_subscription(v_endpoint_test) then raise exception 'Own push registration failed'; end if;
    foreach bad in array array['https://127.0.0.1/test','https://169.254.169.254/latest/meta-data/','https://fcm.googleapis.com.evil.invalid/x','https://fcm.googleapis.com@evil.invalid/x','http://fcm.googleapis.com/x','https://fcm.googleapis.com:8443/x'] loop
        failure := false;
        begin perform public.petcare_register_push_subscription(jsonb_set(subscription,'{endpoint}',to_jsonb(bad)),'UTC');
        exception when invalid_parameter_value then failure := true; end;
        if not failure then raise exception 'Unsafe push URL accepted'; end if;
    end loop;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
    if public.petcare_has_push_subscription(v_endpoint_test) then raise exception 'Cross-account subscription visible'; end if;
    perform public.petcare_unregister_push_subscription(v_endpoint_test);
    failure := false;
    begin perform public.petcare_register_push_subscription(subscription,'UTC');
    exception when insufficient_privilege then failure := true; end;
    if not failure then raise exception 'Cross-account subscription takeover accepted'; end if;
    result := public.petcare_consume_request('chat');
    if not (result->>'allowed')::boolean then raise exception 'Quota leaked between accounts'; end if;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
    if not public.petcare_has_push_subscription(v_endpoint_test) then raise exception 'Other account removed subscription'; end if;
    perform public.petcare_unregister_push_subscription(v_endpoint_test);
    if public.petcare_has_push_subscription(v_endpoint_test) then raise exception 'Own unregister failed'; end if;
    insert into storage.objects(bucket_id,name) values('petcare-stories',a::text || '/security-test/own.jpg');
    failure := false;
    begin insert into storage.objects(bucket_id,name) values('petcare-stories',b::text || '/security-test/forbidden.jpg');
    exception when insufficient_privilege then failure := true; end;
    if not failure then raise exception 'Cross-account storage write accepted'; end if;
    select count(*) into n from storage.objects where bucket_id='petcare-stories' and (storage.foldername(name))[1]=b::text;
    if n <> 0 then raise exception 'Cross-account storage visible'; end if;
    reset role;
    if has_function_privilege('anon','public.petcare_consume_request(text)','execute') or
       has_function_privilege('anon','public.petcare_register_push_subscription(jsonb,text)','execute') or
       has_function_privilege('authenticated','public.petcare_get_push_runtime_secrets()','execute') then raise exception 'Privilege leak'; end if;
    set local role anon;
    failure := false;
    begin perform 1 from public.petcare_data limit 1;
    exception when insufficient_privilege then failure := true; end;
    if not failure then raise exception 'Anonymous data grant present'; end if;
    reset role;
end;
$test$;

rollback;
