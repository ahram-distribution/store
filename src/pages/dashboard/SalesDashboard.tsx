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

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>

  const widgets = [
    { label: 'طلبات اليوم', value: data?.today_orders ?? 0, color: 'bg-primary', path: '/orders?filter=today' },
    { label: 'متابعة الطلبات', value: data?.pending_followup ?? 0, color: 'bg-accent', path: '/orders?filter=pending' },
    { label: 'عملاء غير نشطين', value: data?.inactive_customers ?? 0, color: 'bg-warning', path: '/customers?filter=inactive' },
    { label: 'زيارات اليوم', value: data?.today_visits ?? 0, color: 'bg-success', path: '/visits?filter=today' },
    { label: 'تحصيلات اليوم', value: data?.today_collections ?? 0, color: 'bg-primary', path: '/collections?filter=today' },
  ]

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-text">المبيعات</h1>
      <div className="grid grid-cols-2 gap-3">
        {widgets.map((w) => (
          <button key={w.label} onClick={() => navigate(w.path)}
            className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
            <div className={`w-10 h-10 rounded-xl ${w.color} flex items-center justify-center mb-2`}>
              <span className="text-white text-lg font-bold">{w.value}</span>
            </div>
            <span className="text-sm font-semibold text-text">{w.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
