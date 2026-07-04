import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import SmartFilterBar, { type FilterValues } from '../../components/SmartFilterBar'
import { VisitCard } from '../../components/visits/VisitCard'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const fmt = (n: number) => Number.isFinite(n) ? Math.round(n).toLocaleString('ar-EG-u-nu-latn') : '0'

export default function SalesManagerVisitsList() {
  const nav = useNavigate()
  const [visits, setVisits] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([])
  const [filters, setFilters] = useState<FilterValues>({
    datePreset: 'month', dateFrom: '', dateTo: '', search: '', employeeId: ''
  })

  const resolveDateRange = (f: FilterValues): { from: string | null; to: string | null } => {
    if (f.datePreset === 'all') return { from: null, to: null }
    const now = new Date()
    const startOfDay = (d: Date) => { d.setHours(0, 0, 0, 0); return d.toISOString() }
    const endOfDay = (d: Date) => { d.setHours(23, 59, 59, 999); return d.toISOString() }
    switch (f.datePreset) {
      case 'today': return { from: startOfDay(new Date()), to: endOfDay(new Date()) }
      case 'yesterday': {
        const y = new Date(); y.setDate(y.getDate() - 1)
        return { from: startOfDay(y), to: endOfDay(y) }
      }
      case 'week': {
        const wk = new Date(); wk.setDate(wk.getDate() - wk.getDay())
        return { from: startOfDay(wk), to: endOfDay(new Date()) }
      }
      case 'month': return { from: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: endOfDay(new Date()) }
      case 'prev_month': {
        const pm = new Date(now.getFullYear(), now.getMonth() - 1, 1)
        const pe = new Date(now.getFullYear(), now.getMonth(), 0)
        return { from: startOfDay(pm), to: endOfDay(pe) }
      }
      case 'custom': return { from: f.dateFrom ? startOfDay(new Date(f.dateFrom)) : null, to: f.dateTo ? endOfDay(new Date(f.dateTo)) : null }
      default: return { from: null, to: null }
    }
  }

  const fetchData = useCallback(async () => {
    const token = getToken()
    if (!token) return
    setLoading(true)
    const range = resolveDateRange(filters)
    const { data } = await supabase.rpc('get_governed_visits', {
      p_token: token.trim(),
      p_search: filters.search || null,
      p_employee_id: filters.employeeId || null,
      p_date_from: range.from,
      p_date_to: range.to,
    })
    if (data) setVisits(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [filters])

  useEffect(() => { fetchData() }, [fetchData])

  // Load team employees for the filter dropdown
  useEffect(() => {
    const token = getToken()
    if (!token) return
    supabase.rpc('get_sales_manager_cc', { p_token: token.trim() }).then(({ data: d }: any) => {
      if (d?.team_performance?.members) {
        setEmployees(d.team_performance.members.map((m: any) => ({ id: m.employee_id, name: m.employee_name })))
      }
    })
  }, [])

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 bg-white border-b border-border pb-2 pt-2">
        <div className="flex items-center gap-2">
          <button onClick={() => nav('/sales-manager/operations')} className="text-xs text-primary font-semibold">→ رجوع</button>
          <h1 className="text-lg font-bold text-text">الزيارات</h1>
        </div>
      </div>

      <SmartFilterBar
        searchPlaceholder="بحث باسم العميل أو كود الزيارة..."
        employees={employees}
        onFilterChange={setFilters}
      />

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : visits.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">لا توجد زيارات</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {visits.map((v: any) => (
            <VisitCard key={v.id} visit={v}
              customerName={v.customer_name}
              employeeName={v.employee_name}
              onClick={() => nav(`/visits/${v.id}`)} />
          ))}
        </div>
      )}

      <div className="text-center text-[10px] text-text-secondary pb-4">
        إجمالي: {fmt(visits.length)} زيارة
      </div>
    </div>
  )
}
