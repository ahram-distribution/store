import { useState, useEffect, useMemo, useCallback } from 'react'
import { usePersistentViewState } from '../../hooks/usePersistentViewState'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import { resolveDateRangeISO } from '../../lib/dateRange'
import { OrderCard } from '../../components/orders/OrderCard'
import SmartFilterBar, { type FilterValues } from '../../components/SmartFilterBar'
import { ResultsSummary } from '../../components/data-list/ResultsSummary'
import { ActiveFilters } from '../../components/data-list/ActiveFilters'
import { CardGrid } from '../../components/data-list/CardGrid'
import { EmptyState } from '../../components/data-list/EmptyState'
import { StatusKpiBar } from '../../components/data-list/StatusKpiBar'
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

const STATUS_OPTIONS = [
  { value: '', label: 'كل الحالات' },
  { value: 'draft', label: 'مسودة' },
  { value: 'submitted', label: 'مقدم' },
  { value: 'reviewing', label: 'قيد المراجعة' },
  { value: 'returned_for_revision', label: 'معاد للتعديل' },
  { value: 'approved', label: 'معتمد' },
  { value: 'preparing', label: 'قيد التجهيز' },
  { value: 'prepared', label: 'تم التجهيز' },
  { value: 'ready_for_dispatch', label: 'بانتظار قرار الشحن' },
  { value: 'sent_to_delivery', label: 'أرسل للتوصيل' },
  { value: 'dispatched', label: 'تم الشحن' },
  { value: 'deferred', label: 'مؤجل' },
  { value: 'cancelled', label: 'ملغي' },
  { value: 'delivered', label: 'تم التسليم' },
]

const ORDER_TYPE_OPTIONS = [
  { value: '', label: 'كل الأنواع' },
  { value: 'cash', label: 'نقدي' },
  { value: 'credit', label: 'آجل' },
]

const STATUS_KPI_GROUPS: Record<string, { dot: string; chip: string; active: string }> = {
  draft: { dot: 'bg-gray-300', chip: 'bg-gray-50 border-gray-150 text-gray-500', active: 'bg-gray-100 border-gray-300 text-gray-700 ring-1 ring-gray-200' },
  submitted: { dot: 'bg-blue-300', chip: 'bg-blue-50 border-blue-100 text-blue-600', active: 'bg-blue-100 border-blue-300 text-blue-700 ring-1 ring-blue-200' },
  reviewing: { dot: 'bg-blue-300', chip: 'bg-blue-50 border-blue-100 text-blue-600', active: 'bg-blue-100 border-blue-300 text-blue-700 ring-1 ring-blue-200' },
  returned_for_revision: { dot: 'bg-blue-300', chip: 'bg-blue-50 border-blue-100 text-blue-600', active: 'bg-blue-100 border-blue-300 text-blue-700 ring-1 ring-blue-200' },
  approved: { dot: 'bg-emerald-300', chip: 'bg-emerald-50 border-emerald-100 text-emerald-600', active: 'bg-emerald-100 border-emerald-300 text-emerald-700 ring-1 ring-emerald-200' },
  preparing: { dot: 'bg-emerald-300', chip: 'bg-emerald-50 border-emerald-100 text-emerald-600', active: 'bg-emerald-100 border-emerald-300 text-emerald-700 ring-1 ring-emerald-200' },
  prepared: { dot: 'bg-emerald-300', chip: 'bg-emerald-50 border-emerald-100 text-emerald-600', active: 'bg-emerald-100 border-emerald-300 text-emerald-700 ring-1 ring-emerald-200' },
  ready_for_dispatch: { dot: 'bg-emerald-300', chip: 'bg-emerald-50 border-emerald-100 text-emerald-600', active: 'bg-emerald-100 border-emerald-300 text-emerald-700 ring-1 ring-emerald-200' },
  sent_to_delivery: { dot: 'bg-emerald-300', chip: 'bg-emerald-50 border-emerald-100 text-emerald-600', active: 'bg-emerald-100 border-emerald-300 text-emerald-700 ring-1 ring-emerald-200' },
  dispatched: { dot: 'bg-emerald-300', chip: 'bg-emerald-50 border-emerald-100 text-emerald-600', active: 'bg-emerald-100 border-emerald-300 text-emerald-700 ring-1 ring-emerald-200' },
  deferred: { dot: 'bg-gray-300', chip: 'bg-gray-50 border-gray-150 text-gray-500', active: 'bg-gray-100 border-gray-300 text-gray-700 ring-1 ring-gray-200' },
  cancelled: { dot: 'bg-red-300', chip: 'bg-red-50 border-red-100 text-red-600', active: 'bg-red-100 border-red-300 text-red-700 ring-1 ring-red-200' },
  delivered: { dot: 'bg-emerald-300', chip: 'bg-emerald-50 border-emerald-100 text-emerald-600', active: 'bg-emerald-100 border-emerald-300 text-emerald-700 ring-1 ring-emerald-200' },
}

