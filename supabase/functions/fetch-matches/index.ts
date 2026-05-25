import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const TEAM_FLAGS: Record<string, string> = {
  // Kuzey Amerika
  'United States': '🇺🇸', 'USA': '🇺🇸',
  'Mexico': '🇲🇽', 'Canada': '🇨🇦',
  'Costa Rica': '🇨🇷', 'Panama': '🇵🇦', 'Honduras': '🇭🇳',
  'El Salvador': '🇸🇻', 'Jamaica': '🇯🇲', 'Trinidad and Tobago': '🇹🇹',
  'Guatemala': '🇬🇹', 'Cuba': '🇨🇺',
  // Güney Amerika
  'Brazil': '🇧🇷', 'Argentina': '🇦🇷', 'Colombia': '🇨🇴',
  'Uruguay': '🇺🇾', 'Chile': '🇨🇱', 'Ecuador': '🇪🇨',
  'Peru': '🇵🇪', 'Paraguay': '🇵🇾', 'Bolivia': '🇧🇴',
  'Venezuela': '🇻🇪',
  // Avrupa
  'France': '🇫🇷', 'Germany': '🇩🇪', 'Spain': '🇪🇸',
  'England': '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'Portugal': '🇵🇹', 'Netherlands': '🇳🇱',
  'Italy': '🇮🇹', 'Belgium': '🇧🇪', 'Croatia': '🇭🇷',
  'Serbia': '🇷🇸', 'Switzerland': '🇨🇭', 'Denmark': '🇩🇰',
  'Austria': '🇦🇹', 'Turkey': '🇹🇷', 'Poland': '🇵🇱',
  'Ukraine': '🇺🇦', 'Scotland': '🏴󠁧󠁢󠁳󠁣󠁴󠁿', 'Wales': '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
  'Czech Republic': '🇨🇿', 'Slovakia': '🇸🇰', 'Hungary': '🇭🇺',
  'Romania': '🇷🇴', 'Greece': '🇬🇷', 'Norway': '🇳🇴',
  'Sweden': '🇸🇪', 'Finland': '🇫🇮', 'Iceland': '🇮🇸',
  'Albania': '🇦🇱', 'North Macedonia': '🇲🇰', 'Slovenia': '🇸🇮',
  'Bosnia and Herzegovina': '🇧🇦', 'Montenegro': '🇲🇪',
  'Kosovo': '🇽🇰', 'Georgia': '🇬🇪', 'Armenia': '🇦🇲',
  // Afrika
  'Morocco': '🇲🇦', 'Senegal': '🇸🇳', 'Nigeria': '🇳🇬',
  'Cameroon': '🇨🇲', 'Ghana': '🇬🇭', 'Egypt': '🇪🇬',
  'Tunisia': '🇹🇳', 'Algeria': '🇩🇿', 'Ivory Coast': '🇨🇮',
  "Cote d'Ivoire": '🇨🇮', 'Mali': '🇲🇱', 'South Africa': '🇿🇦',
  'DR Congo': '🇨🇩', 'Congo DR': '🇨🇩', 'Zambia': '🇿🇲',
  'Tanzania': '🇹🇿', 'Uganda': '🇺🇬', 'Zimbabwe': '🇿🇼',
  'Cape Verde': '🇨🇻', 'Angola': '🇦🇴', 'Benin': '🇧🇯',
  'Comoros': '🇰🇲', 'Equatorial Guinea': '🇬🇶',
  // Asya
  'Japan': '🇯🇵', 'South Korea': '🇰🇷', 'Australia': '🇦🇺',
  'Saudi Arabia': '🇸🇦', 'Iran': '🇮🇷', 'Qatar': '🇶🇦',
  'China': '🇨🇳', 'India': '🇮🇳', 'Iraq': '🇮🇶',
  'Jordan': '🇯🇴', 'UAE': '🇦🇪', 'Uzbekistan': '🇺🇿',
  'Oman': '🇴🇲', 'Bahrain': '🇧🇭', 'Kuwait': '🇰🇼',
  'Indonesia': '🇮🇩', 'Thailand': '🇹🇭', 'Vietnam': '🇻🇳',
  'Philippines': '🇵🇭', 'Malaysia': '🇲🇾',
  // Pasifik
  'New Zealand': '🇳🇿',
}

