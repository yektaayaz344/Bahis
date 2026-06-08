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
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Kilitlenme zamanı geçmiş aktif marketleri bul ve kapat
    // bet_markets tablosunu matches ile join yapıyoruz
    const { data: markets, error } = await supabase
      .from('bet_markets')
      .select('id, match_id, lock_before_minutes, matches(match_time)')
      .eq('is_active', true)

    if (error) throw error

    let lockedCount = 0
    const now = new Date()
    const lockedMatchIds = new Set<string>()

    for (const market of markets ?? []) {
      const matchTime = new Date((market.matches as any).match_time)
      const lockBeforeMs = (market.lock_before_minutes || 60) * 60 * 1000
      const lockThreshold = new Date(matchTime.getTime() - lockBeforeMs)

      if (now >= lockThreshold) {
        await supabase
          .from('bet_markets')
          .update({ is_active: false })
          .eq('id', market.id)

        lockedMatchIds.add(market.match_id)
        lockedCount++
      }
    }

    // Kilitli maçların status'unu 'locked' olarak güncelle
    for (const matchId of lockedMatchIds) {
      await supabase
        .from('matches')
        .update({ status: 'locked' })
        .eq('id', matchId)
        .eq('status', 'open') // finished olanları dokunma
    }

    return new Response(JSON.stringify({ locked: lockedCount }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
