import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'
import { supabaseProxy } from '../utils/systemOfTruthGuard'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

const raw = createClient<Database>(supabaseUrl, supabaseAnonKey)

export const supabase = supabaseProxy(raw as unknown as Record<string, unknown>) as typeof raw
