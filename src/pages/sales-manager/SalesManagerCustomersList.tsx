import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import SmartFilterBar, { type FilterValues } from '../../components/SmartFilterBar'
import { usePersistentViewState } from '../../hooks/usePersistentViewState'
import { resolveDateRangeISO } from '../../lib/dateRange'
import { formatNumber } from '../../utils/numbers'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const fmt = (n: number) => formatNumber(n)

const PAGE_SIZE = 40

export default function SalesManagerCustomersList() {
  const nav = useNavigate()
  const [customers, setCustomers] = useState<any[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([])
  const [viewState, setViewState, resetViewState] = usePersistentViewState('sales-customers', {
    filters: { datePreset: 'all', dateFrom: '', dateTo: '', search: '', employeeId: '' } as FilterValues,
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
      p_stats: false,
    }
  }, [filters])

  const fetchData = useCallback(async (page: number, append: boolean) => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    if (!append) setLoading(true)
    const params = buildParams(page, PAGE_SIZE, false)
    if (!params) { setLoading(false); return }
    const proceed = () => { setLoading(false); setLoadingMore(false) }
    const [rowsRes, countRes] = await Promise.all([
      supabase.rpc('get_governed_customers', params),
      supabase.rpc('get_governed_customers', buildParams(1, PAGE_SIZE, true)),
    ])
    const rows = Array.isArray(rowsRes.data) ? rowsRes.data : []
    setCustomers((prev) => {
      const seen = new Set(prev.map((c: any) => c.id))
      return append ? [...prev, ...rows.filter((r: any) => !seen.has(r.id))] : rows
    })
    const c = countRes.data as any
    if (c && typeof c === 'object' && 'count' in c) setTotalCount(Number(c.count))
    proceed()
  }, [buildParams])

  useEffect(() => { fetchData(1, false) }, [fetchData])

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
          <h1 className="text-lg font-bold text-text">العملاء</h1>
        </div>
      </div>

      <SmartFilterBar key={sfResetKey} initialFilters={filters}
        searchPlaceholder="بحث باسم العميل أو الكود..."
        employees={employees}
        onFilterChange={(f) => setViewState({ filters: f })}
      />
      <button onClick={() => { resetViewState(); setSfResetKey(k => k + 1) }} className="text-[10px] px-2 py-1 text-danger font-semibold">إعادة تعيين</button>

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : customers.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">لا يوجد عملاء</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {customers.map((c: any) => (
              <button key={c.id} onClick={() => nav(`/customers/${c.id}`)}
                className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors hover:shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-bold text-text">{c.company_name}</p>
                  <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded">{c.code}</span>
                </div>
                {c.responsible_name && (
                  <p className="text-[11px] text-text-secondary mb-1">المسؤول: {c.responsible_name}</p>
                )}
                <div className="flex items-center gap-2 text-[10px] text-text-secondary">
                  <span>{c.owner_name || 'بدون مالك'}</span>
                  {c.business_type && <span>| {c.business_type}</span>}
                </div>
                {c.phone && <p className="text-[11px] text-text-secondary mt-1" dir="ltr">{c.phone}</p>}
              </button>
            ))}
          </div>
          {customers.length < totalCount && (
            <button
              onClick={() => { setLoadingMore(true); fetchData(Math.floor(customers.length / PAGE_SIZE) + 1, true) }}
              disabled={loadingMore}
              className="w-full bg-white border border-border rounded-xl py-2.5 text-xs font-semibold text-text disabled:opacity-50"
            >
              {loadingMore ? 'جاري التحميل...' : `عرض المزيد (${customers.length} من ${totalCount})`}
            </button>
          )}
        </>
      )}

      <div className="text-center text-[10px] text-text-secondary pb-4">
        إجمالي: {fmt(totalCount)} عميل
      </div>
    </div>
  )
}
