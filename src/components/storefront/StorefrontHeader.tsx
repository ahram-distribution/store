import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'
import { supabase } from '../../lib/supabase'
import { Search, User, LogIn } from 'lucide-react'

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
    <div className="-mx-4 px-4 bg-white h-14 flex items-center justify-between gap-2 border-b border-[#E5E7EB]">
      <div className="text-lg font-bold text-gold shrink-0 leading-tight">
        {companyName}
      </div>
      <div className="flex-1 max-w-[200px] relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={handleSearch}
          placeholder="ابحث عن منتج..."
          className="w-full h-9 pr-9 pl-3 text-sm bg-[#F8FAFC] border border-[#E5E7EB] rounded-full text-[#111827] placeholder:text-muted outline-none focus:border-gold transition-colors"
        />
      </div>
      <button
        onClick={() => navigate(token ? '/account' : '/login')}
        className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-[#0F2B5B] text-white active:opacity-90 transition-opacity"
      >
        {token ? <User className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
      </button>
    </div>
  )
}