import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

type OrderType = 'cash' | 'credit' | null

export function OrderNewPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const customerParam = searchParams.get('customer')
  const visitParam = searchParams.get('visit')

  const [orderType, setOrderType] = useState<OrderType>(null)
  const [customerSearchQuery, setCustomerSearchQuery] = useState('')
  const [allCustomers, setAllCustomers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const token = getToken()

  useEffect(() => {
    if (!token) { setLoading(false); return }
    supabase.rpc('get_governed_customers', { p_token: token }).then(({ data }) => {
      if (data) setAllCustomers(Array.isArray(data) ? data : [data])
      setLoading(false)
    })
  }, [token])

  // If customer param already set, redirect to storefront
  useEffect(() => {
    if (customerParam && orderType) {
      const params = new URLSearchParams()
      params.set('customer', customerParam)
      params.set('order_type', orderType)
      if (visitParam) params.set('visit', visitParam)
      navigate('/storefront?' + params.toString(), { replace: true })
    }
  }, [customerParam, orderType])

  // If customer param is set but no orderType yet, wait for selection
  if (customerParam && !orderType) {
    return (
      <div className="min-h-[calc(100vh-8rem)] flex flex-col items-center justify-center">
        <div className="w-full max-w-sm space-y-4">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
            <h1 className="text-lg font-bold text-text">طلب جديد</h1>
          </div>
          <p className="text-sm text-text-secondary text-center">اختر نوع الطلب</p>
          <div className="space-y-3">
            <button
              onClick={() => setOrderType('cash')}
              className="w-full bg-white rounded-xl border-2 border-emerald-200 p-4 text-right active:bg-emerald-50 transition-colors hover:border-emerald-400"
            >
              <p className="text-base font-bold text-emerald-700">نقدي</p>
              <p className="text-xs text-text-secondary mt-1">طلب عادي — دفع نقدي عند الاستلام</p>
            </button>
            <button
              onClick={() => setOrderType('credit')}
              className="w-full bg-white rounded-xl border-2 border-purple-200 p-4 text-right active:bg-purple-50 transition-colors hover:border-purple-400"
            >
              <p className="text-base font-bold text-purple-700">آجل</p>
              <p className="text-xs text-text-secondary mt-1">طلب ائتماني — دفع لاحق</p>
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (customerParam) return null

  // Show type selection first
  if (!orderType) {
    return (
      <div className="min-h-[calc(100vh-8rem)] flex flex-col items-center justify-center">
        <div className="w-full max-w-sm space-y-4">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
            <h1 className="text-lg font-bold text-text">طلب جديد</h1>
          </div>
          <p className="text-sm text-text-secondary text-center">اختر نوع الطلب</p>
          <div className="space-y-3">
            <button
              onClick={() => setOrderType('cash')}
              className="w-full bg-white rounded-xl border-2 border-emerald-200 p-4 text-right active:bg-emerald-50 transition-colors hover:border-emerald-400"
            >
              <p className="text-base font-bold text-emerald-700">نقدي</p>
              <p className="text-xs text-text-secondary mt-1">طلب عادي — دفع نقدي عند الاستلام</p>
            </button>
            <button
              onClick={() => setOrderType('credit')}
              className="w-full bg-white rounded-xl border-2 border-purple-200 p-4 text-right active:bg-purple-50 transition-colors hover:border-purple-400"
            >
              <p className="text-base font-bold text-purple-700">آجل</p>
              <p className="text-xs text-text-secondary mt-1">طلب ائتماني — دفع لاحق</p>
            </button>
          </div>
        </div>
      </div>
    )
  }

  const filteredCustomers = customerSearchQuery.trim()
    ? allCustomers.filter((c: any) => (c.company_name || '').includes(customerSearchQuery))
    : allCustomers

  return (
    <div className="min-h-[calc(100vh-8rem)] flex flex-col items-center justify-center">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
          <h1 className="text-lg font-bold text-text">طلب جديد</h1>
          <span className={'text-xs px-2 py-0.5 rounded font-medium ' + (orderType === 'credit' ? 'bg-purple-100 text-purple-700' : 'bg-emerald-100 text-emerald-700')}>
            {orderType === 'credit' ? 'آجل' : 'نقدي'}
          </span>
          <button onClick={() => setOrderType(null)} className="text-[10px] text-text-secondary underline">تغيير</button>
        </div>
        <input
          type="text"
          value={customerSearchQuery}
          onChange={(e) => setCustomerSearchQuery(e.target.value)}
          placeholder="ابحث عن عميل..."
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text placeholder:text-text-secondary"
        />
        <div className="space-y-2">
          {filteredCustomers.map((c: any) => (
            <button
              key={c.id}
              onClick={() => navigate(`/storefront?customer=${c.id}&order_type=${orderType}${visitParam ? `&visit=${visitParam}` : ''}`)}
              className="w-full bg-white rounded-xl border border-border p-3 text-right active:bg-surface transition-colors"
            >
              <p className="text-sm font-semibold text-text">{c.company_name}</p>
              <p className="text-[10px] text-text-secondary">{c.code}</p>
            </button>
          ))}
          {filteredCustomers.length === 0 && !loading && (
            <p className="text-center text-sm text-text-secondary py-8">لا يوجد عملاء</p>
          )}
          {loading && (
            <p className="text-center text-sm text-text-secondary py-8">جاري التحميل...</p>
          )}
        </div>
      </div>
    </div>
  )
}
