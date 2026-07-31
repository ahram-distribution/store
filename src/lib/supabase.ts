import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'
import { createDesktopSupabase } from './desktopSupabase'

const isDesktop = typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron')

let supabase: any

if (isDesktop && (window as any).api?.db) {
  supabase = createDesktopSupabase()
} else {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables')
  }
  supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)
}

export { supabase }
