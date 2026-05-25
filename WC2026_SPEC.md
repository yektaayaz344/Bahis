# WC2026 Arkadaş Bahis Uygulaması — Claude Code Geliştirme Rehberi

> **Stack:** Supabase (Auth + PostgreSQL + Edge Functions) · Vanilla HTML/JS · The Odds API · Netlify  
> **Amaç:** Arkadaş grupları için kapalı sistem WC2026 bahis uygulaması. Admin hangi maçların ve bahis türlerinin açılacağını belirler. Puan sistemi gerçek bahis oranlarına dayanır.

---

## Genel Mimari

```
Browser (HTML/JS)
  └─ supabase-js client (CDN)
        ├── Auth          → Giriş/kayıt
        ├── Database      → Maçlar, tahminler, puanlar
        └── Edge Functions → Odds API çekme, puan hesaplama
```

Sunucu yok. Backend = Supabase. Frontend = statik HTML dosyaları → Netlify'a deploy.

---

## ADIM 1 — Supabase Projesi Kur

1. [supabase.com](https://supabase.com) → yeni proje oluştur, adı: `wc2026-bahis`
2. `Project Settings → API` ekranından şunları not al:
   - `Project URL` → `SUPABASE_URL`
   - `anon public` key → `SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (Edge Functions için, asla frontend'e koyma)
3. `Authentication → Settings`:
   - **Email confirm: KAPAT** (davet sistemi için)
   - Site URL: `https://wc2026-bahis.netlify.app` (deploy sonrası güncellenecek)

---

## ADIM 2 — Veritabanı Şemasını Oluştur

Supabase Dashboard → **SQL Editor**'de aşağıdaki migration'ları sırayla çalıştır.

### 2.1 — `users` tablosu

```sql
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  avatar_color text default '#B5D4F4',
  is_admin boolean default false,
  invited_by uuid references public.users(id),
  created_at timestamptz default now()
);

-- Auth kayıt olunca otomatik profil oluştur
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, username)
  values (new.id, split_part(new.email, '@', 1));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

### 2.2 — `matches` tablosu

```sql
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  odds_api_id text unique not null,
  home_team text not null,
  away_team text not null,
  home_flag text default '🏳️',
  away_flag text default '🏳️',
  match_time timestamptz not null,
  group_name text,
  status text default 'draft' check (status in ('draft','open','locked','finished')),
  home_score integer,
  away_score integer,
  result text check (result in ('home_win','away_win','draw')),
  is_admin_approved boolean default false,
  created_at timestamptz default now()
);
```

> **Önemli:** `is_admin_approved = false` olan maçlar kullanıcılara hiç görünmez. Admin onaylayana kadar sadece admin panelinde görülür.

### 2.3 — `bet_markets` tablosu

```sql
create table public.bet_markets (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references public.matches(id) on delete cascade,
  market_type text not null check (market_type in ('1x2','over_under','btts','correct_score','custom')),
  label text not null,
  is_active boolean default true,
  lock_before_minutes integer default 60,
  created_at timestamptz default now()
);
```

> **Önemli:** Admin her maça istediği market türlerini tek tek ekler. Eklenmemiş market kullanıcıya görünmez.

### 2.4 — `bet_options` tablosu

```sql
create table public.bet_options (
  id uuid primary key default gen_random_uuid(),
  market_id uuid references public.bet_markets(id) on delete cascade,
  label text not null,
  odds_value numeric(6,2) not null,
  outcome_key text not null,
  is_correct boolean,
  created_at timestamptz default now()
);
```

### 2.5 — `predictions` tablosu

```sql
create table public.predictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  match_id uuid references public.matches(id) on delete cascade,
  market_id uuid references public.bet_markets(id) on delete cascade,
  option_id uuid references public.bet_options(id) on delete cascade,
  odds_at_prediction numeric(6,2) not null,
  points_earned integer default 0,
  is_correct boolean,
  created_at timestamptz default now(),
  unique(user_id, market_id)  -- Her kullanıcı her market için sadece 1 tahmin
);
```

### 2.6 — `leaderboard_cache` tablosu

```sql
create table public.leaderboard_cache (
  user_id uuid primary key references public.users(id) on delete cascade,
  total_points integer default 0,
  correct_predictions integer default 0,
  total_predictions integer default 0,
  surprise_bonus integer default 0,
  last_updated timestamptz default now()
);
```

---

## ADIM 3 — Row Level Security (RLS) Politikaları

Her tablo için RLS aktif et ve aşağıdaki kuralları uygula.

```sql
-- RLS'yi aktif et
alter table public.users enable row level security;
alter table public.matches enable row level security;
alter table public.bet_markets enable row level security;
alter table public.bet_options enable row level security;
alter table public.predictions enable row level security;
alter table public.leaderboard_cache enable row level security;

