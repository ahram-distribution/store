import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { CustomerForm } from '../../components/customers/CustomerForm'
import type { CustomerFormData } from '../../components/customers/CustomerForm'
import { CUSTOMER_DEFAULT_PASSWORD } from '../../lib/customerConstants'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export default function NewCustomerPage() {
  const nav = useNavigate()
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (formData: CustomerFormData) => {
    const t = getToken()
    if (!t) { toast.error('يرجى تسجيل الدخول'); return }
    setSubmitting(true)

    const { data: sessionResult } = await supabase.rpc('validate_session', { p_token: t })
    const session = sessionResult as Record<string, unknown> | null

    const { data: rpcResult, error } = await supabase.rpc('governed_create_customer', {
      p_token: t,
      p_company_name: formData.companyName.trim(),
      p_phone: formData.phone.trim() || null,
      p_contact_name: formData.contactName.trim() || null,
      p_contact_phone: formData.phone.trim() || null,
      p_business_type: formData.businessType || null,
      p_responsible_name: formData.contactName.trim() || null,
      p_password: CUSTOMER_DEFAULT_PASSWORD,
      p_latitude: formData.latitude,
      p_longitude: formData.longitude,
      p_accuracy_meters: formData.accuracyMeters,
      p_governorate_id: formData.governorateId || null,
      p_city: formData.city.trim() || null,
      p_city_name: formData.city.trim() || null,
      p_street_address: formData.streetAddress.trim() || null,
    })

    setSubmitting(false)
    if (error) {
      if (error.message?.includes('duplicate') || error.message?.includes('already exists')) {
        toast.error('رقم الهاتف موجود مسبقاً')
      } else {
        toast.error(error.message || 'حدث خطأ أثناء إنشاء العميل')
      }
      return
    }

    const result = rpcResult as Record<string, unknown>
    if (result?.error) {
      toast.error(result.error as string)
      return
    }

    toast.success('تم إضافة العميل بنجاح')
    nav('/customers')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 to-accent/5 px-4 py-6">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center justify-between mb-6">
          <button onClick={() => nav(-1)} className="text-primary text-sm font-semibold">→ رجوع</button>
          <h1 className="text-lg font-bold text-text">عميل جديد</h1>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-border p-5">
          <CustomerForm mode="internal" onSubmit={handleSubmit} compact />
        </div>
      </div>
    </div>
  )
}
