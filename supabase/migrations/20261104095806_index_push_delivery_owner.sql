-- The owner's push-health summary and account deletion filter by user_id.
create index if not exists petcare_push_delivery_log_user_idx
    on public.petcare_push_delivery_log(user_id);