-- USERS
create policy "users_select" on public.users for select using (true);
create policy "users_update_own" on public.users for update using (auth.uid() = id);

-- MATCHES: sadece admin onaylananlar görünür
create policy "matches_select_approved" on public.matches
  for select using (is_admin_approved = true);
create policy "matches_admin_all" on public.matches
  for all using (
    exists (select 1 from public.users where id = auth.uid() and is_admin = true)
  );

-- BET_MARKETS: aktif olanlar görünür
create policy "markets_select_active" on public.bet_markets
  for select using (is_active = true);
create policy "markets_admin_all" on public.bet_markets
  for all using (
    exists (select 1 from public.users where id = auth.uid() and is_admin = true)
  );

-- BET_OPTIONS
create policy "options_select" on public.bet_options for select using (true);
create policy "options_admin_all" on public.bet_options
  for all using (
    exists (select 1 from public.users where id = auth.uid() and is_admin = true)
  );

-- PREDICTIONS: kendi tahminini görür, admin hepsini görür
create policy "predictions_select_own" on public.predictions
  for select using (
    auth.uid() = user_id or
    exists (select 1 from public.users where id = auth.uid() and is_admin = true)
  );
create policy "predictions_insert_own" on public.predictions
  for insert with check (auth.uid() = user_id);
create policy "predictions_update_own" on public.predictions
  for update using (auth.uid() = user_id);

-- LEADERBOARD: herkes görebilir
create policy "leaderboard_select" on public.leaderboard_cache for select using (true);
```

---

## ADIM 4 — Edge Functions

Supabase CLI kur: `npm install -g supabase`  
Projeye bağlan: `supabase link --project-ref <proje-id>`

### 4.1 — `fetch-matches` Edge Function

**Dosya:** `supabase/functions/fetch-matches/index.ts`

Bu fonksiyon The Odds API'den WC2026 maçlarını çeker ve `matches` tablosuna kaydeder.

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TEAM_FLAGS: Record<string, string> = {
  'Brazil': '🇧🇷', 'Argentina': '🇦🇷', 'France': '🇫🇷', 'Germany': '🇩🇪',
  'Spain': '🇪🇸', 'England': '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'Portugal': '🇵🇹', 'Netherlands': '🇳🇱',
  'Italy': '🇮🇹', 'Japan': '🇯🇵', 'Morocco': '🇲🇦', 'USA': '🇺🇸',
  'Mexico': '🇲🇽', 'South Korea': '🇰🇷', 'Croatia': '🇭🇷', 'Turkey': '🇹🇷',
  'Honduras': '🇭🇳', 'Serbia': '🇷🇸',
  // Gerekirse ekle
}

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const ODDS_API_KEY = Deno.env.get('ODDS_API_KEY')!
  const url = `https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h,totals,btts&oddsFormat=decimal`

  const res = await fetch(url)
  const games = await res.json()

  let inserted = 0, updated = 0

  for (const game of games) {
    const homeFlag = TEAM_FLAGS[game.home_team] ?? '🏳️'
    const awayFlag = TEAM_FLAGS[game.away_team] ?? '🏳️'

    const { data: existing } = await supabase
      .from('matches')
      .select('id')
      .eq('odds_api_id', game.id)
      .single()

    if (existing) {
      // Oranlar güncellenmiş olabilir — bet_options güncelle ama match'i dokunma
      updated++
    } else {
      await supabase.from('matches').insert({
        odds_api_id: game.id,
        home_team: game.home_team,
        away_team: game.away_team,
        home_flag: homeFlag,
        away_flag: awayFlag,
        match_time: game.commence_time,
        status: 'draft',
        is_admin_approved: false
      })
      inserted++
    }
  }

  return new Response(JSON.stringify({ inserted, updated, total: games.length }), {
    headers: { 'Content-Type': 'application/json' }
  })
})
```

