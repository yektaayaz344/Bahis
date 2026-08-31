-- UEFA Champions League & Europa League - Database Schema & 24 Seed Fixtures

-- 1. users tablosu
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  avatar_color text default '#0066FF',
  is_admin boolean default false,
  invited_by uuid references public.users(id),
  created_at timestamptz default now()
);

-- Auth kayıt olunca otomatik profil oluştur
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
  home_flag text default '⚽',
  away_flag text default '⚽',
  match_time timestamptz not null,
  group_name text default 'UEFA Champions League',
  status text default 'open' check (status in ('draft','open','locked','finished')),
  home_score integer,
  away_score integer,
  result text check (result in ('home_win','away_win','draw')),
  is_admin_approved boolean default true,
  created_at timestamptz default now()
);

-- 3. bet_markets tablosu
create table if not exists public.bet_markets (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references public.matches(id) on delete cascade,
  market_type text not null check (market_type in ('1x2','exact_score','over_under','btts','custom')),
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

-- Görsellerdeki Maç Fikstürü (24 Maç)
insert into public.matches (odds_api_id, home_team, away_team, home_flag, away_flag, match_time, group_name, status, is_admin_approved)
values
  -- FENERBAHÇE FİKSTÜRÜ
  ('fb-1', 'Fenerbahçe', 'Roma', '💛💙', '🇮🇹', '2026-09-10 20:00:00+00', 'UEFA Europa League', 'open', true),
  ('fb-2', 'Aston Villa', 'Fenerbahçe', '🏴󠁧󠁢󠁥󠁮󠁧󠁿', '💛💙', '2026-10-14 20:00:00+00', 'UEFA Europa League', 'open', true),
  ('fb-3', 'Fenerbahçe', 'Slavia Prag', '💛💙', '🇨🇿', '2026-10-20 20:00:00+00', 'UEFA Europa League', 'open', true),
  ('fb-4', 'Fenerbahçe', 'Liverpool', '💛💙', '🏴󠁧󠁢󠁥󠁮󠁧󠁿', '2026-11-04 20:00:00+00', 'UEFA Europa League', 'open', true),
  ('fb-5', 'S. Donetsk', 'Fenerbahçe', '🇺🇦', '💛💙', '2026-11-25 20:00:00+00', 'UEFA Europa League', 'open', true),
  ('fb-6', 'LASK', 'Fenerbahçe', '🇦🇹', '💛💙', '2026-12-09 20:00:00+00', 'UEFA Europa League', 'open', true),
  ('fb-7', 'Fenerbahçe', 'Villarreal', '💛💙', '🇪🇸', '2027-01-20 20:00:00+00', 'UEFA Europa League', 'open', true),
  ('fb-8', 'A. Madrid', 'Fenerbahçe', '🇪🇸', '💛💙', '2027-01-27 20:00:00+00', 'UEFA Europa League', 'open', true),

  -- GALATASARAY FİKSTÜRÜ
  ('gs-1', 'Sporting', 'Galatasaray', '🇵🇹', '💛🔴', '2026-09-09 22:00:00+00', 'UEFA Champions League', 'open', true),
  ('gs-2', 'Galatasaray', 'Barcelona', '💛🔴', '🇪🇸', '2026-10-13 22:00:00+00', 'UEFA Champions League', 'open', true),
  ('gs-3', 'Lille', 'Galatasaray', '🇫🇷', '💛🔴', '2026-10-21 19:45:00+00', 'UEFA Champions League', 'open', true),
  ('gs-4', 'Galatasaray', 'Stuttgart', '💛🔴', '🇩🇪', '2026-11-03 20:45:00+00', 'UEFA Champions League', 'open', true),
  ('gs-5', 'Galatasaray', 'Aston Villa', '💛🔴', '🏴󠁧󠁢󠁥󠁮󠁧󠁿', '2026-11-24 20:45:00+00', 'UEFA Champions League', 'open', true),
  ('gs-6', 'AEK', 'Galatasaray', '🇬🇷', '💛🔴', '2026-12-08 23:00:00+00', 'UEFA Champions League', 'open', true),
  ('gs-7', 'Galatasaray', 'Feyenoord', '💛🔴', '🇳🇱', '2027-01-19 20:45:00+00', 'UEFA Champions League', 'open', true),
  ('gs-8', 'PSG', 'Galatasaray', '🇫🇷', '💛🔴', '2027-01-27 23:00:00+00', 'UEFA Champions League', 'open', true),

  -- BEŞİKTAŞ FİKSTÜRÜ
  ('bjk-1', 'B. Leverkusen', 'Beşiktaş', '🇩🇪', '🖤🤍', '2026-09-12 20:00:00+00', 'UEFA Europa League', 'open', true),
  ('bjk-2', 'Beşiktaş', 'Marsilya', '🖤🤍', '🇫🇷', '2026-10-16 20:00:00+00', 'UEFA Europa League', 'open', true),
  ('bjk-3', 'Celtic', 'Beşiktaş', '🏴󠁧󠁢󠁳󠁣󠁴󠁿', '🖤🤍', '2026-10-22 20:00:00+00', 'UEFA Europa League', 'open', true),
  ('bjk-4', 'Beşiktaş', 'Union SG', '🖤🤍', '🇧🇪', '2026-11-05 20:00:00+00', 'UEFA Europa League', 'open', true),
  ('bjk-5', 'Omonia', 'Beşiktaş', '🇨🇾', '🖤🤍', '2026-11-26 20:00:00+00', 'UEFA Europa League', 'open', true),
  ('bjk-6', 'Beşiktaş', 'Crystal Palace', '🖤🤍', '🏴󠁧󠁢󠁥󠁮󠁧󠁿', '2026-12-10 20:00:00+00', 'UEFA Europa League', 'open', true),
  ('bjk-7', 'Hoffenheim', 'Beşiktaş', '🇩🇪', '🖤🤍', '2027-01-21 20:00:00+00', 'UEFA Europa League', 'open', true),
  ('bjk-8', 'Beşiktaş', 'H. Beer-Sheva', '🖤🤍', '🇮🇱', '2027-01-28 20:00:00+00', 'UEFA Europa League', 'open', true)
on conflict (odds_api_id) do nothing;

-- Her Maç için 1X2 ve Exact Score Marketlerini Oluştur
do $$
declare
  m record;
  bm_1x2_id uuid;
  bm_score_id uuid;
begin
  for m in select id from public.matches loop
    -- 1X2 Market
    if not exists (select 1 from public.bet_markets where match_id = m.id and market_type = '1x2') then
      insert into public.bet_markets (match_id, market_type, label, is_active)
      values (m.id, '1x2', 'Maç Sonucu (10 Puan)', true)
      returning id into bm_1x2_id;

      insert into public.bet_options (market_id, label, outcome_key, odds_value)
      values
        (bm_1x2_id, '1 (Ev Sahibi)', 'home_win', 1.00),
        (bm_1x2_id, 'X (Beraberlik)', 'draw', 1.00),
        (bm_1x2_id, '2 (Deplasman)', 'away_win', 1.00);
    end if;

    -- Exact Score Market
    if not exists (select 1 from public.bet_markets where match_id = m.id and market_type = 'exact_score') then
      insert into public.bet_markets (match_id, market_type, label, is_active)
      values (m.id, 'exact_score', 'Maç Skoru (50 Puan)', true)
      returning id into bm_score_id;

      insert into public.bet_options (market_id, label, outcome_key, odds_value)
      values (bm_score_id, 'Maç Skoru', 'exact_score', 1.00);
    end if;
  end loop;
end $$;
