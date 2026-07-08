import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function OrderNewPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const customerParam = searchParams.get('customer')
  const visitParam = searchParams.get('visit')

  useEffect(() => {
    if (customerParam) {
      const params = new URLSearchParams()
      params.set('customer', customerParam)
      if (visitParam) params.set('visit', visitParam)
      navigate('/storefront/products?' + params.toString(), { replace: true })
    }
  }, [])

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

  if (customerParam) return null

  const filteredCustomers = customerSearchQuery.trim()
    ? allCustomers.filter((c: any) => (c.company_name || '').includes(customerSearchQuery))
    : allCustomers

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">طلب جديد</h1>
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
            onClick={() => navigate(`/storefront/products?customer=${c.id}${visitParam ? `&visit=${visitParam}` : ''}`)}
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
  )
}
