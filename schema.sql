-- UEFA Champions League & Europa League - Schema & 24 Updated Matches + 3-Tier Predictions

-- 1. users tablosu
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  avatar_color text default '#0066FF',
  is_admin boolean default false,
  invited_by uuid references public.users(id),
  created_at timestamptz default now()
);

-- Auth trigger
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2. matches tablosu
create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  odds_api_id text unique not null,
  home_team text not null,
  away_team text not null,
  home_flag text default '',
  away_flag text default '',
  home_logo text default '',
  away_logo text default '',
  match_time timestamptz not null,
  group_name text default 'UEFA Champions League',
  status text default 'open' check (status in ('draft','open','locked','finished')),
  home_score integer,
  away_score integer,
  goalscorers text default '',
  result text check (result in ('home_win','away_win','draw')),
  is_admin_approved boolean default true,
  created_at timestamptz default now()
);

-- 3. bet_markets tablosu
create table if not exists public.bet_markets (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references public.matches(id) on delete cascade,
  market_type text not null check (market_type in ('1x2','exact_score','goalscorer','custom')),
  label text not null default 'Tahminler',
  is_active boolean default true,
  lock_before_minutes integer default 60,
  created_at timestamptz default now()
);

-- 4. bet_options tablosu
create table if not exists public.bet_options (
  id uuid primary key default gen_random_uuid(),
  market_id uuid references public.bet_markets(id) on delete cascade,
  label text not null,
  odds_value numeric(6,2) default 1.00,
  outcome_key text not null,
  is_correct boolean,
  created_at timestamptz default now()
);

-- 5. predictions tablosu
create table if not exists public.predictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  match_id uuid references public.matches(id) on delete cascade,
  market_id uuid references public.bet_markets(id) on delete cascade,
  option_id uuid references public.bet_options(id) on delete cascade,
  predicted_home_score integer,
  predicted_away_score integer,
  predicted_scorer text default '',
  odds_at_prediction numeric(6,2) default 1.00,
  points_earned integer default 0,
  is_correct boolean,
  created_at timestamptz default now(),
  unique(user_id, market_id)
);

-- 6. leaderboard_cache tablosu
create table if not exists public.leaderboard_cache (
  user_id uuid primary key references public.users(id) on delete cascade,
  total_points integer default 0,
  correct_predictions integer default 0,
  exact_scores_count integer default 0,
  scorers_count integer default 0,
  total_predictions integer default 0,
  last_updated timestamptz default now()
);

-- Row Level Security (RLS)
alter table public.users enable row level security;
alter table public.matches enable row level security;
alter table public.bet_markets enable row level security;
alter table public.bet_options enable row level security;
alter table public.predictions enable row level security;
alter table public.leaderboard_cache enable row level security;

drop policy if exists "users_select" on public.users;
create policy "users_select" on public.users for select using (true);
drop policy if exists "users_update_own" on public.users;
create policy "users_update_own" on public.users for update using (true);

drop policy if exists "matches_select_approved" on public.matches;
create policy "matches_select_approved" on public.matches for select using (true);
drop policy if exists "matches_admin_all" on public.matches;
create policy "matches_admin_all" on public.matches for all using (true);

drop policy if exists "markets_select_active" on public.bet_markets;
create policy "markets_select_active" on public.bet_markets for select using (true);

drop policy if exists "options_select" on public.bet_options;
create policy "options_select" on public.bet_options for select using (true);

drop policy if exists "predictions_select_own" on public.predictions;
create policy "predictions_select_own" on public.predictions for select using (true);
drop policy if exists "predictions_insert_own" on public.predictions;
create policy "predictions_insert_own" on public.predictions for insert with check (true);
drop policy if exists "predictions_update_own" on public.predictions;
create policy "predictions_update_own" on public.predictions for update using (true);

drop policy if exists "leaderboard_select" on public.leaderboard_cache;
create policy "leaderboard_select" on public.leaderboard_cache for select using (true);
drop policy if exists "leaderboard_all" on public.leaderboard_cache;
create policy "leaderboard_all" on public.leaderboard_cache for all using (true);

-- Admin Helper
create or replace function public.is_admin()
returns boolean as $$
  select coalesce(
    (select is_admin from public.users where id = auth.uid()),
    false
  )
$$ language sql security definer stable;
