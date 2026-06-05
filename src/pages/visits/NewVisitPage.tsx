import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useVisitsStore } from '../../store/visits'
import toast from 'react-hot-toast'

export function NewVisitPage() {
  const navigate = useNavigate()
  const { activeVisit, addVisit } = useVisitsStore()
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')

  const handleStart = () => {
    if (!customerName || !customerPhone) {
      toast.error('يرجى إدخال اسم العميل ورقم الهاتف')
      return
    }
    if (activeVisit) {
      toast.error('لديك زيارة نشطة حالياً. يرجى إنهاؤها أولاً.')
      navigate(`/visits/${activeVisit.id}`)
      return
    }

    const now = new Date().toISOString()
    const visit = {
      id: crypto.randomUUID?.() || Math.random().toString(36).slice(2),
      customerId: 'new',
      customerName,
      customerPhone,
      status: 'active' as const,
      checkInAt: now,
      timeline: [{ time: new Date().toLocaleTimeString('ar-EG'), action: 'تسجيل الدخول', note: 'GPS captured' }],
    }

    addVisit(visit as any)
    toast.success('تم بدء الزيارة')
    navigate('/visits')
  }

  if (activeVisit) {
    navigate(`/visits/${activeVisit.id}`)
    return null
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/visits')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">زيارة جديدة</h1>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
        <p className="text-xs text-blue-700">
          سيتم تسجيل موقعك الحالي عند بدء الزيارة. تأكد من تواجدك عند العميل.
        </p>
      </div>

      <div className="bg-white rounded-lg border border-border p-4 space-y-3">
        <div>
          <label className="text-xs text-text-secondary block mb-1">اسم العميل</label>
          <input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="أدخل اسم العميل"
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-text-secondary block mb-1">رقم الهاتف</label>
          <input
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
            placeholder="أدخل رقم الهاتف"
            dir="ltr"
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm"
          />
        </div>
      </div>

      <button onClick={handleStart} className="w-full bg-primary text-white text-sm py-3 rounded-lg active:bg-primary-dark transition-colors">
        بدء الزيارة
      </button>
    </div>
  )
}
