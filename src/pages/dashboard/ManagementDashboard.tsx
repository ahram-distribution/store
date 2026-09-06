import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface MgmtData {
  total_orders: number
  pending_orders: number
  approved_orders: number
  total_customers: number
  active_visits: number
  pending_collections: number
  pending_returns: number
  today_orders: number
  today_visits: number
}

export function ManagementDashboard() {
  const navigate = useNavigate()
  const [data, setData] = useState<MgmtData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) return
    supabase.rpc('get_dashboard_management', { p_token: token }).then((mgmt) => {
      if (mgmt.data) setData(mgmt.data as MgmtData)
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>

  const primaryWidgets = [
    { label: 'إجمالي الطلبات', value: data?.total_orders ?? 0, color: 'bg-primary', path: '/orders' },
    { label: 'طلبات معلقة', value: data?.pending_orders ?? 0, color: 'bg-accent', path: '/orders?filter=pending' },
    { label: 'طلبات معتمدة', value: data?.approved_orders ?? 0, color: 'bg-success', path: '/orders?filter=approved' },
    { label: 'إجمالي العملاء', value: data?.total_customers ?? 0, color: 'bg-primary', path: '/customers' },
  ]

  const secondaryWidgets = [
    { label: 'زيارات نشطة', value: data?.active_visits ?? 0, color: 'bg-success', path: '/visits?filter=active' },
    { label: 'تحصيلات معلقة', value: data?.pending_collections ?? 0, color: 'bg-accent', path: '/collections?filter=pending' },
    { label: 'مرتجعات معلقة', value: data?.pending_returns ?? 0, color: 'bg-warning', path: '/returns?filter=pending' },
    { label: 'طلبات اليوم', value: data?.today_orders ?? 0, color: 'bg-primary', path: '/orders?filter=today' },
    { label: 'زيارات اليوم', value: data?.today_visits ?? 0, color: 'bg-success', path: '/visits?filter=today' },
  ]

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-primary to-primary-dark text-white rounded-xl p-5">
        <p className="text-sm opacity-90">لوحة التحكم</p>
        <h2 className="text-xl font-bold mt-1">إدارة النظام</h2>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {primaryWidgets.map((w) => (
          <button key={w.label} onClick={() => navigate(w.path)}
            className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors col-span-1">
            <div className={`w-10 h-10 rounded-xl ${w.color} flex items-center justify-center mb-2`}>
              <span className="text-white text-lg font-bold">{w.value}</span>
            </div>
            <span className="text-sm font-semibold text-text">{w.label}</span>
          </button>
        ))}
      </div>

      <button onClick={() => navigate('/analytics/customers')}
        className="bg-primary text-white rounded-xl p-3 w-full text-sm font-semibold text-center mb-2"
      >
        تحليلات العملاء
      </button>

      <button onClick={() => navigate('/settings/company')}
        className="w-full bg-white rounded-xl border border-border p-3 text-right active:bg-surface transition-colors flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
          <span className="text-white text-sm font-bold">ع</span>
        </div>
        <span className="text-xs font-semibold text-text">بيانات الشركة</span>
      </button>

      <h3 className="text-sm font-semibold text-text mt-4">حالة اليوم</h3>
      <div className="grid grid-cols-2 gap-3">
        {secondaryWidgets.map((w) => (
          <button key={w.label} onClick={() => navigate(w.path)}
            className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
            <div className={`w-9 h-9 rounded-lg ${w.color} flex items-center justify-center mb-2`}>
              <span className="text-white text-sm font-bold">{w.value}</span>
            </div>
            <span className="text-xs font-semibold text-text">{w.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