Deploy: `supabase functions deploy fetch-matches`  
Secret ekle: `supabase secrets set ODDS_API_KEY=<the-odds-api-key>`

### 4.2 — `calculate-points` Edge Function

**Dosya:** `supabase/functions/calculate-points/index.ts`

Maç bittikten sonra admin tetikler. İlgili tüm tahminlerin puanını hesaplar.

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Puan formülü
function calcPoints(odds: number): number {
  const base = Math.floor(odds * 10)
  let bonus = 0
  if (odds >= 15) bonus = Math.floor(base * 0.5)       // +%50 bonus
  else if (odds >= 7) bonus = Math.floor(base * 0.2)   // +%20 bonus
  return base + bonus
}

Deno.serve(async (req) => {
  const { match_id } = await req.json()
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // 1. Maçın sonucunu al
  const { data: match } = await supabase
    .from('matches')
    .select('result, home_score, away_score')
    .eq('id', match_id)
    .single()

  if (!match?.result) {
    return new Response(JSON.stringify({ error: 'Maç sonucu girilmemiş' }), { status: 400 })
  }

  // 2. Bu maça ait tüm bet_options'ı işaretle
  const { data: options } = await supabase
    .from('bet_options')
    .select('id, outcome_key, market_id')
    .in('market_id',
      (await supabase.from('bet_markets').select('id').eq('match_id', match_id)).data!.map(m => m.id)
    )

  for (const opt of options ?? []) {
    const isCorrect = opt.outcome_key === match.result
    await supabase.from('bet_options').update({ is_correct: isCorrect }).eq('id', opt.id)
  }

  // 3. Bu maça ait tüm tahminleri bul ve puan ver
  const { data: predictions } = await supabase
    .from('predictions')
    .select('id, user_id, option_id, odds_at_prediction')
    .eq('match_id', match_id)

  const userPoints: Record<string, { total: number, correct: number, surprise: number }> = {}

  for (const pred of predictions ?? []) {
    const correctOpt = options?.find(o => o.id === pred.option_id)
    const isCorrect = correctOpt?.is_correct ?? false
    const points = isCorrect ? calcPoints(pred.odds_at_prediction) : 0
    const surpriseBonus = isCorrect && pred.odds_at_prediction >= 7
      ? points - Math.floor(pred.odds_at_prediction * 10)
      : 0

    await supabase.from('predictions').update({
      is_correct: isCorrect,
      points_earned: points
    }).eq('id', pred.id)

    if (!userPoints[pred.user_id]) userPoints[pred.user_id] = { total: 0, correct: 0, surprise: 0 }
    userPoints[pred.user_id].total += points
    userPoints[pred.user_id].correct += isCorrect ? 1 : 0
    userPoints[pred.user_id].surprise += surpriseBonus
  }

  // 4. leaderboard_cache güncelle
  for (const [userId, pts] of Object.entries(userPoints)) {
    const { data: existing } = await supabase
      .from('leaderboard_cache')
      .select('*')
      .eq('user_id', userId)
      .single()

    await supabase.from('leaderboard_cache').upsert({
      user_id: userId,
      total_points: (existing?.total_points ?? 0) + pts.total,
      correct_predictions: (existing?.correct_predictions ?? 0) + pts.correct,
      total_predictions: (existing?.total_predictions ?? 0) + (predictions?.filter(p => p.user_id === userId).length ?? 0),
      surprise_bonus: (existing?.surprise_bonus ?? 0) + pts.surprise,
      last_updated: new Date().toISOString()
    })
  }

  // 5. Maçı finished yap
  await supabase.from('matches').update({ status: 'finished' }).eq('id', match_id)

  return new Response(JSON.stringify({ success: true, processed: predictions?.length }), {
    headers: { 'Content-Type': 'application/json' }
  })
})
```

Deploy: `supabase functions deploy calculate-points`

### 4.3 — `lock-markets` Edge Function (Otomatik Kilit)

**Dosya:** `supabase/functions/lock-markets/index.ts`

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Kilitlenme zamanı geçmiş aktif marketleri bul ve kapat
  const { data: markets } = await supabase
    .from('bet_markets')
    .select('id, match_id, lock_before_minutes, matches(match_time)')
    .eq('is_active', true)

  let locked = 0
  for (const market of markets ?? []) {
    const matchTime = new Date((market.matches as any).match_time)
    const lockTime = new Date(matchTime.getTime() - market.lock_before_minutes * 60 * 1000)
    if (new Date() >= lockTime) {
      await supabase.from('bet_markets').update({ is_active: false }).eq('id', market.id)
      locked++
    }
  }

  return new Response(JSON.stringify({ locked }), {
    headers: { 'Content-Type': 'application/json' }
  })
})
```

