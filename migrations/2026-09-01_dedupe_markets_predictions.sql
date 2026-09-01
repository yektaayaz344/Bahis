-- ════════════════════════════════════════════════════════════════════════
-- TEK SEFERLİK TEMİZLİK: dublike market + dublike tahmin
-- Supabase Dashboard → SQL Editor'da çalıştır. Sırayla, tek blok halinde.
-- Sebep: aynı maç+kategori için birden fazla bet_markets satırı oluşmuş,
-- bu yüzden kullanıcılar skor/golcü için 1'den fazla tahmin kaydedebiliyordu.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- 1) Dublike TAHMİNLERİ sil: aynı kullanıcı + maç + kategori için en yenisini tut
with ranked as (
  select p.id,
         row_number() over (
           partition by p.user_id, p.match_id, m.market_type
           order by p.created_at desc
         ) as rn
  from public.predictions p
  join public.bet_markets m on m.id = p.market_id
)
delete from public.predictions
where id in (select id from ranked where rn > 1);

-- 2) Kalan tahminleri kanonik (en eski) market'e taşı; option_id'yi de eşle
with canon as (
  select distinct on (match_id, market_type)
         id as keep_id, match_id, market_type
  from public.bet_markets
  order by match_id, market_type, created_at
),
mapping as (
  select m.id as old_id, c.keep_id
  from public.bet_markets m
  join canon c on c.match_id = m.match_id and c.market_type = m.market_type
  where m.id <> c.keep_id
)
update public.predictions p
set market_id = mp.keep_id,
    option_id = (
      select bo2.id
      from public.bet_options bo1
      join public.bet_options bo2
        on bo2.market_id = mp.keep_id and bo2.outcome_key = bo1.outcome_key
      where bo1.id = p.option_id
      limit 1
    )
from mapping mp
where p.market_id = mp.old_id;

-- 3) Artık kimsenin işaret etmediği dublike market satırlarını sil
with canon as (
  select distinct on (match_id, market_type)
         id as keep_id, match_id, market_type
  from public.bet_markets
  order by match_id, market_type, created_at
)
delete from public.bet_markets m
using canon c
where c.match_id = m.match_id
  and c.market_type = m.market_type
  and m.id <> c.keep_id;

-- 4) Tekrar oluşmasını engelle: maç başına her kategoriden TEK market
create unique index if not exists bet_markets_match_type_uniq
  on public.bet_markets (match_id, market_type);

commit;

-- 5) Bittikten sonra Admin panel → Kullanıcılar → "🔁 Puanları Yeniden Hesapla"
