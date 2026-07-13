import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'

const MONTHS = ['يناير', 'فبراير', 'مارس', 'إبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']

const STORAGE_KEY = 'monthly_activity_month'

interface MonthlyActivityProps {
  scope: 'company' | 'team' | 'personal'
  managerEmployeeId?: string | null
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '\u2014'
  if (Number.isInteger(n)) return n.toLocaleString('ar-EG-u-nu-latn')
  return n.toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function kpiFontClass(formatted: string): string {
  if (formatted === '\u2014') return 'text-xl sm:text-2xl'
  const len = formatted.length
  if (len <= 8) return 'text-xl sm:text-2xl'
  if (len <= 10) return 'text-lg sm:text-xl'
  if (len <= 12) return 'text-base sm:text-lg'
  return 'text-sm sm:text-base'
}

function loadSavedMonth(): { month: number; year: number } {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      const now = new Date()
      const currentMonth = now.getMonth() + 1
      const currentYear = now.getFullYear()
      if (parsed.year < currentYear || (parsed.year === currentYear && parsed.month <= currentMonth)) {
        return parsed
      }
    }
  } catch {}
  const now = new Date()
  return { month: now.getMonth() + 1, year: now.getFullYear() }
}

function saveMonth(month: number, year: number) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ month, year })) } catch {}
}

export function MonthlyActivity({ scope, managerEmployeeId }: MonthlyActivityProps) {
  const user = useAuthStore((s) => s.user)
  const saved = loadSavedMonth()
  const [month, setMonthState] = useState(saved.month)
  const [year, setYearState] = useState(saved.year)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()

  function setMonth(m: number, y: number) {
    setMonthState(m)
    setYearState(y)
    saveMonth(m, y)
  }

  const yearOptions: number[] = []
  for (let y = currentYear - 5; y <= currentYear; y++) yearOptions.push(y)

  function getDateRange() {
    const from = new Date(year, month - 1, 1).toISOString()
    const to = month === currentMonth && year === currentYear
      ? now.toISOString()
      : new Date(year, month, 1).toISOString()
    return { from, to }
  }

  useEffect(() => {
    const { from, to } = getDateRange()
    setLoading(true)
    setData(null)

    if (scope === 'personal') {
      const eid = user?.employee_id
      if (!eid) { setLoading(false); return }
      supabase.rpc('get_runtime_activity', {
        p_employee_id: eid,
        p_date_from: from,
        p_date_to: to,
      }).then(({ data: d, error }) => {
        if (!error && d) setData(d)
      }).finally(() => setLoading(false))
    } else {
      const params: Record<string, any> = { p_date_from: from, p_date_to: to }
      if (scope === 'company') {
        params.p_manager_employee_id = null
      } else {
        params.p_manager_employee_id = managerEmployeeId || user?.employee_id || null
      }
      supabase.rpc('get_runtime_team_activity', params).then(({ data: d, error }) => {
        if (!error && d) setData(d)
      }).finally(() => setLoading(false))
    }
  }, [month, year, scope, managerEmployeeId, user?.employee_id])

  let totalSales = 0
  let totalVisits = 0
  let totalOrders = 0
  let totalCustomers = 0

  if (scope === 'personal' && data) {
    totalSales = data.created_sales || 0
    totalOrders = data.created_orders || 0
    totalVisits = data.completed_visits || 0
    totalCustomers = data.registered_customers || 0
  } else if (Array.isArray(data)) {
    for (const m of data) {
      totalSales += m.sales || 0
      totalOrders += m.orders || 0
      totalVisits += m.completed_visits || 0
      totalCustomers += m.registered_customers || 0
    }
  }

  const formattedValues = [
    fmt(Math.round(totalSales)),
    fmt(totalVisits),
    fmt(totalOrders),
    fmt(totalCustomers),
  ]

  const KPIS = [
    { label: 'إجمالي المبيعات', icon: '💰' },
    { label: 'إجمالي الزيارات', icon: '📍' },
    { label: 'إجمالي الطلبات', icon: '📦' },
    { label: 'إجمالي العملاء الجدد', icon: '👥' },
  ]

  const label = MONTHS[month - 1] + ' ' + year

  return (
    <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
      <div className="bg-gradient-to-l from-primary to-primary-dark px-5 py-3.5 flex items-center justify-between">
        <h2 className="text-sm font-bold text-white">النشاط الشهرى 🟢</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/70">📅</span>
          <select value={month}
            onChange={(e) => setMonth(Number(e.target.value), year)}
            className="bg-white/15 text-white text-xs rounded-lg px-2 py-1 border border-white/20 outline-none appearance-none cursor-pointer"
          >
            {MONTHS.map((name, i) => {
              const m = i + 1
              const disabled = m > currentMonth && year === currentYear
              return <option key={m} value={m} disabled={disabled} className="text-gray-800">{name}</option>
            })}
          </select>
          <select value={year}
            onChange={(e) => setMonth(Math.min(month, currentMonth), Number(e.target.value))}
            className="bg-white/15 text-white text-xs rounded-lg px-2 py-1 border border-white/20 outline-none appearance-none cursor-pointer"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y} disabled={y > currentYear} className="text-gray-800">{y}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="p-5">
        {loading && <div className="text-center py-6 text-text-secondary text-sm">جاري التحميل...</div>}
        {!loading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {KPIS.map((kpi, idx) => {
              const formatted = formattedValues[idx]
              return (
                <div key={kpi.label} className={
                  'rounded-xl p-4 text-center border shadow-sm overflow-hidden ' +
                  (idx === 0 ? 'bg-gradient-to-br from-emerald-50 to-green-100/60 border-emerald-200/50' :
                   idx === 1 ? 'bg-gradient-to-br from-amber-50 to-yellow-100/60 border-amber-200/50' :
                   idx === 2 ? 'bg-gradient-to-br from-blue-50 to-indigo-100/60 border-blue-200/50' :
                   'bg-gradient-to-br from-violet-50 to-purple-100/60 border-violet-200/50')
                }>
                  <div className="text-2xl mb-1">{kpi.icon}</div>
                  <div className={
                    kpiFontClass(formatted) + ' font-bold whitespace-nowrap ' +
                    (idx === 0 ? 'text-success' : idx === 1 ? 'text-warning' : idx === 2 ? 'text-primary' : 'text-accent')
                  }>
                    {formatted}
                  </div>
                  <div className="text-[11px] text-text-secondary mt-1 font-medium">{kpi.label}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
