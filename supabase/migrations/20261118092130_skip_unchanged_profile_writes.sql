set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function petcare_private.sync_profile(p_revision bigint, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_user uuid := auth.uid();
    v_row public.petcare_data%rowtype;
begin
    if not petcare_private.account_active() then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    if p_revision is null or p_revision < 0 then
        raise exception 'Invalid profile' using errcode = '22023';
    end if;
    perform petcare_private.assert_profile_payload(v_user, p_data);
    perform pg_advisory_xact_lock(hashtextextended(v_user::text, 42));
    select * into v_row from public.petcare_data where user_id = v_user for update;

    if coalesce(v_row.revision, 0) <> p_revision then
        return jsonb_build_object('conflict', true, 'data', coalesce(v_row.data, '{}'::jsonb),
                                  'revision', coalesce(v_row.revision, 0));
    end if;
    -- The revision and backup triggers should run only for an actual change.
    if v_row.user_id is null or v_row.data is distinct from p_data then
        insert into public.petcare_data(user_id, data) values (v_user, p_data)
        on conflict(user_id) do update set data = excluded.data returning * into v_row;
    end if;
    return jsonb_build_object('conflict', false, 'data', v_row.data, 'revision', v_row.revision);
end;
$function$;
