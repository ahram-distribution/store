import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface Counts {
  total_orders: number
  pending_orders: number
  approved_orders: number
  total_customers: number
  active_visits: number
  pending_collections: number
  pending_returns: number
  today_orders: number
  today_visits: number
  total_employees: number
  total_companies: number
  total_products: number
}

export function AdminWorkspace() {
  const navigate = useNavigate()
  const [data, setData] = useState<Counts | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    Promise.all([
      supabase.rpc('get_dashboard_management', { p_token: token }),
      supabase.rpc('get_governed_dashboard_counts', { p_token: token }),
      supabase.rpc('get_governed_products', { p_token: token, p_count_only: true }),
    ]).then(([mgmt, countsRes, prod]) => {
      const m = mgmt.data as any || {}
      const dc = countsRes.data as any || {}
      const prodCount = Array.isArray(prod.data) ? (prod.data[0]?.count ?? 0) : 0
      setData({
        total_orders: m.total_orders ?? 0,
        pending_orders: m.pending_orders ?? 0,
        approved_orders: m.approved_orders ?? 0,
        total_customers: m.total_customers ?? 0,
        active_visits: m.active_visits ?? 0,
        pending_collections: m.pending_collections ?? 0,
        pending_returns: m.pending_returns ?? 0,
        today_orders: m.today_orders ?? 0,
        today_visits: m.today_visits ?? 0,
        total_employees: dc.employees_count ?? 0,
        total_companies: dc.companies_count ?? 0,
        total_products: prodCount,
      })
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-primary to-primary-dark text-white rounded-xl p-5">
        <p className="text-sm opacity-90">لوحة التحكم</p>
        <h2 className="text-xl font-bold mt-1">الإدارة</h2>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => navigate('/orders')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{data?.total_orders}</span></div>
          <span className="text-sm font-semibold text-text">إجمالي الطلبات</span>
        </button>
        <button onClick={() => navigate('/orders?filter=pending')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{data?.pending_orders}</span></div>
          <span className="text-sm font-semibold text-text">معلقة</span>
        </button>
        <button onClick={() => navigate('/orders?filter=approved')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-success flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{data?.approved_orders}</span></div>
          <span className="text-sm font-semibold text-text">معتمدة</span>
        </button>
        <button onClick={() => navigate('/customers')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{data?.total_customers}</span></div>
          <span className="text-sm font-semibold text-text">العملاء</span>
        </button>
        <button onClick={() => navigate('/employees')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{data?.total_employees}</span></div>
          <span className="text-sm font-semibold text-text">الموظفين</span>
        </button>
        <button onClick={() => navigate('/products')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{data?.total_products}</span></div>
          <span className="text-sm font-semibold text-text">المنتجات</span>
        </button>
        <button onClick={() => navigate('/companies')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{data?.total_companies}</span></div>
          <span className="text-sm font-semibold text-text">الشركات</span>
        </button>
        <button onClick={() => navigate('/visits')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-success flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{data?.active_visits}</span></div>
          <span className="text-sm font-semibold text-text">زيارات نشطة</span>
        </button>
      </div>

      <div className="bg-white rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold text-text mb-3">إجراءات سريعة</h3>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => navigate('/orders/new')} className="bg-primary text-white text-xs py-2.5 rounded-lg">طلب جديد</button>
          <button onClick={() => navigate('/customers')} className="bg-primary text-white text-xs py-2.5 rounded-lg">إدارة العملاء</button>
          <button onClick={() => navigate('/products')} className="bg-surface text-text text-xs py-2.5 rounded-lg border border-border">المنتجات</button>
          <button onClick={() => navigate('/orders/approval-queue')} className="bg-accent text-white text-xs py-2.5 rounded-lg">اعتماد الطلبات</button>
          <button onClick={() => navigate('/analytics/customers')} className="bg-surface text-text text-xs py-2.5 rounded-lg border border-border">تحليلات</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => navigate('/collections')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center mb-2"><span className="text-white text-sm font-bold">{data?.pending_collections}</span></div>
          <span className="text-xs font-semibold text-text">تحصيلات معلقة</span>
        </button>
        <button onClick={() => navigate('/returns')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-9 h-9 rounded-lg bg-warning flex items-center justify-center mb-2"><span className="text-white text-sm font-bold">{data?.pending_returns}</span></div>
          <span className="text-xs font-semibold text-text">مرتجعات معلقة</span>
        </button>
      </div>
    </div>
  )
}
