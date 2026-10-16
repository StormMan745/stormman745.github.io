-- Run this once in Supabase Dashboard > SQL Editor.
-- Stores each signed-in user's PetCare application data in one private row.

create table if not exists public.petcare_data (
    user_id uuid primary key references auth.users (id) on delete cascade,
    data jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
);

alter table public.petcare_data enable row level security;

drop policy if exists "Users can read their own PetCare data" on public.petcare_data;
create policy "Users can read their own PetCare data"
    on public.petcare_data for select
    to authenticated
    using (auth.uid() = user_id);

drop policy if exists "Users can insert their own PetCare data" on public.petcare_data;
create policy "Users can insert their own PetCare data"
    on public.petcare_data for insert
    to authenticated
    with check (auth.uid() = user_id);

drop policy if exists "Users can update their own PetCare data" on public.petcare_data;
create policy "Users can update their own PetCare data"
    on public.petcare_data for update
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
