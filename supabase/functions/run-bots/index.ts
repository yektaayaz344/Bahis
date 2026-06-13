import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const body = await req.json().catch(() => ({}))
    const includeFinished = body.includeFinished === true

    // Get bots
    const { data: bots } = await supabase
      .from('users')
      .select('id, username')
      .eq('is_bot', true)

    if (!bots?.length) {
      return new Response(JSON.stringify({ error: 'Bot bulunamadı. Önce "Botları Kur" butonuna bas.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const favorici = bots.find(b => b.username === 'Favorici')
    const riskci   = bots.find(b => b.username === 'Riskci')
    const ortanci  = bots.find(b => b.username === 'Ortanci')

    // Get matches
    let query = supabase
      .from('matches')
      .select('id, status, bet_markets(id, bet_options(id, odds_value, outcome_key, is_correct))')
      .eq('is_admin_approved', true)

    if (!includeFinished) {
      query = query.neq('status', 'finished')
    }

    const { data: matches } = await query

    let predCount = 0

    for (const match of matches ?? []) {
      for (const market of match.bet_markets ?? []) {
        const opts = (market.bet_options ?? []).filter((o: any) => o.odds_value)
        if (!opts.length) continue

        const sorted = [...opts].sort((a: any, b: any) => a.odds_value - b.odds_value)
        const favOpt    = sorted[0]
        const riskyOpt  = sorted[sorted.length - 1]
        const midOpt    = sorted[Math.floor((sorted.length - 1) / 2)]

        const botPicks = [
          { bot: favorici, opt: favOpt },
          { bot: riskci,   opt: riskyOpt },
          { bot: ortanci,  opt: midOpt },
        ]

        for (const { bot, opt } of botPicks) {
          if (!bot || !opt) continue

          let isCorrect: boolean | null = null
          let pointsEarned = 0

          if (match.status === 'finished' && opt.is_correct !== null) {
            isCorrect = opt.is_correct === true
            pointsEarned = isCorrect ? Math.floor(Number(opt.odds_value) * 10) : 0
          }

          await supabase.from('predictions').upsert({
            user_id: bot.id,
            match_id: match.id,
            market_id: market.id,
            option_id: opt.id,
            odds_at_prediction: opt.odds_value,
            is_correct: isCorrect,
            points_earned: pointsEarned,
          }, { onConflict: 'user_id,market_id' })

          predCount++
        }
      }
    }

    // Recalculate leaderboard for bots if finished matches included
    if (includeFinished) {
      for (const bot of bots) {
        const { data: preds } = await supabase
          .from('predictions')
          .select('points_earned, is_correct')
          .eq('user_id', bot.id)

        const total   = preds?.length ?? 0
        const correct = preds?.filter(p => p.is_correct === true).length ?? 0
        const points  = preds?.reduce((s, p) => s + (p.points_earned || 0), 0) ?? 0

        await supabase.from('leaderboard_cache').upsert({
          user_id: bot.id,
          total_points: points,
          correct_predictions: correct,
          total_predictions: total,
          surprise_bonus: 0,
          last_updated: new Date().toISOString(),
        })
      }
    }

    return new Response(JSON.stringify({ success: true, predictions_made: predCount }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
