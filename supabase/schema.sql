-- Storyline Director: Supabase PostgreSQL Schema
-- Run this SQL inside your Supabase Dashboard -> SQL Editor

create extension if not exists "pgcrypto";

create table if not exists public.studio_projects (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Untitled Channel Launch',
  active_stage integer not null default 1,
  niche_strategy jsonb,
  content_ideas jsonb not null default '[]'::jsonb,
  script_stage jsonb,
  visual_plan jsonb,
  packaging_lab jsonb,
  growth_plan jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists studio_projects_updated_at_idx
  on public.studio_projects (updated_at desc);

-- Morning Auto-Pipeline & Ready-to-Upload Vault storage
create table if not exists public.studio_vault (
  id text primary key default 'default',
  settings jsonb not null default '{}'::jsonb,
  episodes jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- Optional: automatically keep updated_at fresh on updates
create or replace function public.touch_studio_project_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_studio_projects on public.studio_projects;
create trigger trg_touch_studio_projects
before update on public.studio_projects
for each row
execute function public.touch_studio_project_updated_at();
