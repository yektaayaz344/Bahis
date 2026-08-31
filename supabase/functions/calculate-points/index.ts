import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { match_id } = await req.json()
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: match } = await supabase
      .from('matches')
      .select('home_score, away_score, result')
      .eq('id', match_id)
      .single()

    if (!match?.result) {
      return new Response(JSON.stringify({ error: 'Maç sonucu henüz girilmemiş' }), { status: 400, headers: corsHeaders })
    }

    const { data: marketRows } = await supabase
      .from('bet_markets')
      .select('id, market_type')
      .eq('match_id', match_id)

    const marketMap = new Map(marketRows?.map(m => [m.id, m.market_type]))
    const marketIds = marketRows?.map(m => m.id) ?? []

    const { data: options } = await supabase
      .from('bet_options')
      .select('id, outcome_key, market_id')
      .in('market_id', marketIds)

    const optionMap = new Map(options?.map(o => [o.id, o]))

    const { data: preds } = await supabase
      .from('predictions')
      .select('*')
      .eq('match_id', match_id)

    const userPoints: Record<string, { totalPts: number; correct1x2: number; exactScores: number; count: number }> = {}

    for (const pred of preds ?? []) {
      const mType = marketMap.get(pred.market_id)
      const opt = optionMap.get(pred.option_id)
      let pts = 0
      let isCorrect = false

      if (mType === '1x2') {
        if (opt && opt.outcome_key === match.result) {
          pts = 10
          isCorrect = true
        }
      } else if (mType === 'exact_score') {
        if (
          pred.predicted_home_score !== null &&
          pred.predicted_away_score !== null &&
          pred.predicted_home_score === match.home_score &&
          pred.predicted_away_score === match.away_score
        ) {
          pts = 50
          isCorrect = true
        }
      }

      await supabase.from('predictions').update({
        is_correct: isCorrect,
        points_earned: pts
      }).eq('id', pred.id)

      if (!userPoints[pred.user_id]) {
        userPoints[pred.user_id] = { totalPts: 0, correct1x2: 0, exactScores: 0, count: 0 }
      }

      userPoints[pred.user_id].totalPts += pts
      if (mType === '1x2' && isCorrect) userPoints[pred.user_id].correct1x2 += 1
      if (mType === 'exact_score' && isCorrect) userPoints[pred.user_id].exactScores += 1
      userPoints[pred.user_id].count += 1
    }

    for (const [userId, stats] of Object.entries(userPoints)) {
      const { data: existing } = await supabase
        .from('leaderboard_cache')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle()

      await supabase.from('leaderboard_cache').upsert({
        user_id: userId,
        total_points:        (existing?.total_points        ?? 0) + stats.totalPts,
        correct_predictions: (existing?.correct_predictions ?? 0) + stats.correct1x2,
        exact_scores_count:  (existing?.exact_scores_count  ?? 0) + stats.exactScores,
        total_predictions:   (existing?.total_predictions   ?? 0) + stats.count,
        last_updated: new Date().toISOString()
      })
    }

    return new Response(JSON.stringify({
      success: true,
      processed: preds?.length ?? 0
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
