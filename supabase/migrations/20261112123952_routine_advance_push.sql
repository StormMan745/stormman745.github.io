-- Only the authenticated cron service may read notification schedule snapshots.
create or replace function public.petcare_get_push_schedule_data()
returns table(user_id uuid, reminders jsonb, pets jsonb, pet jsonb, completed_tasks jsonb)
language sql stable security invoker set search_path = '' as $$
    select d.user_id, d.data -> 'reminders', d.data -> 'pets', d.data -> 'pet', d.data -> 'completedTasks'
    from public.petcare_data d
    where exists(select 1 from public.petcare_push_subscriptions s where s.user_id = d.user_id);
$$;
revoke all on function public.petcare_get_push_schedule_data() from public, anon, authenticated;
grant execute on function public.petcare_get_push_schedule_data() to service_role;
