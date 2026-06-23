import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { lifeSignalService } from '../../services/lifeSignalService'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const methods: { value: string; label: string }[] = [
  { value: 'cash', label: 'نقداً' },
  { value: 'bank_transfer', label: 'تحويل بنكي' },
  { value: 'cheque', label: 'شيك' },
  { value: 'deposit', label: 'إيداع' },
]

export function NewCollectionPage() {
  const navigate = useNavigate()
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [allCustomers, setAllCustomers] = useState<any[]>([])
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<string>('')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [customerSearchQuery, setCustomerSearchQuery] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const token = getToken()
    if (!token) return
    supabase.rpc('get_governed_customers', { p_token: token }).then(({ data }) => {
      if (data) setAllCustomers(Array.isArray(data) ? data : [data])
    })
  }, [])

  const handleSubmit = async () => {
    if (!customerId || !amount || !method) {
      toast.error('يرجى اختيار العميل وإدخال المبلغ وطريقة الدفع')
      return
    }

    const token = getToken()
    if (!token) { toast.error('يجب تسجيل الدخول'); return }

    setSubmitting(true)
    const { error } = await supabase.rpc('governed_create_collection', {
      p_token: token,
      p_customer_id: customerId,
      p_amount: parseFloat(amount),
      p_method: method,
      p_reference_number: reference || null,
      p_notes: notes || null,
    })

    if (error) {
      toast.error('فشل تسجيل التحصيل: ' + error.message)
      setSubmitting(false)
      return
    }

    lifeSignalService.notifyBusiness('collection_created')
    toast.success('تم تسجيل التحصيل')
    navigate('/collections')
  }

  if (!customerId) {
    const filtered = customerSearchQuery.trim()
      ? allCustomers.filter((c: any) => (c.company_name || '').includes(customerSearchQuery))
      : allCustomers

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/collections')} className="text-text-secondary text-lg">&larr;</button>
          <h1 className="text-lg font-bold text-text">تحصيل جديد</h1>
        </div>
        <input
          type="text"
          value={customerSearchQuery}
          onChange={(e) => setCustomerSearchQuery(e.target.value)}
          placeholder="ابحث عن عميل..."
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text placeholder:text-text-secondary"
        />
        <div className="space-y-2">
          {filtered.map((c: any) => (
            <button
              key={c.id}
              onClick={() => { setCustomerId(c.id); setCustomerName(c.company_name) }}
              className="w-full bg-white rounded-xl border border-border p-3 text-right active:bg-surface transition-colors"
            >
              <p className="text-sm font-semibold text-text">{c.company_name}</p>
              <p className="text-[10px] text-text-secondary">{c.code}</p>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="text-center text-sm text-text-secondary py-8">لا يوجد عملاء</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => setCustomerId(null)} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">تحصيل من {customerName}</h1>
      </div>

      <div className="bg-white rounded-lg border border-border p-4 space-y-3">
        <div>
          <label className="text-xs text-text-secondary block mb-1">المبلغ</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" placeholder="المبلغ" className="w-full border border-border rounded-lg px-3 py-2.5 text-sm" />
        </div>
        <div>
          <label className="text-xs text-text-secondary block mb-1">طريقة الدفع</label>
          <div className="flex flex-wrap gap-2">
            {methods.map((m) => (
              <button
                key={m.value}
                onClick={() => setMethod(m.value)}
                className={`text-xs px-3 py-2 rounded-lg border transition-colors ${method === m.value ? 'bg-primary text-white border-primary' : 'bg-white text-text-secondary border-border'}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs text-text-secondary block mb-1">المرجع (اختياري)</label>
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="رقم المرجع أو الشيك" className="w-full border border-border rounded-lg px-3 py-2.5 text-sm" />
        </div>
        <div>
          <label className="text-xs text-text-secondary block mb-1">ملاحظات (اختياري)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات" className="w-full border border-border rounded-lg px-3 py-2 text-sm resize-none h-20" />
        </div>
      </div>

      <button onClick={handleSubmit} disabled={submitting} className="w-full bg-success text-white text-sm py-3 rounded-lg disabled:opacity-40 active:opacity-90 transition-colors">
        {submitting ? 'جاري التسجيل...' : 'تسجيل التحصيل'}
      </button>
    </div>
  )
}
