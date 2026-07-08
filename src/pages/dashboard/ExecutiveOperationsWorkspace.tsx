import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { OrderCard } from '../../components/orders/OrderCard'
import { formatCurrencyShort } from '../../utils/format'
import { useAuthStore } from '../../store/auth'
import { OrderDetailView } from '../../components/orders/OrderDetailView'
import type { UnifiedOrder } from '../../types/unified-order'
import { lifeSignalService } from '../../services/lifeSignalService'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

type TabFilter = 'all' | 'approved' | 'preparing' | 'prepared' | 'dispatched' | 'delivered'
type DateFilter = 'all' | 'today' | 'yesterday' | 'this_week' | 'this_month' | 'custom'

interface KPIs {
  waiting_preparation: number
  in_preparation: number
  ready_for_dispatch: number
  in_delivery: number
  delivered: number
  uncollected: number
  partially_collected: number
  fully_collected: number
}

interface QueueItem {
  id: string
  order_number: string
  status: string
  delivery_mode: string | null
  payment_method: string | null
  total_amount: number
  revision_number: number
  customer_name: string
  customer_phone: string | null
  governorate: string | null
  created_at: string
  updated_at: string
  submitted_at: string | null
  approved_at: string | null
  current_delivery_status: string | null
  has_collections: boolean
  collected_amount: number
  owner_name: string | null
  created_by_name: string | null
  item_count: number
  customer_owner_name: string | null
  customer_owner_role: string | null
}

const TAB_IDS: TabFilter[] = ['all', 'approved', 'preparing', 'prepared', 'dispatched', 'delivered']
const TAB_LABELS: Record<string, string> = {
  all: 'الكل',
  approved: 'بانتظار التجهيز',
  preparing: 'قيد التجهيز',
  prepared: 'تم التجهيز',
  dispatched: 'قيد التوصيل',
  delivered: 'تم التسليم',
}

const COLORS: Record<string, string> = {
  waiting_preparation: 'from-amber-500 to-amber-700',
  in_preparation: 'from-blue-500 to-blue-700',
  ready_for_dispatch: 'from-teal-500 to-teal-700',
  in_delivery: 'from-indigo-500 to-indigo-700',
  delivered: 'from-emerald-500 to-emerald-700',
  uncollected: 'from-red-500 to-red-700',
  partially_collected: 'from-orange-500 to-orange-700',
  fully_collected: 'from-green-500 to-green-700',
}

const KPI_CONFIG: { key: keyof KPIs; label: string; icon: string; color: string; filterStatus?: string }[] = [
  { key: 'waiting_preparation', label: 'بانتظار التجهيز', icon: '📦', color: COLORS.waiting_preparation, filterStatus: 'approved' },
  { key: 'in_preparation', label: 'جارى التجهيز', icon: '⚙️', color: COLORS.in_preparation, filterStatus: 'preparing' },
  { key: 'ready_for_dispatch', label: 'جاهز للشحن', icon: '🚚', color: COLORS.ready_for_dispatch, filterStatus: 'prepared' },
  { key: 'in_delivery', label: 'لدى التوصيل', icon: '📬', color: COLORS.in_delivery, filterStatus: 'dispatched' },
  { key: 'delivered', label: 'تم التسليم', icon: '✅', color: COLORS.delivered, filterStatus: 'delivered' },
  { key: 'uncollected', label: 'غير محصل', icon: '💰', color: COLORS.uncollected },
  { key: 'partially_collected', label: 'محصل جزئى', icon: '💳', color: COLORS.partially_collected },
  { key: 'fully_collected', label: 'محصل بالكامل', icon: '🏆', color: COLORS.fully_collected },
]

