import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const ODDS_API_KEY = Deno.env.get('ODDS_API_KEY')!
    const sport = 'soccer_fifa_world_cup'

    // Son 3 günün skorlarını çek
    const url = `https://api.the-odds-api.com/v4/sports/${sport}/scores/?apiKey=${ODDS_API_KEY}&daysFrom=3`
    const res = await fetch(url)
    const games = await res.json()

    if (!Array.isArray(games)) {
      return new Response(JSON.stringify({ error: games.message || 'API hatası' }), { status: 400, headers: corsHeaders })
    }

    let updated = 0
    let skipped = 0

    for (const game of games) {
      if (!game.completed || !game.scores) { skipped++; continue }

      const homeScore = game.scores.find((s: any) => s.name === game.home_team)?.score
      const awayScore = game.scores.find((s: any) => s.name === game.away_team)?.score
      if (homeScore === undefined || awayScore === undefined) continue

      const homeGoals = parseInt(homeScore)
      const awayGoals = parseInt(awayScore)

      let result: string
      if (homeGoals > awayGoals)      result = 'home_win'
      else if (awayGoals > homeGoals) result = 'away_win'
      else                            result = 'draw'

      const { data: match } = await supabase
        .from('matches')
        .select('id, status')
        .eq('odds_api_id', game.id)
        .maybeSingle()

      if (!match) continue
      if (match.status === 'finished') { skipped++; continue }

      // Skoru güncelle
      await supabase.from('matches').update({
        home_score: homeGoals,
        away_score: awayGoals,
        result: result,
        status: 'finished'
      }).eq('id', match.id)

      // NOT: Puanlama admin panelinden yapılır (1X2 + Tam Skor otomatik, Golcü elle).
      // Bu fonksiyon sadece maç skorunu/sonucunu doldurur; tahminlere DOKUNMAZ ki
      // admin'in elle verdiği golcü puanları ezilmesin.
      updated++
    }

    return new Response(JSON.stringify({
      success: true,
      message: `${updated} maç sonucu güncellendi, ${skipped} maç atlandı.`
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
