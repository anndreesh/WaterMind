create extension if not exists pgcrypto;

create or replace function public.watermind_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.user_watermind (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  daily_goal_ml integer not null default 2000 check (daily_goal_ml between 250 and 10000),
  preferred_unit text not null default 'ml' check (preferred_unit in ('ml', 'oz')),
  timezone text not null default 'UTC',
  theme text not null default 'light' check (theme in ('light', 'dark')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.drink_entries_watermind (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  drink_type text not null check (drink_type in ('water', 'sparkling', 'tea', 'coffee', 'milk', 'juice', 'sports', 'other')),
  volume_ml integer not null check (volume_ml between 1 and 5000),
  hydration_factor numeric(4, 3) not null check (hydration_factor between 0.1 and 1.2),
  hydration_estimate_ml integer not null check (hydration_estimate_ml between 0 and 6000),
  notes text check (char_length(notes) <= 180),
  consumed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint drink_hydration_estimate_matches_factor
    check (hydration_estimate_ml = round(volume_ml * hydration_factor)::integer)
);

create index watermind_entries_user_consumed_at_idx
  on public.drink_entries_watermind (user_id, consumed_at desc);

create table public.reminder_settings_watermind (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  enabled boolean not null default false,
  start_time time not null default '09:00',
  end_time time not null default '20:00',
  interval_minutes integer not null default 120 check (interval_minutes in (60, 90, 120, 180)),
  weekdays integer[] not null default array[0,1,2,3,4,5,6],
  timezone text not null default 'UTC',
  snoozed_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reminder_weekdays_valid check (
    cardinality(weekdays) <= 7 and weekdays <@ array[0,1,2,3,4,5,6]
  ),
  constraint reminder_time_range_valid check (start_time < end_time)
);

create trigger watermind_user_updated_at
  before update on public.user_watermind
  for each row execute function public.watermind_set_updated_at();
create trigger watermind_entries_updated_at
  before update on public.drink_entries_watermind
  for each row execute function public.watermind_set_updated_at();
create trigger watermind_reminders_updated_at
  before update on public.reminder_settings_watermind
  for each row execute function public.watermind_set_updated_at();

create or replace function public.watermind_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_watermind (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger watermind_on_auth_user_created
  after insert on auth.users
  for each row execute function public.watermind_handle_new_user();

alter table public.user_watermind enable row level security;
alter table public.drink_entries_watermind enable row level security;
alter table public.reminder_settings_watermind enable row level security;

create policy "Users can read their own profile"
  on public.user_watermind for select to authenticated
  using ((select auth.uid()) = id);
create policy "Users can create their own profile"
  on public.user_watermind for insert to authenticated
  with check ((select auth.uid()) = id);
create policy "Users can update their own profile"
  on public.user_watermind for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "Users can read their own drink entries"
  on public.drink_entries_watermind for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can create their own drink entries"
  on public.drink_entries_watermind for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can update their own drink entries"
  on public.drink_entries_watermind for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users can delete their own drink entries"
  on public.drink_entries_watermind for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read their own reminder settings"
  on public.reminder_settings_watermind for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can create their own reminder settings"
  on public.reminder_settings_watermind for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can update their own reminder settings"
  on public.reminder_settings_watermind for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users can delete their own reminder settings"
  on public.reminder_settings_watermind for delete to authenticated
  using ((select auth.uid()) = user_id);
