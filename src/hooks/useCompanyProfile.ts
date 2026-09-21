import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import { useCompaniesStore } from '../store/companies'

const CACHE_KEY = 'ahram_company_profile_cache'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

export interface CompanyProfile {
  company_name: string
  company_banner_url: string
  sales_phone_1: string
  sales_phone_2: string
  sales_whatsapp_1: string
  sales_whatsapp_2: string
  technical_support_phone: string
  facebook_url: string
}

interface CacheEntry {
  data: CompanyProfile
  timestamp: number
}

// Shared in-flight dedupe across every mounted consumer (Hero, Banner, Footer,
// LoginPage). The profile RPC is small but is fired on each storefront mount;
// deduping concurrent mounts collapses 3+ calls into 1, and the cache covers
// revisits within the TTL.
let inflightPromise: Promise<CompanyProfile | null> | null = null

function readCache(): CompanyProfile | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const entry: CacheEntry = JSON.parse(raw)
    const age = Date.now() - entry.timestamp
    if (age > CACHE_TTL_MS) {
      localStorage.removeItem(CACHE_KEY)
      return null
    }
    return entry.data
  } catch {
    return null
  }
}

function writeCache(data: CompanyProfile) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }))
  } catch { /* quota exceeded — ignore */ }
}

function mapProfile(payload: any): CompanyProfile {
  return {
    company_name: payload.company_name || '',
    company_banner_url: payload.company_banner_url || '',
    sales_phone_1: payload.sales_phone_1 || '',
    sales_phone_2: payload.sales_phone_2 || '',
    sales_whatsapp_1: payload.sales_whatsapp_1 || '',
    sales_whatsapp_2: payload.sales_whatsapp_2 || '',
    technical_support_phone: payload.technical_support_phone || '',
    facebook_url: payload.facebook_url || '',
  }
}

export function useCompanyProfile(): { profile: CompanyProfile | null; loading: boolean } {
  const [profile, setProfile] = useState<CompanyProfile | null>(readCache)
  const [loading, setLoading] = useState(true)
  const token = useAuthStore((s) => s.token)
  const refreshKey = useCompaniesStore((s) => s.refreshKey)

  useEffect(() => {
    const cached = readCache()
    if (cached) {
      setProfile(cached)
      setLoading(false)
      return
    }

    const raw = localStorage.getItem('session_token') || token
    const call = raw
      ? supabase.rpc('get_company_profile', { p_token: raw }).then(({ data: res }: any) => {
          if (res?.success && res.data) return mapProfile(res.data)
          return readCache()
        })
      : supabase.rpc('get_public_company_profile').then(({ data: res }: any) => {
          if (res?.success && res.data) return mapProfile(res.data)
          return readCache()
        })

    const run = () => {
      if (!inflightPromise) {
        inflightPromise = call.then((result) => {
          inflightPromise = null
          if (result && !readCache()) writeCache(result)
          return result
        }).catch(() => {
          inflightPromise = null
          return readCache()
        })
      }
      return inflightPromise
    }

    run().then((result) => {
      if (result) setProfile(result)
      setLoading(false)
    })
  }, [token, refreshKey])

  return { profile, loading }
}