import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useCompaniesStore } from '../../store/companies'
import { StorefrontFooter } from '../../components/storefront/CompanyInfoSection'
import { StorefrontHero } from '../../components/storefront/StorefrontHero'
import { BusinessShortcuts } from '../../components/storefront/BusinessShortcuts'

interface CompanyItem {
  id: string
  companyName: string
  logoUrl: string | null
}

export function CompaniesPage() {
  const navigate = useNavigate()
  const refreshKey = useCompaniesStore((s) => s.refreshKey)
  const [companies, setCompanies] = useState<CompanyItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('companies')
      .select('id, company_name, logo_url')
      .eq('is_active', true)
      .order('company_name')
      .then(({ data, error }) => {
        if (!error && data) {
          setCompanies(
            data.map((c: any) => ({
              id: c.id,
              companyName: c.company_name,
              logoUrl: c.logo_url || null,
            }))
          )
        }
        setLoading(false)
      })
  }, [refreshKey])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div>
      <div style={{ margin: '-16px -16px 0' }}>
        <StorefrontHero />
      </div>

      <div className="space-y-2" style={{ marginTop: 12 }}>
        <BusinessShortcuts />

        <div>
          <h2 className="text-lg font-bold" style={{ color: 'var(--theme-accent)' }}>الشركات التجارية</h2>
          <p className="text-xs mt-0.5" style={{ color: 'rgba(15, 43, 91, .45)' }}>اختر الشركة التي تريد التسوق منها</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {companies.map((company) => (
            <button
              key={company.id}
              onClick={() => navigate(`/storefront/products?companyId=${company.id}`)}
              style={{
                background: 'var(--theme-bg-card)',
                border: '1px solid #E5E7EB',
                borderRadius: 16,
                boxShadow: '0 1px 3px rgba(0,0,0,.05)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '20px 12px 14px',
                minHeight: 155,
                cursor: 'pointer',
                WebkitAppearance: 'none',
                transition: 'transform 0.15s ease',
              }}
              className="active:border-[rgba(var(--theme-accent-rgb),.5)] active:scale-[0.97]"
            >
              {company.logoUrl ? (
                <div style={{ width: 90, height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <img src={company.logoUrl} alt={company.companyName} loading="lazy" decoding="async" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto', borderRadius: 8 }} />
                </div>
              ) : (
                <div style={{ width: 90, height: 90, borderRadius: 8, background: '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ color: 'var(--theme-text-card)', fontWeight: 700, fontSize: 28 }}>{company.companyName.charAt(0)}</span>
                </div>
              )}

              <div style={{ color: 'var(--theme-text-card)', fontWeight: 600, fontSize: 13, textAlign: 'center', lineHeight: 1.4, marginTop: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>{company.companyName}</div>
            </button>
          ))}
        </div>

        {companies.length === 0 && (
          <div className="text-center py-12" style={{ color: 'rgba(15, 43, 91, .45)', fontSize: 14 }}>
            لا توجد شركات متاحة حالياً
          </div>
        )}

        <StorefrontFooter />
      </div>
    </div>
  )
}
