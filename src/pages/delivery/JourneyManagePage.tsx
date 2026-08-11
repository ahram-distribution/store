import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase'
import {
  getToken, journeyStatusLabel, isJourneyReturned, isJourneyOrderDone,
  deliveryStepLabel, fmtAmount, fmtTime, isJourneyActive,
  computeJourneyDistances, formatDistanceHuman, hasCoords,
} from './shared'
import type { DeliveryJourneyItem, JourneyOrder, JourneyEvent } from './shared'
import { locationService } from '../../services/location'
import { MapButton } from '../../components/shared/MapButton'

interface CrewEmp { id: string; code: string; full_name: string; role_names: string }

const EVENT_LABELS: Record<string, string> = {
  started: '🚚 استلام الشحنة وبدء الرحلة',
  returned: '🏢 الرجوع لمقر الشركة',
  received: '📦 استلام الطلب',
  moving_to_customer: '🚗 بدء التحرك للعميل',
  arrived_at_customer: '📍 الوصول للعميل',
  customer_not_found: 'العميل غير موجود',
  collected: '💰 تم التحصيل',
  returned_to_company: '🏢 الرجوع لمقر الشركة',
}

const fmtDate = (v: string | null | undefined): string => {
  if (!v) return '--'
  const d = new Date(v)
  if (isNaN(d.getTime())) return '--'
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', { year: 'numeric', month: 'short', day: 'numeric' }).format(d)
}

const fmtClock = (v: string | null | undefined): string => {
  if (!v) return '--'
  const d = new Date(v)
  if (isNaN(d.getTime())) return '--'
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' }).format(d)
}

