import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function calcPoints(odds: number): number {
  const base = Math.floor(odds * 10)
  if (odds >= 15) return base + Math.floor(base * 0.5)
  if (odds >= 7)  return base + Math.floor(base * 0.2)
  return base
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

      // bet_options doğru/yanlış işaretle
      const { data: marketRows } = await supabase
        .from('bet_markets')
        .select('id')
        .eq('match_id', match.id)

      const marketIds = marketRows?.map(m => m.id) ?? []

      const { data: options } = await supabase
        .from('bet_options')
        .select('id, outcome_key, market_id')
        .in('market_id', marketIds)

      for (const opt of options ?? []) {
        await supabase.from('bet_options').update({
          is_correct: opt.outcome_key === result
        }).eq('id', opt.id)
      }

      // Tahminleri puanla
      const { data: predictions } = await supabase
        .from('predictions')
        .select('id, user_id, option_id, odds_at_prediction')
        .eq('match_id', match.id)

      // Kullanıcı başına puan topla
      const userPoints: Record<string, { total: number; correct: number; surprise: number; count: number }> = {}

      for (const pred of predictions ?? []) {
        const opt = options?.find(o => o.id === pred.option_id)
        const isCorrect = opt?.outcome_key === result
        const points = isCorrect ? calcPoints(Number(pred.odds_at_prediction)) : 0
        const surpriseBonus = isCorrect && Number(pred.odds_at_prediction) >= 7
          ? points - Math.floor(Number(pred.odds_at_prediction) * 10)
          : 0

        await supabase.from('predictions').update({
          is_correct: isCorrect,
          points_earned: points
        }).eq('id', pred.id)

        if (!userPoints[pred.user_id]) userPoints[pred.user_id] = { total: 0, correct: 0, surprise: 0, count: 0 }
        userPoints[pred.user_id].total   += points
        userPoints[pred.user_id].correct += isCorrect ? 1 : 0
        userPoints[pred.user_id].surprise += surpriseBonus
        userPoints[pred.user_id].count   += 1
      }

      // leaderboard_cache güncelle
      for (const [userId, pts] of Object.entries(userPoints)) {
        const { data: existing } = await supabase
          .from('leaderboard_cache')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle()

        await supabase.from('leaderboard_cache').upsert({
          user_id: userId,
          total_points:        (existing?.total_points        ?? 0) + pts.total,
          correct_predictions: (existing?.correct_predictions ?? 0) + pts.correct,
          total_predictions:   (existing?.total_predictions   ?? 0) + pts.count,
          surprise_bonus:      (existing?.surprise_bonus      ?? 0) + pts.surprise,
          last_updated: new Date().toISOString()
        })
      }

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
