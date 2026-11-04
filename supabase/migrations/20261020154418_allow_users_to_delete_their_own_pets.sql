grant delete on public.pets to authenticated;

drop policy if exists "Users can delete their own pets" on public.pets;
create policy "Users can delete their own pets"
    on public.pets for delete
    to authenticated
    using ((select auth.uid()) = user_id);