function getFlag(teamName: string): string {
  if (TEAM_FLAGS[teamName]) return TEAM_FLAGS[teamName]
  // Kısmi eşleşme dene
  for (const [name, flag] of Object.entries(TEAM_FLAGS)) {
    if (teamName.toLowerCase().includes(name.toLowerCase()) ||
        name.toLowerCase().includes(teamName.toLowerCase())) {
      return flag
    }
  }
  return '🏴'
}

async function upsertMarketAndOptions(
  supabase: any,
  matchId: string,
  mType: string,
  label: string,
  options: { label: string; odds_value: number; outcome_key: string }[]
) {
  let { data: dbMarket } = await supabase
    .from('bet_markets')
    .select('id')
    .eq('match_id', matchId)
    .eq('market_type', mType)
    .eq('label', label)
    .maybeSingle()

  if (!dbMarket) {
    const { data: newM } = await supabase
      .from('bet_markets')
      .insert({ match_id: matchId, market_type: mType, label, is_active: true })
      .select()
      .single()
    dbMarket = newM
  }

  if (dbMarket) {
    await supabase.from('bet_options').delete().eq('market_id', dbMarket.id)
    await supabase.from('bet_options').insert(
      options.map(o => ({ ...o, market_id: dbMarket.id }))
    )
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const ODDS_API_KEY = Deno.env.get('ODDS_API_KEY')!
    const ODDS_API_BASE = 'https://api.the-odds-api.com/v4'
    const sportKey = 'soccer_fifa_world_cup'

    // h2h + totals + btts tek çağrıda çek
    const oddsUrl = `${ODDS_API_BASE}/sports/${sportKey}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h&oddsFormat=decimal`
    const oddsRes = await fetch(oddsUrl)
    const oddsData = await oddsRes.json()

    if (!Array.isArray(oddsData)) {
      return new Response(JSON.stringify({ error: oddsData.message || 'API hatası' }), { status: 400, headers: corsHeaders })
    }

    let marketsCreated = 0

    for (const match of oddsData.slice(0, 20)) {
      const homeFlag = getFlag(match.home_team)
      const awayFlag = getFlag(match.away_team)

      // Mevcut maç kontrolü
      const { data: existing } = await supabase
        .from('matches')
        .select('id')
        .eq('odds_api_id', match.id)
        .maybeSingle()

      let dbMatchId: string

      if (!existing) {
        const { data: newMatch } = await supabase.from('matches').insert({
          odds_api_id: match.id,
          home_team: match.home_team,
          away_team: match.away_team,
          home_flag: homeFlag,
          away_flag: awayFlag,
          match_time: match.commence_time,
          group_name: match.sport_title,
          status: 'draft',
          is_admin_approved: false
        }).select('id').single()

        if (!newMatch) continue
        dbMatchId = newMatch.id
      } else {
        // Bayrakları ve zamanı güncelle
        await supabase.from('matches').update({
          match_time: match.commence_time,
          home_flag: homeFlag,
          away_flag: awayFlag,
        }).eq('id', existing.id)
        dbMatchId = existing.id
      }

      // Tüm bookmaker'lardan marketleri topla (daha fazla coverage için)
      // ── Maç Sonucu (1X2) ──
      for (const bm of match.bookmakers ?? []) {
        const h2h = bm.markets?.find((m: any) => m.key === 'h2h')
        if (!h2h?.outcomes?.length) continue

        const homeOut = h2h.outcomes.find((o: any) => o.name === match.home_team)
        const awayOut = h2h.outcomes.find((o: any) => o.name === match.away_team)
        const drawOut = h2h.outcomes.find((o: any) => o.name !== match.home_team && o.name !== match.away_team)

        const opts = []
        if (homeOut) opts.push({ label: '1', odds_value: homeOut.price, outcome_key: 'home_win' })
        if (drawOut) opts.push({ label: 'X', odds_value: drawOut.price, outcome_key: 'draw' })
        if (awayOut) opts.push({ label: '2', odds_value: awayOut.price, outcome_key: 'away_win' })

        if (opts.length >= 2) {
          await upsertMarketAndOptions(supabase, dbMatchId, '1x2', 'Maç Sonucu', opts)
          marketsCreated++
        }
        break // ilk bookmaker yeterli
      }

      await new Promise(r => setTimeout(r, 150))
    }

    return new Response(JSON.stringify({
      success: true,
      message: `${oddsData.length} maç işlendi, ${marketsCreated} market oluşturuldu/güncellendi.`
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
