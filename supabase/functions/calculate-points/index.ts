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
      .select('result')
      .eq('id', match_id)
      .single()

    if (!match?.result) {
      return new Response(JSON.stringify({ error: 'Maç sonucu girilmemiş' }), { status: 400, headers: corsHeaders })
    }

    const { data: marketRows } = await supabase
      .from('bet_markets')
      .select('id')
      .eq('match_id', match_id)

    const marketIds = marketRows?.map(m => m.id) ?? []

    const { data: options } = await supabase
      .from('bet_options')
      .select('id, outcome_key, market_id')
      .in('market_id', marketIds)

    for (const opt of options ?? []) {
      await supabase.from('bet_options').update({
        is_correct: opt.outcome_key === match.result
      }).eq('id', opt.id)
    }

    const { data: preds } = await supabase
      .from('predictions')
      .select('id, user_id, option_id')
      .eq('match_id', match_id)

    const userPoints: Record<string, { total: number; correct: number; count: number }> = {}

    for (const pred of preds ?? []) {
      const isCorrect = options?.find(o => o.id === pred.option_id)?.outcome_key === match.result
      const points = isCorrect ? 1 : 0

      await supabase.from('predictions').update({
        is_correct: isCorrect,
        points_earned: points
      }).eq('id', pred.id)

      if (!userPoints[pred.user_id]) userPoints[pred.user_id] = { total: 0, correct: 0, count: 0 }
      userPoints[pred.user_id].total   += points
      userPoints[pred.user_id].correct += isCorrect ? 1 : 0
      userPoints[pred.user_id].count   += 1
    }

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
