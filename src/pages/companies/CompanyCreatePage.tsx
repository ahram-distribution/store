import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCapability } from '../../hooks/useCapability'
import { fetchGovernedData, createCompany, type CompanyFormData } from '../../hooks/useCompanyMutations'
import { CompanyForm } from '../../components/companies/CompanyForm'
import toast from 'react-hot-toast'

export function CompanyCreatePage() {
  const nav = useNavigate()
  const canManage = useCapability('companies.manage')
  const [tiers, setTiers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    (async () => {
      const { tiers: t } = await fetchGovernedData()
      setTiers(t)
      setLoading(false)
    })()
  }, [])

  async function handleSubmit(form: CompanyFormData) {
    setSaving(true)
    const result = await createCompany(form)
    setSaving(false)
    if (result.error) { toast.error(result.error); return }
    toast.success('تم إنشاء الشركة')
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
      mode="create"
      tiers={tiers}
      saving={saving}
      canManage={canManage}
      onSubmit={handleSubmit}
      onCancel={() => nav('/companies/manage')}
    />
  )
}
