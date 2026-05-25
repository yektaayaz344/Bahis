import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// NOT: Bu değerler Netlify environment variables veya manuel olarak buraya eklenmelidir.
// Yerel geliştirme için buraya geçici olarak yazılabilir.
export const SUPABASE_URL = 'https://chxturwvxstpilynbput.supabase.co'
export const SUPABASE_ANON_KEY = 'sb_publishable_S6X5tX0Rgf1DBibyc6anmQ_8Xw463HF'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
