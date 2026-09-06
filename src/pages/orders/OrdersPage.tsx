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
  const [customers, setCustomers] = useState<any[]>([])
  const [employees, setEmployees] = useState<any[]>([])
  const [governorates, setGovernorates] = useState<{ id: string; name_ar: string }[]>([])
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

  const tierOptions = useMemo(() => {
    const byId = new Map<string, string>()
    for (const o of orders) {
      const id = o?.tier_id
      const name = o?.snapshot_tier_name
      if (id && name && !byId.has(id)) byId.set(id, name)
    }
    return Array.from(byId.entries())
      .map(([value, label]) => ({ value, label: formatTierName(label) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ar'))
  }, [orders])

  const resolveDateRange = (f: FilterValues): { from: string | null; to: string | null } => {
    if (f.datePreset === 'all') return { from: null, to: null }
    if (f.datePreset === 'custom') return resolveDateRangeISO('custom', f.dateFrom || undefined, f.dateTo || undefined)
    return resolveDateRangeISO(f.datePreset as any)
  }

  const buildRpcParams = useCallback((): Record<string, unknown> | null => {
    const token = getToken()
    if (!token) return null
    const range = resolveDateRange(filters)
    const rpcParams: Record<string, unknown> = { p_token: token.trim() }
    if (filters.search) rpcParams.p_search = filters.search
    if (range.from) rpcParams.p_date_from = range.from
    if (range.to) rpcParams.p_date_to = range.to
    if (customerFilter) rpcParams.p_customer_id = customerFilter
    if (tab === 'my_orders' && currentUserId) rpcParams.p_created_by = currentUserId
    rpcParams.p_include_strict_previous = true
    if (dateSource === 'event') rpcParams.p_date_source = 'event'
    return rpcParams
  }, [filters, customerFilter, tab, currentUserId, dateSource])

  const fetchOrders = useCallback(async () => {
    const rpcParams = buildRpcParams()
    if (!rpcParams) { setLoading(false); setInitialLoaded(true); return }
    setLoading(true)
    const { data } = await supabase.rpc('get_unified_orders', rpcParams)
    const rows = (Array.isArray(data) ? data : []) as any[]
    try {
      const snaps = await discountOptionsService.getOrderDiscountSnapshots(rows.map((r) => r.id).filter(Boolean))
      const byId = new Map(snaps.map((s) => [s.orderId, s]))
      for (const row of rows) mergeSnapshotIntoRow(row, byId.get(row.id))
    } catch {
      // best-effort merge
    }
    if (data) setOrders(rows)
    setLoading(false)
    setInitialLoaded(true)
  }, [buildRpcParams])

  // Live customer data: silently re-query the list on a bounded interval so
  // the order card reflects CURRENT customer info without a manual refresh.
  // Reuses the same get_unified_orders params (live join, single query for the
  // whole list — no per-order requests). Pauses while the tab is hidden and
  // only re-fetches when the previous request has settled.
  const silentRefreshing = useRef(false)
  useEffect(() => {
    const timer = window.setInterval(async () => {
      if (document.hidden || silentRefreshing.current) return
      const rpcParams = buildRpcParams()
      if (!rpcParams) return
      silentRefreshing.current = true
      try {
        const { data } = await supabase.rpc('get_unified_orders', rpcParams)
        const rows = (Array.isArray(data) ? data : []) as any[]
        try {
          const snaps = await discountOptionsService.getOrderDiscountSnapshots(rows.map((r) => r.id).filter(Boolean))
          const byId = new Map(snaps.map((s) => [s.orderId, s]))
          for (const row of rows) mergeSnapshotIntoRow(row, byId.get(row.id))
        } catch {
          // best-effort merge
        }
        if (data) setOrders(rows)
      } finally {
        silentRefreshing.current = false
      }
    }, 15000)
    return () => window.clearInterval(timer)
  }, [buildRpcParams])

  useEffect(() => { fetchOrders() }, [filters, customerFilter, tab, dateSource])

  useEffect(() => {
    const token = getToken()
    if (token) fetchUnseenOrders(token)
  }, [])

  useEffect(() => {
    const token = getToken()
    if (!token) return
    Promise.all([
      supabase.rpc('get_governed_customers', { p_token: token }),
      supabase.rpc('get_governed_employees', { p_token: token }),
      supabase.from('reference_governorates').select('id, name_ar').order('name_ar', { ascending: true }),
    ]).then(([custRes, empRes, govRes]) => {
      if (custRes.data) setCustomers(Array.isArray(custRes.data) ? custRes.data : [])
      if (empRes.data) setEmployees(Array.isArray(empRes.data) ? empRes.data : [])
      if (govRes.data) setGovernorates(govRes.data || [])
    })
  }, [])

  const sorted = useMemo(() => {
    let list = orders
    if (tab === 'my_invoices' && currentEmpId) {
      list = list.filter((o: any) => o.owner_id === currentEmpId)
    }
    if (statusFilters.length) {
      list = list.filter((o: any) => statusFilters.includes(String(o.status || '')))
    }
    if (orderTypeFilters.length) {
      list = list.filter((o: any) => orderTypeFilters.includes((o.order_type || 'cash')))
    }
    if (tierFilters.length) {
      list = list.filter((o: any) => tierFilters.includes(String(o.tier_id || '')))
    }
    if (governorateFilters.length) {
      list = list.filter((o: any) => governorateFilters.includes(String(o.customer_governorate_id || '')))
    }
    if (employeeIdFilters.length) {
      list = list.filter((o: any) => {
        const ownerId = String(o.created_by || o.created_by_id || o.order_creator_id || '')
        return employeeIdFilters.includes(ownerId)
      })
    }
    return [...list].sort((a: any, b: any) => {
      const keyA = dateSource === 'event' ? (a.last_event_ts || a.created_at || '') : (a.created_at || '')
      const keyB = dateSource === 'event' ? (b.last_event_ts || b.created_at || '') : (b.created_at || '')
      if (keyB !== keyA) return keyB > keyA ? 1 : -1
      return (b.created_at || '') > (a.created_at || '') ? 1 : -1
    })
  }, [orders, tab, currentEmpId, statusFilters, orderTypeFilters, tierFilters, governorateFilters, employeeIdFilters, dateSource])

  const sortedTotalValue = useMemo(() => {
    return sorted.reduce((sum: number, o: any) => sum + (Number(o.total_amount) || 0), 0)
  }, [sorted])

  const tabLabel = tab === 'all' ? 'الطلبات' : tab === 'my_orders' ? 'طلباتي' : 'فواتيري'

  const handleRefresh = useCallback(() => {
    fetchOrders()
  }, [fetchOrders])

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
      const cust = customers.find((c: any) => c.id === customerFilter)
      if (cust) items.push({ id: 'customer', label: 'العميل', value: cust.company_name })
    }

    for (const gId of governorateFilters) {
      const gov = governorates.find((g) => g.id === gId)
      if (gov) items.push({ id: 'governorate:' + gId, label: 'المحافظة', value: gov.name_ar, onRemove: () => setViewState({ governorateFilter: governorateFilters.filter((x) => x !== gId) }) })
    }

    return items
  }, [tab, filters, statusFilters, orderTypeFilters, tierFilters, governorateFilters, employeeIdFilters, customerFilter, smartFilterEmployees, customers, governorates, STATUS_OPTIONS, dateSource, tierOptions])

  const kpiChips: KpiChipConfig[] = useMemo(() => {
    const statusCounts: Record<string, number> = {}
    const orderList = statusDisplayOrder(isUpperManagement)
    for (const order of sorted) {
      if (!orderList.includes(order.status)) continue
      statusCounts[order.status] = (statusCounts[order.status] || 0) + 1
    }
    return Object.entries(statusCounts)
      .filter(([, count]) => count > 0)
      .sort(([a], [b]) => orderList.indexOf(a) - orderList.indexOf(b))
      .map(([status, count]) => {
        const label = ORDER_STATUS_LABELS[status] || status
        const group = STATUS_KPI_GROUPS[status] || STATUS_KPI_GROUPS.draft
        return {
          id: status,
          label,
          count,
          dotClass: group.dot,
          chipClass: group.chip,
          activeChipClass: group.active,
        }
      })
  }, [sorted, isUpperManagement])

  const dateRangeStr = filters.datePreset === 'custom'
    ? (filters.dateFrom || '...') + ' → ' + (filters.dateTo || '...')
    : (filters.datePreset !== 'all' ? datePresetLabels[filters.datePreset] : undefined)

  const hasActiveFilters = tab !== 'all' || statusFilters.length > 0 || orderTypeFilters.length > 0 || tierFilters.length > 0 || governorateFilters.length > 0 || employeeIdFilters.length > 0 || !!customerFilter || !!filters.search || filters.datePreset !== 'all'

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
    customers,
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

  const handleReportExcel = () => {
    if (!sorted.length) return
    exportOrdersReportExcel(buildOrdersReportRows(sorted, governorates), buildReportMeta())
  }

  const handleReportPrint = () => {
    if (!sorted.length) return
    printOrdersReport(buildOrdersReportRows(sorted, governorates), buildReportMeta())
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
        initialFilters={filters}
        onFilterChange={(f) => setViewState({ filters: f })}
      />

      <div className="flex items-center gap-2">
        <span className="text-xs text-text-secondary">نوع التاريخ:</span>
        <select value={dateSource} onChange={(e) => setViewState({ dateSource: e.target.value })}
          className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white">
          <option value="created">وقت إنشاء الطلب</option>
          <option value="event">آخر حدث تشغيلي</option>
        </select>
      </div>

      <div className="flex flex-wrap gap-2">
        <MultiSelectFilter className="flex-1"
          allLabel="كل الحالات"
          searchPlaceholder="بحث بحالة الطلب..."
          options={FILTER_STATUS_OPTIONS}
          selected={statusFilters}
          onChange={(statusFilter) => setViewState({ statusFilter })} />
        <MultiSelectFilter className="w-[140px] shrink-0"
          allLabel="كل الأنواع"
          searchPlaceholder="بحث بنوع الطلب..."
          options={FILTER_ORDER_TYPE_OPTIONS}
          selected={orderTypeFilters}
          onChange={(orderTypeFilter) => setViewState({ orderTypeFilter })} />
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
        total={sorted.length}
        totalValue={sortedTotalValue}
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
        <CardGrid>
          {sorted.map((order: any) => (
            <OrderCard key={order.id} order={order} orderId={order.id} isUnseen={unseenOrderIds.has(order.id)} />
          ))}
        </CardGrid>
      )}
    </div>
  )
}
