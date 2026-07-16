import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { MobileDialog } from '../../components/shared/MobileDialog'
import { useAuthStore } from '../../store/auth'
import { MonthlyActivity } from '../../components/activity/MonthlyActivity'
import toast from 'react-hot-toast'

const POLLING_INTERVAL = 30000

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const fmt = (n: number) => Number.isFinite(n) ? n.toLocaleString('ar-EG-u-nu-latn') : '0'

interface SalesManagerCC {
  team_overview: { member_count: number; active_today: number; customer_count: number }
  attendance: { active_count: number; on_visit_count: number; on_break_count: number; no_start_count: number; ended_count: number }
  orders: { today_orders: number; today_sales: number; month_orders: number; month_sales: number; pending_followup: number; pending_collections: number }
  visits: { active_visits: number; today_visits: number; month_visits: number }
  customers: { total_customers: number; new_customers_month: number; inactive_customers: number }
  team_performance: {
    members: any[]
    team_targets: {
      sales_target: number; visits_target: number; orders_target: number; new_customers_target: number
      sales_achievement: number; visits_achievement: number; orders_achievement: number; new_customers_achievement: number
      sales_achievement_pct: number; visits_achievement_pct: number; orders_achievement_pct: number; new_customers_achievement_pct: number
    }
  }
  personal_summary: any
}

