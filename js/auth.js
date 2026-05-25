import { supabase } from './supabase.js'

// Oturum kontrolü — her sayfanın başında çağır
export async function requireAuth() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
        window.location.href = './auth.html'
        return null
    }
    return session
}

const ADMIN_EMAIL = 'ayazyekta344@gmail.com'

export function isAdmin(session) {
    return session?.user?.email === ADMIN_EMAIL
}

// Admin kontrolü
export async function requireAdmin() {
    const session = await requireAuth()
    if (!session) return false
    if (!isAdmin(session)) {
        window.location.href = './matches.html'
        return false
    }
    return true
}

// Giriş
export async function login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (!error) {
        window.location.href = './matches.html'
    }
    return { data, error }
}

// Kayıt
export async function signup(email, password, username) {
    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { username } }
    })
    return { data, error }
}

// Çıkış
export async function logout() {
    await supabase.auth.signOut()
    window.location.href = './auth.html'
}

// Mevcut kullanıcı bilgilerini getir
export async function getUserProfile(userId) {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single()
    return { data, error }
}
