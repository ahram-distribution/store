import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { authService } from '../../services/auth'
import { CustomerForm } from '../../components/customers/CustomerForm'
import type { CustomerFormData } from '../../components/customers/CustomerForm'
import { CUSTOMER_DEFAULT_PASSWORD } from '../../lib/customerConstants'
import toast from 'react-hot-toast'

export default function RegistrationPage() {
  const nav = useNavigate()
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (data: CustomerFormData) => {
    setSubmitting(true)
    try {
      const { data: govData } = await supabase.from('reference_governorates').select('name_ar').eq('id', data.governorateId).single()
      const governorateName = govData?.name_ar || ''

      const result = await authService.register({
        phone: data.phone,
        password: CUSTOMER_DEFAULT_PASSWORD,
        companyName: data.companyName,
        responsibleName: data.contactName,
        businessType: data.businessType,
        latitude: data.latitude!,
        longitude: data.longitude!,
        accuracyMeters: data.accuracyMeters!,
        formattedAddress: governorateName + (data.city ? '، ' + data.city : '') + (data.streetAddress ? '، ' + data.streetAddress : ''),
      })

      if (result.error) {
        toast.error(result.error)
        return
      }

      toast.success('تم إنشاء الحساب بنجاح')
      if (result.token) localStorage.setItem('session_token', result.token)
      nav('/home')
    } catch (err: any) {
      const msg = err?.message || 'حدث خطأ أثناء إنشاء الحساب'
      if (msg.includes('PHONE_EXISTS') || msg.includes('already exists') || msg.includes('duplicate')) {
        toast.error('رقم الهاتف مسجل بالفعل في النظام. يرجى تسجيل الدخول.')
      } else {
        toast.error(msg)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8"
      style={{ background: 'linear-gradient(135deg, #071B4D 0%, #0B3D91 40%, #1565C0 70%, #1E88E5 100%)' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <img src="https://gbcbejejgpvltuhbztbx.supabase.co/storage/v1/object/public/ahram/ahram.png" alt="Logo"
            className="h-14 w-auto mx-auto mb-3 rounded-xl border-2 border-[#C9A227] shadow-lg shadow-[#C9A227]/30" />
          <h1 className="text-2xl font-extrabold text-white mb-1">أهلاً بك في أهرام</h1>
          <p className="text-sm text-white/60">أنشئ حسابك في ثوانٍ وابدأ طلبك</p>
        </div>

        <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
          <CustomerForm mode="registration" onSubmit={handleSubmit} />

          <div className="text-center mt-4">
            <button onClick={() => nav('/login')} className="text-sm text-white/50 hover:text-white/70 transition-colors font-medium">
              لديك حساب بالفعل؟ سجّل دخولك
            </button>
          </div>
        </div>

        <div className="text-center mt-4 text-white/40 text-xs">
          <p>تassium Distribution Management System v2.0</p>
        </div>
      </div>
    </div>
  )
}