export function OrdersPage() {
  const navigate = useNavigate()
  const currentUserId = useAuthStore((s) => s.user?.identity_id)
  const currentEmpId = useAuthStore((s) => s.user?.employee_id)
  const [orders, setOrders] = useState<any[]>([])
  const [customers, setCustomers] = useState<any[]>([])
  const [employees, setEmployees] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const params = new URLSearchParams(window.location.search)
  const [viewState, setViewState, resetViewState] = usePersistentViewState('orders-list', {
    tab: (params.get('my') === '1' ? 'my_orders' : 'all') as Tab,
    statusFilter: '',
    customerFilter: '',
    orderTypeFilter: '',
    filters: { datePreset: 'all', dateFrom: '', dateTo: '', search: '', employeeId: '' } as FilterValues,
  })
  const { tab, statusFilter, customerFilter, orderTypeFilter, filters } = viewState
  const [sfResetKey, setSfResetKey] = useState(0)

  const resolveDateRange = (f: FilterValues): { from: string | null; to: string | null } => {
    if (f.datePreset === 'all') return { from: null, to: null }
    if (f.datePreset === 'custom') return resolveDateRangeISO('custom', f.dateFrom || undefined, f.dateTo || undefined)
    return resolveDateRangeISO(f.datePreset as any)
  }

  const fetchOrders = async () => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    setLoading(true)
    const range = resolveDateRange(filters)
    const rpcParams: any = { p_token: token.trim() }
    if (filters.search) rpcParams.p_search = filters.search
    if (filters.employeeId) rpcParams.p_created_by = filters.employeeId
    if (range.from) rpcParams.p_date_from = range.from
    if (range.to) rpcParams.p_date_to = range.to
    if (statusFilter) rpcParams.p_status = statusFilter
    if (customerFilter) rpcParams.p_customer_id = customerFilter
    if (tab === 'my_orders' && currentUserId) rpcParams.p_created_by = currentUserId

    const { data } = await supabase.rpc('get_unified_orders', rpcParams)
    if (data) setOrders(Array.isArray(data) ? data : [])
    setLoading(false)
  }

  useEffect(() => { fetchOrders() }, [filters, statusFilter, customerFilter, tab])

  useEffect(() => {
    const token = getToken()
    if (!token) return
    Promise.all([
      supabase.rpc('get_governed_customers', { p_token: token }),
      supabase.rpc('get_governed_employees', { p_token: token }),
    ]).then(([custRes, empRes]) => {
      if (custRes.data) setCustomers(Array.isArray(custRes.data) ? custRes.data : [])
      if (empRes.data) setEmployees(Array.isArray(empRes.data) ? empRes.data : [])
    })
  }, [])

  const sorted = useMemo(() => {
    let list = orders
    if (tab === 'my_invoices' && currentUserId) {
      list = list.filter((o: any) => o.owner_id === currentUserId)
    }
    if (orderTypeFilter) {
      list = list.filter((o: any) => (o.order_type || 'cash') === orderTypeFilter)
    }
    return [...list].sort((a: any, b: any) => ((b.created_at || '') > (a.created_at || '') ? 1 : -1))
  }, [orders, tab, currentUserId, orderTypeFilter])

  const sortedTotalValue = useMemo(() => {
    return sorted.reduce((sum: number, o: any) => sum + (Number(o.total_amount) || 0), 0)
  }, [sorted])

  const tabLabel = tab === 'all' ? 'الطلبات' : tab === 'my_orders' ? 'طلباتي' : 'فواتيري'

  const handleRefresh = useCallback(() => {
    fetchOrders()
  }, [])

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
      const label = STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label || statusFilter
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

    return items
  }, [tab, filters, statusFilter, customerFilter, employees, customers])

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const order of sorted) {
      const s = order.status
      counts[s] = (counts[s] || 0) + 1
    }
    return counts
  }, [sorted])

  const kpiChips: KpiChipConfig[] = useMemo(() => {
    return Object.entries(statusCounts)
      .filter(([, count]) => count > 0)
      .sort(([a], [b]) => {
        const order = ['draft', 'submitted', 'reviewing', 'returned_for_revision', 'approved', 'preparing', 'prepared', 'ready_for_dispatch', 'sent_to_delivery', 'dispatched', 'delivered', 'deferred', 'cancelled']
        return order.indexOf(a) - order.indexOf(b)
      })
      .map(([status, count]) => {
        const label = STATUS_OPTIONS.find((o) => o.value === status)?.label || status
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
  }, [statusCounts])

  const dateRangeStr = filters.datePreset === 'custom'
    ? (filters.dateFrom || '...') + ' → ' + (filters.dateTo || '...')
    : (filters.datePreset !== 'all' ? datePresetLabels[filters.datePreset] : undefined)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">{tabLabel}</h1>
        <button onClick={() => navigate('/orders/new')} className="mr-auto bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold">+ إنشاء طلب</button>
      </div>

      {currentEmpId && (
        <div className="flex gap-1 bg-white rounded-lg border border-border p-1">
          <button onClick={() => setViewState({ tab: 'all' })} className={'flex-1 text-xs py-1.5 rounded-md font-semibold transition-colors ' + (tab === 'all' ? 'bg-primary text-white' : 'text-text-secondary')}>الكل</button>
          <button onClick={() => setViewState({ tab: 'my_orders' })} className={'flex-1 text-xs py-1.5 rounded-md font-semibold transition-colors ' + (tab === 'my_orders' ? 'bg-primary text-white' : 'text-text-secondary')}>طلباتي</button>
          <button onClick={() => setViewState({ tab: 'my_invoices' })} className={'flex-1 text-xs py-1.5 rounded-md font-semibold transition-colors ' + (tab === 'my_invoices' ? 'bg-primary text-white' : 'text-text-secondary')}>فواتيري</button>
          <button onClick={() => { resetViewState(); setSfResetKey(k => k + 1) }} className="text-[10px] px-2 py-1 mr-auto text-danger font-semibold">إعادة تعيين</button>
        </div>
      )}

      <SmartFilterBar
        key={sfResetKey}
        searchPlaceholder="بحث برقم الطلب أو اسم العميل..."
        employees={employees.map(e => ({ id: e.identity_id || e.id, name: e.full_name }))}
        employeeLabel="المسؤول"
        initialFilters={filters}
        onFilterChange={(f) => setViewState({ filters: f })}
      />

      <div className="flex gap-2">
        <select value={statusFilter} onChange={(e) => setViewState({ statusFilter: e.target.value })}
          className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white">
          {STATUS_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
        <select value={orderTypeFilter} onChange={(e) => setViewState({ orderTypeFilter: e.target.value })}
          className="w-[120px] border border-border rounded-lg px-2 py-1.5 text-xs bg-white">
          {ORDER_TYPE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
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
      />

      <ActiveFilters filters={activeFilterItems} />

      {!loading && kpiChips.length > 0 && (
        <StatusKpiBar chips={kpiChips} selectedId={statusFilter} onToggle={handleStatusToggle} />
      )}

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : sorted.length === 0 ? (
        <EmptyState
          message={tab === 'my_orders' ? 'لا توجد طلبات لك' : tab === 'my_invoices' ? 'لا توجد فواتير لك' : undefined}
        />
      ) : (
        <CardGrid>
          {sorted.map((order: any) => (
            <OrderCard key={order.id} order={order} onClick={() => navigate(`/orders/${order.id}`)} />
          ))}
        </CardGrid>
      )}
    </div>
  )
}
