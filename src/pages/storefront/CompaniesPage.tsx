import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { StorefrontBanner, StorefrontFooter } from '../../components/storefront/CompanyInfoSection'
import { StorefrontHeader } from '../../components/storefront/StorefrontHeader'
import { BusinessShortcuts } from '../../components/storefront/BusinessShortcuts'

interface CompanyItem {
  id: string
  companyName: string
  logoUrl: string | null
}

export function CompaniesPage() {
  const navigate = useNavigate()
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
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <StorefrontHeader />

      <StorefrontBanner />

      <BusinessShortcuts />

      <div>
        <h2 className="text-lg font-bold text-[#111827]">الشركات التجارية</h2>
        <p className="text-xs text-muted mt-0.5">اختر الشركة التي تريد التسوق منها</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {companies.map((company) => (
          <button
            key={company.id}
            onClick={() => navigate(`/storefront/products?companyId=${company.id}`)}
            className="bg-white border border-[#E5E7EB] rounded-2xl shadow-sm active:shadow-inner transition-all flex flex-col overflow-hidden h-36 p-0"
          >
            <div className="flex-1 flex items-center justify-center p-4">
              {company.logoUrl ? (
                <img src={company.logoUrl} alt={company.companyName} className="max-w-full max-h-full object-contain" />
              ) : (
                <div className="w-12 h-12 rounded-xl bg-[#F8FAFC] border border-[#E5E7EB] flex items-center justify-center">
                  <span className="text-sm font-bold text-muted">{company.companyName.charAt(0)}</span>
                </div>
              )}
            </div>
            <div className="text-center pb-2.5 px-2">
              <span className="text-sm font-medium text-[#111827] leading-tight">{company.companyName}</span>
            </div>
          </button>
        ))}
      </div>

      {companies.length === 0 && (
        <div className="text-center py-12 text-muted text-sm">
          لا توجد شركات متاحة حالياً
        </div>
      )}

      <StorefrontFooter />
    </div>
  )
}
