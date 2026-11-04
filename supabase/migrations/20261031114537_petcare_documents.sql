-- Private originals; metadata is separate from the application's JSON snapshot.
create table public.petcare_documents (
    id uuid primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    pet_id text not null check (length(pet_id) between 1 and 160),
    record_id text check (length(record_id) between 1 and 160),
    title text not null check (length(trim(title)) between 1 and 160),
    category text not null check (category in ('passport', 'analysis', 'conclusion', 'prescription', 'other')),
    document_date date not null,
    file_name text not null check (length(file_name) between 1 and 255),
    mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
    file_size integer not null check (file_size between 1 and 10485760),
    storage_path text not null unique,
    created_at timestamptz not null default now(),
    constraint document_path_is_owned check (
        storage_path = user_id::text || '/' || id::text || '/original.' ||
        case mime_type when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg'
            when 'image/png' then 'png' when 'image/webp' then 'webp' end
    )
);
create index petcare_documents_pet_date_idx on public.petcare_documents(user_id, pet_id, document_date desc);
alter table public.petcare_documents enable row level security;
revoke all on public.petcare_documents from public, anon, authenticated;
grant select, insert, delete on public.petcare_documents to authenticated;
grant update (title, category, document_date, record_id) on public.petcare_documents to authenticated;
create policy "Documents: read own" on public.petcare_documents for select to authenticated
    using ((select auth.uid()) = user_id);
create policy "Documents: insert own" on public.petcare_documents for insert to authenticated
    with check ((select auth.uid()) = user_id);
create policy "Documents: edit own" on public.petcare_documents for update to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Documents: delete own" on public.petcare_documents for delete to authenticated
    using ((select auth.uid()) = user_id);

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('petcare-documents', 'petcare-documents', false, 10485760,
    array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
create policy "Document files: read own" on storage.objects for select to authenticated
    using (bucket_id = 'petcare-documents' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "Document files: upload own" on storage.objects for insert to authenticated
    with check (bucket_id = 'petcare-documents' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "Document files: delete own" on storage.objects for delete to authenticated
    using (bucket_id = 'petcare-documents' and (storage.foldername(name))[1] = (select auth.uid()::text));
