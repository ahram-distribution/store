import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import SmartFilterBar, { type FilterValues } from '../../components/SmartFilterBar'
import { VisitCard } from '../../components/visits/VisitCard'
import { resolveDateRangeISO } from '../../lib/dateRange'
import { usePersistentViewState } from '../../hooks/usePersistentViewState'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const fmt = (n: number) => Number.isFinite(n) ? n.toLocaleString('ar-EG-u-nu-latn') : '0'

export default function SalesManagerVisitsList() {
  const nav = useNavigate()
  const [visits, setVisits] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([])
  const [viewState, setViewState, resetViewState] = usePersistentViewState('sales-visits', {
    filters: { datePreset: 'month', dateFrom: '', dateTo: '', search: '', employeeId: '' } as FilterValues,
  })
  const { filters } = viewState
  const [sfResetKey, setSfResetKey] = useState(0)

  const resolveDateRange = (f: FilterValues): { from: string | null; to: string | null } => {
    if (f.datePreset === 'all') return { from: null, to: null }
    if (f.datePreset === 'custom') return resolveDateRangeISO('custom', f.dateFrom || undefined, f.dateTo || undefined)
    return resolveDateRangeISO(f.datePreset as any)
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

      <SmartFilterBar key={sfResetKey} initialFilters={filters}
        searchPlaceholder="بحث باسم العميل أو كود الزيارة..."
        employees={employees}
        onFilterChange={(f) => setViewState({ filters: f })}
      />
      <button onClick={() => { resetViewState(); setSfResetKey(k => k + 1) }} className="text-[10px] px-2 py-1 text-danger font-semibold">إعادة تعيين</button>

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
