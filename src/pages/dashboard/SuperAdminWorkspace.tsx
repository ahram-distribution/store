import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { ORDER_STATUS_LABELS } from '../../types/order-display'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface DashData {
  total_orders: number; pending_orders: number; approved_orders: number
  total_customers: number; active_visits: number; pending_collections: number
  pending_returns: number; today_orders: number; today_visits: number
}

interface CreditStats {
  new_apps: number; under_review: number; docs_pending: number
  approved: number; rejected: number; suspended: number
}

interface StatusCount {
  status: string; count: number
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-200 text-gray-700', submitted: 'bg-blue-100 text-blue-700',
  reviewing: 'bg-yellow-100 text-yellow-700', returned_for_revision: 'bg-orange-100 text-orange-700',
  approved: 'bg-green-100 text-green-700', preparing: 'bg-amber-100 text-amber-700',
  prepared: 'bg-teal-100 text-teal-700', ready_for_dispatch: 'bg-indigo-100 text-indigo-700',
  sent_to_delivery: 'bg-cyan-100 text-cyan-700', dispatched: 'bg-purple-100 text-purple-700',
  deferred: 'bg-slate-100 text-slate-700', cancelled: 'bg-red-100 text-red-700',
  delivered: 'bg-emerald-100 text-emerald-700',
}

