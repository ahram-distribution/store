import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase'
import { MapButton } from '../../components/shared/MapButton'
import { ResolvedAddress } from '../../components/shared/ResolvedAddress'
import { DeliveryJourney } from './DeliveryJourney'
import {
  getToken, DELIVERY_STEP_LABELS, deliveryStepLabel,
  isDeliveryCompleted, fmtAmount, fmtTime, hasCoords, computeJourneyDistances, formatDistanceHuman,
} from './shared'

interface ShippingDetail {
  delivery: {
    id: string
    order_id: string
    status: string
    delivery_step: string | null
    collection_required: boolean | null
    rep_name: string | null
    driver_name: string | null
    assigned_at: string | null
    started_at: string | null
    completed_at: string | null
    returned_at: string | null
    attempt_number: number
    notes: string | null
  }
  order: {
    id: string
    order_number: string
    status: string
    total_amount: string | number
    invoice_number: string | null
    invoice_total: string | number | null
    payment_method: string
    discount_amount: string | number | null
    created_at: string
    delivery_mode: string | null
    owner_name: string
    owner_phone: string
  }
  customer: {
    name: string
    phone: string
    address: string
    latitude: string | number | null
    longitude: string | number | null
  }
  items: Array<{
    product_name: string
    unit_type: string | null
    unit_quantity: number
    piece_quantity: number
    unit_price: string | number
    total_price: string | number
  }>
  actions: Array<{
    action: string
    employee_name: string
    amount: string | number | null
    latitude: string | number | null
    longitude: string | number | null
    captured_at: string | null
    created_at: string | null
  }>
  collection: {
    id: string
    code: string
    status: string
    amount: string | number
    collected_at: string | null
    approved_at: string | null
    collected_by_name: string
  } | null
  last_location: {
    latitude: string | number | null
    longitude: string | number | null
    at: string | null
    source: string | null
  } | null
}

interface CrewEmp { id: string; code: string; full_name: string; role_names: string }

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'نقدي',
  credit: 'آجل',
  ittiman: 'ائتمان',
}