**pg_cron ile her 5 dakikada otomatik tetikle** (SQL Editor'de çalıştır):

```sql
select cron.schedule(
  'lock-markets-job',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/lock-markets',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  $$
);
```

---

## ADIM 5 — Frontend Dosya Yapısı

```
/
├── index.html           → Giriş kontrolü, yönlendirme
├── auth.html            → Login sayfası
├── matches.html         → Maçlar + tahmin yapma
├── leaderboard.html     → Sıralama tablosu
├── my-stats.html        → Kişisel istatistikler
├── admin.html           → Admin paneli
├── js/
│   ├── supabase.js      → Client başlatma (tek yer)
│   ├── auth.js          → Oturum yönetimi
│   ├── matches.js       → Maç listesi, tahmin gönderme
│   ├── leaderboard.js   → Sıralama
│   ├── stats.js         → Kişisel istatistik
│   └── admin.js         → Admin işlemleri
└── css/
    └── style.css        → Stiller
```

### 5.1 — `js/supabase.js`

```javascript
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

export const supabase = createClient(
  'https://PROJE_ID.supabase.co',   // SUPABASE_URL buraya
  'eyJ...'                           // SUPABASE_ANON_KEY buraya
)
```

### 5.2 — `js/auth.js`

```javascript
import { supabase } from './supabase.js'

// Oturum kontrolü — her sayfanın başında çağır
export async function requireAuth() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    window.location.href = '/auth.html'
    return null
  }
  return session
}

// Admin kontrolü
export async function requireAdmin() {
  const session = await requireAuth()
  if (!session) return false
  const { data: user } = await supabase
    .from('users')
    .select('is_admin')
    .eq('id', session.user.id)
    .single()
  if (!user?.is_admin) {
    window.location.href = '/matches.html'
    return false
  }
  return true
}

// Giriş
export async function login(email, password) {
  return await supabase.auth.signInWithPassword({ email, password })
}

// Çıkış
export async function logout() {
  await supabase.auth.signOut()
  window.location.href = '/auth.html'
}
```

### 5.3 — `matches.html` — Maç Listesi & Tahmin

Bu sayfada yapılması gerekenler:

1. Sayfa yüklenince `requireAuth()` çağır.
2. Supabase'den onaylı ve açık maçları çek:
   ```javascript
   const { data: matches } = await supabase
     .from('matches')
     .select(`
       *,
       bet_markets (
         *,
         bet_options (*)
       )
     `)
     .eq('is_admin_approved', true)
     .in('status', ['open', 'locked', 'finished'])
     .order('match_time', { ascending: true })
   ```
3. Her maç için bir kart render et. Market varsa altında bahis seçeneklerini göster.
4. Kilitli market (`is_active = false`) → seçenekler disabled göster.
5. Kullanıcının daha önce yaptığı tahminleri de çek ve kartlarda göster:
   ```javascript
   const { data: myPredictions } = await supabase
     .from('predictions')
     .select('market_id, option_id, points_earned, is_correct')
     .eq('user_id', session.user.id)
   ```
6. Tahmin gönderme:
   ```javascript
   async function submitPrediction(marketId, matchId, optionId, oddsValue) {
     const { error } = await supabase.from('predictions').upsert({
       user_id: session.user.id,
       match_id: matchId,
       market_id: marketId,
       option_id: optionId,
       odds_at_prediction: oddsValue
     }, { onConflict: 'user_id,market_id' })
     if (error) console.error(error)
   }
   ```

### 5.4 — `leaderboard.html` — Sıralama

```javascript
const { data: leaderboard } = await supabase
  .from('leaderboard_cache')
  .select('*, users(username, avatar_color)')
  .order('total_points', { ascending: false })
```

Sütunlar: Sıra · İsim · Toplam Puan · Doğru/Toplam · Sürpriz Bonus

### 5.5 — `my-stats.html` — Kişisel İstatistik

```javascript
const { data: myPreds } = await supabase
  .from('predictions')
  .select('*, bet_options(label, odds_value), matches(home_team, away_team, home_flag, away_flag)')
  .eq('user_id', session.user.id)
  .order('created_at', { ascending: false })
```

Göster: Toplam puan · Doğru/Toplam oran · Sürpriz bonus · Son 10 tahmin listesi

---

## ADIM 6 — Admin Paneli (`admin.html`)

Sayfa başında `requireAdmin()` çağır. Falsy dönerse yönlendir.

### 6.1 — Maç Yönetimi

**A) Maçları API'den Çek:**
```javascript
// Admin panosundaki "Maçları Güncelle" butonuna basınca
await supabase.functions.invoke('fetch-matches')
```

