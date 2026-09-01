-- ════════════════════════════════════════════════════════════════════════
-- Her maça TAM 3 market: Maç Sonucu (1x2) · Maç Skoru (exact_score) · Gol (goalscorer)
--
-- Kök sebep: canlı DB'deki bet_markets check constraint'i eski sürümdü
-- (1x2, over_under, btts, correct_score, custom) — 'exact_score' ve 'goalscorer'
-- ekleme denemeleri sessizce reddediliyordu. O yüzden skor/gol tahminleri
-- market_id = NULL olarak kaydediliyor, unique(user_id, market_id) devreye
-- girmediği için kullanıcı sınırsız tahmin yapabiliyordu.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- A) check constraint'i şemaya hizala
alter table public.bet_markets drop constraint if exists bet_markets_market_type_check;
alter table public.bet_markets add constraint bet_markets_market_type_check
  check (market_type in ('1x2','exact_score','goalscorer','custom'));

-- B) bozuk tahminleri temizle (market_id null veya silinmiş market'e işaret eden)
delete from public.predictions p
where p.market_id is null
   or not exists (select 1 from public.bet_markets bm where bm.id = p.market_id);

-- C) eksik marketleri ekle (1x2 zaten var)
insert into public.bet_markets (match_id, market_type, label, is_active)
select m.id, 'exact_score', 'Maç Skoru (5 Puan)', true
from public.matches m
on conflict (match_id, market_type) do nothing;

insert into public.bet_markets (match_id, market_type, label, is_active)
select m.id, 'goalscorer', 'Gol Atacak Oyuncu (2 Puan)', true
from public.matches m
on conflict (match_id, market_type) do nothing;

-- D) her yeni market'e option
insert into public.bet_options (market_id, label, outcome_key, odds_value)
select bm.id, 'Maç Skoru', 'exact_score', 1.00
from public.bet_markets bm
where bm.market_type = 'exact_score'
  and not exists (select 1 from public.bet_options o where o.market_id = bm.id);

insert into public.bet_options (market_id, label, outcome_key, odds_value)
select bm.id, 'Golcü Tahmini', 'goalscorer', 1.00
from public.bet_markets bm
where bm.market_type = 'goalscorer'
  and not exists (select 1 from public.bet_options o where o.market_id = bm.id);

-- E) market_id artık zorunlu — bir daha null-market tahmin oluşamaz
alter table public.predictions alter column market_id set not null;

commit;
