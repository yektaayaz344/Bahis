import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const ODDS_API_KEY = Deno.env.get('ODDS_API_KEY')!

    // /sports endpoint'i en ucuz çağrı — sadece 1 istek harcıyor, usage header'ları döndürür
    const res = await fetch(
      `https://api.the-odds-api.com/v4/sports?apiKey=${ODDS_API_KEY}&all=false`
    )

    const used      = parseInt(res.headers.get('x-requests-used')      ?? '0')
    const remaining = parseInt(res.headers.get('x-requests-remaining') ?? '0')
    const total     = used + remaining

    // Sonraki sıfırlanma: her ayın 1'i
    const now   = new Date()
    const reset = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const daysLeft = Math.ceil((reset.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

    return new Response(JSON.stringify({
      used,
      remaining,
      total,
      reset_date: reset.toISOString().split('T')[0],
      days_until_reset: daysLeft,
      percent_used: total > 0 ? Math.round((used / total) * 100) : 0,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