**B) Draft Maçları Listele ve Onayla:**
```javascript
// Admin tüm maçları görür (RLS'de admin bypass var)
const { data: draftMatches } = await supabase
  .from('matches')
  .select('*')
  .eq('is_admin_approved', false)
  .order('match_time', { ascending: true })

// Onayla butonu
async function approveMatch(matchId) {
  await supabase.from('matches').update({
    is_admin_approved: true,
    status: 'open'
  }).eq('id', matchId)
}
```

### 6.2 — Market Ekleme

Admin bir maçı onayladıktan sonra o maça market ekleyebilir:

```javascript
async function addMarket(matchId, marketType, label, lockBeforeMinutes = 60) {
  const { data: market } = await supabase.from('bet_markets').insert({
    match_id: matchId,
    market_type: marketType,  // '1x2' | 'over_under' | 'btts' | 'custom'
    label: label,             // Örn: "Maç Sonucu", "2.5 Üst/Alt", "Her İki Takım Gol Atar"
    is_active: true,
    lock_before_minutes: lockBeforeMinutes
  }).select().single()
  return market
}
```

Market eklendikten sonra seçenekleri ekle:

```javascript
// 1X2 için standart seçenekler
async function add1x2Options(marketId, homeTeam, awayTeam, homeOdds, drawOdds, awayOdds) {
  await supabase.from('bet_options').insert([
    { market_id: marketId, label: `${homeTeam} kazanır`, odds_value: homeOdds, outcome_key: 'home_win' },
    { market_id: marketId, label: 'Beraberlik', odds_value: drawOdds, outcome_key: 'draw' },
    { market_id: marketId, label: `${awayTeam} kazanır`, odds_value: awayOdds, outcome_key: 'away_win' },
  ])
}

// Over/Under için
async function addOverUnderOptions(marketId, line, overOdds, underOdds) {
  await supabase.from('bet_options').insert([
    { market_id: marketId, label: `${line} Üstü`, odds_value: overOdds, outcome_key: `over_${line}` },
    { market_id: marketId, label: `${line} Altı`, odds_value: underOdds, outcome_key: `under_${line}` },
  ])
}
```

**Not:** Oranlar The Odds API'den fetch-matches fonksiyonu çağrılınca admin panelinde otomatik görüntülenir. Admin bu oranları seçeneklere kopyalar ya da manuel girer.

### 6.3 — Skor Girişi ve Puan Hesaplama

```javascript
async function enterScore(matchId, homeScore, awayScore) {
  let result = 'draw'
  if (homeScore > awayScore) result = 'home_win'
  else if (awayScore > homeScore) result = 'away_win'

  await supabase.from('matches').update({
    home_score: homeScore,
    away_score: awayScore,
    result: result,
    status: 'finished'
  }).eq('id', matchId)

  // Puanları hesapla
  await supabase.functions.invoke('calculate-points', {
    body: { match_id: matchId }
  })
}
```

---

## ADIM 7 — Puan Sistemi Özeti

Kod yazarken bu formülü birebir uygula:

