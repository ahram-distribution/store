import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import { MapButton } from '../../components/shared/MapButton'
import { trackingEngine } from '../../services/trackingEngine'
import { getCurrentLocation } from '../../services/gpsService'
import { DeliveryJourney } from './DeliveryJourney'
import { JourneyOrderFlow } from './JourneyOrderFlow'
import {
  getToken, deliveryStepLabel, isDeliveryCompleted, isJourneyOrderDone,
  fmtAmount, fmtTime, hasCoords, computeJourneyDistances,
} from './shared'
import type { DeliveryJourneyItem, JourneyOrder } from './shared'

export function DeliveryOrderDetailPage() {
  const { journeyId, deliveryId } = useParams()
  const navigate = useNavigate()
  const [journey, setJourney] = useState<DeliveryJourneyItem | null>(null)
  const [item, setItem] = useState<JourneyOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [amount, setAmount] = useState('')

  const load = useCallback(async () => {
    const token = getToken()
    if (!token || !journeyId) { setLoading(false); return }
    setLoading(true)
    const { data, error } = await supabase.rpc('governed_get_journey', { p_token: token, p_journey_id: journeyId })
    if (error) { toast.error(error.message); setLoading(false); return }
    const res = data as DeliveryJourneyItem & { error?: string }
    if (res?.error) { toast.error(res.error); setLoading(false); return }
    setJourney(res)
    const found = deliveryId
      ? (res.orders || []).find((d) => d.delivery_id === deliveryId)
      : (res.orders || [])[0] || null
    setItem(found || null)
    setAmount(found ? String(Number(found.total_amount) || 0) : '')
    setLoading(false)
  }, [journeyId, deliveryId])

  useEffect(() => { load() }, [load])

  const getGps = async () => {
    const res = await getCurrentLocation({ maxWaitMs: 8000 })
    return res.success && res.location
      ? { lat: res.location.latitude, lng: res.location.longitude, acc: res.location.accuracy, at: res.location.capturedAt }
      : null
  }

  const startSilentTracking = async () => {
    if (trackingEngine.status.running) return
    const token = getToken()
    if (!token) return
    const { data } = await supabase.rpc('get_my_workday_status', { p_token: token })
    const sessionId = (data as { session_id?: string })?.session_id
    if (!sessionId) return
    const employeeId = useAuthStore.getState().user?.employee_id
    trackingEngine.start(sessionId, employeeId, 300)
  }

  const doAction = async (action: string, opts?: { withoutCollection?: boolean }) => {
    const token = getToken()
    if (!token || !item) return
    setBusy(action)
    const gps = await getGps()
    const params: Record<string, unknown> = {
      p_token: token,
      p_delivery_id: item.delivery_id,
      p_action: action,
      p_amount: action === 'collected' && !opts?.withoutCollection ? Number(amount) || 0 : null,
    }
    if (gps) {
      params.p_latitude = gps.lat
      params.p_longitude = gps.lng
      params.p_accuracy_meters = gps.acc
      params.p_captured_at = gps.at
    }
    const { data, error } = await supabase.rpc('governed_delivery_action', params)
    setBusy(null)
    if (error) { toast.error(error.message); return }
    const res = data as { error?: string }
    if (res?.error) {
      toast.error(res.error)
    } else {
      toast.success('تم تسجيل الخطوة بنجاح')
      if (gps) trackingEngine.recordActionPoint({ latitude: gps.lat, longitude: gps.lng, accuracy: gps.acc, pointType: 'delivery_action' })
      if (action === 'received') await startSilentTracking()
      if (action === 'returned_to_company') trackingEngine.stop()
      load()
    }
  }

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  if (!item) return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(journeyId ? `/my-deliveries/tasks/${journeyId}` : '/my-deliveries/tasks')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">تفاصيل الطلب</h1>
      </div>
      <p className="text-center text-text-secondary text-sm py-8">لم يتم العثور على الطلب</p>
    </div>
  )

  const virtual = !!journey?.is_virtual
  const allDone = virtual ? isDeliveryCompleted(item.delivery_step) : isJourneyOrderDone(item.delivery_step)
  const customerNotFound = item.delivery_step === 'customer_not_found'
    || (item.actions || []).some((a) => a.action === 'customer_not_found')
  const custLoc = hasCoords(item.customer_latitude, item.customer_longitude)
    ? { lat: Number(item.customer_latitude), lng: Number(item.customer_longitude) }
    : null
  const { segments, totalMeters } = computeJourneyDistances(item.actions || [])
  const otherTeam = item.is_rep ? (item.driver_name || null) : (item.rep_name || null)
  const flowProps = {
    step: item.delivery_step,
    collectionRequired: item.collection_required,
    customerNotFound,
    actions: item.actions || [],
    segments,
    totalMeters,
    manage: true,
    busy,
    amount,
    onAmountChange: setAmount,
    onAction: doAction,
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(journeyId ? `/my-deliveries/tasks/${journeyId}` : '/my-deliveries/tasks')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">تفاصيل الطلب</h1>
      </div>

      {/* ملخص الطلب */}
      <div className="bg-gradient-to-br from-primary to-blue-900 text-white rounded-xl p-5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-sm opacity-90">الطلب {item.order_number}</p>
          {allDone && <span className="text-[11px] px-2 py-1 rounded-full bg-emerald-500/30 text-emerald-50">✓ مكتمل</span>}
        </div>
        <h2 className="text-xl font-bold mt-1">{item.customer_name}</h2>
        <p className="text-sm mt-1 font-semibold">{fmtAmount(item.invoice_total ?? item.total_amount)}</p>
        {item.invoice_number && (
          <p className="text-[11px] mt-1 opacity-90">فاتورة رقم: {item.invoice_number}</p>
        )}
        <span className="inline-block mt-2 text-xs px-2 py-1 rounded-full bg-white/20">{deliveryStepLabel(item.delivery_step)}</span>
      </div>

      {/* العميل */}
      <div className="bg-white rounded-xl border border-border p-4 space-y-2">
        <p className="text-sm font-bold text-text">👤 معلومات العميل</p>
        <p className="text-xs text-text-secondary">👤 {item.customer_name}</p>
        {item.customer_phone && <p className="text-xs text-text-secondary">📞 <span dir="ltr">{item.customer_phone}</span></p>}
        {item.customer_address && <p className="text-xs text-text-secondary">📍 {item.customer_address}</p>}
        {item.items_count > 0 && <p className="text-xs text-text-secondary">📦 عدد الأصناف: {item.items_count}</p>}
        {custLoc && (
          <div className="pt-1"><MapButton latitude={custLoc.lat} longitude={custLoc.lng} size="sm" /></div>
        )}
      </div>

      {/* مندوب المبيعات */}
      {item.owner_name && (
        <div className="bg-white rounded-xl border border-border p-4 space-y-1">
          <p className="text-sm font-bold text-text">👤 مندوب المبيعات</p>
          <p className="text-xs text-text-secondary">الاسم: {item.owner_name}</p>
          {item.owner_phone && <p className="text-xs text-text-secondary">📞 <span dir="ltr">{item.owner_phone}</span></p>}
        </div>
      )}

      {/* الفريق */}
      <div className="bg-white rounded-xl border border-border p-4 space-y-2">
        <p className="text-sm font-bold text-text">الفريق</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-border bg-surface/40 p-3">
            <p className="text-[11px] text-text-secondary">🚚 مندوب التوصيل</p>
            <p className="text-sm font-semibold mt-1">{item.rep_name || 'غير مُسند'}</p>
          </div>
          <div className="rounded-xl border border-border bg-surface/40 p-3">
            <p className="text-[11px] text-text-secondary">👤 السائق</p>
            <p className="text-sm font-semibold mt-1">{item.driver_name || 'غير مُسند'}</p>
          </div>
        </div>
        {otherTeam && !allDone && (
          <p className="text-[11px] text-text-secondary">زميلك في هذه المهمة: {otherTeam}</p>
        )}
        <p className="text-xs">
          <span className={item.collection_required === false ? 'text-emerald-600' : 'text-amber-600'}>
            {item.collection_required === false ? '✓ بدون تحصيل' : '💰 مطلوب التحصيل'}
          </span>
        </p>
        {item.assigned_at && <p className="text-[11px] text-text-secondary">التعيين: {fmtTime(item.assigned_at)}</p>}
        {item.started_at && <p className="text-[11px] text-text-secondary">البدء: {fmtTime(item.started_at)}</p>}
        {item.returned_at && <p className="text-[11px] text-text-secondary">الإرجاع: {fmtTime(item.returned_at)}</p>}
      </div>

      {/* مسار الطلب */}
      <div className="bg-white rounded-xl border border-border p-4 space-y-3">
        <p className="text-sm font-bold text-text">مسار الطلب</p>
        {virtual ? <DeliveryJourney {...flowProps} /> : <JourneyOrderFlow {...flowProps} />}
      </div>

      {item.collection && item.delivery_step === 'collected' && (
        <div className="bg-white rounded-xl border border-border p-4 space-y-1 text-sm">
          <p className="text-sm font-bold text-text">💰 التحصيل</p>
          <p className="text-xs text-text-secondary">المبلغ: {fmtAmount(item.collection.amount)}</p>
          <p className={`text-xs ${item.collection.status === 'approved' ? 'text-emerald-600' : 'text-amber-600'}`}>
            الحالة: {item.collection.status === 'approved' ? 'معتمد من الإدارة' : 'قيد الاعتماد'}
          </p>
        </div>
      )}

      <button onClick={() => navigate(journeyId ? `/my-deliveries/tasks/${journeyId}` : '/my-deliveries/tasks')} className="w-full bg-surface text-text rounded-xl p-3 text-sm">العودة للرحلة</button>
    </div>
  )
}