export function SuperAdminWorkspace() {
  const navigate = useNavigate()
  const [dash, setDash] = useState<DashData | null>(null)
  const [credit, setCredit] = useState<CreditStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [pendingApprovals, setPendingApprovals] = useState(0)
  const [preparingOrders, setPreparingOrders] = useState(0)
  const [activeEmp, setActiveEmp] = useState(0)
  const [statusCounts, setStatusCounts] = useState<StatusCount[]>([])

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    Promise.all([
      supabase.rpc('get_dashboard_management', { p_token: token }),
      supabase.rpc('get_credit_dashboard_stats', { p_token: token }),
      supabase.rpc('get_governed_dashboard_counts', { p_token: token }),
      supabase.rpc('get_order_status_counts', { p_token: token }),
    ]).then(([dashRes, crRes, countsRes2, countsRes]) => {
      if (dashRes.data) setDash(dashRes.data as DashData)
      if (crRes.data) setCredit(crRes.data as CreditStats)
      if (countsRes2.data && !countsRes2.data.error) setActiveEmp((countsRes2.data as any).employees_count ?? 0)
      if (countsRes.data && !countsRes.data.error) {
        const statusArr = countsRes.data as StatusCount[]
        setStatusCounts(statusArr)
        const sub = statusArr.find((s: StatusCount) => s.status === 'submitted')?.count || 0
        const prep = statusArr.find((s: StatusCount) => s.status === 'preparing')?.count || 0
        setPendingApprovals(sub)
        setPreparingOrders(prep)
      }
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>

  function QuickAction({ path, icon, label, color }: { path: string; icon: string; label: string; color: string }) {
    return (
      <button onClick={() => navigate(path)}
        className={`${color} text-white rounded-xl p-4 text-center active:opacity-90 transition-opacity flex flex-col items-center gap-1`}>
        <span className="text-xl">{icon}</span>
        <span className="text-xs font-semibold">{label}</span>
      </button>
    )
  }

  return (
    <div className="space-y-4">

      {/* HEADER */}
      <div className="bg-gradient-to-br from-purple-700 to-purple-900 text-white rounded-xl p-5">
        <p className="text-xs opacity-80">مركز القيادة والتشغيل</p>
        <h2 className="text-xl font-bold mt-1">لوحة السوبر أدمن</h2>
      </div>

      {/* TOP KPIs */}
      <div className="grid grid-cols-3 gap-2">
        <KPIBox value={dash?.total_orders ?? 0} label="إجمالي الطلبات" color="bg-primary" onClick={() => navigate('/orders')} />
        <KPIBox value={dash?.pending_orders ?? 0} label="معلق" color="bg-amber-500" onClick={() => navigate('/orders?filter=pending')} />
        <KPIBox value={dash?.approved_orders ?? 0} label="معتمد" color="bg-success" onClick={() => navigate('/orders?filter=approved')} />
        <KPIBox value={dash?.today_orders ?? 0} label="طلبات اليوم" color="bg-indigo-600" onClick={() => navigate('/orders?filter=today')} />
        <KPIBox value={dash?.pending_collections ?? 0} label="تحصيلات" color="bg-accent" onClick={() => navigate('/collections')} />
      </div>

      {/* PENDING QUEUES */}
      <div className="bg-white rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold text-text mb-3">قوائم الانتظار</h3>
        <div className="space-y-2">
          <QueueRowItem label="طلبات بانتظار الاعتماد" count={pendingApprovals} path="/orders/approval-queue" color="bg-accent" />
                    <QueueRowItem label="تحصيلات معلقة" count={dash?.pending_collections ?? 0} path="/collections" color="bg-orange-500" />
          <QueueRowItem label="مرتجعات معلقة" count={dash?.pending_returns ?? 0} path="/returns" color="bg-red-500" />
        </div>
      </div>

      {/* ORDER STATUS COUNTERS */}
      <div className="bg-white rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold text-text mb-3">حالة الطلبات</h3>
        <div className="grid grid-cols-3 gap-2">
          {statusCounts.map((sc) => (
            <button key={sc.status} onClick={() => navigate(`/orders?status=${sc.status}`)}
              className={`rounded-lg p-2 text-center active:opacity-80 transition-opacity ${STATUS_COLORS[sc.status] || 'bg-gray-100 text-gray-700'}`}>
              <p className="text-sm font-bold">{sc.count}</p>
              <p className="text-[9px] leading-tight">{ORDER_STATUS_LABELS[sc.status] || sc.status}</p>
            </button>
          ))}
        </div>
      </div>

      {/* QUICK ACTIONS */}
      <div>
        <h3 className="text-sm font-bold text-text mb-2">إجراءات سريعة</h3>
        <div className="grid grid-cols-3 gap-2">
          <QuickAction path="/orders/new" label="طلب جديد" icon="📋" color="bg-primary" />
          <QuickAction path="/orders/approval-queue" label="اعتماد طلبات" icon="✅" color="bg-accent" />
          <QuickAction path="/customers/new" label="عميل جديد" icon="👤" color="bg-success" />
          <QuickAction path="/visits/new" label="زيارة" icon="📍" color="bg-indigo-600" />
          <QuickAction path="/collections/new" label="تحصيل" icon="💰" color="bg-amber-500" />
                  </div>
      </div>

      {/* TODAY'S PERFORMANCE */}
      <div className="bg-white rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold text-text mb-3">أداء اليوم</h3>
        <div className="grid grid-cols-2 gap-3">
          <PerfBox value={dash?.today_orders ?? 0} label="طلبات اليوم" />
          <PerfBox value={dash?.today_visits ?? 0} label="زيارات اليوم" />
          <PerfBox value={dash?.active_visits ?? 0} label="زيارات نشطة حالياً" />
          <PerfBox value={dash?.total_customers ?? 0} label="إجمالي العملاء" />
        </div>
      </div>

      {/* PENDING APPROVALS (Credit) */}
      {credit && (
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-text">طلبات الائتمان</h3>
            <button onClick={() => navigate('/credit/applications')} className="text-[10px] text-primary font-semibold">عرض الكل</button>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <MiniStat value={credit.new_apps} label="جديد" color="bg-blue-50 text-blue-700" />
            <MiniStat value={credit.under_review} label="مراجعة" color="bg-yellow-50 text-yellow-700" />
            <MiniStat value={credit.docs_pending} label="مستندات" color="bg-orange-50 text-orange-700" />
          </div>
        </div>
      )}

      {/* MODULE WORKSPACES */}
      <div>
        <h3 className="text-sm font-bold text-text mb-2">وحدات التشغيل</h3>
        <div className="grid grid-cols-2 gap-2">
                    <ModuleCard label="التوصيل" icon="🚚" desc="إدارة الشحن والتسليم" path="/delivery" onNavigate={navigate} />
                                        <ModuleCard label="التقارير" icon="📊" desc="تقارير وتحليلات" path="/reports" onNavigate={navigate} />
          <ModuleCard label="الهيكل البيعي" icon="🔗" desc="التسلسل الهرمي للمبيعات" path="/hierarchy" onNavigate={navigate} />
          <ModuleCard label="المزادات" icon="🔨" desc="المزادات والصفقات" path="/auctions" onNavigate={navigate} />
        </div>
      </div>

      {/* QUICK LINKS */}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => navigate('/account')} className="bg-surface border border-border rounded-xl py-3 text-xs font-semibold text-text text-center">الحساب</button>
        <button onClick={() => navigate('/storefront')} className="bg-surface border border-border rounded-xl py-3 text-xs font-semibold text-text text-center">المتجر</button>
      </div>

    </div>
  )
}

function KPIBox({ value, label, color, onClick }: { value: number; label: string; color: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="bg-white rounded-xl border border-border p-3 text-center active:bg-surface transition-colors">
      <div className={`w-8 h-8 rounded-lg ${color} text-white text-sm font-bold flex items-center justify-center mx-auto mb-1`}>
        {value}
      </div>
      <span className="text-[10px] font-semibold text-text">{label}</span>
    </button>
  )
}

function QueueRowItem({ label, count, path, color }: { label: string; count: number; path: string; color: string }) {
  const navigate = useNavigate()
  return (
    <button onClick={() => navigate(path)}
      className="w-full flex items-center justify-between py-2 px-3 bg-surface rounded-lg active:bg-border transition-colors">
      <span className="text-xs font-semibold text-text">{label}</span>
      <span className={`text-xs font-bold text-white px-2 py-0.5 rounded-full ${color}`}>{count}</span>
    </button>
  )
}

function PerfBox({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-center gap-3 bg-surface rounded-lg p-3">
      <span className="text-lg font-bold text-primary">{value}</span>
      <span className="text-xs text-text-secondary">{label}</span>
    </div>
  )
}

function MiniStat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className={`rounded-lg p-2 ${color}`}>
      <p className="text-sm font-bold">{value}</p>
      <p className="text-[10px]">{label}</p>
    </div>
  )
}

function ModuleCard({ label, icon, desc, path, onNavigate }: { label: string; icon: string; desc: string; path: string; onNavigate: (p: string) => void }) {
  return (
    <button onClick={() => onNavigate(path)}
      className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
      <span className="text-lg">{icon}</span>
      <h4 className="text-xs font-bold text-text mt-1">{label}</h4>
      <p className="text-[9px] text-text-secondary mt-0.5">{desc}</p>
    </button>
  )
}