```javascript
function calcPoints(odds) {
  const base = Math.floor(odds * 10)
  if (odds >= 15) return base + Math.floor(base * 0.5)  // +%50 sürpriz bonus
  if (odds >= 7)  return base + Math.floor(base * 0.2)  // +%20 sürpriz bonus
  return base
}
```

| Oran | Temel Puan | Bonus | Toplam |
|------|-----------|-------|--------|
| 1.18 (favori) | 11 | 0 | **11** |
| 1.65 | 16 | 0 | **16** |
| 4.50 | 45 | 0 | **45** |
| 7.00 | 70 | +14 | **84** |
| 9.00 | 90 | +18 | **108** |
| 15.00 | 150 | +75 | **225** |
| 18.00 (sürpriz) | 180 | +90 | **270** |

- Yanlış tahmin = 0 puan (eksi yok)
- `odds_at_prediction` snapshot alınır — oran değişse bile tahmin anındaki oran geçerlidir

---

## ADIM 8 — Netlify Deploy

1. Tüm statik dosyaları (HTML/CSS/JS) bir klasörde topla
2. [netlify.com](https://netlify.com) → "Deploy manually" → klasörü sürükle bırak
3. Site ayarları → Environment variables:
   - `SUPABASE_URL` = proje URL'i
   - `SUPABASE_ANON_KEY` = anon key
4. Supabase → Authentication → URL Configuration → Site URL'i Netlify adresiyle güncelle

---

## ADIM 9 — İlk Kullanıcı ve Arkadaş Daveti

### Admin yapma:
```sql
-- Supabase SQL Editor'de, kendi email'inle kayıt olduktan sonra:
UPDATE public.users SET is_admin = true WHERE id = auth.uid();
```

### Arkadaşları davet et:
Supabase Admin API ile davet emaili gönder (admin.html'de buton):

```javascript
async function inviteUser(email) {
  // Supabase service_role ile yapılır — Edge Function içinden çağırılmalı
  const res = await supabase.functions.invoke('invite-user', {
    body: { email }
  })
  return res
}
```

**`supabase/functions/invite-user/index.ts`** oluştur:

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  const { email } = await req.json()
  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  const { error } = await adminClient.auth.admin.inviteUserByEmail(email)
  return new Response(JSON.stringify({ success: !error, error: error?.message }), {
    headers: { 'Content-Type': 'application/json' }
  })
})
```

Deploy: `supabase functions deploy invite-user`

---

## Geliştirme Sırası (Önerilen)

```
[1] Supabase kur + SQL şemalarını oluştur (Adım 1-2)
[2] RLS politikalarını yaz (Adım 3)
[3] fetch-matches Edge Function + The Odds API key (Adım 4.1)
[4] Admin paneli — maç çekme, onaylama, market ekleme (Adım 6.1-6.2)
[5] Auth sayfası + supabase.js + auth.js (Adım 5.1-5.2)
[6] matches.html — maç listesi ve tahmin gönderme (Adım 5.3)
[7] calculate-points Edge Function (Adım 4.2)
[8] Admin — skor girişi ve puan tetikleme (Adım 6.3)
[9] leaderboard.html + my-stats.html (Adım 5.4-5.5)
[10] lock-markets Edge Function + cron (Adım 4.3)
[11] invite-user Edge Function (Adım 9)
[12] Netlify deploy (Adım 8)
```

---

## Önemli Notlar

- **SUPABASE_SERVICE_ROLE_KEY** asla frontend HTML/JS dosyalarına yazma. Sadece Edge Functions'ta kullan.
- **SUPABASE_ANON_KEY** frontend'e yazılabilir — RLS politikaları onu korur.
- The Odds API ücretsiz planda **500 istek/ay**. WC2026 grubu ~48 maç, günde 1 kez çekersen ~48 istek. Yeterli.
- `odds_at_prediction` tahmin anında snapshot alınır. Oran sonradan değişse bile kullanıcının puanı değişmez.
- Maç başlamadan en az 60 dakika önce marketler otomatik kilitlenir (`lock-markets` cron).
- Admin onaylamadığı sürece hiçbir maç ve market kullanıcıya görünmez (RLS + `is_admin_approved`).
