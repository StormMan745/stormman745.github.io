insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'petcare-stories',
    'petcare-stories',
    false,
    26214400,
    array['image/jpeg', 'video/mp4', 'video/webm']::text[]
)
on conflict (id) do update set
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "PetCare story files: read own" on storage.objects;
create policy "PetCare story files: read own"
    on storage.objects for select
    to authenticated
    using (
        bucket_id = 'petcare-stories'
        and (storage.foldername(name))[1] = (select auth.uid()::text)
    );

drop policy if exists "PetCare story files: upload own" on storage.objects;
create policy "PetCare story files: upload own"
    on storage.objects for insert
    to authenticated
    with check (
        bucket_id = 'petcare-stories'
        and (storage.foldername(name))[1] = (select auth.uid()::text)
    );

drop policy if exists "PetCare story files: update own" on storage.objects;
create policy "PetCare story files: update own"
    on storage.objects for update
    to authenticated
    using (
        bucket_id = 'petcare-stories'
        and (storage.foldername(name))[1] = (select auth.uid()::text)
    )
    with check (
        bucket_id = 'petcare-stories'
        and (storage.foldername(name))[1] = (select auth.uid()::text)
    );

drop policy if exists "PetCare story files: delete own" on storage.objects;
create policy "PetCare story files: delete own"
    on storage.objects for delete
    to authenticated
    using (
        bucket_id = 'petcare-stories'
        and (storage.foldername(name))[1] = (select auth.uid()::text)
    );
