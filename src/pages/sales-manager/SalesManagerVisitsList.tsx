import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import SmartFilterBar, { type FilterValues } from '../../components/SmartFilterBar'
import { VisitCard } from '../../components/visits/VisitCard'
import { resolveDateRangeISO } from '../../lib/dateRange'
import { usePersistentViewState } from '../../hooks/usePersistentViewState'
import { formatNumber } from '../../utils/numbers'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const fmt = (n: number) => formatNumber(n)

const PAGE_SIZE = 40

export default function SalesManagerVisitsList() {
  const nav = useNavigate()
  const [visits, setVisits] = useState<any[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
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

  const buildParams = useCallback((page: number, perPage: number, countOnly: boolean) => {
    const token = getToken()
    if (!token) return null
    const range = resolveDateRange(filters)
    return {
      p_token: token.trim(),
      p_search: filters.search || null,
      p_employee_id: filters.employeeId || null,
      p_date_from: range.from,
      p_date_to: range.to,
      p_page: page,
      p_per_page: perPage,
      p_count_only: countOnly,
    }
  }, [filters])

  const fetchData = useCallback(async (page: number, append: boolean) => {
    if (!append) setLoading(true)
    const params = buildParams(page, PAGE_SIZE, false)
    if (!params) { setLoading(false); return }
    const proceed = () => { setLoading(false); setLoadingMore(false) }
    const [rowsRes, countRes] = await Promise.all([
      supabase.rpc('get_governed_visits', params),
      supabase.rpc('get_governed_visits', buildParams(1, PAGE_SIZE, true)),
    ])
    const rows = Array.isArray(rowsRes.data) ? rowsRes.data : []
    const count = (countRes.data && typeof countRes.data === 'object' && 'count' in (countRes.data as any)
      ? Number((countRes.data as any).count)
      : 0)
    setVisits((prev) => {
      const seen = new Set(prev.map((v: any) => v.id))
      return append ? [...prev, ...rows.filter((r: any) => !seen.has(r.id))] : rows
    })
    setTotalCount(count)
    proceed()
  }, [buildParams])

  useEffect(() => { fetchData(1, false) }, [fetchData])

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
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {visits.map((v: any) => (
              <VisitCard key={v.id} visit={v}
                customerName={v.customer_name}
                employeeName={v.employee_name}
                onClick={() => nav(`/visits/${v.id}`)} />
            ))}
          </div>
          {visits.length < totalCount && (
            <button
              onClick={() => { setLoadingMore(true); fetchData(Math.floor(visits.length / PAGE_SIZE) + 1, true) }}
              disabled={loadingMore}
              className="w-full bg-white border border-border rounded-xl py-2.5 text-xs font-semibold text-text disabled:opacity-50"
            >
              {loadingMore ? 'جاري التحميل...' : `عرض المزيد (${visits.length} من ${totalCount})`}
            </button>
          )}
        </>
      )}

      <div className="text-center text-[10px] text-text-secondary pb-4">
        إجمالي: {fmt(totalCount)} زيارة
      </div>
    </div>
  )
}
