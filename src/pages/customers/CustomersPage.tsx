import { useState, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import { useCapability } from '../../hooks/useCapability'
import { computeDateRange, cairoMidnightISO, cairoDateComponents } from '../../lib/dateRange'
import { usePersistentViewState } from '../../hooks/usePersistentViewState'
import { useEntityViewsStore } from '../../store/entityViews'
import SmartFilterBar, { type FilterValues } from '../../components/SmartFilterBar'
import { PaginationFooter } from '../../components/data-list/PaginationFooter'
import { CustomerCard } from '../../components/customers/CustomerCard'
import type { CustomerCardData } from '../../types/customers'
import {
  buildCustomerReportFilterSummary,
  buildCustomerReportRows,
  exportCustomersReportExcel,
  printCustomersReport,
  type CustomerReportFilterContext,
  type CustomerReportMeta,
} from '../../services/customerReport'
import { exportCustomersToPhone } from '../../services/googleContactsExport'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

// Newest customer first by creation date; deterministic id tie-break only for
// identical created_at values (no other secondary ordering).
function sortCustomersNewestFirst(a: CustomerCardData, b: CustomerCardData): number {
  const ta = a.created_at ? new Date(a.created_at).getTime() : 0
  const tb = b.created_at ? new Date(b.created_at).getTime() : 0
  if (tb !== ta) return tb - ta
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

const PAGE_SIZE = 30

interface CustomersStats {
  total: number; no_orders: number; no_visits: number; no_location: number; needs_correction: number
}

export function CustomersPage() {
  const navigate = useNavigate()
  const canCreate = useCapability('customers.create')
  const userRoles = useAuthStore((s) => s.user?.roles) || []
  const isExactUpperMgmt = userRoles.includes('الإدارة العليا')
  const currentEmpId = useAuthStore((s) => s.user?.employee_id)
  const [customers, setCustomers] = useState<CustomerCardData[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [stats, setStats] = useState<CustomersStats | null>(null)
  const [page, setPage] = useState(1)
  const reqCounter = useRef(0)
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([])
  const [governorates, setGovernorates] = useState<{ id: string; name_ar: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [viewState, setViewState, resetViewState] = usePersistentViewState('customers-list', {
    myOnly: false,
    filters: { datePreset: 'all', dateFrom: '', dateTo: '', search: '', employeeId: '' } as FilterValues,
    quickFilters: { noOrders: false, noVisits: false, noLocation: false, needsCorrection: false },
    governorateId: '',
  })
  const { myOnly, filters, quickFilters, governorateId } = viewState
  const [sfResetKey, setSfResetKey] = useState(0)
  const unseenCustomerIds = useEntityViewsStore((s) => s.unseenCustomerIds)
  const fetchUnseenCustomers = useEntityViewsStore((s) => s.fetchUnseenCustomers)

  const resolveDateRange = (f: FilterValues): { from: string | null; to: string | null } => {
    if (f.datePreset === 'all') return { from: null, to: null }
    const nowUtc = new Date()
    const [y, m, d] = cairoDateComponents(nowUtc)
    const pad = (n: number) => String(n).padStart(2, '0')
    switch (f.datePreset) {
      case 'today': {
        const from = cairoMidnightISO(y, m, d)
        return { from, to: nowUtc.toISOString() }
      }
      case 'yesterday': {
        const yesterday = new Date(y, m - 1, d)
        yesterday.setDate(yesterday.getDate() - 1)
        const [yy, ym, yd] = cairoDateComponents(yesterday)
        const from = cairoMidnightISO(yy, ym, yd)
        const to = cairoMidnightISO(y, m, d)
        return { from, to }
      }
      case 'week': {
        const { dateFrom, dateTo } = computeDateRange('week')
        return { from: dateFrom, to: dateTo }
      }
      case 'month': {
        const { dateFrom, dateTo } = computeDateRange('month')
        return { from: dateFrom, to: dateTo }
      }
      case 'prev_month': {
        const prevMonth = m === 1 ? 12 : m - 1
        const prevYear = m === 1 ? y - 1 : y
        const from = cairoMidnightISO(prevYear, prevMonth, 1)
        const to = cairoMidnightISO(y, m, 1)
        return { from, to }
      }
      case 'custom': {
        if (!f.dateFrom && !f.dateTo) return { from: null, to: null }
        const from = f.dateFrom ? cairoMidnightISO(...f.dateFrom.split('-').map(Number) as [number, number, number]) : null
        const to = f.dateTo ? (() => { const [ty, tm, td] = f.dateTo.split('-').map(Number); const d2 = new Date(cairoMidnightISO(ty, tm, td)); d2.setDate(d2.getDate() + 1); return d2.toISOString() })() : null
        return { from, to }
      }
      default: return { from: null, to: null }
    }
  }

  const buildParams = (page: number, perPage: number, countOnly: boolean, statsOnly = false) => {
    const token = getToken()
    if (!token) return null
    const range = resolveDateRange(filters)
    const params: any = {
      p_token: token.trim(),
      p_search: filters.search || null,
      p_employee_id: filters.employeeId || null,
      p_date_from: range.from,
      p_date_to: range.to,
      p_no_orders: quickFilters.noOrders || null,
      p_no_visits: quickFilters.noVisits || null,
      p_no_location: quickFilters.noLocation || null,
      p_governorate_id: governorateId || null,
      p_needs_address_correction: quickFilters.needsCorrection ? true : null,
      p_page: page,
      p_per_page: perPage,
      p_count_only: countOnly,
      p_stats: statsOnly,
    }
    if (myOnly && currentEmpId) {
      params.p_employee_id = currentEmpId
    }
    return params
  }

  const fetchData = async (targetPage: number) => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    const params = buildParams(targetPage, PAGE_SIZE, false)
    if (!params) { setLoading(false); return }
    setLoading(true)
    const reqId = ++reqCounter.current
    const [custRes, countRes, statsRes] = await Promise.all([
      supabase.rpc('get_governed_customers', params),
      supabase.rpc('get_governed_customers', buildParams(1, PAGE_SIZE, true)),
      targetPage === 1 ? supabase.rpc('get_governed_customers', buildParams(1, PAGE_SIZE, false, true)) : Promise.resolve({ data: null }),
    ])
    if (reqId !== reqCounter.current) return
    const list = Array.isArray(custRes.data) ? custRes.data : []
    setCustomers([...list].sort(sortCustomersNewestFirst))
    const c = countRes.data as any
    if (c && typeof c === 'object' && 'count' in c) setTotalCount(Number(c.count))
    if (targetPage === 1 && statsRes?.data && typeof statsRes.data === 'object' && 'total' in (statsRes.data as any)) {
      const s = statsRes.data as any
      setStats({ total: Number(s.total), no_orders: Number(s.no_orders), no_visits: Number(s.no_visits), no_location: Number(s.no_location), needs_correction: Number(s.needs_correction) })
    }
    setLoading(false)
  }

  const fetchAllMatching = async () => {
    const params = buildParams(1, 10000, false)
    if (!params) return []
    const { data } = await supabase.rpc('get_governed_customers', params)
    return Array.isArray(data) ? data : []
  }

  // Reset to page 1 whenever any filter changes; page re-fetches the filtered
  // page + server-side COUNT.
  useEffect(() => { setPage(1) }, [filters, myOnly, quickFilters, governorateId])

  useEffect(() => { fetchData(page) }, [page, filters, myOnly, quickFilters, governorateId])

  useEffect(() => {
    const token = getToken()
    if (token) fetchUnseenCustomers(token)
  }, [])

  useEffect(() => {
    const token = getToken()
    if (!token) return
    Promise.all([
      supabase.rpc('get_governed_employees', { p_token: token }),
      supabase.from('reference_governorates').select('id, name_ar').order('name_ar', { ascending: true }),
    ]).then(([empRes, govRes]) => {
      if (empRes.data) setEmployees((Array.isArray(empRes.data) ? empRes.data : []).map((e: any) => ({ id: e.id, name: e.full_name })))
      if (govRes.data) setGovernorates(govRes.data)
    })
  }, [])

  const toggleQuickFilter = (key: keyof typeof quickFilters) => {
    setViewState((prev: typeof viewState) => ({ quickFilters: { ...prev.quickFilters, [key]: !prev.quickFilters[key] } }))
  }

  const hasActiveQuickFilter = quickFilters.noOrders || quickFilters.noVisits || quickFilters.noLocation || quickFilters.needsCorrection

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  const reportContext = (): CustomerReportFilterContext => ({
    search: filters.search || '',
    datePreset: filters.datePreset || 'all',
    dateFrom: filters.dateFrom || '',
    dateTo: filters.dateTo || '',
    employeeId: filters.employeeId || '',
    myOnly,
    quickFilters,
    governorateId,
    employees,
    governorates,
  })

  const buildReportMeta = (): CustomerReportMeta => {
    const [y, m, d] = cairoDateComponents(new Date())
    const stamp = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    return {
      title: 'تقرير العملاء',
      generatedAt: new Date(),
      filterLines: buildCustomerReportFilterSummary(reportContext()),
      fileName: `تقرير_العملاء_${stamp}`,
    }
  }

  const handleReportExcel = async () => {
    const rows = await fetchAllMatching()
    if (!rows.length) return
    exportCustomersReportExcel(buildCustomerReportRows([...rows].sort(sortCustomersNewestFirst), governorates), buildReportMeta())
  }

  const handleReportPrint = async () => {
    const rows = await fetchAllMatching()
    if (!rows.length) return
    printCustomersReport(buildCustomerReportRows([...rows].sort(sortCustomersNewestFirst), governorates), buildReportMeta())
  }

  const handleExportPhone = async () => {
    const rows = await fetchAllMatching()
    if (!rows.length) {
      toast.error('لا يوجد عملاء متاحون للتصدير')
      return
    }
    try {
      const count = await exportCustomersToPhone({ customers: [...rows].sort(sortCustomersNewestFirst), governorates })
      toast.success(`تم تصدير ${count} عميل`)
    } catch {
      toast.error('حدث خطأ أثناء التصدير')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">العملاء</h1>
        {!loading && totalCount > 0 && isExactUpperMgmt && (
          <div className="flex gap-1.5">
            <button onClick={handleExportPhone} className="bg-white border border-border rounded-lg text-[11px] px-2.5 py-1.5 font-semibold text-text hover:bg-neutral-50">📱 تصدير للهاتف</button>
            <button onClick={handleReportExcel} className="bg-white border border-border rounded-lg text-[11px] px-2.5 py-1.5 font-semibold text-text hover:bg-neutral-50">📊 Excel</button>
            <button onClick={handleReportPrint} className="bg-white border border-border rounded-lg text-[11px] px-2.5 py-1.5 font-semibold text-text hover:bg-neutral-50">🖨️ طباعة</button>
          </div>
        )}
        {canCreate && (
          <button onClick={() => navigate('/customers/new')} className="mr-auto bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold">+ إضافة عميل</button>
        )}
      </div>

      {currentEmpId && (
        <div className="flex gap-1 bg-white rounded-lg border border-border p-1">
          <button onClick={() => setViewState({ myOnly: false })} className={`flex-1 text-xs py-1.5 rounded-md font-semibold transition-colors ${!myOnly ? 'bg-primary text-white' : 'text-text-secondary'}`}>الكل</button>
          <button onClick={() => setViewState({ myOnly: true })} className={`flex-1 text-xs py-1.5 rounded-md font-semibold transition-colors ${myOnly ? 'bg-primary text-white' : 'text-text-secondary'}`}>عملائي</button>
          <button onClick={() => { resetViewState(); setSfResetKey(k => k + 1) }} className="text-[10px] px-2 py-1 mr-auto text-danger font-semibold">إعادة تعيين</button>
        </div>
      )}

      <SmartFilterBar
        key={sfResetKey}
        searchPlaceholder="بحث باسم العميل أو الكود..."
        employees={employees}
        employeeLabel="المسؤول عن العميل"
        initialFilters={filters}
        onFilterChange={(f) => setViewState({ filters: f })}
      />

      {/* Governorate filter */}
      <select
        value={governorateId}
        onChange={(e) => setViewState({ governorateId: e.target.value })}
        className="w-full border border-border rounded-lg px-2 py-1.5 text-xs bg-white"
      >
        <option value="">كل المحافظات</option>
        {governorates.map((g) => <option key={g.id} value={g.id}>{g.name_ar}</option>)}
      </select>

      {/* Stats bar */}
      {!loading && stats && stats.total > 0 && (
        <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-[11px] bg-white rounded-lg border border-border p-2.5">
          <span className="text-text font-semibold whitespace-nowrap">👥 <span className="text-text-muted font-medium">المعروض:</span> {stats.total} عميل</span>
          <span className="text-border">|</span>
          <span className="text-text font-semibold" dir="ltr">{stats.total - stats.no_orders}</span>
          <span className="text-text-muted whitespace-nowrap">📦 لديهم طلبات</span>
          <span className="text-border">|</span>
          <span className="text-text font-semibold" dir="ltr">{stats.no_orders}</span>
          <span className="text-text-muted whitespace-nowrap">🚫 بدون طلبات</span>
          <span className="text-border">|</span>
          <span className="text-text font-semibold" dir="ltr">{stats.no_location}</span>
          <span className="text-text-muted whitespace-nowrap">📍 بدون لوكيشن</span>
          <span className="text-border">|</span>
          <span className="text-text font-semibold" dir="ltr">{stats.no_visits}</span>
          <span className="text-text-muted whitespace-nowrap">🚗 بدون زيارات</span>
          <span className="text-border">|</span>
          <span className="text-text font-semibold" dir="ltr">{stats.needs_correction}</span>
          <span className="text-text-muted whitespace-nowrap">⚠️ يحتاج تصحيح عنوان</span>
        </div>
      )}

      {/* Quick filters */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => toggleQuickFilter('needsCorrection')}
          className={`text-[10px] px-2.5 py-1 rounded-lg font-semibold transition-colors border ${
            quickFilters.needsCorrection
              ? 'bg-amber-100 text-amber-700 border-amber-200'
              : 'bg-white text-text-secondary border-border'
          }`}
        >
          {quickFilters.needsCorrection ? '✓' : '□'} تصحيح عنوان
        </button>
        <button
          onClick={() => toggleQuickFilter('noOrders')}
          className={`text-[10px] px-2.5 py-1 rounded-lg font-semibold transition-colors border ${
            quickFilters.noOrders
              ? 'bg-orange-100 text-orange-700 border-orange-200'
              : 'bg-white text-text-secondary border-border'
          }`}
        >
          {quickFilters.noOrders ? '✓' : '□'} بدون طلبات
        </button>
        <button
          onClick={() => toggleQuickFilter('noVisits')}
          className={`text-[10px] px-2.5 py-1 rounded-lg font-semibold transition-colors border ${
            quickFilters.noVisits
              ? 'bg-blue-100 text-blue-700 border-blue-200'
              : 'bg-white text-text-secondary border-border'
          }`}
        >
          {quickFilters.noVisits ? '✓' : '□'} بدون زيارات
        </button>
        <button
          onClick={() => toggleQuickFilter('noLocation')}
          className={`text-[10px] px-2.5 py-1 rounded-lg font-semibold transition-colors border ${
            quickFilters.noLocation
              ? 'bg-purple-100 text-purple-700 border-purple-200'
              : 'bg-white text-text-secondary border-border'
          }`}
        >
          {quickFilters.noLocation ? '✓' : '□'} بدون رابط لوكيشن
        </button>
        {hasActiveQuickFilter && (
          <button
            onClick={() => setViewState({ quickFilters: { noOrders: false, noVisits: false, noLocation: false, needsCorrection: false }, governorateId: '' })}
            className="text-[10px] px-2.5 py-1 rounded-lg font-semibold bg-red-50 text-red-600 border border-red-100 hover:bg-red-100 transition-colors"
          >
            إلغاء الكل
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : customers.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">
          {myOnly ? 'لا يوجد عملاء تابعين لك' : 'لا يوجد عملاء'}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            {customers.map((c) => (
              <CustomerCard key={c.id} customer={c} isUnseen={unseenCustomerIds.has(c.id)} />
            ))}
          </div>
          {totalPages > 1 && (
            <PaginationFooter page={page} totalPages={totalPages} onChange={setPage} />
          )}
        </>
      )}
    </div>
  )
}
