import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Optional cloud backend. The URL and anon key are public by design (Row Level Security
 * protects the data); the service-role key and AI provider keys never appear in client code.
 * When these env vars are absent the app runs fully offline and cloud features say so.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    : null

export const isCloudConfigured = supabase !== null

export function functionsUrl(name: string): string {
  return `${url}/functions/v1/${name}`
}
