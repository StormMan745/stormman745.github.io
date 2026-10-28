-- Publish account changes; existing SELECT RLS still limits each subscriber to its own row.
do $migration$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime' and not puballtables)
       and not exists (
           select 1 from pg_publication_tables
           where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'petcare_data'
       ) then
        alter publication supabase_realtime add table public.petcare_data;
    end if;
end
$migration$;
