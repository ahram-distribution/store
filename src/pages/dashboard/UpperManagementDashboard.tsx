import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

interface DashboardData {
  new_orders: number
  pending_orders: number
  active_visits: number
  today_visits: number
  new_customers: number
  stagnant_customers: number
  daily_sales: number
  monthly_sales: number
  best_rep: { id: string; code: string; name: string; total_sales: number } | null
  weakest_rep: { id: string; code: string; name: string; total_sales: number } | null
  total_customers: number
  total_reps: number
}

interface StatusCount {
  status: string; count: number
}

interface DashMgmt {
  total_orders: number; pending_orders: number; approved_orders: number
  total_customers: number; active_visits: number; pending_collections: number
  pending_returns: number; today_orders: number; today_visits: number
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'مسودة', submitted: 'مقدم', reviewing: 'قيد المراجعة',
  returned_for_revision: 'معاد للتعديل', approved: 'معتمد',
  preparing: 'قيد التجهيز', prepared: 'تم التجهيز',
  ready_for_dispatch: 'بانتظار القرار', sent_to_delivery: 'أرسل للتوصيل',
  dispatched: 'تم الشحن', deferred: 'مؤجل', cancelled: 'ملغي', delivered: 'تم التسليم',
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

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

function fmt(n: number): string {
  return n.toLocaleString('ar-EG')
}

export default function UpperManagementDashboard() {
  const nav = useNavigate()
  const [data, setData] = useState<DashboardData | null>(null)
  const [dashMgmt, setDashMgmt] = useState<DashMgmt | null>(null)
  const [statusCounts, setStatusCounts] = useState<StatusCount[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    Promise.all([
      supabase.rpc('get_upper_management_dashboard', { p_token: token }),
      supabase.rpc('get_dashboard_management', { p_token: token }),
      supabase.rpc('get_order_status_counts', { p_token: token }),
    ]).then(([umd, mgmt, counts]) => {
      if (!umd.error && umd.data) setData(umd.data as DashboardData)
      if (!mgmt.error && mgmt.data) setDashMgmt(mgmt.data as DashMgmt)
      if (!counts.error && counts.data) setStatusCounts(counts.data as StatusCount[])
      setLoading(false)
    })
  }, [])

  if (loading) {
    return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  }

  const submittedCount = statusCounts.find(s => s.status === 'submitted')?.count || 0
  const preparingCount = statusCounts.find(s => s.status === 'preparing')?.count || 0