export default function SalesManagerCCPage() {
  const nav = useNavigate()
  const [showReportsCenter, setShowReportsCenter] = useState(false)
  const [data, setData] = useState<SalesManagerCC | null>(null)
  const [loading, setLoading] = useState(true)
  const user = useAuthStore((s) => s.user)

  /* Customer Picker */
  const [showCustomerPicker, setShowCustomerPicker] = useState<'order' | 'visit' | null>(null)
  const [customerList, setCustomerList] = useState<any[]>([])
  const [custSearchQuery, setCustSearchQuery] = useState('')

  const token = getToken()

  const fetchData = useCallback(async () => {
    if (!token) return
    const { data: result, error } = await supabase.rpc('get_sales_manager_cc', { p_token: token.trim() })
    if (error || (result && typeof result === 'object' && (result as Record<string, unknown>).error)) {
      setLoading(false)
      return
    }
    if (result && typeof result === 'object') {
      setData(result as unknown as SalesManagerCC)
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchData(); const id = setInterval(fetchData, POLLING_INTERVAL); return () => clearInterval(id) }, [fetchData])

  const fetchCustomers = useCallback(async () => {
    const t = getToken()
    if (!t || customerList.length > 0) return
    const { data } = await supabase.rpc('get_governed_customers', { p_token: t })
    if (data) setCustomerList(Array.isArray(data) ? data : typeof data === 'object' && data !== null ? [data] : [])
  }, [customerList.length])

  const handlePickCustomer = async (customer: any) => {
    const t = getToken()
    if (!t) return
    if (showCustomerPicker === 'order') {
      nav(`/orders/new?customer=${customer.id}`)
    }
  }

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  if (!data) return <div className="text-center py-12 text-text-secondary text-sm">لا توجد بيانات</div>

  const { team_overview: tov, attendance: att } = data

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 bg-white border-b border-border pb-2 pt-2">
        <h1 className="text-lg font-bold text-text mb-2">مركز قيادة المبيعات</h1>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-2">
        <button onClick={() => { setShowCustomerPicker('order'); fetchCustomers() }}
          className="flex-1 bg-primary/10 text-primary border border-primary/20 py-3 rounded-xl font-bold text-sm active:scale-[0.98] transition-all flex items-center justify-center gap-1.5">
          🛒 إنشاء طلب
        </button>
        <button onClick={() => nav('/visits/screen')}
          className="flex-1 bg-accent/10 text-accent border border-accent/20 py-3 rounded-xl font-bold text-sm active:scale-[0.98] transition-all flex items-center justify-center gap-1.5">
          📍 بدء زيارة
        </button>
      </div>

      {/* Team Overview Cards */}
      <div className="grid grid-cols-3 gap-3">
        <OverviewCard label="أعضاء الفريق" value={fmt(tov?.member_count ?? 0)} icon="👥" onClick={() => nav('/sales-manager/targets')} />
        <OverviewCard label="نشط اليوم" value={fmt(tov?.active_today ?? 0)} icon="✅" onClick={() => nav('/attendance/operations')} />
        <OverviewCard label="العملاء" value={fmt(tov?.customer_count ?? 0)} icon="👤" onClick={() => nav('/sales-manager/operations')} />
      </div>

      <MonthlyActivity scope="team" managerEmployeeId={user?.employee_id} />

      {/* Attendance */}
      <button onClick={() => nav('/attendance/operations')}
        className="w-full bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors hover:shadow-sm hover:border-primary/20">
        <h3 className="text-sm font-bold text-text mb-3">الحضور والانصراف</h3>
        <div className="grid grid-cols-4 gap-2 text-center">
          <MiniStat label="يعمل الآن" value={fmt(att?.active_count ?? 0)} color="text-blue-700" />
          <MiniStat label="في استراحة" value={fmt(att?.on_break_count ?? 0)} color="text-amber-700" />
          <MiniStat label="أنهوا اليوم" value={fmt(att?.ended_count ?? 0)} color="text-green-700" />
          <MiniStat label="لم يبدأوا" value={fmt(att?.no_start_count ?? 0)} color="text-gray-500" />
        </div>
      </button>

      {/* Navigation Grid */}
      <div className="grid grid-cols-2 gap-3">
        <NavCard icon="⚙️" label="العمليات التجارية" desc="الطلبات، الزيارات، العملاء" onClick={() => nav('/sales-manager/operations')} />
        <NavCard icon="📑" label="مركز التقارير" desc="تقارير النشاط والتارجت" onClick={() => setShowReportsCenter(true)} />
      </div>

      {/* Reports Center Modal */}
      {showReportsCenter && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowReportsCenter(false)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-text text-center">📑 مركز التقارير</h3>
            <button onClick={() => { setShowReportsCenter(false); nav('/reports/activity', { state: { scope: 'team' } }) }}
              className="w-full bg-gradient-to-l from-blue-600 to-indigo-700 text-white rounded-xl py-3.5 text-center active:opacity-80 transition-opacity">
              <div className="text-sm font-bold">تقارير النشاط</div>
              <div className="text-[10px] opacity-80 mt-0.5">تقرير نشاط أعضاء الفريق</div>
            </button>
            <button disabled
              className="w-full bg-gray-200 text-gray-400 rounded-xl py-3.5 text-center cursor-not-allowed">
              <div className="text-sm font-bold">تقارير التارجت</div>
              <div className="text-[10px] opacity-80 mt-0.5">قريباً</div>
            </button>
            <button onClick={() => setShowReportsCenter(false)}
              className="w-full text-text-secondary text-xs py-2">إغلاق</button>
          </div>
        </div>
      )}

      {/* Customer Picker Modal */}
      <MobileDialog
        open={!!showCustomerPicker}
        onClose={() => { setShowCustomerPicker(null); setCustSearchQuery('') }}
        title={showCustomerPicker === 'order' ? 'اختيار عميل للطلب' : 'اختيار عميل للزيارة'}
      >
        <input type="text" value={custSearchQuery} onChange={e => setCustSearchQuery(e.target.value)}
          placeholder="بحث بالاسم أو الكود..."
          className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
        <div className="space-y-1">
          {customerList.filter((c: any) => {
            if (!custSearchQuery) return true
            const q = custSearchQuery.toLowerCase()
            return c.company_name?.toLowerCase().includes(q) || c.code?.toLowerCase().includes(q)
          }).length === 0 && (
            <p className="text-center text-xs text-text-secondary py-4">لا يوجد عملاء</p>
          )}
          {customerList.filter((c: any) => {
            if (!custSearchQuery) return true
            const q = custSearchQuery.toLowerCase()
            return c.company_name?.toLowerCase().includes(q) || c.code?.toLowerCase().includes(q)
          }).map((c: any) => (
            <button key={c.id} type="button" onClick={() => { handlePickCustomer(c); setCustSearchQuery('') }}
              className="w-full text-right px-3 py-2 rounded-lg hover:bg-surface transition-colors border border-border/50 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-text">{c.company_name}</p>
                <p className="text-[10px] text-text-secondary">{c.code} {c.responsible_name ? `| ${c.responsible_name}` : ''}</p>
              </div>
              <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded">{c.owner_name || ''}</span>
            </button>
          ))}
        </div>
      </MobileDialog>

      <div className="text-center text-[10px] text-text-secondary pb-4">
        يتم التحديث تلقائياً كل 30 ثانية
      </div>
    </div>
  )
}

function OverviewCard({ label, value, icon, onClick }: { label: string; value: string; icon: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="bg-white rounded-xl border border-border p-3 text-right active:bg-surface transition-colors w-full">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">{icon}</span>
        <span className="text-[10px] text-text-secondary">{label}</span>
      </div>
      <p className="text-lg font-bold text-text">{value}</p>
    </button>
  )
}

function NavCard({ icon, label, desc, onClick }: { icon: string; label: string; desc: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="bg-white rounded-xl border border-border p-5 text-right active:bg-surface transition-colors hover:shadow-sm hover:border-primary/20">
      <div className="text-3xl mb-2">{icon}</div>
      <p className="text-base font-bold text-text">{label}</p>
      <p className="text-[11px] text-text-secondary mt-1">{desc}</p>
    </button>
  )
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-surface rounded-lg p-2 text-center border border-border/50">
      <p className={`text-sm font-bold ${color}`}>{value}</p>
      <p className="text-[10px] text-text-secondary">{label}</p>
    </div>
  )
}
