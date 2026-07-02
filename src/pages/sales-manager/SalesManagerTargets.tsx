import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort } from '../../utils/format'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const fmt = (n: number) => Number.isFinite(n) ? n.toLocaleString('ar-EG-u-nu-latn') : '0'
const fmtPct = (n: number) => Number.isFinite(n) ? n.toFixed(1) + '%' : '0.0%'
const pctColor = (pct: number) => pct >= 100 ? 'text-success' : pct >= 50 ? 'text-warning' : 'text-red-500'

interface MemberPerf {
  employee_id: string; employee_code: string; employee_name: string
  customer_count: number; month_orders: number; month_sales: number
  today_orders: number; today_visits: number; month_visits: number
  sales_target: number; visits_target: number; orders_target: number
  new_customers_target: number; achievement_pct: number
}

interface TeamTargets {
  sales_target: number; visits_target: number; orders_target: number
  new_customers_target: number; sales_achievement: number; visits_achievement: number
  orders_achievement: number; new_customers_achievement: number
  sales_achievement_pct: number; visits_achievement_pct: number
  orders_achievement_pct: number; new_customers_achievement_pct: number
}

interface TeamPerformance { members: MemberPerf[]; team_targets: TeamTargets }

export default function SalesManagerTargets() {
  const nav = useNavigate()
  const [teamPerf, setTeamPerf] = useState<TeamPerformance | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [dateFilter, setDateFilter] = useState<string>('month')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const fetchData = useCallback(async () => {
    const token = getToken()
    if (!token) return
    const { data: result, error } = await supabase.rpc('get_sales_manager_cc', { p_token: token.trim() })
    if (error || (result && typeof result === 'object' && (result as Record<string, unknown>).error)) {
      setLoading(false); return
    }
    if (result && typeof result === 'object') {
      const d = result as any
      if (d.team_performance) setTeamPerf(d.team_performance as TeamPerformance)
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  if (!teamPerf) return <div className="text-center py-12 text-text-secondary text-sm">لا توجد بيانات</div>

  const tt = teamPerf.team_targets

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-border pb-2 pt-2">
        <div className="flex items-center gap-2">
          <button onClick={() => nav('/sales-manager-cc')} className="text-xs text-primary font-semibold">→ رجوع</button>
          <h1 className="text-lg font-bold text-text">المستهدفات والإنجاز</h1>
        </div>
      </div>

      {/* Team Targets */}
      {tt && (
        <div className="bg-white rounded-xl border border-border p-4">
          <h3 className="text-sm font-bold text-text mb-3">أهداف الفريق</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <TargetCard label="المبيعات" target={tt.sales_target} actual={tt.sales_achievement} pct={tt.sales_achievement_pct} />
            <TargetCard label="الزيارات" target={tt.visits_target} actual={tt.visits_achievement} pct={tt.visits_achievement_pct} />
            <TargetCard label="الطلبات" target={tt.orders_target} actual={tt.orders_achievement} pct={tt.orders_achievement_pct} />
            <TargetCard label="عملاء جدد" target={tt.new_customers_target} actual={tt.new_customers_achievement} pct={tt.new_customers_achievement_pct} />
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-text">أعضاء الفريق</h3>
        </div>
        <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
          placeholder="بحث بالاسم أو الكود..."
          className="w-full text-xs px-3 py-2 rounded-lg border border-border bg-surface mb-3 focus:outline-none focus:border-primary transition-colors" />
        <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3 scrollbar-none">
          {[
            { key: 'today', label: 'اليوم' },
            { key: 'yesterday', label: 'اليوم السابق' },
            { key: 'week', label: 'الأسبوع الحالي' },
            { key: 'month', label: 'هذا الشهر' },
            { key: 'prev_month', label: 'الشهر السابق' },
            { key: 'custom', label: 'فترة محددة' },
          ].map(f => (
            <button key={f.key} onClick={() => setDateFilter(f.key)}
              className={`shrink-0 text-[10px] px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                dateFilter === f.key ? 'bg-primary text-white' : 'bg-surface text-text-secondary border border-border/50'
              }`}>
              {f.label}
            </button>
          ))}
        </div>
        {dateFilter === 'custom' && (
          <div className="flex gap-2 mb-3">
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="flex-1 text-xs px-2 py-1.5 rounded-lg border border-border bg-surface focus:outline-none focus:border-primary" />
            <span className="text-xs text-text-secondary self-center">إلى</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="flex-1 text-xs px-2 py-1.5 rounded-lg border border-border bg-surface focus:outline-none focus:border-primary" />
          </div>
        )}

        {/* Member Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {teamPerf.members
            .filter(m => {
              if (!searchQuery) return true
              const q = searchQuery.toLowerCase()
              return m.employee_name?.toLowerCase().includes(q) || m.employee_code?.toLowerCase().includes(q)
            })
            .map(m => (
            <button key={m.employee_id} onClick={() => nav(`/employees/${m.employee_id}`)}
              className="bg-white rounded-xl border border-border p-3 text-right active:bg-surface transition-colors">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mb-2 mx-auto">
                <span className="text-sm font-bold text-primary">{m.employee_name?.charAt(0) || '?'}</span>
              </div>
              <p className="text-sm font-bold text-text text-center truncate">{m.employee_name}</p>
              <p className="text-[10px] text-text-secondary text-center mb-2">{m.employee_code}</p>
              <div className="grid grid-cols-2 gap-1 text-center">
                <div className="bg-surface rounded p-1">
                  <p className="text-xs font-bold text-text">
                    {dateFilter === 'today' || dateFilter === 'yesterday' ? fmt(m.today_orders) : fmt(m.month_orders)}
                  </p>
                  <p className="text-[8px] text-text-secondary">طلبات</p>
                </div>
                <div className="bg-surface rounded p-1">
                  <p className="text-xs font-bold text-text">
                    {dateFilter === 'today' || dateFilter === 'yesterday' ? fmt(m.today_visits) : fmt(m.month_visits)}
                  </p>
                  <p className="text-[8px] text-text-secondary">زيارات</p>
                </div>
                <div className="bg-surface rounded p-1">
                  <p className="text-xs font-bold text-text">{fmt(m.customer_count)}</p>
                  <p className="text-[8px] text-text-secondary">عملاء</p>
                </div>
                <div className="bg-surface rounded p-1">
                  <p className={`text-xs font-bold ${pctColor(m.achievement_pct)}`}>
                    {m.sales_target > 0 ? fmtPct(m.achievement_pct) : 'غير متوفر'}
                  </p>
                  <p className="text-[8px] text-text-secondary">إنجاز</p>
                </div>
              </div>
            </button>
          ))}
        </div>
        {teamPerf.members.filter(m => {
          if (!searchQuery) return true
          const q = searchQuery.toLowerCase()
          return m.employee_name?.toLowerCase().includes(q) || m.employee_code?.toLowerCase().includes(q)
        }).length === 0 && (
          <p className="text-center text-xs text-text-secondary py-8">لا يوجد أعضاء مطابقين</p>
        )}
      </div>

      {/* Performance Table */}
      {teamPerf.members.length > 0 && (
        <div className="bg-white rounded-xl border border-border p-4">
          <h3 className="text-sm font-bold text-text mb-3">أداء أعضاء الفريق</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-right py-2 px-2 text-text-secondary font-semibold">الاسم</th>
                  <th className="text-center py-2 px-2 text-text-secondary font-semibold">العملاء</th>
                  <th className="text-center py-2 px-2 text-text-secondary font-semibold">الطلبات</th>
                  <th className="text-center py-2 px-2 text-text-secondary font-semibold">المبيعات</th>
                  <th className="text-center py-2 px-2 text-text-secondary font-semibold">الزيارات</th>
                  <th className="text-center py-2 px-2 text-text-secondary font-semibold">الإنجاز</th>
                </tr>
              </thead>
              <tbody>
                {teamPerf.members.map(m => (
                  <tr key={m.employee_id} className="border-b border-border/50 hover:bg-surface/50 cursor-pointer"
                    onClick={() => nav(`/employees/${m.employee_id}`)}>
                    <td className="py-2 px-2 font-semibold text-text">{m.employee_name}</td>
                    <td className="py-2 px-2 text-center text-text-secondary">{fmt(m.customer_count)}</td>
                    <td className="py-2 px-2 text-center text-text-secondary">{fmt(m.month_orders)}</td>
                    <td className="py-2 px-2 text-center text-text-secondary">{formatCurrencyShort(m.month_sales)}</td>
                    <td className="py-2 px-2 text-center text-text-secondary">{fmt(m.month_visits)}</td>
                    <td className={`py-2 px-2 text-center font-bold ${pctColor(m.achievement_pct)}`}>
                      {m.sales_target > 0 ? fmtPct(m.achievement_pct) : 'غير متوفر'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function TargetCard({ label, target, actual, pct }: { label: string; target: number; actual: number; pct: number }) {
  return (
    <div className="bg-surface rounded-xl p-3 border border-border/50">
      <p className="text-[10px] text-text-secondary mb-1">{label}</p>
      <p className="text-sm font-bold text-text">{formatCurrencyShort(target)}</p>
      <div className="flex items-center gap-2 mt-1">
        <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-success' : pct >= 50 ? 'bg-warning' : 'bg-red-400'}`}
            style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <span className={`text-[10px] font-bold ${pctColor(pct)}`}>{fmtPct(pct)}</span>
      </div>
    </div>
  )
}
