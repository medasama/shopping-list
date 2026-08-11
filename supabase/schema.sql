-- Run this once in the Supabase dashboard: SQL Editor > New query > Run
create extension if not exists pgcrypto;

create table if not exists public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default '食品',
  checked boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.shopping_items enable row level security;

-- No login system in this app, so the anon/publishable key needs full access.
create policy "anon full access" on public.shopping_items
  for all
  using (true)
  with check (true);

-- Enables realtime sync so PC/phone stay in sync live.
alter publication supabase_realtime add table public.shopping_items;
