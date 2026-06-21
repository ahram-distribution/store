import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface SalesData {
  today_orders: number
  pending_followup: number
  inactive_customers: number
  today_visits: number
  today_collections: number
}

export function SalesDashboard() {
  const navigate = useNavigate()
  const [data, setData] = useState<SalesData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) return
    supabase.rpc('get_dashboard_sales', { p_token: token }).then(({ data: d }) => {
      if (d) setData(d as SalesData)
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="text-center py-12 ds-small">جاري التحميل...</div>

  const widgets = [
    { label: 'طلبات اليوم', value: data?.today_orders ?? 0, color: 'bg-primary', path: '/orders?filter=today' },
    { label: 'متابعة الطلبات', value: data?.pending_followup ?? 0, color: 'bg-accent', path: '/orders?filter=pending' },
    { label: 'عملاء غير نشطين', value: data?.inactive_customers ?? 0, color: 'bg-warning', path: '/customers?filter=inactive' },
    { label: 'زيارات اليوم', value: data?.today_visits ?? 0, color: 'bg-success', path: '/visits?filter=today' },
    { label: 'تحصيلات اليوم', value: data?.today_collections ?? 0, color: 'bg-primary', path: '/collections?filter=today' },
  ]

  return (
    <div className="ds-gap-lg flex flex-col">
      <h1 className="ds-title">المبيعات</h1>
      <div className="grid grid-cols-2 ds-gap-md">
        {widgets.map((w) => (
          <button key={w.label} onClick={() => navigate(w.path)}
            className="ds-card text-right active:bg-surface transition-colors">
            <div className={`w-10 h-10 rounded-xl ${w.color} flex items-center justify-center mb-2`}>
              <span className="text-white ds-body font-bold">{w.value}</span>
            </div>
            <span className="text-sm font-semibold text-text">{w.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