export function JourneyManagePage() {
  const { journeyId } = useParams()
  const navigate = useNavigate()
  const [journey, setJourney] = useState<DeliveryJourneyItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [emps, setEmps] = useState<CrewEmp[]>([])
  const [repId, setRepId] = useState('')
  const [driverId, setDriverId] = useState('')
  const [showCrewForm, setShowCrewForm] = useState(false)

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

  const journeyEvents = useMemo(() => (journey?.events || []) as JourneyEvent[], [journey])
  const distance = useMemo(() => computeJourneyDistances(journeyEvents), [journeyEvents])

  const [addresses, setAddresses] = useState<Record<string, string | null>>({})
  useEffect(() => {
    let cancelled = false
    const unique = new Map<string, { lat: number; lng: number }>()
    for (const ev of journeyEvents) {
      if (hasCoords(ev.latitude, ev.longitude)) {
        const lat = Number(ev.latitude)
        const lng = Number(ev.longitude)
        unique.set(`${lat},${lng}`, { lat, lng })
      }
    }
    for (const [key, p] of unique) {
      locationService.reverseGeocode(p.lat, p.lng)
        .then((addr) => { if (!cancelled) setAddresses((prev) => ({ ...prev, [key]: addr })) })
        .catch(() => {})
    }
    return () => { cancelled = true }
  }, [journeyEvents])

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
    if (!journey) return
    const rep = emps.find((e) => e.full_name === journey.rep_name)
    const drv = emps.find((e) => e.full_name === journey.driver_name)
    setRepId(rep?.id || '')
    setDriverId(drv?.id || '')
  }, [journey?.journey_id, emps]) // eslint-disable-line react-hooks/exhaustive-deps

  const repOptions = emps.filter((e) => e.role_names.includes('مندوب توصيل'))
  const driverOptions = emps.filter((e) => e.role_names.includes('سائق'))
  const currentRepOpt = journey && repId && journey.rep_name && !repOptions.some((o) => o.id === repId)
    ? [{ id: repId, full_name: journey.rep_name, code: '', role_names: 'مندوب توصيل' }]
    : []
  const currentDriverOpt = journey && driverId && journey.driver_name && !driverOptions.some((o) => o.id === driverId)
    ? [{ id: driverId, full_name: journey.driver_name, code: '', role_names: 'سائق' }]
    : []

  const saveCrew = async () => {
    const token = getToken()
    if (!token || !journey) return
    setBusy(true)
    const { data, error } = await supabase.rpc('governed_update_journey_crew', {
      p_token: token,
      p_journey_id: journey.journey_id,
      p_rep_id: repId || null,
      p_driver_id: driverId || null,
    })
    setBusy(false)
    if (error) { toast.error(error.message); return }
    const res = data as { error?: string }
    if (res?.error) { toast.error(res.error); return }
    toast.success('تم تحديث فريق الرحلة')
    setShowCrewForm(false)
    load()
  }

  const returnJourney = async () => {
    const token = getToken()
    if (!token || !journey) return
    setBusy(true)
    const { data, error } = await supabase.rpc('governed_return_journey', {
      p_token: token,
      p_journey_id: journey.journey_id,
    })
    setBusy(false)
    if (error) { toast.error(error.message); return }
    const res = data as { error?: string }
    if (res?.error) { toast.error(res.error); return }
    toast.success('تم إنهاء الرحلة والرجوع')
    load()
  }

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  if (!journey) return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/shipping/journeys')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">تفاصيل الرحلة</h1>
      </div>
      <p className="text-center text-text-secondary text-sm py-8">لم يتم العثور على الرحلة</p>
    </div>
  )

  const orders = journey.orders || []
  const events = journeyEvents
  const doneCount = orders.filter((o) => isJourneyOrderDone(o.delivery_step)).length

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/shipping/journeys')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">تفاصيل الرحلة</h1>
      </div>

      {/* رأس الرحلة */}
      <div className="bg-gradient-to-br from-primary to-blue-900 text-white rounded-xl p-5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-sm opacity-90">{journey.journey_code || 'رحلة توصيل'}</p>
          <span className="text-[11px] px-2 py-1 rounded-full bg-white/20">{journeyStatusLabel(journey.status)}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          <div>
            <p className="text-lg font-bold">{journey.totals?.orders_count ?? orders.length}</p>
            <p className="text-[10px] opacity-80">الطلبات</p>
          </div>
          <div>
            <p className="text-lg font-bold">{fmtAmount(journey.totals?.total_value)}</p>
            <p className="text-[10px] opacity-80">القيمة</p>
          </div>
          <div>
            <p className="text-lg font-bold">{fmtAmount(journey.totals?.total_collection_required)}</p>
            <p className="text-[10px] opacity-80">التحصيل المطلوب</p>
          </div>
          <div>
            <p className="text-lg font-bold">{fmtAmount(journey.totals?.total_collected)}</p>
            <p className="text-[10px] opacity-80">تم التحصيل</p>
          </div>
        </div>
        <div className="mt-3 text-[11px] opacity-90 space-y-0.5">
          {journey.assigned_at && <p>الإنشاء: {fmtTime(journey.assigned_at)}</p>}
          {journey.started_at && <p>البدء: {fmtTime(journey.started_at)}</p>}
          {journey.returned_at && <p>الرجوع: {fmtTime(journey.returned_at)}</p>}
        </div>
      </div>

      {/* إجمالي مسافة الرحلة */}
      {distance.totalMeters > 0 && (
        <div className="bg-white rounded-xl border border-border p-4 flex items-center justify-between">
          <p className="text-sm font-bold text-text">📏 إجمالي مسافة الرحلة</p>
          <p className="text-sm font-bold text-primary">{formatDistanceHuman(distance.totalMeters)}</p>
        </div>
      )}

      {/* فريق الرحلة */}
      <div className="bg-white rounded-xl border border-border p-4 space-y-3">
        <p className="text-sm font-bold text-text">فريق الرحلة</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-border bg-surface/40 p-3">
            <p className="text-[11px] text-text-secondary">🚚 مندوب التوصيل</p>
            <p className={`text-sm font-semibold mt-1 ${journey.rep_name ? 'text-text' : 'text-gray-400'}`}>
              {journey.rep_name || 'غير مُسند'}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-surface/40 p-3">
            <p className="text-[11px] text-text-secondary">👤 السائق</p>
            <p className={`text-sm font-semibold mt-1 ${journey.driver_name ? 'text-text' : 'text-gray-400'}`}>
              {journey.driver_name || 'غير مُسند'}
            </p>
          </div>
        </div>

        {isJourneyActive(journey.status) && (
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
                    {busy ? 'جاري الحفظ...' : 'حفظ فريق الرحلة'}
                  </button>
                  <button onClick={() => setShowCrewForm(false)} className="bg-surface text-text rounded-xl px-3 text-sm">إلغاء</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowCrewForm(true)} className="w-full bg-surface text-primary rounded-xl p-2.5 text-sm font-semibold">
                تعديل فريق الرحلة
              </button>
            )}
          </>
        )}
      </div>

      {/* إنهاء الرحلة (رجوع) */}
      {journey.status === 'in_progress' && (
        <button
          onClick={returnJourney}
          disabled={busy}
          className="w-full bg-amber-500 text-white rounded-xl p-3 text-sm font-semibold disabled:opacity-50"
        >
          {busy ? 'جاري...' : 'إنهاء الرحلة والرجوع لمقر الشركة'}
        </button>
      )}

      {/* الطلبات */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-text">طلبات الرحلة</p>
          <span className="text-[11px] text-text-secondary">{doneCount} من {orders.length} مكتملة</span>
        </div>
        {orders.length === 0 ? (
          <p className="text-center text-text-secondary text-sm py-6">لا توجد طلبات</p>
        ) : (
          orders.map((o: JourneyOrder) => {
            const done = isJourneyOrderDone(o.delivery_step)
            return (
              <button
                key={o.delivery_id}
                onClick={() => navigate(`/shipping/${o.delivery_id}`)}
                className={`w-full text-right bg-white rounded-xl border p-3 ${done ? 'border-gray-200' : 'border-border'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-sm font-bold truncate ${done ? 'text-gray-500' : 'text-text'}`}>
                    📦 {o.customer_name}
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap ${done ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>
                    {deliveryStepLabel(o.delivery_step)}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-text-secondary">
                  <span>{o.order_number}</span>
                  <span>{fmtAmount(o.invoice_total ?? o.total_amount)}</span>
                </div>
                <div className="mt-1 text-[11px] space-y-0.5">
                  {o.collection_required === false ? (
                    <p className="text-emerald-600">✓ بدون تحصيل</p>
                  ) : o.delivery_step === 'collected' ? (
                    <p className="text-emerald-600">💰 تم التحصيل: {fmtAmount(o.collected_amount ?? o.collection?.amount)}</p>
                  ) : (
                    <p className="text-amber-600">💰 مطلوب التحصيل: {fmtAmount(o.collection_amount ?? o.invoice_total ?? o.total_amount)}</p>
                  )}
                  {o.collection && o.delivery_step === 'collected' && (
                    <p className={o.collection.status === 'approved' ? 'text-emerald-600' : 'text-amber-600'}>
                      {o.collection.status === 'approved' ? '✓ معتمد' : '⏳ قيد الاعتماد'}
                    </p>
                  )}
                </div>
              </button>
            )
          })
        )}
      </div>

      {/* أحداث الرحلة */}
      {events.length > 0 && (
        <div className="bg-white rounded-xl border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-text">أحداث الرحلة</p>
            {distance.totalMeters > 0 && (
              <span className="text-[11px] px-2 py-1 rounded-full bg-blue-50 text-blue-700">📏 {formatDistanceHuman(distance.totalMeters)}</span>
            )}
          </div>
          {events.map((ev, idx) => {
            const hasLoc = hasCoords(ev.latitude, ev.longitude)
            const lat = hasLoc ? Number(ev.latitude) : null
            const lng = hasLoc ? Number(ev.longitude) : null
            const key = lat !== null && lng !== null ? `${lat},${lng}` : ''
            const segDist = distance.segments[idx]?.distanceMeters
            const addr = key ? addresses[key] : null
            return (
              <div key={idx} className="rounded-xl border border-border/70 bg-surface/30 p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-text">{EVENT_LABELS[ev.action] || ev.action}</p>
                  <span className="text-[11px] text-text-secondary">👤 {ev.employee_name || '--'}</span>
                </div>
                {ev.order_number && (
                  <p className="text-[11px] text-text-secondary">📦 الطلب: {ev.order_number}{ev.amount != null && ev.action === 'collected' ? ` - المبلغ ${fmtAmount(ev.amount)}` : ''}</p>
                )}
                <div className="flex items-center gap-3 text-[11px] text-text-secondary flex-wrap">
                  <span>📅 {fmtDate(ev.captured_at || ev.created_at)}</span>
                  <span>🕘 {fmtClock(ev.captured_at || ev.created_at)}</span>
                  {segDist !== null && segDist !== undefined && (
                    <span className="text-blue-600">📏 المسافة من المرحلة السابقة: {formatDistanceHuman(segDist)}</span>
                  )}
                </div>
                {hasLoc && lat !== null && lng !== null && (
                  <div className="text-[11px] text-text-secondary space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span>📍 الموقع: {lat.toFixed(6)}, {lng.toFixed(6)}</span>
                      <MapButton latitude={lat} longitude={lng} size="sm" showCopyLink />
                    </div>
                    <p>
                      <span className="font-semibold text-text">العنوان: </span>
                      {addr || 'جاري تحميل العنوان...'}
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <button onClick={() => navigate('/shipping/journeys')} className="w-full bg-surface text-text rounded-xl p-3 text-sm">العودة لقائمة الرحلات</button>
    </div>
  )
}
