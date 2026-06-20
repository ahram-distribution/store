import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { formatCurrencyShort } from '../../utils/format'
import { useAuthStore } from '../../store/auth'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

type TabFilter = 'all' | 'approved' | 'preparing' | 'prepared' | 'dispatched' | 'delivered'

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
  customer_name: string
  customer_phone: string | null
  governorate: string | null
  created_at: string
  updated_at: string
  current_delivery_status: string | null
  has_collections: boolean
  collected_amount: number
}

interface FullOrder {
  order: any
  customer: any
  items: any[]
  status_history: any[]
  current_delivery: any
  delivery_history: any[]
  collections: any[]
  returns: any[]
  preparation: any
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

const KPI_CONFIG: { key: keyof KPIs; label: string; icon: string; color: string }[] = [
  { key: 'waiting_preparation', label: 'بانتظار التجهيز', icon: '📦', color: COLORS.waiting_preparation },
  { key: 'in_preparation', label: 'جارى التجهيز', icon: '⚙️', color: COLORS.in_preparation },
  { key: 'ready_for_dispatch', label: 'جاهز للشحن', icon: '🚚', color: COLORS.ready_for_dispatch },
  { key: 'in_delivery', label: 'لدى التوصيل', icon: '📬', color: COLORS.in_delivery },
  { key: 'delivered', label: 'تم التسليم', icon: '✅', color: COLORS.delivered },
  { key: 'uncollected', label: 'غير محصل', icon: '💰', color: COLORS.uncollected },
  { key: 'partially_collected', label: 'محصل جزئى', icon: '💳', color: COLORS.partially_collected },
  { key: 'fully_collected', label: 'محصل بالكامل', icon: '🏆', color: COLORS.fully_collected },
]

export function ExecutiveOperationsWorkspace() {
  const user = useAuthStore((s) => s.user)
  const [kpis, setKpis] = useState<KPIs | null>(null)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabFilter>('all')
  const [search, setSearch] = useState('')
  const [governorateFilter, setGovernorateFilter] = useState('')
  const [deliveryModeFilter, setDeliveryModeFilter] = useState('')
  const [governorates, setGovernorates] = useState<string[]>([])
  const [selectedOrder, setSelectedOrder] = useState<QueueItem | null>(null)
  const [orderDetail, setOrderDetail] = useState<FullOrder | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [employees, setEmployees] = useState<{ id: string; code: string; full_name: string }[]>([])
  const [carriers, setCarriers] = useState<{ id: string; name: string }[]>([])

  const [deliveryMode, setDeliveryMode] = useState<'internal' | 'external'>('internal')
  const [internalDriver, setInternalDriver] = useState('')
  const [internalVehicle, setInternalVehicle] = useState('')
  const [internalNotes, setInternalNotes] = useState('')
  const [externalCarrier, setExternalCarrier] = useState('')
  const [externalWaybill, setExternalWaybill] = useState('')
  const [externalTrackingUrl, setExternalTrackingUrl] = useState('')
  const [externalNotes, setExternalNotes] = useState('')
  const [returnReason, setReturnReason] = useState('')
  const [showReturnDialog, setShowReturnDialog] = useState(false)

  const loadData = useCallback(async () => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    try {
      const [kpiRes, queueRes, empRes, carrierRes] = await Promise.all([
        supabase.rpc('get_governed_executive_kpis', { p_token: token }),
        supabase.rpc('get_governed_executive_queue', {
          p_token: token,
          p_status: activeTab === 'all' ? null : activeTab,
          p_search: search || null,
          p_governorate: governorateFilter || null,
          p_delivery_mode: deliveryModeFilter || null,
        }),
        supabase.rpc('get_governed_employees', { p_token: token }),
        supabase.rpc('get_governed_external_carriers', { p_token: token }),
      ])

      if (kpiRes.data && !kpiRes.data.error) setKpis(kpiRes.data as KPIs)
      if (queueRes.data) setQueue(Array.isArray(queueRes.data) ? queueRes.data as QueueItem[] : [])

      const empArr = (empRes.data as any[]) || []
      setEmployees(empArr.filter((e: any) => e.is_active).map((e: any) => ({ id: e.id, code: e.code, full_name: e.full_name || '' })))

      setCarriers((carrierRes.data as any[]) || [])
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to load data' })
    } finally {
      setLoading(false)
    }
  }, [activeTab, search, governorateFilter, deliveryModeFilter])

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
        p_token: token,
        p_id: orderId,
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      setOrderDetail(data as FullOrder)
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to load order' })
    } finally {
      setDetailLoading(false)
    }
  }

  const openOrder = (item: QueueItem) => {
    setSelectedOrder(item)
    setDeliveryMode(item.delivery_mode === 'external' ? 'external' : 'internal')
    setInternalDriver(''); setInternalVehicle(''); setInternalNotes('')
    setExternalCarrier(''); setExternalWaybill(''); setExternalTrackingUrl(''); setExternalNotes('')
    loadOrderDetail(item.id)
  }

  const closeOrder = () => {
    setSelectedOrder(null)
    setOrderDetail(null)
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
      loadData()
      loadOrderDetail(selectedOrder.id)
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
      loadData()
      loadOrderDetail(selectedOrder!.id)
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'فشل إكمال التجهيز' })
    }
  }

  const handleDispatch = async () => {
    if (!selectedOrder) return
    const token = getToken()
    if (!token) return
    try {
      const params: any = {
        p_token: token,
        p_id: selectedOrder.id,
        p_assigned_to: deliveryMode === 'internal' ? internalDriver || null : null,
        p_external_carrier_id: deliveryMode === 'external' ? externalCarrier || null : null,
        p_waybill_number: deliveryMode === 'external' ? externalWaybill || null : null,
        p_tracking_url: deliveryMode === 'external' ? externalTrackingUrl || null : null,
      }
      const { data, error } = await supabase.rpc('governed_dispatch_order', params)
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      setMessage({ type: 'success', text: 'تم شحن الطلب' })
      loadData()
      loadOrderDetail(selectedOrder.id)
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
      loadData()
      loadOrderDetail(selectedOrder!.id)
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'فشل تسليم الطلب' })
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
      setShowReturnDialog(false)
      setReturnReason('')
      closeOrder()
      loadData()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'فشل إعادة الطلب' })
    }
  }

  const getCollectionStatus = (total: number, collected: number): { label: string; color: string } => {
    if (!collected || collected === 0) return { label: 'غير محصل', color: 'bg-red-100 text-red-700' }
    if (collected >= total) return { label: 'محصل بالكامل', color: 'bg-green-100 text-green-700' }
    return { label: 'محصل جزئى', color: 'bg-orange-100 text-orange-700' }
  }

  if (loading && !kpis) {
    return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  }

  return (
    <div className="space-y-4 pb-12" dir="rtl">
      {/* Header */}
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

      {/* Section 1 — Executive KPIs */}
      <div className="grid grid-cols-4 gap-2">
        {KPI_CONFIG.map((cfg) => (
          <div key={cfg.key} className={`rounded-xl p-2.5 text-white bg-gradient-to-br ${cfg.color} shadow-sm`}>
            <div className="text-lg">{cfg.icon}</div>
            <div className="text-lg font-bold mt-0.5">{kpis?.[cfg.key] ?? 0}</div>
            <div className="text-[10px] opacity-90 leading-tight mt-0.5">{cfg.label}</div>
          </div>
        ))}
      </div>

      {/* Section 2 — Operational Queue */}
      <div className="bg-white rounded-xl border border-border p-3">
        <div className="flex items-center gap-2 mb-3">
          <input
            type="text"
            placeholder="بحث برقم الطلب أو العميل..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 border border-border rounded-lg px-3 py-2 text-xs bg-surface"
          />
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

        <div className="flex gap-2 mb-3">
          <select value={governorateFilter} onChange={(e) => setGovernorateFilter(e.target.value)}
            className="flex-1 border border-border rounded-lg px-2 py-1.5 text-[10px] bg-white">
            <option value="">كل المحافظات</option>
            {governorates.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <select value={deliveryModeFilter} onChange={(e) => setDeliveryModeFilter(e.target.value)}
            className="flex-1 border border-border rounded-lg px-2 py-1.5 text-[10px] bg-white">
            <option value="">كل أنواع الشحن</option>
            <option value="internal">توصيل داخلي</option>
            <option value="external">شركة شحن</option>
          </select>
        </div>

        <div className="space-y-1.5 max-h-80 overflow-y-auto">
          {queue.length === 0 ? (
            <div className="text-center py-8 text-text-secondary text-xs">لا توجد طلبات</div>
          ) : queue.map((item) => {
            const collStatus = getCollectionStatus(item.total_amount, item.collected_amount)
            return (
              <button key={item.id} onClick={() => openOrder(item)}
                className={`w-full text-right bg-white rounded-lg border p-2.5 transition-colors hover:bg-surface ${
                  selectedOrder?.id === item.id ? 'border-primary ring-1 ring-primary' : 'border-border'
                }`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-text">{item.order_number}</span>
                  <StatusBadge status={item.status} size="sm" />
                </div>
                <div className="text-[10px] text-text-secondary space-y-0.5">
                  <span>{item.customer_name}</span>
                  {item.governorate && <span className="mr-2">• {item.governorate}</span>}
                </div>
                <div className="flex items-center justify-between mt-1 text-[10px]">
                  <span className="font-semibold text-text">{formatCurrencyShort(item.total_amount)}</span>
                  <span className={`px-1.5 py-0.5 rounded ${collStatus.color}`}>{collStatus.label}</span>
                </div>
                <div className="text-[9px] text-text-secondary mt-0.5">
                  {new Date(item.updated_at || item.created_at).toLocaleDateString('ar-EG-u-nu-latn')}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Section 3 — Order Command Panel */}
      {selectedOrder && (
        <div className="bg-white rounded-xl border border-border p-3 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-text">{selectedOrder.order_number}</h3>
            <button onClick={closeOrder} className="text-text-secondary text-lg leading-none">&times;</button>
          </div>

          {detailLoading ? (
            <div className="text-center py-4 text-text-secondary text-xs">جاري تحميل بيانات الطلب...</div>
          ) : orderDetail ? (
            <>
              {/* Customer Block */}
              <div className="bg-surface rounded-lg p-3">
                <h4 className="text-xs font-bold text-text mb-2">👤 بيانات العميل</h4>
                <div className="text-[11px] space-y-1">
                  <p><span className="text-text-secondary">الاسم: </span>{orderDetail.order.snapshot_customer_name || orderDetail.customer?.company_name || '-'}</p>
                  <p><span className="text-text-secondary">الهاتف: </span>{orderDetail.order.snapshot_customer_phone || orderDetail.customer?.phone || '-'}</p>
                  <p><span className="text-text-secondary">العنوان: </span>{orderDetail.order.snapshot_customer_address || `${orderDetail.customer?.address_line1 || ''} ${orderDetail.customer?.city || ''} ${orderDetail.customer?.governorate || ''}` || '-'}</p>
                </div>
                <div className="flex gap-2 mt-2">
                  {orderDetail.customer?.address_latitude && orderDetail.customer?.address_longitude && (
                    <>
                      <a href={`https://maps.google.com/?q=${orderDetail.customer.address_latitude},${orderDetail.customer.address_longitude}`}
                        target="_blank" rel="noopener noreferrer"
                        className="flex-1 bg-primary text-white text-[10px] py-1.5 rounded-lg text-center">
                        🗺️ فتح الخريطة
                      </a>
                      <button onClick={() => {
                        navigator.clipboard.writeText(`https://maps.google.com/?q=${orderDetail.customer.address_latitude},${orderDetail.customer.address_longitude}`)
                        setMessage({ type: 'success', text: 'تم نسخ الرابط' })
                      }}
                        className="flex-1 bg-surface text-text border border-border text-[10px] py-1.5 rounded-lg text-center">
                        📋 نسخ الرابط
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Ownership Block */}
              <div className="bg-surface rounded-lg p-3">
                <h4 className="text-xs font-bold text-text mb-2">👥 الملكية</h4>
                <div className="text-[11px] space-y-1">
                  <p><span className="text-text-secondary">مالك العميل: </span>{orderDetail.order.customer_owner_name || '-'}</p>
                  <p><span className="text-text-secondary">منشئ الطلب: </span>{orderDetail.order.order_creator_name || '-'}</p>
                  <p><span className="text-text-secondary">رقم المراجعة: </span>{orderDetail.order.revision_number || 0}</p>
                </div>
              </div>

              {/* Delivery Mode Decision */}
              {['approved', 'prepared'].includes(orderDetail.order.status) && (
                <div className="bg-surface rounded-lg p-3">
                  <h4 className="text-xs font-bold text-text mb-2">🚚 نوع الشحن</h4>
                  <div className="flex gap-2 mb-3">
                    <button onClick={() => setDeliveryMode('internal')}
                      className={`flex-1 py-2 rounded-lg text-[11px] font-semibold border ${
                        deliveryMode === 'internal' ? 'bg-primary text-white border-primary' : 'bg-white text-text-secondary border-border'
                      }`}>
                      توصيل داخلي
                    </button>
                    <button onClick={() => setDeliveryMode('external')}
                      className={`flex-1 py-2 rounded-lg text-[11px] font-semibold border ${
                        deliveryMode === 'external' ? 'bg-primary text-white border-primary' : 'bg-white text-text-secondary border-border'
                      }`}>
                      شركة شحن
                    </button>
                  </div>

                  {deliveryMode === 'internal' ? (
                    <div className="space-y-2">
                      <select value={internalDriver} onChange={(e) => setInternalDriver(e.target.value)}
                        className="w-full border border-border rounded-lg px-3 py-2 text-[11px] bg-white">
                        <option value="">اختر السائق...</option>
                        {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name || e.code}</option>)}
                      </select>
                      <input type="text" placeholder="رقم السيارة" value={internalVehicle}
                        onChange={(e) => setInternalVehicle(e.target.value)}
                        className="w-full border border-border rounded-lg px-3 py-2 text-[11px] bg-white" />
                      <textarea placeholder="ملاحظات" value={internalNotes}
                        onChange={(e) => setInternalNotes(e.target.value)}
                        className="w-full border border-border rounded-lg px-3 py-2 text-[11px] bg-white" rows={2} />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <select value={externalCarrier} onChange={(e) => setExternalCarrier(e.target.value)}
                        className="w-full border border-border rounded-lg px-3 py-2 text-[11px] bg-white">
                        <option value="">اختر شركة الشحن...</option>
                        {carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <input type="text" placeholder="رقم البوليصة" value={externalWaybill}
                        onChange={(e) => setExternalWaybill(e.target.value)}
                        className="w-full border border-border rounded-lg px-3 py-2 text-[11px] bg-white" />
                      <input type="text" placeholder="رابط التتبع" value={externalTrackingUrl}
                        onChange={(e) => setExternalTrackingUrl(e.target.value)}
                        className="w-full border border-border rounded-lg px-3 py-2 text-[11px] bg-white" />
                      <textarea placeholder="ملاحظات" value={externalNotes}
                        onChange={(e) => setExternalNotes(e.target.value)}
                        className="w-full border border-border rounded-lg px-3 py-2 text-[11px] bg-white" rows={2} />
                    </div>
                  )}

                  <button onClick={handleDispatch}
                    disabled={deliveryMode === 'internal' ? !internalDriver : !externalCarrier}
                    className="w-full mt-3 bg-success text-white rounded-lg py-2.5 text-xs font-bold disabled:opacity-40">
                    تأكيد الشحن
                  </button>
                </div>
              )}

              {/* Delivery Info (when already dispatched) */}
              {orderDetail.current_delivery && ['dispatched'].includes(orderDetail.order.status) && (
                <div className="bg-surface rounded-lg p-3">
                  <h4 className="text-xs font-bold text-text mb-2">🚚 معلومات الشحن</h4>
                  <div className="text-[11px] space-y-1">
                    <p><span className="text-text-secondary">النوع: </span>{orderDetail.order.delivery_mode === 'external' ? 'شركة شحن' : 'توصيل داخلي'}</p>
                    {orderDetail.current_delivery.assigned_to_name && (
                      <p><span className="text-text-secondary">السائق: </span>{orderDetail.current_delivery.assigned_to_name}</p>
                    )}
                    {orderDetail.current_delivery.external_carrier_name && (
                      <p><span className="text-text-secondary">شركة الشحن: </span>{orderDetail.current_delivery.external_carrier_name}</p>
                    )}
                    {orderDetail.current_delivery.waybill_number && (
                      <p><span className="text-text-secondary">البوليصة: </span>{orderDetail.current_delivery.waybill_number}</p>
                    )}
                    {orderDetail.current_delivery.tracking_url && (
                      <p><a href={orderDetail.current_delivery.tracking_url} target="_blank" rel="noopener noreferrer"
                        className="text-primary underline">رابط التتبع</a></p>
                    )}
                    <p><span className="text-text-secondary">الحالة: </span>
                      <StatusBadge status={orderDetail.current_delivery.status} size="sm" /></p>
                  </div>
                  <button onClick={handleCompleteDelivery}
                    className="w-full mt-3 bg-success text-white rounded-lg py-2.5 text-xs font-bold">
                    تسجيل التسليم
                  </button>
                </div>
              )}

              {/* Collections Panel */}
              <div className="bg-surface rounded-lg p-3">
                <h4 className="text-xs font-bold text-text mb-2">💰 التحصيل</h4>
                {(() => {
                  const total = selectedOrder.total_amount
                  const collected = orderDetail.collections
                    ?.filter((c: any) => c.status !== 'pending')
                    .reduce((s: number, c: any) => s + Number(c.amount), 0) || 0
                  const remaining = total - collected
                  const collStatus = getCollectionStatus(total, collected)
                  return (
                    <div className="space-y-1 text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="text-text-secondary">الحالة:</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] ${collStatus.color}`}>{collStatus.label}</span>
                      </div>
                      <p><span className="text-text-secondary">المطلوب: </span>{formatCurrencyShort(total)}</p>
                      <p><span className="text-text-secondary">المحصل: </span>{formatCurrencyShort(collected)}</p>
                      {remaining > 0 && <p><span className="text-text-secondary">المتبقى: </span>{formatCurrencyShort(remaining)}</p>}
                    </div>
                  )
                })()}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-2">
                {orderDetail.order.status === 'approved' && (
                  <button onClick={handleStartPrep}
                    className="flex-1 min-w-[100px] bg-accent text-white rounded-lg py-2.5 text-xs font-bold">
                    بدء التجهيز
                  </button>
                )}
                {orderDetail.order.status === 'preparing' && orderDetail.preparation?.id && (
                  <button onClick={handleCompletePrep}
                    className="flex-1 min-w-[100px] bg-success text-white rounded-lg py-2.5 text-xs font-bold">
                    إكمال التجهيز
                  </button>
                )}
                {orderDetail.order.status === 'delivered' && (
                  <StatusBadge status="delivered" size="md" />
                )}
                {!['delivered', 'cancelled', 'draft'].includes(orderDetail.order.status) && (
                  <button onClick={() => setShowReturnDialog(true)}
                    className="flex-1 min-w-[100px] bg-red-500 text-white rounded-lg py-2.5 text-xs font-bold">
                    إعادة للتعديل
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="text-center py-4 text-text-secondary text-xs">تعذر تحميل بيانات الطلب</div>
          )}
        </div>
      )}

      {/* Return for Revision Dialog */}
      {showReturnDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl p-5 w-full max-w-sm shadow-xl">
            <h3 className="font-bold text-text mb-3 text-sm">إعادة الطلب للتعديل</h3>
            <textarea placeholder="سبب الإعادة (مطلوب)" value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              className="w-full border border-border rounded-lg p-2 text-sm mb-3" rows={3} />
            <div className="flex gap-2">
              <button onClick={() => { setShowReturnDialog(false); setReturnReason('') }}
                className="flex-1 bg-surface text-text rounded-xl py-2 text-sm">إلغاء</button>
              <button onClick={handleReturnForRevision} disabled={!returnReason.trim()}
                className="flex-1 bg-red-600 text-white rounded-xl py-2 text-sm disabled:opacity-40">تأكيد</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