function getDateRange(filter: DateFilter): { from: string | null; to: string | null } {
  const now = new Date()
  const today = now.toISOString().split('T')[0]
  const yesterday = new Date(now.getTime() - 86400000).toISOString().split('T')[0]
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0]
  const monthAgo = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  switch (filter) {
    case 'today': return { from: today, to: today }
    case 'yesterday': return { from: yesterday, to: yesterday }
    case 'this_week': return { from: weekAgo, to: today }
    case 'this_month': return { from: monthAgo, to: today }
    default: return { from: null, to: null }
  }
}

export function ExecutiveOperationsWorkspace() {
  const user = useAuthStore((s) => s.user)
  const [kpis, setKpis] = useState<KPIs | null>(null)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabFilter>('all')
  const [search, setSearch] = useState('')
  const [employeeSearch, setEmployeeSearch] = useState('')
  const [governorateFilter, setGovernorateFilter] = useState('')
  const [deliveryModeFilter, setDeliveryModeFilter] = useState('')
  const [collectionStatusFilter, setCollectionStatusFilter] = useState('')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [governorates, setGovernorates] = useState<string[]>([])
  const [selectedOrder, setSelectedOrder] = useState<QueueItem | null>(null)
  const [orderDetail, setOrderDetail] = useState<UnifiedOrder | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [employees, setEmployees] = useState<{ id: string; code: string; full_name: string }[]>([])
  const [fullScreen, setFullScreen] = useState(false)

  const [deliveryMode, setDeliveryMode] = useState<'internal' | 'external'>('internal')
  const [internalDriver, setInternalDriver] = useState('')
  const [internalVehicle, setInternalVehicle] = useState('')
  const [internalDeparture, setInternalDeparture] = useState('')
  const [internalNotes, setInternalNotes] = useState('')
  const [externalCarrierName, setExternalCarrierName] = useState('')
  const [externalWaybill, setExternalWaybill] = useState('')
  const [externalTrackingUrl, setExternalTrackingUrl] = useState('')
  const [externalDeliveryDate, setExternalDeliveryDate] = useState('')
  const [externalNotes, setExternalNotes] = useState('')
  const [showDispatchModal, setShowDispatchModal] = useState(false)
  const [showCollectionModal, setShowCollectionModal] = useState(false)
  const [collectionMethod, setCollectionMethod] = useState('cash')
  const [collectionAmount, setCollectionAmount] = useState('')
  const [collectionReference, setCollectionReference] = useState('')
  const [collectionNotes, setCollectionNotes] = useState('')
  const [returnReason, setReturnReason] = useState('')
  const [showReturnDialog, setShowReturnDialog] = useState(false)

  const loadData = useCallback(async () => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    try {
      const dr = dateFilter === 'custom' ? { from: dateFrom || null, to: dateTo || null } : getDateRange(dateFilter)
      const [kpiRes, queueRes, empRes] = await Promise.all([
        supabase.rpc('get_governed_executive_kpis', {
          p_token: token, p_date_from: dr.from, p_date_to: dr.to,
        }),
        supabase.rpc('get_governed_executive_queue', {
          p_token: token,
          p_status: activeTab === 'all' ? null : activeTab,
          p_search: search || null,
          p_governorate: governorateFilter || null,
          p_delivery_mode: deliveryModeFilter || null,
          p_date_from: dr.from,
          p_date_to: dr.to,
          p_employee_name: employeeSearch || null,
          p_date_filter: dateFilter === 'all' ? null : dateFilter,
        }),
        supabase.rpc('get_governed_employees', { p_token: token }),
      ])
      if (kpiRes.data && !kpiRes.data.error) setKpis(kpiRes.data as KPIs)
      if (queueRes.data) setQueue(Array.isArray(queueRes.data) ? queueRes.data as QueueItem[] : [])
      const empArr = (empRes.data as any[]) || []
      setEmployees(empArr.filter((e: any) => e.is_active).map((e: any) => ({ id: e.id, code: e.code, full_name: e.full_name || '' })))
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to load data' })
    } finally {
      setLoading(false)
    }
  }, [activeTab, search, employeeSearch, governorateFilter, deliveryModeFilter, collectionStatusFilter, dateFilter, dateFrom, dateTo])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    if (!queue.length) return
    const g = [...new Set(queue.map((o) => o.governorate).filter(Boolean) as string[])]
    setGovernorates(g)
  }, [queue])

  const loadOrderDetail = async (orderId: string) => {
    const token = getToken()
    if (!token) return
    setDetailLoading(true)
    setOrderDetail(null)
    try {
      const { data, error } = await supabase.rpc('get_unified_order', {
        p_token: token, p_id: orderId,
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      setOrderDetail(data as UnifiedOrder)
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to load order' })
    } finally {
      setDetailLoading(false)
    }
  }

  const openOrder = (item: QueueItem) => {
    setSelectedOrder(item)
    setDeliveryMode(item.delivery_mode === 'external' ? 'external' : 'internal')
    setInternalDriver(''); setInternalVehicle(''); setInternalDeparture(''); setInternalNotes('')
    setExternalCarrierName(''); setExternalWaybill(''); setExternalTrackingUrl(''); setExternalDeliveryDate(''); setExternalNotes('')
    setCollectionMethod('cash'); setCollectionAmount(''); setCollectionReference(''); setCollectionNotes('')
    loadOrderDetail(item.id)
    setFullScreen(true)
  }

  const closeOrder = () => {
    setSelectedOrder(null)
    setOrderDetail(null)
    setFullScreen(false)
  }

  const handleStartPrep = async () => {
    if (!selectedOrder) return
    const token = getToken()
    if (!token) return
    try {
      const { data, error } = await supabase.rpc('governed_start_preparation', {
        p_token: token, p_id: selectedOrder.id,
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      setMessage({ type: 'success', text: 'تم بدء التجهيز' })
      loadData(); loadOrderDetail(selectedOrder.id)
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'فشل بدء التجهيز' })
    }
  }

  const handleCompletePrep = async () => {
    if (!orderDetail?.preparation?.id) return
    const token = getToken()
    if (!token) return
    try {
      const { data, error } = await supabase.rpc('governed_complete_preparation', {
        p_token: token, p_preparation_id: orderDetail.preparation.id,
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      setMessage({ type: 'success', text: 'تم إكمال التجهيز' })
      loadData(); loadOrderDetail(selectedOrder!.id)
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'فشل إكمال التجهيز' })
    }
  }

  const handleDispatch = async () => {
    if (!selectedOrder) return
    const token = getToken()
    if (!token) return
    try {
      const params: any = { p_token: token, p_id: selectedOrder.id }
      if (deliveryMode === 'internal') {
        params.p_assigned_to = internalDriver || null
        params.p_vehicle_number = internalVehicle || null
        params.p_departure_date = internalDeparture ? new Date(internalDeparture).toISOString() : null
        params.p_notes = internalNotes || null
      } else {
        params.p_carrier_name = externalCarrierName || null
        params.p_waybill_number = externalWaybill || null
        params.p_tracking_url = externalTrackingUrl || null
        params.p_carrier_delivery_date = externalDeliveryDate ? new Date(externalDeliveryDate).toISOString() : null
        params.p_notes = externalNotes || null
      }
      const { data, error } = await supabase.rpc('governed_dispatch_order', params)
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      setMessage({ type: 'success', text: 'تم شحن الطلب' })
      setShowDispatchModal(false)
      loadData(); loadOrderDetail(selectedOrder.id)
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'فشل شحن الطلب' })
    }
  }

  const handleCompleteDelivery = async () => {
    if (!orderDetail?.current_delivery?.id) return
    const token = getToken()
    if (!token) return
    try {
      const { data, error } = await supabase.rpc('governed_complete_delivery', {
        p_token: token, p_delivery_id: orderDetail.current_delivery.id,
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      setMessage({ type: 'success', text: 'تم تسليم الطلب' })
      loadData(); loadOrderDetail(selectedOrder!.id)
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'فشل تسليم الطلب' })
    }
  }

  const handleCreateCollection = async () => {
    if (!selectedOrder || !orderDetail) return
    const token = getToken()
    if (!token) return
    const amount = parseFloat(collectionAmount)
    if (!amount || amount <= 0) { setMessage({ type: 'error', text: 'المبلغ مطلوب' }); return }
    try {
      const { data, error } = await supabase.rpc('governed_create_collection', {
        p_token: token,
        p_customer_id: orderDetail.order.customer_id,
        p_method: collectionMethod,
        p_amount: amount,
        p_reference_number: collectionReference || null,
        p_notes: collectionNotes || null,
        p_order_id: selectedOrder.id,
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      lifeSignalService.notifyBusiness('collection_created')
      setMessage({ type: 'success', text: 'تم تسجيل التحصيل' })
      setShowCollectionModal(false)
      setCollectionAmount(''); setCollectionReference(''); setCollectionNotes('')
      loadData(); loadOrderDetail(selectedOrder.id)
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'فشل تسجيل التحصيل' })
    }
  }

  const handleApproveCollection = async (collectionId: string) => {
    const token = getToken()
    if (!token) return
    try {
      const { data, error } = await supabase.rpc('governed_approve_collection', {
        p_token: token, p_id: collectionId,
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      setMessage({ type: 'success', text: 'تم اعتماد التحصيل' })
      loadData(); loadOrderDetail(selectedOrder!.id)
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'فشل اعتماد التحصيل' })
    }
  }

  const handleReturnForRevision = async () => {
    if (!selectedOrder || !returnReason.trim()) return
    const token = getToken()
    if (!token) return
    try {
      const { data, error } = await supabase.rpc('governed_return_order_for_revision', {
        p_token: token, p_id: selectedOrder.id, p_reason: returnReason,
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      setMessage({ type: 'success', text: 'تم إعادة الطلب للتعديل' })
      setShowReturnDialog(false); setReturnReason('')
      closeOrder(); loadData()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'فشل إعادة الطلب' })
    }
  }

  const handleKpiClick = (kpi: typeof KPI_CONFIG[0]) => {
    if (kpi.filterStatus) setActiveTab(kpi.filterStatus as TabFilter)
  }

  const getCollectionStatus = (total: number, collected: number): { label: string; color: string } => {
    if (!collected || collected === 0) return { label: 'غير محصل', color: 'bg-red-100 text-red-700' }
    if (collected >= total) return { label: 'محصل بالكامل', color: 'bg-green-100 text-green-700' }
    return { label: 'محصل جزئى', color: 'bg-orange-100 text-orange-700' }
  }

  const filteredQueue = useMemo(() => {
    return queue
      .map((item) => {
        const cs = getCollectionStatus(item.total_amount, item.collected_amount)
        let csKey = 'uncollected'
        if (item.collected_amount >= item.total_amount) csKey = 'fully_collected'
        else if (item.collected_amount > 0) csKey = 'partially_collected'
        return { ...item, _collectionStatusKey: csKey, _collectionBadge: { label: cs.label, className: cs.color } }
      })
      .filter((item) => {
        if (!collectionStatusFilter) return true
        return item._collectionStatusKey === collectionStatusFilter
      })
  }, [queue, collectionStatusFilter])

  if (loading && !kpis) {
    return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  }

  const orderContent = () => (
    <div className="space-y-4 pb-12" dir="rtl">
      <div className="bg-gradient-to-br from-secondary to-[#0F2B5B] text-white rounded-xl p-5">
        <p className="text-sm opacity-90">غرفة العمليات التنفيذية</p>
        <h2 className="text-xl font-bold mt-1">{user?.full_name || 'المشرف التنفيذي'}</h2>
      </div>

      {message && (
        <div className={`p-3 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          <div className="flex items-center justify-between">
            <span>{message.text}</span>
            <button className="text-lg leading-none" onClick={() => setMessage(null)}>&times;</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-border p-3">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {(['all', 'today', 'yesterday', 'this_week', 'this_month', 'custom'] as DateFilter[]).map((df) => (
            <button key={df} onClick={() => setDateFilter(df)}
              className={`whitespace-nowrap px-3 py-1.5 rounded-full text-[10px] font-semibold ${
                dateFilter === df ? 'bg-primary text-white' : 'bg-surface border border-border text-text-secondary'
              }`}>
              {df === 'all' ? 'الكل' : df === 'today' ? 'اليوم' : df === 'yesterday' ? 'أمس' : df === 'this_week' ? 'الأسبوع الحالي' : df === 'this_month' ? 'الشهر الحالي' : 'فترة مخصصة'}
            </button>
          ))}
        </div>
        {dateFilter === 'custom' && (
          <div className="flex gap-2 mt-2">
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="flex-1 border border-border rounded-lg px-2 py-1.5 text-[10px] bg-white" />
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="flex-1 border border-border rounded-lg px-2 py-1.5 text-[10px] bg-white" />
          </div>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2">
        {KPI_CONFIG.map((cfg) => (
          <button key={cfg.key} onClick={() => handleKpiClick(cfg)}
            className={`rounded-xl p-2.5 text-white bg-gradient-to-br ${cfg.color} shadow-sm text-right transition-transform active:scale-95 ${cfg.filterStatus ? 'cursor-pointer' : 'cursor-default'}`}>
            <div className="text-lg">{cfg.icon}</div>
            <div className="text-lg font-bold mt-0.5">{kpis?.[cfg.key] ?? 0}</div>
            <div className="text-[10px] opacity-90 leading-tight mt-0.5">{cfg.label}</div>
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-border p-3">
        <div className="flex items-center gap-2 mb-3">
          <input type="text" placeholder="بحث برقم الطلب أو العميل..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 border border-border rounded-lg px-3 py-2 text-xs bg-surface" />
        </div>
        <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
          {TAB_IDS.map((t) => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`whitespace-nowrap px-3 py-1.5 rounded-full text-[10px] font-semibold ${
                activeTab === t ? 'bg-primary text-white' : 'bg-surface border border-border text-text-secondary'
              }`}>
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <input type="text" placeholder="بحث باسم المندوب..." value={employeeSearch}
            onChange={(e) => setEmployeeSearch(e.target.value)}
            className="w-full border border-border rounded-lg px-2 py-1.5 text-[10px] bg-white" />
          <select value={governorateFilter} onChange={(e) => setGovernorateFilter(e.target.value)}
            className="w-full border border-border rounded-lg px-2 py-1.5 text-[10px] bg-white">
            <option value="">كل المحافظات</option>
            {governorates.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <select value={deliveryModeFilter} onChange={(e) => setDeliveryModeFilter(e.target.value)}
            className="w-full border border-border rounded-lg px-2 py-1.5 text-[10px] bg-white">
            <option value="">كل أنواع الشحن</option>
            <option value="internal">توصيل داخلي</option>
            <option value="external">شركة شحن</option>
          </select>
          <select value={collectionStatusFilter} onChange={(e) => setCollectionStatusFilter(e.target.value)}
            className="w-full border border-border rounded-lg px-2 py-1.5 text-[10px] bg-white">
            <option value="">كل حالات التحصيل</option>
            <option value="uncollected">غير محصل</option>
            <option value="partially_collected">محصل جزئى</option>
            <option value="fully_collected">محصل بالكامل</option>
          </select>
        </div>
        <div className="space-y-1.5 max-h-96 overflow-y-auto">
          {filteredQueue.length === 0 ? (
            <div className="text-center py-8 text-text-secondary text-xs">لا توجد طلبات</div>
          ) : filteredQueue.map((item) => (
            <OrderCard
              key={item.id}
              order={{
                id: item.id,
                order_number: item.order_number,
                status: item.status,
                customer_name: item.customer_name,
                customer_phone: item.customer_phone,
                created_by_name: item.created_by_name,
                customer_owner_name: item.customer_owner_name || undefined,
                customer_owner_role: item.customer_owner_role || undefined,
                total_amount: item.total_amount,
                created_at: item.created_at,
                updated_at: item.updated_at,
                delivery_mode: item.delivery_mode || undefined,
                revision_number: item.revision_number,
                governorate: item.governorate || undefined,
                collection_badge: item._collectionBadge,
              }}
              onClick={() => openOrder(item)}
            />
          ))}
        </div>
      </div>
    </div>
  )

  const orderDetailView = () => {
    if (detailLoading) {
      return <div className="text-center py-12 text-text-secondary text-sm">جاري تحميل بيانات الطلب...</div>
    }
    if (!orderDetail) {
      return <div className="text-center py-12 text-text-secondary text-sm">تعذر تحميل بيانات الطلب</div>
    }

    const st = orderDetail.order.status
    const canDispatch = ['approved', 'preparing', 'prepared'].includes(st)
    const pendingCollections = orderDetail.collections?.filter((c: any) => c.status === 'pending') || []
    const collectedAmount = orderDetail.collections
      ?.filter((c: any) => c.status !== 'pending' && c.amount != null)
      .reduce((s: number, c: any) => s + Number(c.amount), 0) || 0
    const remaining = (selectedOrder?.total_amount || 0) - collectedAmount

    const actions = (
      <div className="flex flex-wrap gap-1">
        {st === 'approved' && (
          <button onClick={handleStartPrep}
            className="bg-accent text-white text-[10px] px-2.5 py-1.5 rounded-lg font-semibold">
            بدء التجهيز
          </button>
        )}
        {st === 'preparing' && orderDetail.preparation?.id && (
          <button onClick={handleCompletePrep}
            className="bg-success text-white text-[10px] px-2.5 py-1.5 rounded-lg font-semibold">
            إكمال التجهيز
          </button>
        )}
        {canDispatch && (
          <button onClick={() => setShowDispatchModal(true)}
            className="bg-primary text-white text-[10px] px-2.5 py-1.5 rounded-lg font-semibold">
            شحن
          </button>
        )}
        {st === 'dispatched' && orderDetail.current_delivery && (
          <button onClick={handleCompleteDelivery}
            className="bg-success text-white text-[10px] px-2.5 py-1.5 rounded-lg font-semibold">
            تسليم
          </button>
        )}
        {st === 'delivered' && (
          <button onClick={() => setShowCollectionModal(true)}
            className="bg-emerald-600 text-white text-[10px] px-2.5 py-1.5 rounded-lg font-semibold">
            تحصيل
          </button>
        )}
        {!['delivered', 'cancelled', 'draft', 'returned_for_revision'].includes(st) && (
          <button onClick={() => setShowReturnDialog(true)}
            className="bg-red-500 text-white text-[10px] px-2.5 py-1.5 rounded-lg font-semibold">
            إعادة للتعديل
          </button>
        )}
      </div>
    )

    return (
      <div className="fixed inset-0 z-50 bg-white overflow-y-auto" dir="rtl">
        <div className="max-w-4xl mx-auto p-4 space-y-4 pb-32">
          <OrderDetailView data={orderDetail} onBack={closeOrder} actions={actions} />

          {/* Collection approval section */}
          {pendingCollections.length > 0 && (
            <div className="bg-white rounded-xl border border-border p-4">
              <h4 className="text-sm font-bold text-text mb-3">💰 تحصيلات معلقة</h4>
              <div className="space-y-2">
                {pendingCollections.map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between bg-amber-50 rounded-lg p-3 border border-amber-200">
                    <div className="text-[13px]">
                      <span className="font-semibold">{c.code}</span>
                      <span className="mx-2 text-text-secondary">|</span>
                      <span>{formatCurrencyShort(Number(c.amount))}</span>
                      <span className="mx-2 text-text-secondary">|</span>
                      <span>{c.method === 'cash' ? 'نقدي' : c.method === 'transfer' ? 'تحويل' : c.method === 'cheque' ? 'شيك' : c.method}</span>
                    </div>
                    <button onClick={() => handleApproveCollection(c.id)}
                      className="bg-emerald-600 text-white text-xs px-4 py-1.5 rounded-lg font-semibold">
                      اعتماد
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Remaining balance */}
          {st === 'delivered' && remaining > 0 && (
            <div className="bg-white rounded-xl border border-border p-4">
              <h4 className="text-sm font-bold text-text mb-3">💰 المتبقي</h4>
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-text-secondary">المطلوب: {formatCurrencyShort(selectedOrder?.total_amount || 0)}</span>
                <span className="text-green-700 font-semibold">المحصل: {formatCurrencyShort(collectedAmount)}</span>
                <span className="text-red-600 font-bold">المتبقي: {formatCurrencyShort(Math.max(remaining, 0))}</span>
              </div>
            </div>
          )}
        </div>

        {/* Dispatch Modal */}
        {showDispatchModal && (
          <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center px-4">
            <div className="bg-white rounded-xl w-full max-w-lg max-h-[calc(100dvh-6rem)] flex flex-col shadow-xl" onClick={e => e.stopPropagation()}>
              <div className="shrink-0 bg-white border-b border-border px-5 py-3 flex items-center justify-between">
                <h3 className="font-bold text-text">شحن الطلب</h3>
                <button onClick={() => setShowDispatchModal(false)} className="text-text-secondary text-2xl leading-none">&times;</button>
              </div>
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                <div className="flex gap-2">
                  <button onClick={() => setDeliveryMode('internal')}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-semibold border ${
                      deliveryMode === 'internal' ? 'bg-primary text-white border-primary' : 'bg-white text-text-secondary border-border'
                    }`}>سيارات الشركة</button>
                  <button onClick={() => setDeliveryMode('external')}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-semibold border ${
                      deliveryMode === 'external' ? 'bg-primary text-white border-primary' : 'bg-white text-text-secondary border-border'
                    }`}>شركات الشحن</button>
                </div>

                {deliveryMode === 'internal' ? (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-text-secondary mb-1">اسم السائق</label>
                      <select value={internalDriver} onChange={(e) => setInternalDriver(e.target.value)}
                        className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white">
                        <option value="">اختر السائق...</option>
                        {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name || e.code}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-text-secondary mb-1">رقم السيارة</label>
                      <input type="text" placeholder="مثال: س ص 1234" value={internalVehicle}
                        onChange={(e) => setInternalVehicle(e.target.value)}
                        className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
                    </div>
                    <div>
                      <label className="block text-xs text-text-secondary mb-1">تاريخ ووقت المغادرة</label>
                      <input type="datetime-local" value={internalDeparture}
                        onChange={(e) => setInternalDeparture(e.target.value)}
                        className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
                    </div>
                    <div>
                      <label className="block text-xs text-text-secondary mb-1">ملاحظات</label>
                      <textarea value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)}
                        className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" rows={2} />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-text-secondary mb-1">اسم شركة الشحن</label>
                      <input type="text" placeholder="اكتب اسم الشركة..." value={externalCarrierName}
                        onChange={(e) => setExternalCarrierName(e.target.value)}
                        className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
                    </div>
                    <div>
                      <label className="block text-xs text-text-secondary mb-1">رقم البوليصة</label>
                      <input type="text" placeholder="رقم البوليصة" value={externalWaybill}
                        onChange={(e) => setExternalWaybill(e.target.value)}
                        className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
                    </div>
                    <div>
                      <label className="block text-xs text-text-secondary mb-1">رابط التتبع</label>
                      <input type="text" placeholder="https://..." value={externalTrackingUrl}
                        onChange={(e) => setExternalTrackingUrl(e.target.value)}
                        className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
                    </div>
                    <div>
                      <label className="block text-xs text-text-secondary mb-1">تاريخ التسليم لشركة الشحن</label>
                      <input type="datetime-local" value={externalDeliveryDate}
                        onChange={(e) => setExternalDeliveryDate(e.target.value)}
                        className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
                    </div>
                    <div>
                      <label className="block text-xs text-text-secondary mb-1">ملاحظات</label>
                      <textarea value={externalNotes} onChange={(e) => setExternalNotes(e.target.value)}
                        className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" rows={2} />
                    </div>
                  </div>
                )}

                <button onClick={handleDispatch}
                  disabled={deliveryMode === 'internal' ? !internalDriver : !externalCarrierName}
                  className="w-full bg-success text-white rounded-xl py-3 text-sm font-bold disabled:opacity-40">
                  {deliveryMode === 'internal' ? 'تأكيد الشحن' : 'تأكيد الشحن لشركة الشحن'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Collection Modal */}
        {showCollectionModal && (
          <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center px-4">
            <div className="bg-white rounded-xl w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
              <div className="border-b border-border px-5 py-3 flex items-center justify-between">
                <h3 className="font-bold text-text">تسجيل تحصيل</h3>
                <button onClick={() => setShowCollectionModal(false)} className="text-text-secondary text-2xl leading-none">&times;</button>
              </div>
              <div className="p-5 space-y-3">
                <div>
                  <label className="block text-xs text-text-secondary mb-1">طريقة الدفع</label>
                  <select value={collectionMethod} onChange={(e) => setCollectionMethod(e.target.value)}
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white">
                    <option value="cash">نقدي</option>
                    <option value="transfer">تحويل بنكي</option>
                    <option value="cheque">شيك</option>
                    <option value="credit_card">بطاقة ائتمان</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-text-secondary mb-1">المبلغ</label>
                  <input type="number" step="0.01" min="0" placeholder="0.00" value={collectionAmount}
                    onChange={(e) => setCollectionAmount(e.target.value)}
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
                </div>
                <div>
                  <label className="block text-xs text-text-secondary mb-1">رقم المرجع (اختياري)</label>
                  <input type="text" placeholder="رقم الإذن أو التحويل" value={collectionReference}
                    onChange={(e) => setCollectionReference(e.target.value)}
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
                </div>
                <div>
                  <label className="block text-xs text-text-secondary mb-1">ملاحظات (اختياري)</label>
                  <textarea value={collectionNotes} onChange={(e) => setCollectionNotes(e.target.value)}
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" rows={2} />
                </div>
                <button onClick={handleCreateCollection}
                  disabled={!collectionAmount || parseFloat(collectionAmount) <= 0}
                  className="w-full bg-emerald-600 text-white rounded-xl py-3 text-sm font-bold disabled:opacity-40">
                  تسجيل التحصيل
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Return for Revision Dialog */}
        {showReturnDialog && (
          <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center px-4">
            <div className="bg-white rounded-xl w-full max-w-sm shadow-xl">
              <div className="border-b border-border px-5 py-3">
                <h3 className="font-bold text-text">إعادة الطلب للتعديل</h3>
              </div>
              <div className="p-5 space-y-3">
                <textarea placeholder="سبب الإعادة (مطلوب)" value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  className="w-full border border-border rounded-lg p-3 text-sm bg-white" rows={3} />
                <div className="flex gap-2">
                  <button onClick={() => { setShowReturnDialog(false); setReturnReason('') }}
                    className="flex-1 bg-surface text-text rounded-xl py-2.5 text-sm">إلغاء</button>
                  <button onClick={handleReturnForRevision} disabled={!returnReason.trim()}
                    className="flex-1 bg-red-600 text-white rounded-xl py-2.5 text-sm disabled:opacity-40">تأكيد</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      {fullScreen ? orderDetailView() : orderContent()}
    </>
  )
}
