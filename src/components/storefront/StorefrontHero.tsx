import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import { ThemeSelector } from './ThemeSelector'

interface CompanyData {
  company_name: string
  company_banner_url: string
}

function useCompanyProfile() {
  const [data, setData] = useState<CompanyData | null>(null)
  const [loading, setLoading] = useState(true)
  const token = useAuthStore((s) => s.token)

  useEffect(() => {
    if (!token) {
      supabase.rpc('get_public_company_profile').then(({ data: res }) => {
        if (res?.success && res.data) {
          setData({
            company_name: (res.data as any).company_name || '',
            company_banner_url: (res.data as any).company_banner_url || '',
          })
        }
        setLoading(false)
      })
      return
    }
    supabase.rpc('get_company_profile', { p_token: token }).then(({ data: res }) => {
      if (res?.success && res.data) {
        setData({
          company_name: (res.data as any).company_name || '',
          company_banner_url: (res.data as any).company_banner_url || '',
        })
      }
      setLoading(false)
    })
  }, [token])

  return { data, loading }
}

const stats = [
  { value: '35+', label: 'شركة شريكة' },
  { value: '1500+', label: 'منتج متنوع' },
  { value: 'عروض', label: 'يومية' },
  { value: 'توصيل', label: 'سريع' },
]

export function StorefrontHero() {
  const navigate = useNavigate()
  const { data, loading } = useCompanyProfile()
  const { token } = useAuthStore()
  const [search, setSearch] = useState('')
  const [themeOpen, setThemeOpen] = useState(false)

  const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && search.trim()) {
      navigate(`/storefront/products?q=${encodeURIComponent(search.trim())}`)
    }
  }

  return (
    <>
      <div style={{ background: 'var(--theme-primary)', borderBottomLeftRadius: 20, borderBottomRightRadius: 20 }}>

        <div className="flex items-center gap-3" style={{ padding: '18px 16px 10px' }}>
          <img
            src={`${import.meta.env.BASE_URL}pwa/branding/logo-square.png`}
            alt=""
            style={{ width: 48, height: 48, borderRadius: 10, flexShrink: 0 }}
          />
          <div className="flex-1 min-w-0">
            <div style={{ color: 'var(--theme-accent)', fontWeight: 700, fontSize: 18, lineHeight: 1.2 }}>
              الأهرام للتجارة والتوزيع
            </div>
            <div style={{ color: 'rgba(255,255,255,.5)', fontSize: 11, marginTop: 2 }}>
              منصة توزيع متكاملة للجملة والتجزئة
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2" style={{ padding: '0 16px 14px' }}>
          <div className="flex-1 relative">
            <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'rgba(255,255,255,.35)', fontSize: 15, lineHeight: 1 }}>🔍</span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleSearch}
              placeholder="ابحث عن منتج..."
              style={{
                width: '100%',
                height: 36,
                paddingRight: 34,
                paddingLeft: 10,
                borderRadius: 999,
                background: 'rgba(255,255,255,.08)',
                border: '1px solid rgba(var(--theme-accent-rgb), .15)',
                color: '#fff',
                fontSize: 13,
                outline: 'none',
              }}
              className="storefront-search-input"
            />
          </div>
          <button
            onClick={() => navigate(token ? '/account' : '/login')}
            className="shrink-0 flex items-center justify-center active:opacity-80 transition-opacity"
            style={{ width: 36, height: 36, borderRadius: 999, background: 'rgba(var(--theme-accent-rgb), .15)', border: '1px solid rgba(var(--theme-accent-rgb), .25)', color: 'var(--theme-accent)' }}
          >
            {token ? <span style={{ fontSize: 18, lineHeight: 1 }}>👤</span> : <span style={{ fontSize: 13, fontWeight: 600 }}>دخول</span>}
          </button>
          <button
            onClick={() => setThemeOpen(true)}
            className="shrink-0 flex items-center justify-center active:opacity-80 transition-opacity"
            style={{ width: 36, height: 36, borderRadius: 999, background: 'rgba(var(--theme-accent-rgb), .15)', border: '1px solid rgba(var(--theme-accent-rgb), .25)', color: 'var(--theme-accent)', fontSize: 16, lineHeight: 1 }}
            title="الثيمات"
          >
            🎨
          </button>
        </div>

        <div className="grid grid-cols-4">
          {stats.map((s, i) => (
            <div key={s.label} style={{ background: 'var(--theme-primary)', padding: '10px 4px', textAlign: 'center', borderRight: i < stats.length - 1 ? '1px solid rgba(var(--theme-accent-rgb), .15)' : 'none', borderTop: '1px solid rgba(var(--theme-accent-rgb), .15)' }}>
              <div style={{ color: 'var(--theme-accent)', fontWeight: 700, fontSize: 15, lineHeight: 1.2 }}>{s.value}</div>
              <div style={{ color: 'rgba(255,255,255,.45)', fontSize: 9, marginTop: 1 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {themeOpen && <ThemeSelector onClose={() => setThemeOpen(false)} />}
    </>
  )
}
