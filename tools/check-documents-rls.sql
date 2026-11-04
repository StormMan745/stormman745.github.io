-- Transactional checks: test identities and metadata are always rolled back.
begin;
insert into auth.users(id) values ('a1000000-0000-4000-8000-000000000001'), ('b1000000-0000-4000-8000-000000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
insert into public.petcare_documents(id,user_id,pet_id,title,category,document_date,file_name,mime_type,file_size,storage_path)
values ('d1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','test-pet','RLS test','passport',current_date,'test.pdf','application/pdf',20,
'a1000000-0000-4000-8000-000000000001/d1000000-0000-4000-8000-000000000001/original.pdf');
insert into storage.objects(bucket_id,name) values ('petcare-documents','a1000000-0000-4000-8000-000000000001/rls-test.pdf');
do $$ begin
    if (select count(*) from public.petcare_documents where pet_id='test-pet') <> 1 then raise exception 'Own document hidden'; end if;
    update public.petcare_documents set title='Changed' where pet_id='test-pet';
    if not exists(select 1 from public.petcare_documents where title='Changed' and pet_id='test-pet') then raise exception 'Own edit failed'; end if;
    begin
        update public.petcare_documents set user_id='b1000000-0000-4000-8000-000000000002' where pet_id='test-pet';
        raise exception 'Ownership mutation allowed';
    exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000002', true);
do $$ declare affected integer; begin
    if exists(select 1 from public.petcare_documents where pet_id='test-pet') then raise exception 'Cross-account read allowed'; end if;
    if exists(select 1 from storage.objects where bucket_id='petcare-documents' and name like 'a1000000-%') then raise exception 'Cross-account file read allowed'; end if;
    delete from public.petcare_documents where pet_id='test-pet';
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Cross-account delete allowed'; end if;
    begin
        insert into storage.objects(bucket_id,name) values ('petcare-documents','a1000000-0000-4000-8000-000000000001/spoof.pdf');
        raise exception 'Cross-account upload allowed';
    exception when insufficient_privilege then null; end;
    begin
        insert into public.petcare_documents(id,user_id,pet_id,title,category,document_date,file_name,mime_type,file_size,storage_path)
        values ('d1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001','test-pet','Spoof','passport',current_date,'test.pdf','application/pdf',20,
        'a1000000-0000-4000-8000-000000000001/d1000000-0000-4000-8000-000000000002/original.pdf');
        raise exception 'Cross-account metadata insert allowed';
    exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
delete from public.petcare_documents where pet_id='test-pet';
do $$ begin
    if exists(select 1 from public.petcare_documents where pet_id='test-pet') then raise exception 'Own delete failed'; end if;
end $$;
rollback;
select 'PASS: own CRUD, immutable ownership, cross-account denial, private file policies; all test data rolled back' as result;