  return (
    <div className="p-4 space-y-6" dir="rtl">
      <h1 className="text-xl font-bold text-text">لوحة الإدارة العليا</h1>

      {/* 12 KPIs */}
      <div className="grid grid-cols-2 gap-3">
        <KpiCard label="الطلبات الجديدة" value={data?.new_orders ?? 0} color="bg-primary" onClick={() => nav('/orders?status=new')} />
        <KpiCard label="الطلبات المعلقة" value={data?.pending_orders ?? 0} color="bg-warning" onClick={() => nav('/orders?status=pending')} />
        <KpiCard label="الزيارات الجارية" value={data?.active_visits ?? 0} color="bg-success" onClick={() => nav('/visits?status=active')} />
        <KpiCard label="زيارات اليوم" value={data?.today_visits ?? 0} color="bg-accent" onClick={() => nav('/visits?date=today')} />
        <KpiCard label="العملاء الجدد" value={data?.new_customers ?? 0} color="bg-primary" onClick={() => nav('/customers?filter=new')} />
        <KpiCard label="العملاء الراكدون" value={data?.stagnant_customers ?? 0} color="bg-warning" onClick={() => nav('/customers?filter=stagnant')} />
        <KpiCard label="المبيعات اليومية" value={fmt(data?.daily_sales ?? 0)} color="bg-success" onClick={() => nav('/reports')} />
        <KpiCard label="المبيعات الشهرية" value={fmt(data?.monthly_sales ?? 0)} color="bg-accent" onClick={() => nav('/reports')} />
        <KpiCard label="أفضل مندوب" value={data?.best_rep?.name ?? '—'} color="bg-success" onClick={() => data?.best_rep && nav(`/employees/${data.best_rep.id}`)} />
        <KpiCard label="أضعف مندوب" value={data?.weakest_rep?.name ?? '—'} color="bg-warning" onClick={() => data?.weakest_rep && nav(`/employees/${data.weakest_rep.id}`)} />
        <KpiCard label="عدد العملاء" value={data?.total_customers ?? 0} color="bg-primary" onClick={() => nav('/customers')} />
        <KpiCard label="عدد المناديب" value={data?.total_reps ?? 0} color="bg-accent" onClick={() => nav('/employees')} />
      </div>

      {/* Pending Queues */}
      <div className="bg-white rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold text-text mb-3">قوائم الانتظار</h3>
        <div className="space-y-2">
          <QueueRow label="بانتظار الاعتماد" count={submittedCount} color="bg-accent" onClick={() => nav('/orders/approval-queue')} />
          <QueueRow label="قيد التجهيز" count={preparingCount} color="bg-amber-500" onClick={() => nav('/warehouse')} />
          <QueueRow label="تحصيلات معلقة" count={dashMgmt?.pending_collections ?? 0} color="bg-orange-500" onClick={() => nav('/collections')} />
          <QueueRow label="مرتجعات معلقة" count={dashMgmt?.pending_returns ?? 0} color="bg-red-500" onClick={() => nav('/returns')} />
        </div>
      </div>

      {/* Order Status Counters */}
      <div className="bg-white rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold text-text mb-3">حالة الطلبات</h3>
        <div className="grid grid-cols-3 gap-2">
          {statusCounts.map((sc) => (
            <button key={sc.status} onClick={() => nav(`/orders?status=${sc.status}`)}
              className={`rounded-lg p-2 text-center active:opacity-80 transition-opacity ${STATUS_COLORS[sc.status] || 'bg-gray-100 text-gray-700'}`}>
              <p className="text-sm font-bold">{sc.count}</p>
              <p className="text-[9px] leading-tight">{STATUS_LABELS[sc.status] || sc.status}</p>
            </button>
          ))}
        </div>
      </div>

      {/* 9 Quick Actions */}
      <div>
        <h2 className="text-lg font-bold text-text mb-3">إجراءات سريعة</h2>
        <div className="grid grid-cols-3 gap-3">
          <ActionButton label="العملاء" icon="👥" onClick={() => nav('/customers')} />
          <ActionButton label="الطلبات" icon="📋" onClick={() => nav('/orders')} />
          <ActionButton label="الزيارات" icon="📍" onClick={() => nav('/visits')} />
          <ActionButton label="المناديب" icon="🧑‍💼" onClick={() => nav('/employees?role=rep')} />
          <ActionButton label="السوبر فايزر" icon="👔" onClick={() => nav('/employees?role=supervisor')} />
          <ActionButton label="الموظفين" icon="👥" onClick={() => nav('/employees')} />
          <ActionButton label="التقارير" icon="📊" onClick={() => nav('/reports')} />
          <ActionButton label="المخزون" icon="📦" onClick={() => nav('/products')} />
          <ActionButton label="النشاط الموحد" icon="🔄" onClick={() => nav('/activity')} />
        </div>
      </div>

      {/* Operational Modules */}
      <div>
        <h3 className="text-sm font-bold text-text mb-2">وحدات التشغيل</h3>
        <div className="grid grid-cols-2 gap-2">
          <ModuleCard label="المخزن" icon="📦" desc="تجهيز ومراجعة الطلبات" onClick={() => nav('/warehouse')} />
          <ModuleCard label="التوصيل" icon="🚚" desc="إدارة الشحن والتسليم" onClick={() => nav('/delivery')} />
          <ModuleCard label="المنتجات" icon="🛍️" desc="إدارة قائمة المنتجات" onClick={() => nav('/products')} />
          <ModuleCard label="الموظفين" icon="👥" desc="إدارة الموظفين والصلاحيات" onClick={() => nav('/employees')} />
          <ModuleCard label="الشركات" icon="🏢" desc="إدارة الشركات المورّدة" onClick={() => nav('/companies')} />
          <ModuleCard label="التقارير" icon="📊" desc="تقارير وتحليلات" onClick={() => nav('/reports')} />
          <ModuleCard label="الهيكل البيعي" icon="🔗" desc="التسلسل الهرمي للمبيعات" onClick={() => nav('/hierarchy')} />
          <ModuleCard label="المزادات" icon="🔨" desc="المزادات والصفقات" onClick={() => nav('/auctions')} />
        </div>
      </div>
    </div>
  )
}

function KpiCard({ label, value, color, onClick }: { label: string; value: string | number; color: string; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={`bg-white rounded-xl border border-border p-4 text-right ${onClick ? 'active:bg-surface transition-colors cursor-pointer' : ''}`}
    >
      <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center mb-2`}>
        <span className="text-white text-lg font-bold">{typeof value === 'number' ? value : value}</span>
      </div>
      <span className="text-sm font-semibold text-text">{label}</span>
    </Tag>
  )
}

function ActionButton({ label, icon, onClick }: { label: string; icon: string; onClick?: () => void }) {
  return (
    <button onClick={onClick}
      className="bg-white rounded-xl border border-border p-3 text-center active:bg-surface transition-colors cursor-pointer">
      <div className="text-2xl mb-1">{icon}</div>
      <span className="text-xs font-semibold text-text">{label}</span>
    </button>
  )
}

function QueueRow({ label, count, color, onClick }: { label: string; count: number; color: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="w-full flex items-center justify-between py-2 px-3 bg-surface rounded-lg active:bg-border transition-colors">
      <span className="text-xs font-semibold text-text">{label}</span>
      <span className={`text-xs font-bold text-white px-2 py-0.5 rounded-full ${color}`}>{count}</span>
    </button>
  )
}

function ModuleCard({ label, icon, desc, onClick }: { label: string; icon: string; desc: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
      <span className="text-lg">{icon}</span>
      <h4 className="text-xs font-bold text-text mt-1">{label}</h4>
      <p className="text-[9px] text-text-secondary mt-0.5">{desc}</p>
    </button>
  )
}
