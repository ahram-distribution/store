import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'
import { supabase } from '../../lib/supabase'

export function StorefrontHeader() {
  const navigate = useNavigate()
  const { token } = useAuthStore()
  const [search, setSearch] = useState('')
  const [companyName, setCompanyName] = useState('الأهرام للتجارة والتوزيع')

  useEffect(() => {
    if (!token) return
    supabase.rpc('get_company_profile', { p_token: token }).then(({ data }) => {
      if (data?.success && data.data?.company_name) setCompanyName(data.data.company_name)
    })
  }, [token])

  const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && search.trim()) {
      navigate(`/storefront/products?q=${encodeURIComponent(search.trim())}`)
    }
  }

  return (
    <div className="-mx-4 px-4 flex items-center justify-between gap-2" style={{ background: '#0F2B5B', height: 56, borderBottom: '1px solid rgba(201,162,39,.2)' }}>
      <div className="flex items-center gap-2.5 shrink-0">
        <img src={`${import.meta.env.BASE_URL}pwa/branding/logo-square.png`} alt="" style={{ width: 32, height: 32, borderRadius: 6 }} />
        <div className="text-lg font-bold" style={{ color: '#C9A227', lineHeight: 1.2 }}>
          {companyName}
        </div>
      </div>
      <div className="flex-1 max-w-[180px] relative">
        <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'rgba(255,255,255,.35)', fontSize: 16, lineHeight: 1 }}>🔍</span>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={handleSearch}
          placeholder="ابحث عن منتج..."
          style={{
            width: '100%',
            height: 36,
            paddingRight: 36,
            paddingLeft: 12,
            borderRadius: 999,
            background: 'rgba(255,255,255,.08)',
            border: '1px solid rgba(201,162,39,.15)',
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
        style={{ width: 36, height: 36, borderRadius: 999, background: 'rgba(201,162,39,.15)', border: '1px solid rgba(201,162,39,.25)', color: '#C9A227' }}
      >
        {token ? <span style={{ fontSize: 18, lineHeight: 1 }}>👤</span> : <span style={{ fontSize: 13, fontWeight: 600 }}>دخول</span>}
      </button>
    </div>
  )
}