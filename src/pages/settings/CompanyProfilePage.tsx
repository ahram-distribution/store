import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useCapability } from '../../hooks/useCapability'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function CompanyProfilePage() {
  const navigate = useNavigate()
  const canEdit = useCapability('orders.manage')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    company_name: '',
    company_banner_url: '',
    facebook_url: '',
    sales_phone_1: '',
    sales_phone_2: '',
    sales_whatsapp_1: '',
    sales_whatsapp_2: '',
    technical_support_phone: '',
  })

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    supabase.rpc('get_company_profile', { p_token: token }).then(({ data, error }) => {
      if (error) { toast.error(error.message); setLoading(false); return }
      if (data?.data) {
        setForm({
          company_name: data.data.company_name || '',
          company_banner_url: data.data.company_banner_url || '',
          facebook_url: data.data.facebook_url || '',
          sales_phone_1: data.data.sales_phone_1 || '',
          sales_phone_2: data.data.sales_phone_2 || '',
          sales_whatsapp_1: data.data.sales_whatsapp_1 || '',
          sales_whatsapp_2: data.data.sales_whatsapp_2 || '',
          technical_support_phone: data.data.technical_support_phone || '',
        })
      }
      setLoading(false)
    })
  }, [])

  const handleChange = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(prev => ({ ...prev, [field]: e.target.value }))
  }

  const handleSave = async () => {
    const token = getToken()
    if (!token) return
    setSaving(true)
    const { error } = await supabase.rpc('governed_update_company_profile', {
      p_token: token,
      p_company_name: form.company_name || null,
      p_company_banner_url: form.company_banner_url || null,
      p_facebook_url: form.facebook_url || null,
      p_sales_phone_1: form.sales_phone_1 || null,
      p_sales_phone_2: form.sales_phone_2 || null,
      p_sales_whatsapp_1: form.sales_whatsapp_1 || null,
      p_sales_whatsapp_2: form.sales_whatsapp_2 || null,
      p_technical_support_phone: form.technical_support_phone || null,
    })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success('تم حفظ البيانات')
  }

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>

  const fields = [
    { key: 'company_name', label: 'اسم الشركة', type: 'text' },
    { key: 'company_banner_url', label: 'رابط البانر', type: 'text' },
    { key: 'facebook_url', label: 'رابط فيسبوك', type: 'text' },
    { key: 'sales_phone_1', label: 'هاتف مبيعات 1', type: 'tel' },
    { key: 'sales_phone_2', label: 'هاتف مبيعات 2', type: 'tel' },
    { key: 'sales_whatsapp_1', label: 'واتساب مبيعات 1', type: 'tel' },
    { key: 'sales_whatsapp_2', label: 'واتساب مبيعات 2', type: 'tel' },
    { key: 'technical_support_phone', label: 'هاتف الدعم الفني', type: 'tel' },
  ]

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">بيانات الشركة</h1>
      </div>

      <div className="bg-white rounded-xl border border-border p-4 space-y-3">
        {fields.map(f => (
          <div key={f.key}>
            <label className="block text-xs text-text-secondary mb-1">{f.label}</label>
            <input
              type={f.type}
              value={(form as any)[f.key]}
              onChange={handleChange(f.key)}
              readOnly={!canEdit}
              className={`w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white ${!canEdit ? 'opacity-60' : ''}`}
            />
          </div>
        ))}
      </div>

      {canEdit && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full bg-primary text-white rounded-xl py-3 text-sm font-semibold active:opacity-90 disabled:opacity-40"
        >
          {saving ? 'جاري الحفظ...' : 'حفظ'}
        </button>
      )}
    </div>
  )
}
