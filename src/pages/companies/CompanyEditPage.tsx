import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useCapability } from '../../hooks/useCapability'
import { fetchGovernedData, updateCompany, extractTierExceptions, type CompanyFormData } from '../../hooks/useCompanyMutations'
import { CompanyForm } from '../../components/companies/CompanyForm'
import toast from 'react-hot-toast'

export function CompanyEditPage() {
  const nav = useNavigate()
  const { id } = useParams<{ id: string }>()
  const canManage = useCapability('companies.manage')
  const [company, setCompany] = useState<any>(null)
  const [tiers, setTiers] = useState<any[]>([])
  const [exceptions, setExceptions] = useState<{ tier_id: string; id: string; discount_percent: number }[]>([])
  const [initialDiscounts, setInitialDiscounts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!id) { nav('/companies/manage', { replace: true }); return }
    (async () => {
      const { companies, tiers: t } = await fetchGovernedData()
      const found = companies.find((c: any) => c.id === id)
      if (!found) { toast.error('الشركة غير موجودة'); nav('/companies/manage', { replace: true }); return }
      setCompany(found)
      setTiers(t)
      const { discounts, exceptions: ex } = extractTierExceptions(id, t)
      setInitialDiscounts(discounts)
      setExceptions(ex)
      setLoading(false)
    })()
  }, [id, nav])

  async function handleSubmit(form: CompanyFormData) {
    if (!id) return
    setSaving(true)
    const result = await updateCompany(id, form, tiers, exceptions)
    setSaving(false)
    if (result.error) { toast.error(result.error); return }
    toast.success('تم حفظ التغييرات')
    nav('/companies/manage')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <span className="text-sm text-text-secondary">جاري التحميل...</span>
      </div>
    )
  }

  return (
    <CompanyForm
      mode="edit"
      initialCompanyName={company.company_name ?? ''}
      initialLegacyCode={company.legacy_code ?? ''}
      initialDisplayOrder={company.display_order ?? 1}
      initialLogoUrl={company.logo_url ?? ''}
      initialIsVisible={company.is_visible ?? true}
      tiers={tiers}
      initialTierDiscounts={initialDiscounts}
      saving={saving}
      canManage={canManage}
      onSubmit={handleSubmit}
      onCancel={() => nav('/companies/manage')}
    />
  )
}
