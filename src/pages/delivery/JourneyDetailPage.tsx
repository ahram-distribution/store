import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import { MapButton } from '../../components/shared/MapButton'
import { trackingEngine } from '../../services/trackingEngine'
import { getCurrentLocation } from '../../services/gpsService'
import {
  getToken, fmtAmount, fmtTime, deliveryStepLabel, journeyStatusLabel,
  isJourneyReturned, isJourneyOrderDone, computeJourneyDistances, hasCoords,
} from './shared'
import type { DeliveryJourneyItem, JourneyOrder } from './shared'

export function JourneyDetailPage() {
  const params = useParams()
  const journeyId = params.journeyId || params.id
  const navigate = useNavigate()
  const [journey, setJourney] = useState<DeliveryJourneyItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const token = getToken()
    if (!token || !journeyId) { setLoading(false); return }
    setLoading(true)
    const { data, error } = await supabase.rpc('governed_get_journey', { p_token: token, p_journey_id: journeyId })
    if (error) { toast.error(error.message); setLoading(false); return }
    const res = data as DeliveryJourneyItem & { error?: string }
    if (res?.error) { toast.error(res.error); setLoading(false); return }
    setJourney(res)
    setLoading(false)
  }, [journeyId])

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

  const doJourneyAction = async (action: 'started' | 'returned') => {
    const token = getToken()
    if (!token || !journey) return
    setBusy(action)
    const gps = await getGps()
    const params: Record<string, unknown> = { p_token: token, p_journey_id: journey.journey_id }
    if (gps) {
      params.p_latitude = gps.lat
      params.p_longitude = gps.lng
      params.p_accuracy_meters = gps.acc
      params.p_captured_at = gps.at
    }
    const { data, error } = await supabase.rpc(action === 'started' ? 'governed_start_journey' : 'governed_return_journey', params)
    setBusy(null)
    if (error) { toast.error(error.message); return }
    const res = data as { error?: string }
    if (res?.error) {
      toast.error(res.error)
    } else {
      toast.success(action === 'started' ? 'تم استلام الشحنة — انطلقت الرحلة' : 'تم الرجوع لمقر الشركة')
      if (gps) trackingEngine.recordActionPoint({ latitude: gps.lat, longitude: gps.lng, accuracy: gps.acc, pointType: 'journey_action' })
      if (action === 'started') await startSilentTracking()
      if (action === 'returned') trackingEngine.stop()
      load()
    }
  }

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  if (!journey) return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/my-deliveries/tasks')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">تفاصيل الرحلة</h1>
      </div>
      <p className="text-center text-text-secondary text-sm py-8">لم يتم العثور على الرحلة</p>
    </div>
  )

  const returned = isJourneyReturned(journey.status)
  const orders = journey.orders || []
  const totalCollected = Number(journey.totals?.total_collected || 0)

  const renderOrderCard = (it: JourneyOrder) => {
    const done = isJourneyOrderDone(it.delivery_step)
    const loc = (() => {
      const acts = it.actions || []
      for (let i = acts.length - 1; i >= 0; i--) {
        if (hasCoords(acts[i].latitude, acts[i].longitude)) {
          return { lat: Number(acts[i].latitude), lng: Number(acts[i].longitude) }
        }
      }
      return hasCoords(it.customer_latitude, it.customer_longitude)
        ? { lat: Number(it.customer_latitude), lng: Number(it.customer_longitude) }
        : null
    })()
    return (
      <button
        key={it.delivery_id}
        onClick={() => navigate(`/my-deliveries/tasks/${journey.journey_id}/order/${it.delivery_id}`)}
        className="w-full text-right bg-white rounded-xl border border-border p-4 hover:shadow-sm transition-shadow"
      >
        <div className="flex items-center justify-between mb-2 gap-2">
          <span className="text-sm font-bold text-text">📦 {it.customer_name}</span>
          <span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${done ? 'bg-emerald-50 text-emerald-700' : it.delivery_step ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
            {done ? '✓ مكتمل' : deliveryStepLabel(it.delivery_step)}
          </span>
        </div>
        <div className="text-xs text-text-secondary space-y-1">
          <p>الطلب: <span className="font-semibold text-text">{it.order_number}</span> - {fmtAmount(it.invoice_total ?? it.total_amount)}</p>
          {it.invoice_number && <p>فاتورة رقم: <span className="font-semibold text-text">{it.invoice_number}</span></p>}
          <p className="flex items-center gap-1.5 flex-wrap">
            {it.collection_required === false
              ? <span className="text-emerald-600">✓ بدون تحصيل</span>
              : <span className="text-amber-600">💰 مطلوب التحصيل</span>}
          </p>
          {it.collection && it.delivery_step === 'collected' && (
            <p className={it.collection.status === 'approved' ? 'text-emerald-600' : 'text-amber-600'}>
              💰 التحصيل: {fmtAmount(it.collection.amount)} - {it.collection.status === 'approved' ? 'معتمد' : 'قيد الاعتماد'}
            </p>
          )}
        </div>
        <span className="mt-3 inline-block w-full text-center bg-surface text-primary rounded-xl p-2.5 text-sm font-semibold">
          فتح الطلب
        </span>
        {loc && (
          <div className="mt-2 flex justify-end" onClick={(e) => e.stopPropagation()}>
            <MapButton latitude={loc.lat} longitude={loc.lng} size="sm" showCopyLink={false} />
          </div>
        )}
      </button>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/my-deliveries/tasks')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">تفاصيل الرحلة</h1>
      </div>

      {/* ملخص الرحلة */}
      <div className="bg-gradient-to-br from-primary to-blue-900 text-white rounded-xl p-5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-sm opacity-90">{journey.journey_code || (journey.is_virtual ? 'توصيل مباشر' : 'رحلة')}</p>
          <span className="text-[11px] px-2 py-1 rounded-full bg-white/20">{journeyStatusLabel(journey.status)}</span>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-4 text-center">
          <div className="rounded-xl bg-white/10 p-3">
            <p className="text-lg font-bold">{orders.length}</p>
            <p className="text-[11px] opacity-90">عدد الطلبات</p>
          </div>
          <div className="rounded-xl bg-white/10 p-3">
            <p className="text-lg font-bold">{fmtAmount(journey.totals?.total_value)}</p>
            <p className="text-[11px] opacity-90">إجمالي القيمة</p>
          </div>
          <div className="rounded-xl bg-white/10 p-3">
            <p className="text-lg font-bold">{fmtAmount(totalCollected)}</p>
            <p className="text-[11px] opacity-90">إجمالي التحصيل</p>
          </div>
        </div>
      </div>

      {/* الفريق */}
      <div className="bg-white rounded-xl border border-border p-4 space-y-2">
        <p className="text-sm font-bold text-text">الفريق</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-border bg-surface/40 p-3">
            <p className="text-[11px] text-text-secondary">🚚 مندوب التوصيل</p>
            <p className="text-sm font-semibold mt-1">{journey.rep_name || 'غير مُسند'}</p>
          </div>
          <div className="rounded-xl border border-border bg-surface/40 p-3">
            <p className="text-[11px] text-text-secondary">👤 السائق</p>
            <p className="text-sm font-semibold mt-1">{journey.driver_name || 'غير مُسند'}</p>
          </div>
        </div>
        {journey.assigned_at && <p className="text-[11px] text-text-secondary">التعيين: {fmtTime(journey.assigned_at)}</p>}
        {journey.started_at && <p className="text-[11px] text-text-secondary">بدء الرحلة: {fmtTime(journey.started_at)}</p>}
        {journey.returned_at && <p className="text-[11px] text-text-secondary">الرجوع: {fmtTime(journey.returned_at)}</p>}
      </div>

      {/* أحداث الرحلة */}
      {(journey.events || []).length > 0 && (
        <div className="bg-white rounded-xl border border-border p-4 space-y-2">
          <p className="text-sm font-bold text-text">أحداث الرحلة</p>
          {(journey.events || []).map((ev, i) => (
            <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-border/50 last:border-0">
              <span className="text-text">
                {ev.action === 'started' ? '🚚 استلام الشحنة' : '🏢 الرجوع لمقر الشركة'}
              </span>
              <span className="text-text-secondary flex items-center gap-2">
                {ev.employee_name ? <span>{ev.employee_name}</span> : null}
                <span>{fmtTime(ev.captured_at || ev.created_at)}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* إجراءات الرحلة */}
      {!returned && journey.can_manage !== false && (
        <div className="space-y-2">
          {journey.status === 'assigned' && (
            <button
              onClick={() => doJourneyAction('started')}
              disabled={busy !== null || orders.length === 0}
              className="w-full bg-primary text-white rounded-xl p-3 text-sm font-semibold disabled:opacity-50"
            >
              {busy === 'started' ? 'جاري...' : '🚚 استلام الشحنة وبدء الرحلة'}
            </button>
          )}
          {journey.status === 'in_progress' && (
            <button
              onClick={() => doJourneyAction('returned')}
              disabled={busy !== null}
              className="w-full bg-white border border-primary text-primary rounded-xl p-3 text-sm font-semibold disabled:opacity-50"
            >
              {busy === 'returned' ? 'جاري...' : '🏢 تم الرجوع لمقر الشركة'}
            </button>
          )}
        </div>
      )}

      {/* الطلبات */}
      <div className="space-y-2">
        <p className="text-sm font-bold text-text">طلبات الرحلة ({orders.length})</p>
        {orders.map((it) => renderOrderCard(it))}
      </div>

      <button onClick={() => navigate('/my-deliveries/tasks')} className="w-full bg-surface text-text rounded-xl p-3 text-sm">العودة للقائمة</button>
    </div>
  )
}
