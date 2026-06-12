import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import { useCompaniesStore } from '../store/companies'

const CACHE_KEY = 'ahram_company_profile_cache'

export interface CompanyProfile {
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

function readCache(): CompanyProfile | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const entry: CacheEntry = JSON.parse(raw)
    const age = Date.now() - entry.timestamp
    if (age > 24 * 60 * 60 * 1000) {
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

export function useCompanyProfile(): { profile: CompanyProfile | null; loading: boolean } {
  const [profile, setProfile] = useState<CompanyProfile | null>(readCache)
  const [loading, setLoading] = useState(true)
  const token = useAuthStore((s) => s.token)
  const refreshKey = useCompaniesStore((s) => s.refreshKey)

  useEffect(() => {
    const raw = localStorage.getItem('session_token') || token

    if (!raw) {
      setLoading(true)
      supabase.rpc('get_public_company_profile').then(({ data: res }: any) => {
        if (res?.success && res.data) {
          const p: CompanyProfile = {
            sales_phone_1: res.data.sales_phone_1 || '',
            sales_phone_2: res.data.sales_phone_2 || '',
            sales_whatsapp_1: res.data.sales_whatsapp_1 || '',
            sales_whatsapp_2: res.data.sales_whatsapp_2 || '',
            technical_support_phone: res.data.technical_support_phone || '',
            facebook_url: res.data.facebook_url || '',
          }
          setProfile(p)
          writeCache(p)
        } else {
          const cached = readCache()
          if (cached) setProfile(cached)
        }
        setLoading(false)
      }).catch(() => {
        const cached = readCache()
        if (cached) setProfile(cached)
        setLoading(false)
      })
      return
    }

    setLoading(true)
    supabase.rpc('get_company_profile', { p_token: raw }).then(({ data: res }: any) => {
      if (res?.success && res.data) {
        const p: CompanyProfile = {
          sales_phone_1: res.data.sales_phone_1 || '',
          sales_phone_2: res.data.sales_phone_2 || '',
          sales_whatsapp_1: res.data.sales_whatsapp_1 || '',
          sales_whatsapp_2: res.data.sales_whatsapp_2 || '',
          technical_support_phone: res.data.technical_support_phone || '',
          facebook_url: res.data.facebook_url || '',
        }
        setProfile(p)
        writeCache(p)
      } else {
        const cached = readCache()
        if (cached) setProfile(cached)
      }
      setLoading(false)
    }).catch(() => {
      const cached = readCache()
      if (cached) setProfile(cached)
      setLoading(false)
    })
  }, [token, refreshKey])

  return { profile, loading }
}
