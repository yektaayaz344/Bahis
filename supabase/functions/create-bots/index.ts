import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BOTS = [
  { username: 'Favorici', email: 'bot-favorici@wc2026.internal', strategy: 'favorite' },
  { username: 'Riskci',   email: 'bot-riskci@wc2026.internal',   strategy: 'risky'    },
  { username: 'Ortanci',  email: 'bot-ortanci@wc2026.internal',  strategy: 'middle'   },
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const results = []

    for (const bot of BOTS) {
      // Check if already exists
      const { data: existing } = await supabase
        .from('users')
        .select('id, username')
        .eq('username', bot.username)
        .maybeSingle()

      if (existing) {
        results.push({ username: bot.username, status: 'already_exists', id: existing.id })
        continue
      }

      // Create auth user
      const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
        email: bot.email,
        password: crypto.randomUUID(),
        email_confirm: true,
      })

      if (authErr || !authUser.user) {
        results.push({ username: bot.username, status: 'error', error: authErr?.message })
        continue
      }

      // Create public user record
      const { error: userErr } = await supabase.from('users').insert({
        id: authUser.user.id,
        username: bot.username,
        avatar_color: '#64748b',
        is_bot: true,
      })

      if (userErr) {
        results.push({ username: bot.username, status: 'error', error: userErr.message })
        continue
      }

      // Initialize leaderboard_cache
      await supabase.from('leaderboard_cache').insert({
        user_id: authUser.user.id,
        total_points: 0,
        correct_predictions: 0,
        total_predictions: 0,
        surprise_bonus: 0,
      })

      results.push({ username: bot.username, status: 'created', id: authUser.user.id })
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
