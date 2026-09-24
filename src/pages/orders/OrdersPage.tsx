import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { usePersistentViewState } from '../../hooks/usePersistentViewState'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { discountOptionsService, mergeSnapshotIntoRow } from '../../services/discountOptions'
import { useAuthStore } from '../../store/auth'
import { useEntityViewsStore } from '../../store/entityViews'
import { resolveDateRangeISO, cairoDateComponents } from '../../lib/dateRange'
import { OrderCard } from '../../components/orders/OrderCard'
import SmartFilterBar, { type FilterValues } from '../../components/SmartFilterBar'
import { ResultsSummary } from '../../components/data-list/ResultsSummary'
import { ActiveFilters } from '../../components/data-list/ActiveFilters'
import { CardGrid } from '../../components/data-list/CardGrid'
import { EmptyState } from '../../components/data-list/EmptyState'
import { StatusKpiBar } from '../../components/data-list/StatusKpiBar'
import { PaginationFooter } from '../../components/data-list/PaginationFooter'
import MultiSelectFilter from '../../components/MultiSelectFilter'
import { formatTierName } from '../../utils/format'
import { ORDER_STATUS_LABELS, statusFilterOptions, statusDisplayOrder, visibleStatusLabel } from '../../types/order-display'
import { useUpperManagement } from '../../hooks/useUpperManagement'
import {
  buildOrdersReportFilterSummary,
  buildOrdersReportRows,
  exportOrdersReportExcel,
  printOrdersReport,
  type OrdersReportMeta,
} from '../../services/ordersReport'
import type { ActiveFilterItem, KpiChipConfig } from '../../types/data-list'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

function normalizeFilter(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
  return typeof v === 'string' && v ? [v] : []
}

type Tab = 'all' | 'my_orders' | 'my_invoices'

const datePresetLabels: Record<string, string> = {
  all: 'كل الفترات',
  today: 'اليوم',
  yesterday: 'أمس',
  week: 'الأسبوع الحالي',
  month: 'الشهر الحالي',
  prev_month: 'الشهر السابق',
  custom: 'الفترة المخصصة',
}

const ORDER_TYPE_OPTIONS = [
  { value: '', label: 'كل الأنواع' },
  { value: 'cash', label: 'نقدي' },
  { value: 'ittiman', label: 'ائتمان' },
]

const PAGE_SIZE = 30

const STATUS_KPI_GROUPS: Record<string, { dot: string; chip: string; active: string }> = {
  submitted: { dot: 'bg-blue-300', chip: 'bg-blue-50 border-blue-100 text-blue-600', active: 'bg-blue-100 border-blue-300 text-blue-700 ring-1 ring-blue-200' },
  approved: { dot: 'bg-emerald-300', chip: 'bg-emerald-50 border-emerald-100 text-emerald-600', active: 'bg-emerald-100 border-emerald-300 text-emerald-700 ring-1 ring-emerald-200' },
  reviewing: { dot: 'bg-blue-300', chip: 'bg-blue-50 border-blue-100 text-blue-600', active: 'bg-blue-100 border-blue-300 text-blue-700 ring-1 ring-blue-200' },
  preparing: { dot: 'bg-emerald-300', chip: 'bg-emerald-50 border-emerald-100 text-emerald-600', active: 'bg-emerald-100 border-emerald-300 text-emerald-700 ring-1 ring-emerald-200' },
  prepared: { dot: 'bg-emerald-300', chip: 'bg-emerald-50 border-emerald-100 text-emerald-600', active: 'bg-emerald-100 border-emerald-300 text-emerald-700 ring-1 ring-emerald-200' },
  delivered: { dot: 'bg-emerald-300', chip: 'bg-emerald-50 border-emerald-100 text-emerald-600', active: 'bg-emerald-100 border-emerald-300 text-emerald-700 ring-1 ring-emerald-200' },
  returned_for_revision: { dot: 'bg-amber-300', chip: 'bg-amber-50 border-amber-100 text-amber-600', active: 'bg-amber-100 border-amber-300 text-amber-700 ring-1 ring-amber-200' },
  cancelled: { dot: 'bg-red-300', chip: 'bg-red-50 border-red-100 text-red-600', active: 'bg-red-100 border-red-300 text-red-700 ring-1 ring-red-200' },
}

