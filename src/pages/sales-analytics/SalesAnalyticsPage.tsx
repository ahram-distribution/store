import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { formatCurrencyWhole } from '../../utils/format'
import { UnifiedFilterBar } from '../../components/shared/UnifiedFilterBar'
import { useAuthStore } from '../../store/auth'
import { resolveDateRangeISO } from '../../lib/dateRange'
import { supabase } from '../../lib/supabase'
import { filterDelivered as filterDeliveredOrders } from '../../lib/deliveredOrders'
import type { FilterState } from '../../types/filters'

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(n))
}

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

type Tab = 'customers' | 'companies' | 'products'

const TAB_LABELS: Record<Tab, string> = {
  customers: 'المبيعات حسب العملاء',
  companies: 'المبيعات حسب الشركات',
  products: 'المبيعات حسب الأصناف',
}

interface EntityRow {
  name: string
  activity: number
  target: number
  orderCount?: number
}

/* ── Drill-Down Modal ── */
interface DrillDownSourceOrder {
  id: string
  order_number: string
  customer_name: string
  total_amount: number
  created_at: string
  status: string
  items?: any[]
  matched_total?: number
}

interface DrillDownProps {
  type: 'customer' | 'company' | 'product' | 'all'
  entityName: string
  orders: any[]
  orderItems: any[]
  filterDelivered?: boolean
  onClose: () => void
  onNavigate: (orderId: string) => void
}