export function ShippingOrderDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<ShippingDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [emps, setEmps] = useState<CrewEmp[]>([])
  const [repId, setRepId] = useState('')
  const [driverId, setDriverId] = useState('')
  const [showCrewForm, setShowCrewForm] = useState(false)
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceTotal, setInvoiceTotal] = useState('')

  const load = useCallback(async () => {
    const token = getToken()
    if (!token || !id) { setLoading(false); return }
    setLoading(true)
    const { data, error } = await supabase.rpc('governed_get_shipping_order', { p_token: token, p_delivery_id: id })
    if (error) { toast.error(error.message); setLoading(false); return }
    const res = data as ShippingDetail & { error?: string }
    if (res?.error) { toast.error(res.error); setLoading(false); return }
    setDetail(res)
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  const loadEmps = useCallback(async () => {
    const token = getToken()
    if (!token) return
    const { data } = await supabase.rpc('get_governed_employees', { p_token: token })
    if (Array.isArray(data)) {
      const crew = (data as Array<{ id: string; code: string; full_name: string; role_names?: string; is_active?: boolean }>)
        .filter((e) => e.is_active !== false)
        .filter((e) => {
          const names = (e.role_names || '')
          return names.includes('مندوب توصيل') || names.includes('سائق')
        })
        .map((e) => ({ id: e.id, code: e.code, full_name: e.full_name, role_names: e.role_names || '' }))
      setEmps(crew)
    }
  }, [])

  useEffect(() => { loadEmps() }, [loadEmps])

  useEffect(() => {
    if (!detail) return
    const rep = emps.find((e) => e.full_name === detail.delivery.rep_name)
    const drv = emps.find((e) => e.full_name === detail.delivery.driver_name)
    setRepId(rep?.id || '')
    setDriverId(drv?.id || '')
  }, [detail?.delivery?.id, emps]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!detail) return
    setInvoiceNumber(detail.order.invoice_number || '')
    setInvoiceTotal(detail.order.invoice_total != null ? String(detail.order.invoice_total) : '')
  }, [detail?.order?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const repOptions = emps.filter((e) => e.role_names.includes('مندوب توصيل'))
  const driverOptions = emps.filter((e) => e.role_names.includes('سائق'))
  const currentRepOpt = detail && repId && detail.delivery.rep_name && !repOptions.some((o) => o.id === repId)
    ? [{ id: repId, full_name: detail.delivery.rep_name, code: '', role_names: 'مندوب توصيل' }]
    : []
  const currentDriverOpt = detail && driverId && detail.delivery.driver_name && !driverOptions.some((o) => o.id === driverId)
    ? [{ id: driverId, full_name: detail.delivery.driver_name, code: '', role_names: 'سائق' }]
    : []

  const saveCrew = async () => {
    const token = getToken()
    if (!token || !detail) return
    setBusy(true)
    const { data, error } = await supabase.rpc('governed_assign_delivery_crew', {
      p_token: token,
      p_delivery_id: detail.delivery.id,
      p_rep_id: repId || null,
      p_driver_id: driverId || null,
    })
    setBusy(false)
    if (error) { toast.error(error.message); return }
    const res = data as { error?: string }
    if (res?.error) { toast.error(res.error); return }
    toast.success('تم حفظ فريق التوصيل')
    setShowCrewForm(false)
    load()
  }

  const reconcile = async () => {
    const token = getToken()
    if (!token || !detail?.collection) return
    setBusy(true)
    const { data, error } = await supabase.rpc('governed_reconcile_delivery_collection', {
      p_token: token,
      p_collection_id: detail.collection.id,
    })
    setBusy(false)
    if (error) { toast.error(error.message); return }
    const res = data as { error?: string }
    if (res?.error) { toast.error(res.error); return }
    toast.success('تم اعتماد التحصيل')
    load()
  }

  const setCollectionRequired = async (value: boolean) => {
    const token = getToken()
    if (!token || !detail) return
    setBusy(true)
    const { data, error } = await supabase.rpc('governed_set_delivery_collection_required', {
      p_token: token,
      p_delivery_id: detail.delivery.id,
      p_collection_required: value,
    })
    setBusy(false)
    if (error) { toast.error(error.message); return }
    const res = data as { error?: string }
    if (res?.error) { toast.error(res.error); return }
    toast.success(value ? 'تم حفظ: مطلوب التحصيل' : 'تم حفظ: بدون تحصيل')
    load()
  }

  const saveInvoice = async () => {
    const token = getToken()
    if (!token || !detail) return
    setBusy(true)
    const { data, error } = await supabase.rpc('governed_update_order_invoice', {
      p_token: token,
      p_order_id: detail.order.id,
      p_invoice_number: invoiceNumber.trim() || null,
      p_invoice_total: invoiceTotal === '' ? null : Number(invoiceTotal),
    })
    setBusy(false)
    if (error) { toast.error(error.message); return }
    const res = data as { error?: string }
    if (res?.error) { toast.error(res.error); return }
    toast.success('تم حفظ بيانات الفاتورة')
    load()
  }

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  if (!detail) return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/shipping')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">تفاصيل الشحن</h1>
      </div>
      <p className="text-center text-text-secondary text-sm py-8">لم يتم العثور على الشحنة</p>
    </div>
  )

  const allDone = isDeliveryCompleted(detail.delivery.delivery_step)
  const customerNotFound = detail.delivery.delivery_step === 'customer_not_found'
    || detail.actions.some((a) => a.action === 'customer_not_found')
  const custLoc = hasCoords(detail.customer.latitude, detail.customer.longitude)
    ? { lat: Number(detail.customer.latitude), lng: Number(detail.customer.longitude) }
    : null
  const { segments, totalMeters } = computeJourneyDistances(detail.actions)

  const collectionMode = detail.delivery.collection_required === false ? 'without' : 'required'

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/shipping')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">تفاصيل الشحن</h1>
      </div>

      {/* A. ملخص الطلب */}
      <div className="bg-gradient-to-br from-primary to-blue-900 text-white rounded-xl p-5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-sm opacity-90">الطلب {detail.order.order_number}</p>
          {allDone && <span className="text-[11px] px-2 py-1 rounded-full bg-emerald-500/30 text-emerald-50">✓ مكتملة</span>}
        </div>
        <h2 className="text-xl font-bold mt-1">{detail.customer.name}</h2>
        <p className="text-sm mt-1 font-semibold">{fmtAmount(detail.order.invoice_total ?? detail.order.total_amount)}</p>
        {detail.order.invoice_number && (
          <p className="text-[11px] mt-1 opacity-90">فاتورة رقم: {detail.order.invoice_number}</p>
        )}
        <span className="inline-block mt-2 text-xs px-2 py-1 rounded-full bg-white/20">{deliveryStepLabel(detail.delivery.delivery_step)}</span>
      </div>

      <div className="bg-white rounded-xl border border-border p-4 space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-secondary">رقم الطلب</span>
          <span className="text-sm font-semibold text-text">{detail.order.order_number}</span>
        </div>
        {detail.customer.phone && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">هاتف العميل</span>
            <span className="text-sm font-semibold text-text" dir="ltr">{detail.customer.phone}</span>
          </div>
        )}
        {detail.customer.address && (
          <div className="flex items-start justify-between gap-3">
            <span className="text-xs text-text-secondary shrink-0">العنوان</span>
            <span className="text-xs text-text text-right">{detail.customer.address}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-secondary">طريقة الدفع</span>
          <span className="text-sm font-semibold text-text">{PAYMENT_LABELS[detail.order.payment_method] || detail.order.payment_method}</span>
        </div>
        {Number(detail.order.discount_amount || 0) > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">الخصم</span>
            <span className="text-sm font-semibold text-text">{fmtAmount(detail.order.discount_amount)}</span>
          </div>
        )}
        {detail.order.owner_name && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">مندوب المبيعات</span>
            <span className="text-sm font-semibold text-text">{detail.order.owner_name}</span>
          </div>
        )}
        {detail.order.delivery_mode && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">نوع الشحن</span>
            <span className="text-sm font-semibold text-text">{detail.order.delivery_mode === 'external' ? 'خارجي' : 'داخلي'}</span>
          </div>
        )}
        {custLoc && (
          <div className="pt-1"><MapButton latitude={custLoc.lat} longitude={custLoc.lng} size="sm" /></div>
        )}
      </div>

      {/* A2. بيانات الفاتورة */}
      <div className="bg-white rounded-xl border border-border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-text">بيانات الفاتورة</p>
          <span className="text-[11px] text-text-secondary">متاحة للتعديل</span>
        </div>
        <div>
          <label className="text-xs text-text-secondary">رقم الفاتورة</label>
          <input
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            placeholder="مثال: INV-2026-0001"
            className="w-full mt-1 border border-border rounded-lg px-2 py-1.5 text-sm bg-white text-text"
          />
        </div>
        <div>
          <label className="text-xs text-text-secondary">إجمالي الفاتورة (ج.م)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={invoiceTotal}
            onChange={(e) => setInvoiceTotal(e.target.value)}
            placeholder={String(detail.order.total_amount)}
            className="w-full mt-1 border border-border rounded-lg px-2 py-1.5 text-sm bg-white text-text"
          />
        </div>
        <button
          onClick={saveInvoice}
          disabled={busy}
          className="w-full bg-primary text-white rounded-xl p-2.5 text-sm font-semibold disabled:opacity-50"
        >
          {busy ? 'جاري الحفظ...' : 'حفظ بيانات الفاتورة'}
        </button>
      </div>

      {/* B. فريق التوصيل */}
      <div className="bg-white rounded-xl border border-border p-4 space-y-3">
        <p className="text-sm font-bold text-text">فريق التوصيل</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-border bg-surface/40 p-3">
            <p className="text-[11px] text-text-secondary">🚚 مندوب التوصيل</p>
            <p className={`text-sm font-semibold mt-1 ${detail.delivery.rep_name ? 'text-text' : 'text-gray-400'}`}>
              {detail.delivery.rep_name || 'غير مُسند'}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-surface/40 p-3">
            <p className="text-[11px] text-text-secondary">👤 السائق</p>
            <p className={`text-sm font-semibold mt-1 ${detail.delivery.driver_name ? 'text-text' : 'text-gray-400'}`}>
              {detail.delivery.driver_name || 'غير مُسند'}
            </p>
          </div>
        </div>
        {detail.delivery.assigned_at && (
          <p className="text-[11px] text-text-secondary">وقت التعيين: {fmtTime(detail.delivery.assigned_at)}</p>
        )}

        {!allDone && (
          <>
            {showCrewForm ? (
              <div className="space-y-2 pt-1 border-t border-border/60">
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-text-secondary">مندوب توصيل
                    <select value={repId} onChange={(e) => setRepId(e.target.value)} className="w-full mt-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white text-text">
                      <option value="">-- غير معين --</option>
                      {[...currentRepOpt, ...repOptions].map((e) => (
                        <option key={e.id} value={e.id}>{e.full_name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-text-secondary">سائق
                    <select value={driverId} onChange={(e) => setDriverId(e.target.value)} className="w-full mt-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white text-text">
                      <option value="">-- غير معين --</option>
                      {[...currentDriverOpt, ...driverOptions].map((e) => (
                        <option key={e.id} value={e.id}>{e.full_name}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="flex gap-2">
                  <button onClick={saveCrew} disabled={busy} className="flex-1 bg-primary text-white rounded-xl p-2.5 text-sm font-semibold disabled:opacity-50">
                    {busy ? 'جاري الحفظ...' : 'حفظ فريق التوصيل'}
                  </button>
                  <button onClick={() => setShowCrewForm(false)} className="bg-surface text-text rounded-xl px-3 text-sm">إلغاء</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowCrewForm(true)} className="w-full bg-surface text-primary rounded-xl p-2.5 text-sm font-semibold">
                تعديل فريق التوصيل
              </button>
            )}
          </>
        )}
      </div>

      {/* C. التحصيل */}
      <div className="bg-white rounded-xl border border-border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-text">التحصيل</p>
          <span className={`text-[11px] px-2 py-0.5 rounded-full ${collectionMode === 'without' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
            {collectionMode === 'without' ? 'بدون تحصيل' : 'مطلوب التحصيل'}
          </span>
        </div>
        {!detail.delivery.delivery_step ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setCollectionRequired(true)}
                disabled={busy}
                className={`rounded-xl p-3 text-sm font-bold border ${collectionMode === 'required' ? 'bg-primary text-white border-primary' : 'bg-white text-text-secondary border-border'}`}
              >
                💰 مطلوب التحصيل
              </button>
              <button
                onClick={() => setCollectionRequired(false)}
                disabled={busy}
                className={`rounded-xl p-3 text-sm font-bold border ${collectionMode === 'without' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-text-secondary border-border'}`}
              >
                ✓ بدون تحصيل
              </button>
            </div>
            <p className="text-[11px] text-text-secondary">يتم حفظ الاختيار ويُستخدم أثناء التوصيل</p>
          </>
        ) : (
          <p className="text-xs text-text-secondary">لا يمكن تعديل التحصيل بعد بدء التوصيل.</p>
        )}
        {detail.collection && (
          <div className="rounded-xl border border-border bg-surface/40 p-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-secondary">التحصيل المسجل</span>
              <span className={`text-[11px] px-2 py-0.5 rounded-full ${detail.collection.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                {detail.collection.status === 'approved' ? 'معتمد' : 'قيد الاعتماد'}
              </span>
            </div>
            <p className="text-sm font-bold text-text">{fmtAmount(detail.collection.amount)}</p>
            {detail.collection.collected_by_name && <p className="text-[11px] text-text-secondary">بواسطة: {detail.collection.collected_by_name}</p>}
            {detail.collection.collected_at && <p className="text-[11px] text-text-secondary">التاريخ: {fmtTime(detail.collection.collected_at)}</p>}
            {detail.collection.status === 'pending' && (
              <button onClick={reconcile} disabled={busy} className="w-full mt-1 bg-success text-white rounded-xl p-2.5 text-sm font-semibold disabled:opacity-50">
                {busy ? 'جاري...' : 'اعتماد التحصيل'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* D. مسار الرحلة */}
      <div className="bg-white rounded-xl border border-border p-4 space-y-3">
        <p className="text-sm font-bold text-text">مسار الرحلة</p>
        <DeliveryJourney
          step={detail.delivery.delivery_step}
          collectionRequired={detail.delivery.collection_required}
          customerNotFound={customerNotFound}
          actions={detail.actions}
          segments={segments}
          totalMeters={totalMeters}
        />
      </div>

      {/* E. الفاتورة */}
      <div className="bg-white rounded-xl border border-border p-4">
        <button
          onClick={() => navigate(`/orders/${detail.order.id}`)}
          className="w-full flex items-center justify-center gap-2 bg-surface text-primary rounded-xl p-3 text-sm font-bold"
        >
          <span>📄</span> عرض محتوى الفاتورة
        </button>
      </div>

      {/* F. تفاصيل الرحلة */}
      {detail.actions.length > 0 && (
        <div className="bg-white rounded-xl border border-border p-4 space-y-2">
          <p className="text-sm font-bold text-text">تفاصيل الرحلة</p>
          {detail.actions.map((a, idx) => {
            const seg = segments[idx]
            const hasLoc = hasCoords(a.latitude, a.longitude)
            const isCollected = a.action === 'collected'
            const label = isCollected ? (a.amount ? `تم التحصيل (${fmtAmount(a.amount)})` : 'بدون تحصيل') : (DELIVERY_STEP_LABELS[a.action] || a.action)
            return (
              <div key={idx} className="rounded-xl border border-border/70 bg-surface/30 p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-text">{label}</p>
                  <span className="text-[11px] text-text-secondary">🕘 {fmtTime(a.captured_at || a.created_at)}</span>
                </div>
                <p className="text-[11px] text-text-secondary">👤 {a.employee_name || '--'}</p>
                {hasLoc && (
                  <div className="flex items-start gap-2 flex-wrap">
                    <MapButton latitude={Number(a.latitude)} longitude={Number(a.longitude)} size="sm" showCopyLink={false} />
                    <ResolvedAddress lat={Number(a.latitude)} lng={Number(a.longitude)} size="sm" className="text-text-secondary" />
                  </div>
                )}
                {hasLoc && (
                  <p className="text-[11px] text-text-secondary">
                    المسافة من المرحلة السابقة: {seg?.isFirst ? 'البداية' : formatDistanceHuman(seg?.distanceMeters)}
                  </p>
                )}
              </div>
            )
          })}
          {totalMeters > 0 && (
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs font-semibold text-text">إجمالي مسافة الرحلة</span>
              <span className="text-sm font-bold text-primary">{formatDistanceHuman(totalMeters)}</span>
            </div>
          )}
        </div>
      )}

      <button onClick={() => navigate('/shipping')} className="w-full bg-surface text-text rounded-xl p-3 text-sm">العودة للقائمة</button>
    </div>
  )
}