export function OrdersPage() {
  const navigate = useNavigate()
  const isUpperManagement = useUpperManagement()
  const userRoles = useAuthStore((s) => s.user?.roles) || []
  const isExactUpperMgmt = userRoles.includes('الإدارة العليا')
  const currentUserId = useAuthStore((s) => s.user?.identity_id)
  const currentEmpId = useAuthStore((s) => s.user?.employee_id)
  const unseenOrderIds = useEntityViewsStore((s) => s.unseenOrderIds)
  const fetchUnseenOrders = useEntityViewsStore((s) => s.fetchUnseenOrders)
  const [orders, setOrders] = useState<any[]>([])
  const [customerFilterCustomer, setCustomerFilterCustomer] = useState<any>(null)
  const [employees, setEmployees] = useState<any[]>([])
  const [governorates, setGovernorates] = useState<{ id: string; name_ar: string }[]>([])
  const [allTiers, setAllTiers] = useState<any[]>([])
  const [page, setPage] = useState(1)
  const reqCounter = useRef(0)
  const [summary, setSummary] = useState<{ count: number; total_value: number; status_counts: Record<string, number> } | null>(null)
  const [loading, setLoading] = useState(true)
  const [initialLoaded, setInitialLoaded] = useState(false)
  const params = new URLSearchParams(window.location.search)
  const [viewState, setViewState, resetViewState] = usePersistentViewState('orders-list', {
    tab: (params.get('my') === '1' ? 'my_orders' : 'all') as Tab,
    statusFilter: [] as string[],
    customerFilter: '',
    orderTypeFilter: [] as string[],
    governorateFilter: [] as string[],
    tierFilter: [] as string[],
    dateSource: 'created',
    filters: { datePreset: 'all', dateFrom: '', dateTo: '', search: '', employeeId: '', employeeIds: [] } as FilterValues,
  })
  const { tab, statusFilter, customerFilter, orderTypeFilter, governorateFilter, tierFilter, dateSource, filters } = viewState
  const statusFilters = useMemo(() => normalizeFilter(statusFilter), [statusFilter])
  const orderTypeFilters = useMemo(() => normalizeFilter(orderTypeFilter), [orderTypeFilter])
  const tierFilters = useMemo(() => normalizeFilter(tierFilter), [tierFilter])
  const governorateFilters = useMemo(() => normalizeFilter(governorateFilter), [governorateFilter])
  const employeeIdFilters = useMemo(
    () => normalizeFilter(Array.isArray(filters.employeeIds) ? filters.employeeIds : (filters.employeeId || '')),
    [filters.employeeIds, filters.employeeId]
  )
  const [sfResetKey, setSfResetKey] = useState(0)

  const STATUS_OPTIONS = useMemo(() => statusFilterOptions(isUpperManagement), [isUpperManagement])
  const FILTER_STATUS_OPTIONS = useMemo(() => STATUS_OPTIONS.filter((o) => o.value !== ''), [STATUS_OPTIONS])
  const FILTER_ORDER_TYPE_OPTIONS = useMemo(() => ORDER_TYPE_OPTIONS.filter((o) => o.value !== ''), [])

  const smartFilterEmployees = useMemo(
    () => employees.map(e => ({ id: e.identity_id || e.id, name: e.full_name })),
    [employees]
  )

  const tierOptions = useMemo(
    () => (allTiers || [])
      .map((t: any) => ({ value: String(t.id ?? ''), label: formatTierName(t.name || '') }))
      .filter((o) => o.value)
      .sort((a, b) => a.label.localeCompare(b.label, 'ar')),
    [allTiers]
  )

  const resolveDateRange = (f: FilterValues): { from: string | null; to: string | null } => {
    if (f.datePreset === 'all') return { from: null, to: null }
    if (f.datePreset === 'custom') return resolveDateRangeISO('custom', f.dateFrom || undefined, f.dateTo || undefined)
    return resolveDateRangeISO(f.datePreset as any)
  }

  const buildRpcParams = useCallback((pageNum?: number, opts?: { summaryMode?: boolean; perPage?: number }): Record<string, unknown> | null => {
    const token = getToken()
    if (!token) return null
    const range = resolveDateRange(filters)
    const rpcParams: Record<string, unknown> = { p_token: token.trim() }
    if (filters.search) rpcParams.p_search = filters.search
    if (range.from) rpcParams.p_date_from = range.from
    if (range.to) rpcParams.p_date_to = range.to
    if (customerFilter) rpcParams.p_customer_id = customerFilter
    if (tab === 'my_orders' && currentUserId) rpcParams.p_created_by = currentUserId
    if (tab === 'my_invoices' && currentEmpId) rpcParams.p_owner_id = currentEmpId
    if (statusFilters.length) rpcParams.p_statuses = statusFilters
    if (orderTypeFilters.length) rpcParams.p_order_types = orderTypeFilters
    if (tierFilters.length) rpcParams.p_tier_ids = tierFilters
    if (governorateFilters.length) rpcParams.p_governorate_ids = governorateFilters
    if (employeeIdFilters.length) rpcParams.p_created_by_ids = employeeIdFilters
    rpcParams.p_include_strict_previous = true
    if (dateSource === 'event') rpcParams.p_date_source = 'event'
    if (opts?.summaryMode) rpcParams.p_summary = true
    else if (pageNum != null) {
      rpcParams.p_page = pageNum
      rpcParams.p_per_page = opts?.perPage ?? PAGE_SIZE
    }
    return rpcParams
  }, [filters, customerFilter, tab, currentUserId, currentEmpId, statusFilters, orderTypeFilters, tierFilters, governorateFilters, employeeIdFilters, dateSource])

  const mergeSnapshots = useCallback(async (rows: any[]) => {
    try {
      const snaps = await discountOptionsService.getOrderDiscountSnapshots(rows.map((r) => r.id).filter(Boolean))
      const byId = new Map(snaps.map((s) => [s.orderId, s]))
      for (const row of rows) mergeSnapshotIntoRow(row, byId.get(row.id))
    } catch {
      // best-effort merge
    }
  }, [])

  const fetchPage = useCallback(async (targetPage: number, opts?: { silent?: boolean }) => {
    const pageParams = buildRpcParams(targetPage)
    const summaryParams = buildRpcParams(1, { summaryMode: true })
    if (!pageParams || !summaryParams) { setLoading(false); setInitialLoaded(true); return }
    if (!opts?.silent) setLoading(true)
    const reqId = ++reqCounter.current
    const [pageRes, summaryRes] = await Promise.all([
      supabase.rpc('get_unified_orders', pageParams),
      supabase.rpc('get_unified_orders', summaryParams),
    ])
    if (reqId !== reqCounter.current) return
    const rows = (Array.isArray(pageRes.data) ? pageRes.data : []) as any[]
    await mergeSnapshots(rows)
    if (pageRes.data) setOrders(rows)
    const s = summaryRes.data as any
    if (s && typeof s === 'object' && typeof s.count === 'number' && typeof s.status_counts === 'object') {
      setSummary(s)
    }
    if (!opts?.silent) setLoading(false)
    setInitialLoaded(true)
  }, [buildRpcParams, mergeSnapshots])

  // Live customer data: silently re-query the list on a bounded interval so
  // the order card reflects CURRENT customer info without a manual refresh.
  // Reuses the same get_unified_orders params (live join, single query for the
  // whole list — no per-order requests). Pauses while the tab is hidden and
  // only re-fetches when the previous request has settled.
  const silentRefreshing = useRef(false)
  useEffect(() => {
    const timer = window.setInterval(async () => {
      if (document.hidden || silentRefreshing.current) return
      silentRefreshing.current = true
      try {
        await fetchPage(page, { silent: true })
      } finally {
        silentRefreshing.current = false
      }
    }, 60000)
    return () => window.clearInterval(timer)
  }, [fetchPage, page])

  // Reset to page 1 whenever any filter changes; changing page preserves the
  // current filters — only the requested page is fetched from the server.
  useEffect(() => {
    setPage(1)
  }, [filters, customerFilter, tab, dateSource, statusFilters, orderTypeFilters, tierFilters, governorateFilters, employeeIdFilters])

  useEffect(() => {
    fetchPage(page)
  }, [page, fetchPage])

  useEffect(() => {
    const token = getToken()
    if (token) fetchUnseenOrders(token)
  }, [])

  useEffect(() => {
    const token = getToken()
    if (!token) return
    Promise.all([
      supabase.rpc('get_governed_employees', { p_token: token }),
      supabase.rpc('get_governed_tiers', { p_token: token }),
      supabase.from('reference_governorates').select('id, name_ar').order('name_ar', { ascending: true }),
    ]).then(([empRes, tiersRes, govRes]) => {
      if (empRes.data) setEmployees(Array.isArray(empRes.data) ? empRes.data : [])
      if (tiersRes.data) setAllTiers(Array.isArray(tiersRes.data) ? tiersRes.data : [])
      if (govRes.data) setGovernorates(govRes.data || [])
    })
  }, [])

  // Resolve the single filtered customer's name on demand (no full customer list).
  useEffect(() => {
    let cancelled = false
    const token = getToken()
    if (!token) { setCustomerFilterCustomer(null); return }
    if (!customerFilter) { setCustomerFilterCustomer(null); return }
    setCustomerFilterCustomer({ id: customerFilter, company_name: customerFilter })
    supabase.rpc('get_governed_customer', { p_token: token.trim(), p_id: customerFilter }).then((res) => {
      if (cancelled) return
      const d = res.data as any
      if (d && typeof d === 'object' && d.company_name) setCustomerFilterCustomer(d)
    })
    return () => { cancelled = true }
  }, [customerFilter])

  const sorted = useMemo(() => {
    // The grid is ALWAYS the current server page (already filtered + paged) —
    // no client-side slicing. Sort only to match the RPC ORDER BY within the page.
    const list = [...orders]
    list.sort((a: any, b: any) => {
      const keyA = dateSource === 'event' ? (a.last_event_ts || a.created_at || '') : (a.created_at || '')
      const keyB = dateSource === 'event' ? (b.last_event_ts || b.created_at || '') : (b.created_at || '')
      if (keyB !== keyA) return keyB > keyA ? 1 : -1
      return (b.created_at || '') > (a.created_at || '') ? 1 : -1
    })
    return list
  }, [orders, dateSource])

  const tabLabel = tab === 'all' ? 'الطلبات' : tab === 'my_orders' ? 'طلباتي' : 'فواتيري'

  const handleRefresh = useCallback(() => {
    fetchPage(page)
  }, [fetchPage, page])

  const handleStatusToggle = useCallback((status: string) => {
    setViewState((prev: any) => {
      const cur = normalizeFilter(prev.statusFilter)
      const next = cur.includes(status) ? cur.filter((s) => s !== status) : [...cur, status]
      return { statusFilter: next }
    })
  }, [])

  const activeFilterItems: ActiveFilterItem[] = useMemo(() => {
    const items: ActiveFilterItem[] = []

    if (tab === 'my_orders') items.push({ id: 'tab', label: 'النوع', value: 'طلباتي' })
    else if (tab === 'my_invoices') items.push({ id: 'tab', label: 'النوع', value: 'فواتيري' })

    if (filters.datePreset !== 'all') {
      items.push({ id: 'date', label: 'الفترة', value: datePresetLabels[filters.datePreset] || filters.datePreset })
    }
    if (dateSource === 'event') {
      items.push({
        id: 'dateSource', label: 'نوع التاريخ', value: 'آخر حدث تشغيلي',
        onRemove: () => setViewState({ dateSource: 'created' }),
      })
    }
    if (filters.datePreset === 'custom') {
      if (filters.dateFrom) items.push({ id: 'dateFrom', label: 'من', value: filters.dateFrom })
      if (filters.dateTo) items.push({ id: 'dateTo', label: 'إلى', value: filters.dateTo })
    }

    if (filters.search) items.push({ id: 'search', label: 'بحث', value: filters.search })

    for (const empId of employeeIdFilters) {
      const emp = smartFilterEmployees.find((e) => e.id === empId)
      if (emp) items.push({ id: 'employee:' + empId, label: 'المسؤول', value: emp.name, onRemove: () => setViewState({ filters: { ...filters, employeeIds: employeeIdFilters.filter((x) => x !== empId) } }) })
    }

    for (const s of statusFilters) {
      const label = STATUS_OPTIONS.find((o) => o.value === s)?.label || visibleStatusLabel(s) || s
      items.push({ id: 'status:' + s, label: 'الحالة', value: label, onRemove: () => setViewState({ statusFilter: statusFilters.filter((x) => x !== s) }) })
    }

    for (const v of orderTypeFilters) {
      const label = ORDER_TYPE_OPTIONS.find((o) => o.value === v)?.label || v
      items.push({ id: 'orderType:' + v, label: 'النوع', value: label, onRemove: () => setViewState({ orderTypeFilter: orderTypeFilters.filter((x) => x !== v) }) })
    }

    for (const t of tierFilters) {
      const tier = tierOptions.find((x) => x.value === t)
      items.push({ id: 'tier:' + t, label: 'الشريحة', value: tier?.label || t, onRemove: () => setViewState({ tierFilter: tierFilters.filter((x) => x !== t) }) })
    }

    if (customerFilter) {
      const cust = customerFilterCustomer
      if (cust) items.push({ id: 'customer', label: 'العميل', value: cust.company_name })
    }

    for (const gId of governorateFilters) {
      const gov = governorates.find((g) => g.id === gId)
      if (gov) items.push({ id: 'governorate:' + gId, label: 'المحافظة', value: gov.name_ar, onRemove: () => setViewState({ governorateFilter: governorateFilters.filter((x) => x !== gId) }) })
    }

    return items
  }, [tab, filters, statusFilters, orderTypeFilters, tierFilters, governorateFilters, employeeIdFilters, customerFilter, smartFilterEmployees, customerFilterCustomer, governorates, STATUS_OPTIONS, dateSource, tierOptions])

  const kpiChips: KpiChipConfig[] = useMemo(() => {
    const orderList = statusDisplayOrder(isUpperManagement)
    const statusCounts = summary?.status_counts || {}
    return orderList
      .filter((status) => (statusCounts[status] || 0) > 0)
      .map((status) => {
        const label = ORDER_STATUS_LABELS[status] || status
        const group = STATUS_KPI_GROUPS[status] || STATUS_KPI_GROUPS.draft
        return {
          id: status,
          label,
          count: statusCounts[status] || 0,
          dotClass: group.dot,
          chipClass: group.chip,
          activeChipClass: group.active,
        }
      })
  }, [summary, isUpperManagement])

  const dateRangeStr = filters.datePreset === 'custom'
    ? (filters.dateFrom || '...') + ' → ' + (filters.dateTo || '...')
    : (filters.datePreset !== 'all' ? datePresetLabels[filters.datePreset] : undefined)

  const hasActiveFilters = tab !== 'all' || statusFilters.length > 0 || orderTypeFilters.length > 0 || tierFilters.length > 0 || governorateFilters.length > 0 || employeeIdFilters.length > 0 || !!customerFilter || !!filters.search || filters.datePreset !== 'all'

  const totalPages = Math.max(1, Math.ceil((summary?.count ?? 0) / PAGE_SIZE))

  const handleResetAll = useCallback(() => {
    resetViewState()
    setSfResetKey(k => k + 1)
  }, [resetViewState])

  const reportContext = () => ({
    tab,
    datePreset: filters.datePreset || 'all',
    dateFrom: filters.dateFrom || '',
    dateTo: filters.dateTo || '',
    search: filters.search || '',
    employeeIds: employeeIdFilters,
    statusFilter: statusFilters,
    customerFilter,
    orderTypeFilter: orderTypeFilters,
    governorateFilter: governorateFilters,
    tierFilter: tierFilters,
    tiers: tierOptions,
    employees: smartFilterEmployees,
    customers: customerFilterCustomer ? [customerFilterCustomer] : [],
    governorates,
  })

  const buildReportMeta = (): OrdersReportMeta => {
    const [y, m, d] = cairoDateComponents(new Date())
    const stamp = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    return {
      title: 'تقرير الطلبات',
      subtitle: 'قائمة الطلبات المعروضة على شاشة الطلبات',
      generatedAt: new Date(),
      filterLines: buildOrdersReportFilterSummary(reportContext()),
      fileName: `تقرير_الطلبات_${stamp}`,
    }
  }

  // Print/Export is an explicit exception: bypass the 30-row page and retrieve
  // ALL records matching the currently applied search/filters for this operation
  // only (no page param -> full filtered result set).
  const fetchAllMatching = async () => {
    const rpcParams = buildRpcParams(1, { perPage: 10000 })
    if (!rpcParams) return []
    const { data } = await supabase.rpc('get_unified_orders', rpcParams)
    const rows = (Array.isArray(data) ? data : []) as any[]
    await mergeSnapshots(rows)
    return rows
  }

  const handleReportExcel = async () => {
    const rows = await fetchAllMatching()
    if (!rows.length) return
    exportOrdersReportExcel(buildOrdersReportRows(rows, governorates), buildReportMeta())
  }

  const handleReportPrint = async () => {
    const rows = await fetchAllMatching()
    if (!rows.length) return
    printOrdersReport(buildOrdersReportRows(rows, governorates), buildReportMeta())
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">{tabLabel}</h1>
        {!loading && sorted.length > 0 && isExactUpperMgmt && (
          <div className="flex gap-1.5">
            <button onClick={handleReportExcel} className="bg-white border border-border rounded-lg text-[11px] px-2.5 py-1.5 font-semibold text-text hover:bg-neutral-50">📊 Excel</button>
            <button onClick={handleReportPrint} className="bg-white border border-border rounded-lg text-[11px] px-2.5 py-1.5 font-semibold text-text hover:bg-neutral-50">🖨️ طباعة</button>
          </div>
        )}
        <button onClick={() => navigate('/orders/new')} className="mr-auto bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold">+ إنشاء طلب</button>
      </div>

      {currentEmpId && (
        <div className="flex gap-1 bg-white rounded-lg border border-border p-1">
          <button onClick={() => setViewState({ tab: 'all' })} className={'flex-1 text-xs py-1.5 rounded-md font-semibold transition-colors ' + (tab === 'all' ? 'bg-primary text-white' : 'text-text-secondary')}>الكل</button>
          <button onClick={() => setViewState({ tab: 'my_orders' })} className={'flex-1 text-xs py-1.5 rounded-md font-semibold transition-colors ' + (tab === 'my_orders' ? 'bg-primary text-white' : 'text-text-secondary')}>طلباتي</button>
          <button onClick={() => setViewState({ tab: 'my_invoices' })} className={'flex-1 text-xs py-1.5 rounded-md font-semibold transition-colors ' + (tab === 'my_invoices' ? 'bg-primary text-white' : 'text-text-secondary')}>فواتيري</button>
        </div>
      )}

      <SmartFilterBar
        key={sfResetKey}
        searchPlaceholder="بحث برقم الطلب أو اسم العميل..."
        employees={smartFilterEmployees}
        employeeLabel="المسؤول"
        multiEmployee
        employeeBelowSearch
        initialFilters={filters}
        onFilterChange={(f) => setViewState({ filters: f })}
      />

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-text-secondary">نوع التاريخ:</span>
        <select value={dateSource} onChange={(e) => setViewState({ dateSource: e.target.value })}
          className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white">
          <option value="created">وقت إنشاء الطلب</option>
          <option value="event">آخر حدث تشغيلي</option>
        </select>
        <MultiSelectFilter className="w-[140px] shrink-0"
          allLabel="كل الأنواع"
          searchPlaceholder="بحث بنوع الطلب..."
          options={FILTER_ORDER_TYPE_OPTIONS}
          selected={orderTypeFilters}
          onChange={(orderTypeFilter) => setViewState({ orderTypeFilter })} />
      </div>

      <div className="flex flex-wrap gap-2">
        <MultiSelectFilter className="flex-1"
          allLabel="كل الحالات"
          searchPlaceholder="بحث بحالة الطلب..."
          options={FILTER_STATUS_OPTIONS}
          selected={statusFilters}
          onChange={(statusFilter) => setViewState({ statusFilter })} />
        <MultiSelectFilter className="flex-1"
          allLabel="كل الشرائح"
          searchPlaceholder="بحث بالشريحة..."
          options={tierOptions}
          selected={tierFilters}
          onChange={(tierFilter) => setViewState({ tierFilter })} />
        <MultiSelectFilter className="flex-1"
          allLabel="كل المحافظات"
          searchPlaceholder="بحث بالمحافظة..."
          options={governorates.map((g) => ({ value: g.id, label: g.name_ar }))}
          selected={governorateFilters}
          onChange={(governorateFilter) => setViewState({ governorateFilter })} />
      </div>

      <ResultsSummary
        total={summary?.count ?? 0}
        totalValue={summary?.total_value ?? 0}
        dateFrom={dateRangeStr}
        filters={[]}
        onRefresh={handleRefresh}
        refreshState={loading ? 'loading' : 'idle'}
        title="إجمالي الطلبات"
        unit="طلب"
        valueLabel="إجمالي القيمة"
        onReset={hasActiveFilters ? handleResetAll : undefined}
        resetLabel="إعادة تعيين الفلاتر لعرض الكل"
      />

      <ActiveFilters filters={activeFilterItems} />

      {!loading && kpiChips.length > 0 && (
        <StatusKpiBar chips={kpiChips} selectedIds={statusFilters} onToggle={handleStatusToggle} />
      )}

      {!initialLoaded ? (
        <CardGrid>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border border-r-4 bg-white p-3.5 space-y-3 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-3/4" />
              <div className="flex items-center justify-between">
                <div className="h-5 bg-gray-100 rounded-full w-16" />
                <div className="h-3 bg-gray-100 rounded w-20" />
              </div>
              <div className="flex items-baseline gap-1.5">
                <div className="h-3 bg-gray-100 rounded w-12" />
                <div className="h-5 bg-gray-200 rounded w-24" />
              </div>
              <div className="h-3 bg-gray-100 rounded w-28" />
              <div className="flex gap-2 pt-2 border-t border-border/50">
                <div className="h-4 bg-gray-100 rounded w-12" />
                <div className="h-4 bg-gray-100 rounded w-14" />
              </div>
            </div>
          ))}
        </CardGrid>
      ) : sorted.length === 0 ? (
        <EmptyState
          message={tab === 'my_orders' ? 'لا توجد طلبات لك' : tab === 'my_invoices' ? 'لا توجد فواتير لك' : undefined}
        />
      ) : (
        <>
          <CardGrid>
            {sorted.map((order: any) => (
              <OrderCard key={order.id} order={order} orderId={order.id} isUnseen={unseenOrderIds.has(order.id)} />
            ))}
          </CardGrid>
          {totalPages > 1 && (
            <PaginationFooter page={page} totalPages={totalPages} onChange={setPage} />
          )}
        </>
      )}
    </div>
  )
}
