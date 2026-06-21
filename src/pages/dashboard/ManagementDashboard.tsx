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

interface CreditStats {
  new_apps: number
  under_review: number
  docs_pending: number
  approved: number
  rejected: number
  suspended: number
}

export function ManagementDashboard() {
  const navigate = useNavigate()
  const [data, setData] = useState<MgmtData | null>(null)
  const [credit, setCredit] = useState<CreditStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) return
    Promise.all([
      supabase.rpc('get_dashboard_management', { p_token: token }),
      supabase.rpc('get_credit_dashboard_stats', { p_token: token })
    ]).then(([mgmt, cr]) => {
      if (mgmt.data) setData(mgmt.data as MgmtData)
      if (cr.data) setCredit(cr.data as CreditStats)
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
    <div className="ds-gap-lg flex flex-col">
      <div className="bg-gradient-to-br from-primary to-primary-dark text-white rounded-xl ds-p-xl">
        <p className="ds-small opacity-90">لوحة التحكم</p>
        <h2 className="ds-title mt-1">إدارة النظام</h2>
      </div>

      <div className="grid grid-cols-2 ds-gap-md">
        {primaryWidgets.map((w) => (
          <button key={w.label} onClick={() => navigate(w.path)}
            className="ds-card text-right active:bg-surface transition-colors col-span-1">
            <div className={`w-10 h-10 rounded-xl ${w.color} flex items-center justify-center mb-2`}>
              <span className="text-white ds-body font-bold">{w.value}</span>
            </div>
            <span className="ds-body font-semibold">{w.label}</span>
          </button>
        ))}
      </div>

      <button onClick={() => navigate('/analytics/customers')}
        className="ds-btn ds-btn-primary w-full"
      >
        تحليلات العملاء
      </button>

      <div className="ds-card ds-gap-md flex flex-col">
        <div className="flex items-center justify-between">
          <h3 className="ds-body font-semibold">الائتمان</h3>
          <button onClick={() => navigate('/credit/applications')} className="ds-small text-primary font-semibold">عرض الكل</button>
        </div>
        <div className="grid grid-cols-3 ds-gap-sm">
          <div className="text-center ds-p-sm bg-blue-50 rounded-lg">
            <p className="ds-body font-bold text-blue-700">{credit?.new_apps ?? 0}</p>
            <p className="ds-xs text-blue-600">جديد</p>
          </div>
          <div className="text-center ds-p-sm bg-yellow-50 rounded-lg">
            <p className="ds-body font-bold text-yellow-700">{credit?.under_review ?? 0}</p>
            <p className="ds-xs text-yellow-600">قيد المراجعة</p>
          </div>
          <div className="text-center ds-p-sm bg-orange-50 rounded-lg">
            <p className="ds-body font-bold text-orange-700">{credit?.docs_pending ?? 0}</p>
            <p className="ds-xs text-orange-600">مستندات</p>
          </div>
          <div className="text-center ds-p-sm bg-green-50 rounded-lg">
            <p className="ds-body font-bold text-green-700">{credit?.approved ?? 0}</p>
            <p className="ds-xs text-green-600">معتمد</p>
          </div>
          <div className="text-center ds-p-sm bg-red-50 rounded-lg">
            <p className="ds-body font-bold text-red-700">{credit?.rejected ?? 0}</p>
            <p className="ds-xs text-red-600">مرفوض</p>
          </div>
          <div className="text-center ds-p-sm bg-gray-100 rounded-lg">
            <p className="ds-body font-bold text-gray-700">{credit?.suspended ?? 0}</p>
            <p className="ds-xs text-gray-600">معلق</p>
          </div>
        </div>
        <button onClick={() => navigate('/credit/programs')} className="ds-btn ds-btn-ghost w-full ds-small">إدارة برامج الائتمان</button>
      </div>

      <button onClick={() => navigate('/settings/company')}
        className="ds-card flex items-center ds-gap-md active:bg-surface transition-colors">
        <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
          <span className="text-white ds-small font-bold">ع</span>
        </div>
        <span className="ds-small font-semibold">بيانات الشركة</span>
      </button>

      <h3 className="ds-subtitle">حالة اليوم</h3>
      <div className="grid grid-cols-2 ds-gap-md">
        {secondaryWidgets.map((w) => (
          <button key={w.label} onClick={() => navigate(w.path)}
            className="ds-card text-right active:bg-surface transition-colors">
            <div className={`w-9 h-9 rounded-lg ${w.color} flex items-center justify-center mb-2`}>
              <span className="text-white ds-small font-bold">{w.value}</span>
            </div>
            <span className="ds-xs font-semibold">{w.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
