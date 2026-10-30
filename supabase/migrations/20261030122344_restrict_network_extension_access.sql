-- pg_net is non-relocatable on this project. Restrict its capabilities instead
-- of dropping/recreating the extension used by the notification scheduler.
-- On hosted Supabase these objects are owned by supabase_admin. The postgres
-- role may only receive warnings for these REVOKEs, so verify effective grants.
-- The production audit found grants unchanged; net is NOT exposed by PostgREST.
-- Do not treat this migration alone as proof of revoked extension privileges.
revoke all on all functions in schema net from public, anon, authenticated;
revoke all on all tables in schema net from public, anon, authenticated;
revoke all on all sequences in schema net from public, anon, authenticated;
grant usage on schema net to service_role;
grant execute on all functions in schema net to service_role;

do $$
begin
    if not has_function_privilege('postgres','net.http_post(text,jsonb,jsonb,jsonb,integer)','execute') then
        raise exception 'Notification scheduler must retain network access';
    end if;
end;
$$;