function DrillDownModal({ type, entityName, orders, orderItems, filterDelivered, onClose, onNavigate }: DrillDownProps) {
  const sourceOrders = useMemo(() => {
    const filtered = filterDelivered ? filterDeliveredOrders(orders) : orders
    const map = new Map<string, DrillDownSourceOrder>()

    if (type === 'customer') {
      for (const order of filtered) {
        if ((order.customer_name || 'غير محدد') === entityName) {
          map.set(order.id, {
            id: order.id,
            order_number: order.order_number,
            customer_name: order.customer_name,
            total_amount: Number(order.total_amount) || 0,
            created_at: order.created_at,
            status: order.status,
            matched_total: Number(order.total_amount) || 0,
          })
        }
      }
    } else if (type === 'company') {
      const filteredItemIds = new Set(filtered.map((o: any) => o.id))
      for (const item of orderItems) {
        if ((item.company_name || 'غير محدد') === entityName && filteredItemIds.has(item.order_id)) {
          const order = filtered.find((o: any) => o.id === item.order_id)
          if (order) {
            const orderId = order.id
            if (!map.has(orderId)) {
              map.set(orderId, {
                id: order.id,
                order_number: order.order_number,
                customer_name: order.customer_name,
                total_amount: Number(order.total_amount) || 0,
                created_at: order.created_at,
                status: order.status,
                items: [],
                matched_total: 0,
              })
            }
            const entry = map.get(orderId)
            if (entry) {
              entry.items!.push(item)
              entry.matched_total = (entry.matched_total || 0) + (Number(item.total_price) || 0)
            }
          }
        }
      }
    } else if (type === 'product') {
      const filteredItemIds = new Set(filtered.map((o: any) => o.id))
      for (const item of orderItems) {
        if ((item.product_name || 'غير محدد') === entityName && filteredItemIds.has(item.order_id)) {
          const order = filtered.find((o: any) => o.id === item.order_id)
          if (order) {
            const orderId = order.id
            if (!map.has(orderId)) {
              map.set(orderId, {
                id: order.id,
                order_number: order.order_number,
                customer_name: order.customer_name,
                total_amount: Number(order.total_amount) || 0,
                created_at: order.created_at,
                status: order.status,
                items: [],
                matched_total: 0,
              })
            }
            const entry = map.get(orderId)
            if (entry) {
              entry.items!.push(item)
              entry.matched_total = (entry.matched_total || 0) + (Number(item.total_price) || 0)
            }
          }
        }
      }
    } else {
      for (const order of filtered) {
        map.set(order.id, {
          id: order.id,
          order_number: order.order_number,
          customer_name: order.customer_name,
          total_amount: Number(order.total_amount) || 0,
          created_at: order.created_at,
          status: order.status,
          matched_total: Number(order.total_amount) || 0,
        })
      }
    }

    return Array.from(map.values()).sort((a, b) => ((b.created_at || '') > (a.created_at || '') ? 1 : -1))
  }, [type, entityName, orders, orderItems, filterDelivered])

  const totalMatched = useMemo(() => sourceOrders.reduce((sum, o) => sum + (o.matched_total || 0), 0), [sourceOrders])

  const title = filterDelivered ? 'الطلبات المسلّمة' :
    type === 'all' ? 'جميع الطلبات'
    : type === 'customer' ? `طلبات العميل: ${entityName}`
    : type === 'company' ? `طلبات الشركة: ${entityName}`
    : `طلبات المنتج: ${entityName}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div>
            <div className="text-sm font-bold text-text">{title}</div>
            <div className="text-[11px] text-text-secondary mt-0.5">{sourceOrders.length} طلب · {formatNumber(totalMatched)} ج.م</div>
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-text text-lg leading-none p-1">&times;</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {sourceOrders.length === 0 ? (
            <div className="text-center py-8 text-text-secondary text-sm">لا توجد سجلات</div>
          ) : sourceOrders.map((order) => (
            <div
              key={order.id}
              onClick={() => onNavigate(order.id)}
              className="bg-surface rounded-lg border border-border p-3 cursor-pointer hover:border-primary/30 transition-colors"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-text font-mono">{order.order_number}</span>
                <span className="text-[10px] text-text-secondary">{new Date(order.created_at).toLocaleDateString('ar-EG')}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-text-secondary truncate">{order.customer_name}</span>
                <span className="text-xs font-bold text-primary">{formatNumber(order.matched_total || order.total_amount)} ج.م</span>
              </div>
              {order.items && order.items.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border/50 space-y-0.5">
                  {order.items.map((item: any, idx: number) => (
                    <div key={idx} className="flex items-center justify-between text-[10px] text-text-secondary">
                      <span className="truncate">{item.product_name}</span>
                      <span className="ml-2 shrink-0">{formatNumber(Number(item.total_price) || 0)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── Activity Cell (drillable) ── */
function ActivityCell({ value, onClick }: { value: number; onClick: () => void }) {
  return (
    <div className="flex-1 text-center">
      <div className="text-[10px] text-text-secondary mb-0.5">النشاط</div>
      <button onClick={onClick} className="text-sm font-bold text-primary cursor-pointer hover:underline">
        {formatNumber(value)}
      </button>
    </div>
  )
}

/* ── Target Cell (drillable) ── */
function TargetCell({ value, onClick }: { value: number; onClick: () => void }) {
  return (
    <div className="flex-1 text-center">
      <div className="text-[10px] text-text-secondary mb-0.5">المنفذ فعلي</div>
      <button onClick={onClick} className="text-sm font-bold text-success cursor-pointer hover:underline">
        {formatNumber(value)}
      </button>
    </div>
  )
}

/* ── Entity Card ── */
function EntityCard({ name, activity, target, orderCount, onActivityClick, onTargetClick, onOrderCountClick }: {
  name: string; activity: number; target: number; orderCount?: number
  onActivityClick: () => void; onTargetClick: () => void; onOrderCountClick?: () => void
}) {
  return (
    <div className="bg-white rounded-xl border border-border p-4">
      <div className="text-sm font-bold text-text mb-1 truncate" title={name}>{name}</div>
      {orderCount !== undefined && (
        <button
          onClick={onOrderCountClick}
          className="text-[11px] text-text-secondary mb-3 cursor-pointer hover:underline"
        >
          {orderCount} طلب
        </button>
      )}
      <div className="flex gap-3">
        <ActivityCell value={activity} onClick={onActivityClick} />
        <div className="w-px bg-border" />
        <TargetCell value={target} onClick={onTargetClick} />
      </div>
    </div>
  )
}

/* ── Grand Total Footer ── */
function GrandTotalFooter({ totalActivity, totalTarget, onClick, onTargetClick }: { totalActivity: number; totalTarget: number; onClick: () => void; onTargetClick: () => void }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      <div className="text-xs font-bold text-text mb-3">الإجمالي الكلي</div>
      <div className="flex gap-3">
        <div className="flex-1 text-center">
          <div className="text-[10px] text-text-secondary mb-0.5">إجمالي النشاط</div>
          <button onClick={onClick} className="text-base font-bold text-primary cursor-pointer hover:underline">
            {formatCurrencyWhole(totalActivity)}
          </button>
        </div>
        <div className="w-px bg-border" />
        <div className="flex-1 text-center">
          <div className="text-[10px] text-text-secondary mb-0.5">إجمالي المنفذ فعلي</div>
          <button onClick={onTargetClick} className="text-base font-bold text-success cursor-pointer hover:underline">
            {formatCurrencyWhole(totalTarget)}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Main Page ── */
export function SalesAnalyticsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const [activeTab, setActiveTab] = useState<Tab>('customers')
  const [analyticsData, setAnalyticsData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [employees, setEmployees] = useState<any[]>([])
  const [drillDownParams, setDrillDownParams] = useState<{ type: 'customer' | 'company' | 'product' | 'all'; entityName: string; filterDelivered?: boolean } | null>(null)
  const [drillDownOrders, setDrillDownOrders] = useState<any[] | null>(null)
  const [drillDownItems, setDrillDownItems] = useState<any[] | null>(null)
  const [drillDownLoading, setDrillDownLoading] = useState(false)

  const scope = ((location.state as { scope?: string })?.scope ?? 'company') as 'company' | 'team' | 'self'

  const initialFilter = useMemo<FilterState>(() => {
    if (scope === 'self') {
      return { datePreset: 'month', dateFrom: '', dateTo: '', search: '', managerId: null, employeeId: user?.employee_id || null }
    }
    if (scope === 'team') {
      return { datePreset: 'month', dateFrom: '', dateTo: '', search: '', managerId: user?.employee_id || null, employeeId: null }
    }
    return { datePreset: 'month', dateFrom: '', dateTo: '', search: '', managerId: null, employeeId: null }
  }, [scope, user?.employee_id])

  const [filters, setFilters] = useState<FilterState>(initialFilter)

  useEffect(() => { setFilters(initialFilter) }, [initialFilter])

  const managerOptions = useMemo(() => {
    if (scope === 'team') {
      const me = employees.find((e: any) => e.id === user?.employee_id)
      return me ? [{ value: me.id, label: me.full_name }] : []
    }
    const map = new Map<string, string>()
    for (const e of employees) {
      if (e.manager_id && !map.has(e.manager_id)) {
        const mgr = employees.find((m: any) => m.id === e.manager_id)
        map.set(e.manager_id, mgr ? mgr.full_name : e.manager_id)
      }
    }
    return Array.from(map, ([value, label]) => ({ value, label }))
  }, [employees, scope, user?.employee_id])

  const employeeOptions = useMemo(() => {
    const toOpt = (e: any) => ({ value: e.id, label: e.full_name || e.code || e.id })
    if (scope === 'team') {
      const myEmployeeId = user?.employee_id
      const meOption = myEmployeeId ? [{ value: myEmployeeId, label: 'أنا (مدير البيع)' }] : []
      const directReports = employees
        .filter((e: any) => e.manager_id === user?.employee_id && e.id !== myEmployeeId)
        .map(toOpt)
      return [...meOption, ...directReports]
    }
    if (scope === 'company' && filters.managerId) {
      const manager = employees.find((e: any) => e.id === filters.managerId)
      const managerOption = manager ? [{ value: manager.id, label: 'المدير نفسه' }] : []
      const directReports = employees
        .filter((e: any) => e.manager_id === filters.managerId && e.id !== filters.managerId)
        .map(toOpt)
      return [...managerOption, ...directReports]
    }
    if (filters.managerId) {
      return employees.filter((e: any) => e.manager_id === filters.managerId).map(toOpt)
    }
    return employees.map(toOpt)
  }, [employees, scope, user?.employee_id, filters.managerId])

  const managerTeamIds = useMemo(() => {
    if (!filters.managerId) return null
    const teamMembers = employees.filter((e: any) => e.manager_id === filters.managerId)
    const ids = teamMembers.map((e: any) => e.id as string)
    if (scope === 'team' && user?.employee_id && !ids.includes(user.employee_id)) {
      ids.push(user.employee_id)
    }
    if (scope === 'company' && !ids.includes(filters.managerId)) {
      ids.push(filters.managerId)
    }
    return ids.length > 0 ? ids : null
  }, [employees, filters.managerId, scope, user?.employee_id])

  const resolveDateRange = (f: FilterState): { from: string | null; to: string | null } => {
    if (f.datePreset === 'all') return { from: null, to: null }
    if (f.datePreset === 'custom') return resolveDateRangeISO('custom', f.dateFrom || undefined, f.dateTo || undefined)
    return resolveDateRangeISO(f.datePreset as any)
  }

  const fetchData = useCallback(async () => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    setLoading(true)
    const range = resolveDateRange(filters)
    const params: any = { p_token: token.trim() }
    if (filters.search) params.p_search = filters.search
    if (filters.employeeId) {
      params.p_owner_id = filters.employeeId
    } else if (managerTeamIds) {
      params.p_owner_ids = managerTeamIds
    }
    if (range.from) params.p_date_from = range.from
    if (range.to) params.p_date_to = range.to

    const { data } = await supabase.rpc('get_sales_analytics', params)
    if (data) setAnalyticsData(data)
    setLoading(false)
  }, [filters, managerTeamIds])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    const token = getToken()
    if (!token) return
    supabase.rpc('get_governed_employees', { p_token: token }).then(({ data }) => {
      if (data) setEmployees(Array.isArray(data) ? data : [])
    })
  }, [])

  /* ── Lazy drill-down fetch ── */
  useEffect(() => {
    if (!drillDownParams) { setDrillDownOrders(null); setDrillDownItems(null); return }
    const token = getToken()
    if (!token) return
    let cancelled = false
    setDrillDownLoading(true)

    const range = resolveDateRange(filters)

    supabase.rpc('get_sales_analytics_drilldown', {
      p_token: token.trim(),
      p_entity_type: drillDownParams.type,
      p_entity_name: drillDownParams.entityName,
      p_filter_delivered: drillDownParams.filterDelivered || false,
      p_date_from: range.from,
      p_date_to: range.to,
    }).then(({ data }) => {
      if (cancelled) return
      if (data) {
        setDrillDownOrders(Array.isArray(data.orders) ? data.orders : [])
        setDrillDownItems(Array.isArray(data.items) ? data.items : [])
      } else {
        setDrillDownOrders([])
        setDrillDownItems([])
      }
      setDrillDownLoading(false)
    })

    return () => { cancelled = true }
  }, [drillDownParams])

  /* ── Derive active rows from pre-aggregated data ── */
  const customerAgg: EntityRow[] = useMemo(() => {
    if (!analyticsData?.customers) return []
    return analyticsData.customers.map((c: any) => ({
      name: c.name,
      activity: Number(c.activity) || 0,
      target: Number(c.target) || 0,
      orderCount: c.order_count || 0,
    }))
  }, [analyticsData])

  const companyAgg = useMemo(() => {
    if (!analyticsData?.companies) return []
    return analyticsData.companies.map((c: any) => ({
      name: c.name,
      activity: Number(c.activity) || 0,
      target: Number(c.target) || 0,
    }))
  }, [analyticsData])

  const productAgg = useMemo(() => {
    if (!analyticsData?.products) return []
    return analyticsData.products.map((p: any) => ({
      name: p.name,
      activity: Number(p.activity) || 0,
      target: Number(p.target) || 0,
    }))
  }, [analyticsData])

  const activeRows = activeTab === 'customers' ? customerAgg : activeTab === 'companies' ? companyAgg : productAgg
  const totalActivity = useMemo(() => activeRows.reduce((sum, r) => sum + r.activity, 0), [activeRows])
  const totalTarget = useMemo(() => activeRows.reduce((sum, r) => sum + r.target, 0), [activeRows])

  const tabEntityLabel = activeTab === 'customers' ? 'العملاء' : activeTab === 'companies' ? 'الشركات' : 'الأصناف'

  const openDrillDown = useCallback((type: 'customer' | 'company' | 'product' | 'all', entityName: string, filterDelivered?: boolean) => {
    setDrillDownParams({ type, entityName, filterDelivered })
  }, [])

  const handleNavigateOrder = useCallback((orderId: string) => {
    setDrillDownParams(null)
    navigate(`/orders/${orderId}`)
  }, [navigate])

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">تحليل المبيعات</h1>
      </div>

      {/* ── Filter Bar ── */}
      <UnifiedFilterBar
        value={filters}
        onChange={setFilters}
        showSearch
        showMonthSelector
        showDateRange
        showManagerFilter={scope === 'company'}
        showEmployeeFilter={scope !== 'self'}
        managerOptions={managerOptions}
        employeeOptions={employeeOptions}
        searchPlaceholder="بحث بالاسم أو الكود..."
        managerPlaceholder="كل المديرين"
        employeePlaceholder={scope === 'team' || filters.managerId ? 'كل الفريق' : 'كل المناديب'}
      />

      {/* ── Top Summary Cards ── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-xl border border-border p-4 text-center">
          <div className="text-[10px] text-text-secondary mb-1">إجمالي النشاط</div>
          <button onClick={() => openDrillDown('all', '')} className="text-lg font-bold text-primary cursor-pointer hover:underline">
            {formatCurrencyWhole(totalActivity)}
          </button>
        </div>
        <div className="bg-white rounded-xl border border-border p-4 text-center">
          <div className="text-[10px] text-text-secondary mb-1">إجمالي المنفذ فعلي</div>
          <button onClick={() => openDrillDown('all', '', true)} className="text-lg font-bold text-success cursor-pointer hover:underline">
            {formatCurrencyWhole(totalTarget)}
          </button>
        </div>
      </div>

      {/* ── Tab Bar ── */}
      <div className="flex gap-1 bg-white rounded-lg border border-border p-1 overflow-x-auto">
        {(['customers', 'companies', 'products'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`whitespace-nowrap flex-1 text-[10px] px-2 py-2 rounded-md font-semibold transition-colors ${
              activeTab === tab ? 'bg-primary text-white' : 'text-text-secondary'
            }`}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* ── Tab Header Summary ── */}
      <div className="flex items-center gap-4 text-xs text-text-secondary px-1">
        <span>عدد {tabEntityLabel}: <strong className="text-text">{activeRows.length}</strong></span>
        <span>النشاط: <button onClick={() => openDrillDown('all', '')} className="text-primary font-bold cursor-pointer hover:underline">{formatCurrencyWhole(totalActivity)}</button></span>
        <span>المنفذ فعلي: <button onClick={() => openDrillDown('all', '', true)} className="text-success font-bold cursor-pointer hover:underline">{formatCurrencyWhole(totalTarget)}</button></span>
      </div>

      {/* ── Entity List ── */}
      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : activeRows.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">لا توجد بيانات</div>
      ) : (
        <div className="space-y-3">
          {activeRows.map((row) => (
            <EntityCard
              key={row.name}
              name={row.name}
              activity={row.activity}
              target={row.target}
              orderCount={'orderCount' in row ? (row as EntityRow).orderCount : undefined}
              onActivityClick={() => openDrillDown(activeTab === 'customers' ? 'customer' : activeTab === 'companies' ? 'company' : 'product', row.name)}
              onTargetClick={() => openDrillDown(activeTab === 'customers' ? 'customer' : activeTab === 'companies' ? 'company' : 'product', row.name, true)}
              onOrderCountClick={activeTab === 'customers' && 'orderCount' in row ? () => openDrillDown('customer', row.name) : undefined}
            />
          ))}

          {/* ── Grand Total Footer ── */}
          <GrandTotalFooter totalActivity={totalActivity} totalTarget={totalTarget} onClick={() => openDrillDown('all', '')} onTargetClick={() => openDrillDown('all', '', true)} />
        </div>
      )}

      {/* ── Drill-Down Modal ── */}
      {drillDownParams && (
        drillDownLoading ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-xl p-8 text-text-secondary text-sm">جاري التحميل...</div>
          </div>
        ) : (
          <DrillDownModal
            type={drillDownParams.type}
            entityName={drillDownParams.entityName}
            orders={drillDownOrders || []}
            orderItems={drillDownItems || []}
            filterDelivered={drillDownParams.filterDelivered}
            onClose={() => setDrillDownParams(null)}
            onNavigate={handleNavigateOrder}
          />
        )
      )}
    </div>
  )
}
