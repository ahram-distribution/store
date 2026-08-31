import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { usePersistentViewState } from '../../hooks/usePersistentViewState'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
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
  { value: 'credit', label: 'آجل' },
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
    statusFilter: '',
    customerFilter: '',
    orderTypeFilter: '',
    governorateFilter: '',
    dateSource: 'created',
    filters: { datePreset: 'all', dateFrom: '', dateTo: '', search: '', employeeId: '' } as FilterValues,
  })
  const { tab, statusFilter, customerFilter, orderTypeFilter, governorateFilter, dateSource, filters } = viewState
  const [sfResetKey, setSfResetKey] = useState(0)

  const STATUS_OPTIONS = useMemo(() => statusFilterOptions(isUpperManagement), [isUpperManagement])

  const smartFilterEmployees = useMemo(
    () => employees.map(e => ({ id: e.identity_id || e.id, name: e.full_name })),
    [employees]
  )

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
    if (filters.employeeId) rpcParams.p_created_by = filters.employeeId
    if (range.from) rpcParams.p_date_from = range.from
    if (range.to) rpcParams.p_date_to = range.to
    if (statusFilter) rpcParams.p_status = statusFilter
    if (customerFilter) rpcParams.p_customer_id = customerFilter
    if (tab === 'my_orders' && currentUserId) rpcParams.p_created_by = currentUserId
    if (governorateFilter) rpcParams.p_governorate_id = governorateFilter
    rpcParams.p_include_strict_previous = true
    if (dateSource === 'event') rpcParams.p_date_source = 'event'
    return rpcParams
  }, [filters, statusFilter, customerFilter, tab, currentUserId, governorateFilter, dateSource])

  const fetchOrders = useCallback(async () => {
    const rpcParams = buildRpcParams()
    if (!rpcParams) { setLoading(false); setInitialLoaded(true); return }
    setLoading(true)
    const { data } = await supabase.rpc('get_unified_orders', rpcParams)
    if (data) setOrders(Array.isArray(data) ? data : [])
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
        if (data) setOrders(Array.isArray(data) ? data : [])
      } finally {
        silentRefreshing.current = false
      }
    }, 15000)
    return () => window.clearInterval(timer)
  }, [buildRpcParams])

  useEffect(() => { fetchOrders() }, [filters, statusFilter, customerFilter, tab, governorateFilter, dateSource])

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
    if (orderTypeFilter) {
      list = list.filter((o: any) => (o.order_type || 'cash') === orderTypeFilter)
    }
    return [...list].sort((a: any, b: any) => {
      const keyA = dateSource === 'event' ? (a.last_event_ts || a.created_at || '') : (a.created_at || '')
      const keyB = dateSource === 'event' ? (b.last_event_ts || b.created_at || '') : (b.created_at || '')
      if (keyB !== keyA) return keyB > keyA ? 1 : -1
      return (b.created_at || '') > (a.created_at || '') ? 1 : -1
    })
  }, [orders, tab, currentEmpId, orderTypeFilter, dateSource])

  const sortedTotalValue = useMemo(() => {
    return sorted.reduce((sum: number, o: any) => sum + (Number(o.total_amount) || 0), 0)
  }, [sorted])

  const tabLabel = tab === 'all' ? 'الطلبات' : tab === 'my_orders' ? 'طلباتي' : 'فواتيري'

  const handleRefresh = useCallback(() => {
    fetchOrders()
  }, [fetchOrders])

  const handleStatusToggle = useCallback((status: string) => {
    setViewState((prev: any) => ({ statusFilter: prev.statusFilter === status ? '' : status }))
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

    if (filters.employeeId) {
      const emp = employees.find((e: any) => (e.identity_id || e.id) === filters.employeeId)
      if (emp) items.push({ id: 'employee', label: 'المسؤول', value: emp.full_name })
    }

    if (statusFilter) {
      const label = STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label || visibleStatusLabel(statusFilter) || statusFilter
      items.push({ id: 'status', label: 'الحالة', value: label, onRemove: () => setViewState({ statusFilter: '' }) })
    }

    if (orderTypeFilter) {
      const label = ORDER_TYPE_OPTIONS.find((o) => o.value === orderTypeFilter)?.label || orderTypeFilter
      items.push({ id: 'orderType', label: 'النوع', value: label, onRemove: () => setViewState({ orderTypeFilter: '' }) })
    }

    if (customerFilter) {
      const cust = customers.find((c: any) => c.id === customerFilter)
      if (cust) items.push({ id: 'customer', label: 'العميل', value: cust.company_name })
    }

    if (governorateFilter) {
      const gov = governorates.find((g) => g.id === governorateFilter)
      if (gov) items.push({ id: 'governorate', label: 'المحافظة', value: gov.name_ar, onRemove: () => setViewState({ governorateFilter: '' }) })
    }

    return items
  }, [tab, filters, statusFilter, customerFilter, employees, customers, governorateFilter, governorates, STATUS_OPTIONS, dateSource])

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

  const hasActiveFilters = tab !== 'all' || !!statusFilter || !!orderTypeFilter || !!customerFilter || !!governorateFilter || !!filters.search || filters.datePreset !== 'all' || !!filters.employeeId

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
    employeeId: filters.employeeId || '',
    statusFilter,
    customerFilter,
    orderTypeFilter,
    governorateFilter,
    employees,
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

      <div className="flex gap-2">
        <select value={statusFilter} onChange={(e) => setViewState({ statusFilter: e.target.value })}
          className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white">
          {STATUS_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
        <select value={orderTypeFilter} onChange={(e) => setViewState({ orderTypeFilter: e.target.value })}
          className="w-[120px] border border-border rounded-lg px-2 py-1.5 text-xs bg-white">
          {ORDER_TYPE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
        <select value={governorateFilter} onChange={(e) => setViewState({ governorateFilter: e.target.value })}
          className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white">
          <option value="">كل المحافظات</option>
          {governorates.map((g) => <option key={g.id} value={g.id}>{g.name_ar}</option>)}
        </select>
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
        <StatusKpiBar chips={kpiChips} selectedId={statusFilter} onToggle={handleStatusToggle} />
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
