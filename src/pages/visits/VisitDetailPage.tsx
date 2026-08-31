import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useVisitsStore } from '../../store/visits'
import { formatDate, formatDateTime, formatCurrencyShort } from '../../utils/format'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { ResolvedAddress } from '../../components/shared/ResolvedAddress'
import { locationService } from '../../services/location'
import { getStrictLocation } from '../../services/gpsService'
import { trackingEngine } from '../../services/trackingEngine'
import { lifeSignalService } from '../../services/lifeSignalService'
import toast from 'react-hot-toast'

const resultLabels: Record<string, string> = {
  order_taken: 'تم الطلب',
  collection_taken: 'تم التحصيل',
  order_and_collection: 'طلب وتحصيل',
  follow_up: 'متابعة',
  customer_closed: 'العميل مغلق',
  no_responsible_person: 'لا يوجد مسؤول',
  order_rejected: 'رفض الطلب',
  postponed: 'تأجل',
  other: 'أخرى',
}

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

function visitDuration(start: string, end: string): string {
  const diff = new Date(end).getTime() - new Date(start).getTime()
  const mins = Math.floor(diff / 60000)
  if (!isFinite(mins) || mins < 1) return 'أقل من دقيقة'
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  return hours > 0
    ? hours + 'س ' + (rem > 0 ? rem + 'د' : '')
    : rem + ' دقيقة'
}

export function VisitDetailPage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const { activeVisit, updateVisit, setActiveVisit } = useVisitsStore()
  const [visit, setVisit] = useState<any>(null)
  const [customerName, setCustomerName] = useState('')
  const [employeeName, setEmployeeName] = useState('')
  const [startCoords, setStartCoords] = useState('')
  const [endCoords, setEndCoords] = useState('')
  const [loading, setLoading] = useState(true)
  const [notes, setNotes] = useState('')
  const [result, setResult] = useState('')
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [ctx, setCtx] = useState<any>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  const prevVisits = Array.isArray(ctx?.previous_visits) ? ctx.previous_visits : []

  useEffect(() => {
    if (!id) return
    const token = getToken()
    if (!token) { setLoading(false); return }

    const loadVisit = async () => {
      let cid: string | undefined
      let v: any
      if (activeVisit?.id === id) {
        v = activeVisit
        setVisit(v)
        cid = v.customer_id || (v as any).customerId
      } else {
        const { data: visitData } = await supabase.rpc('get_governed_visit', { p_token: token, p_id: id })
        if (visitData) {
          v = visitData as any
          setVisit(v)
          cid = (v as any).customer_id
        }
      }
      if (v) {
        if (v.employee_id) {
          supabase.rpc('get_governed_employee', { p_token: token, p_employee_id: v.employee_id })
            .then(({ data }) => {
              if (data && !(data as any)?.error) setEmployeeName((data as any)?.full_name || '')
            })
        }
        const startLat = Number(v.check_in_latitude)
        const startLng = Number(v.check_in_longitude)
        const endLat = Number(v.check_out_latitude)
        const endLng = Number(v.check_out_longitude)
        if (startLat && startLng) {
          setStartCoords(`${startLat.toFixed(6)}, ${startLng.toFixed(6)}`)
        }
        if (endLat && endLng) {
          setEndCoords(`${endLat.toFixed(6)}, ${endLng.toFixed(6)}`)
        }
      }
      if (cid) {
        const { data } = await supabase.rpc('get_governed_customer', { p_token: token, p_id: cid })
        if (data) setCustomerName(Array.isArray(data) ? data[0]?.company_name : data?.company_name || '')
      }
      // Live customer context + summary + previous-visits history for this visit
      const { data: ctxData } = await supabase.rpc('get_customer_visit_context', { p_token: token, p_visit_id: id as string })
      if (ctxData && !(ctxData as any)?.error) setCtx(ctxData as any)
      setLoading(false)
    }
    loadVisit()
  }, [id, activeVisit])

  const handleCheckOut = async () => {
    if (!result) {
      toast.error('يرجى اختيار نتيجة الزيارة')
      return
    }
    if (!visit) return
    if (checkoutBusy) return
    setCheckoutBusy(true)

    const gpsResult = await getStrictLocation()
    if (!gpsResult.success || !gpsResult.location) {
      setCheckoutBusy(false)
      toast.error('لا يمكن إنهاء الزيارة قبل تسجيل موقع الانتهاء.')
      toast.error('تعذر تحديد موقعك الحالي. تأكد من تشغيل خدمة الموقع ثم حاول مرة أخرى.')
      return
    }

    const gps = gpsResult.location
    const locationId = await locationService.saveLocation(gps)
    trackingEngine.recordActionPoint({
      latitude: gps.latitude,
      longitude: gps.longitude,
      accuracy: gps.accuracy,
      pointType: 'visit_checkout',
    }).catch(() => {})

    updateVisit(visit.id, {
      status: 'completed',
      checkOutAt: new Date().toISOString(),
      result,
      notes: notes || undefined,
    })
    const token = getToken()
    if (token) {
      await supabase.rpc('governed_checkout_visit', {
        p_token: token,
        p_visit_id: visit.id,
        p_latitude: gps.latitude,
        p_longitude: gps.longitude,
        p_visit_result: result,
        p_notes: notes || null,
      })
    }
    lifeSignalService.notifyBusiness('visit_checkout')
    setActiveVisit(null)
    setCheckoutBusy(false)
    toast.success('تم إنهاء الزيارة')
    navigate('/visits')
  }

  const results = [
    { value: 'order_taken', label: 'تم الطلب' },
    { value: 'collection_taken', label: 'تم التحصيل' },
    { value: 'order_and_collection', label: 'طلب وتحصيل' },
    { value: 'follow_up', label: 'متابعة' },
    { value: 'customer_closed', label: 'العميل مغلق' },
    { value: 'no_responsible_person', label: 'لا يوجد مسؤول' },
    { value: 'order_rejected', label: 'رفض الطلب' },
    { value: 'postponed', label: 'تأجل' },
    { value: 'other', label: 'أخرى' },
  ]

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  if (!visit) return <div className="text-center py-12 text-text-secondary text-sm">الزيارة غير موجودة</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/visits')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">{visit.code || 'زيارة'}</h1>
        <StatusBadge status={visit.status} />
      </div>

      {(() => {
        const isActive = visit.status === 'active'
        const isCompleted = visit.status === 'completed'

        let headerBg = 'bg-gradient-to-l from-primary/10 to-primary/5 border-b border-primary/10'
        let codeBg = 'bg-primary text-white'
        let durationColor = 'text-text-secondary font-semibold'
        if (isActive) {
          headerBg = 'bg-gradient-to-l from-accent/15 to-accent/5 border-b border-accent/10'
          codeBg = 'bg-accent text-white'
          durationColor = 'text-accent font-semibold'
        } else if (isCompleted) {
          headerBg = 'bg-gradient-to-l from-success/10 to-success/5 border-b border-success/10'
          codeBg = 'bg-success text-white'
          durationColor = 'text-success font-semibold'
        }

        const startTime = visit.check_in_at
        const endTime = visit.check_out_at
        let durationText = ''
        if (startTime && endTime) {
          const s = new Date(startTime).getTime()
          const e = new Date(endTime).getTime()
          if (!isNaN(s) && !isNaN(e)) {
            const diff = e - s
            const mins = Math.floor(diff / 60000)
            if (mins < 1) durationText = 'أقل من دقيقة'
            else {
              const hours = Math.floor(mins / 60)
              const rem = mins % 60
              durationText = hours > 0
                ? hours + 'س ' + (rem > 0 ? rem + 'د' : '')
                : rem + ' دقيقة'
            }
          }
        }

        const hasStartGps = visit.check_in_latitude != null && visit.check_in_longitude != null
        const hasEndGps = visit.check_out_latitude != null && visit.check_out_longitude != null

        return (
          <div className="bg-white rounded-xl border border-border overflow-hidden">
            <div className={'px-4 py-2.5 flex items-center justify-between ' + headerBg}>
              <span className={'text-xs px-2.5 py-0.5 rounded-full font-semibold ' + codeBg}>
                {visit.code || 'غير متوفر'}
              </span>
              <StatusBadge status={visit.status} />
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-primary font-semibold mb-0.5">العميل</p>
                  <p className="text-lg font-bold text-text">
                    <button onClick={() => navigate(`/customers/${visit.customer_id}`)} className="hover:text-primary-dark transition-colors cursor-pointer">{customerName || visit.customer_id}</button>
                  </p>
                </div>
                {visit.visit_result && !isActive && (
                  <span className="text-[11px] bg-success/10 text-success px-3 py-1 rounded-full font-semibold">
                    {resultLabels[visit.visit_result] || visit.visit_result}
                  </span>
                )}
              </div>

              <div className="h-px bg-border/60" />

              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5">
                {employeeName && (
                  <>
                    <span className="text-[13px] text-indigo-600 font-semibold">بواسطة</span>
                    <span className="text-[15px] text-indigo-900 font-medium">{employeeName}</span>
                  </>
                )}
                {startTime && (
                  <>
                    <span className="text-[13px] text-blue-600 font-semibold">البداية</span>
                    <span className="text-[15px] text-blue-800">{formatDateTime(startTime)}</span>
                  </>
                )}
                {endTime && (
                  <>
                    <span className="text-[13px] text-emerald-600 font-semibold">النهاية</span>
                    <span className="text-[15px] text-emerald-800">{formatDateTime(endTime)}</span>
                  </>
                )}
                {durationText && (
                  <>
                    <span className="text-[13px] text-amber-700 font-semibold">المدة</span>
                    <span className={'text-[15px] ' + durationColor}>{durationText}</span>
                  </>
                )}
              </div>

              {(hasStartGps || hasEndGps) && <div className="h-px bg-border/60" />}

              <div className="space-y-2.5">
                {hasStartGps && (
                  <div className="bg-blue-50/70 border border-blue-200/50 rounded-lg px-3.5 py-2.5">
                    <p className="text-[11px] text-blue-700 font-semibold mb-1">بداية الزيارة</p>
                    <p className="text-[13px] flex items-center flex-wrap gap-x-2">
                      <a href={locationService.buildGoogleMapsUrl(Number(visit.check_in_latitude), Number(visit.check_in_longitude))} target="_blank" rel="noopener noreferrer" className="inline-block bg-blue-600 text-white text-[11px] px-3 py-1 rounded-full font-semibold">فتح الخريطة</a>
                      {startCoords && <span className="text-blue-500 text-[10px]">({startCoords})</span>}
                    </p>
                    <p className="mt-1">
                      <ResolvedAddress lat={Number(visit.check_in_latitude)} lng={Number(visit.check_in_longitude)} size="md" className="text-blue-700" />
                    </p>
                  </div>
                )}
                {hasEndGps && (
                  <div className="bg-emerald-50/70 border border-emerald-200/50 rounded-lg px-3.5 py-2.5">
                    <p className="text-[11px] text-emerald-700 font-semibold mb-1">نهاية الزيارة</p>
                    <p className="text-[13px] flex items-center flex-wrap gap-x-2">
                      <a href={locationService.buildGoogleMapsUrl(Number(visit.check_out_latitude), Number(visit.check_out_longitude))} target="_blank" rel="noopener noreferrer" className="inline-block bg-emerald-600 text-white text-[11px] px-3 py-1 rounded-full font-semibold">فتح الخريطة</a>
                      {endCoords && <span className="text-emerald-500 text-[10px]">({endCoords})</span>}
                    </p>
                    <p className="mt-1">
                      <ResolvedAddress lat={Number(visit.check_out_latitude)} lng={Number(visit.check_out_longitude)} size="md" className="text-emerald-700" />
                    </p>
                  </div>
                )}
              </div>

              {visit.notes && <div className="h-px bg-border/60" />}

              {visit.notes && (() => {
                const orderMatch = visit.notes.match(/^طلب:([a-f0-9-]+)\|(.+)/)
                return (
                  <div className="bg-amber-50 border border-amber-300/60 rounded-lg px-4 py-3">
                    <p className="text-[13px] text-amber-900 leading-relaxed whitespace-pre-wrap">{orderMatch ? orderMatch[2] : visit.notes}</p>
                    {orderMatch && (
                      <button onClick={(e) => { e.stopPropagation(); navigate('/orders/' + orderMatch[1]) }} className="bg-indigo-600 text-white text-[12px] px-4 py-1.5 rounded-full font-bold mt-2 inline-block">
                        عرض تفاصيل الطلب
                      </button>
                    )}
                  </div>
                )
              })()}
            </div>
          </div>
        )
      })()}

      {ctx && (
        <div className="space-y-4">
          {/* Customer Information */}
          <div className="bg-white rounded-xl border border-border p-4">
            <h2 className="text-sm font-bold text-primary mb-3">بيانات العميل</h2>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
              <span className="text-text-secondary">الاسم</span>
              <span className="text-text font-semibold">{ctx.customer?.company_name || visit.customer_name || '—'}</span>
              {ctx.customer?.phone && (
                <>
                  <span className="text-text-secondary">الهاتف</span>
                  <span dir="ltr" className="text-left text-text">{ctx.customer.phone}</span>
                </>
              )}
              {ctx.customer?.registered_address && (
                <>
                  <span className="text-text-secondary">العنوان الحالي</span>
                  <span className="text-text">{ctx.customer.registered_address}</span>
                </>
              )}
              {!ctx.customer?.registered_address && (
                <>
                  <span className="text-text-secondary">العنوان الحالي</span>
                  <span className="text-text-muted">غير متوفر</span>
                </>
              )}
              {ctx.customer?.created_at && (
                <>
                  <span className="text-text-secondary">تاريخ إنشاء العميل</span>
                  <span className="text-text">{formatDate(ctx.customer.created_at)}</span>
                </>
              )}
              {ctx.customer?.creator_name && (
                <>
                  <span className="text-text-secondary">أنشأ الحساب</span>
                  <span className="text-text">{ctx.customer.creator_name}</span>
                </>
              )}
            </div>
          </div>

          {/* Customer Summary */}
          <div className="bg-white rounded-xl border border-border p-4">
            <h2 className="text-sm font-bold text-primary mb-3">ملخص العميل</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="bg-surface/60 rounded-lg px-3 py-2.5 text-center">
                <p className="text-[10px] text-text-secondary">عدد الطلبات</p>
                <p className="text-lg font-bold text-text" dir="ltr">{ctx.summary?.order_count ?? 0}</p>
              </div>
              <div className="bg-surface/60 rounded-lg px-3 py-2.5 text-center">
                <p className="text-[10px] text-text-secondary">إجمالي قيمة الطلبات</p>
                <p className="text-lg font-bold text-text" dir="ltr">{ctx.summary?.orders_total != null ? formatCurrencyShort(ctx.summary.orders_total) : '0'}</p>
              </div>
              <div className="bg-surface/60 rounded-lg px-3 py-2.5 text-center">
                <p className="text-[10px] text-text-secondary">عدد الزيارات</p>
                <p className="text-lg font-bold text-text" dir="ltr">{ctx.visit_count ?? 0}</p>
              </div>
              <div className="bg-surface/60 rounded-lg px-3 py-2.5 text-center">
                <p className="text-[10px] text-text-secondary">آخر طلب</p>
                <p className="text-lg font-bold text-text">{ctx.summary?.last_order_date ? formatDate(ctx.summary.last_order_date) : '—'}</p>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between gap-2 text-sm">
              <span className="text-text-secondary">آخر زيارة قبل الحالية</span>
              {prevVisits[0] ? (
                <span className="text-text font-semibold" dir="ltr">
                  {formatDateTime(prevVisits[0].check_in_at)}
                </span>
              ) : (
                <span className="text-text-muted">لا توجد زيارة سابقة</span>
              )}
            </div>
          </div>

          {/* Customer Visit History (previous visits, excluding current) */}
          <div className="bg-white rounded-xl border border-border p-4">
            <button
              onClick={() => setHistoryOpen(o => !o)}
              className="w-full flex items-center justify-between text-sm font-bold text-primary"
            >
              <span>سجل زيارات العميل</span>
              <span className="text-text-muted text-xs">{prevVisits.length} زيارة</span>
            </button>
            {!historyOpen ? (
              <p className="mt-2 text-[11px] text-text-secondary">
                {prevVisits.length === 0
                  ? 'لا توجد زيارة سابقة'
                  : 'اضغط لعرض الزيارات السابقة'}
              </p>
            ) : prevVisits.length === 0 ? (
              <p className="mt-2 text-[11px] text-text-secondary">لا توجد زيارة سابقة</p>
            ) : (
              <div className="mt-2 space-y-2 max-h-72 overflow-y-auto">
                {prevVisits.map(pv => (
                  <div key={pv.id} className="border border-border/60 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-text-secondary">{pv.code || 'زيارة'}</span>
                      <StatusBadge status={pv.status} />
                    </div>
                    <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
                      {pv.check_in_at && (
                        <>
                          <span className="text-text-secondary">البداية</span>
                          <span className="text-text">{formatDateTime(pv.check_in_at)}</span>
                        </>
                      )}
                      {pv.check_out_at && (
                        <>
                          <span className="text-text-secondary">النهاية</span>
                          <span className="text-text">{formatDateTime(pv.check_out_at)}</span>
                        </>
                      )}
                      {pv.check_in_at && pv.check_out_at && (
                        <>
                          <span className="text-text-secondary">المدة</span>
                          <span className="text-text">{visitDuration(pv.check_in_at, pv.check_out_at)}</span>
                        </>
                      )}
                      {pv.employee_name && (
                        <>
                          <span className="text-text-secondary">بواسطة</span>
                          <span className="text-text">{pv.employee_name}</span>
                        </>
                      )}
                      {pv.visit_result && (
                        <>
                          <span className="text-text-secondary">النتيجة</span>
                          <span className="text-text">{resultLabels[pv.visit_result] || pv.visit_result}</span>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {visit.status === 'active' && (
        <div className="bg-white rounded-lg border border-border p-3 space-y-3">
          <h3 className="text-sm font-semibold text-text">إنهاء الزيارة</h3>
          <div className="flex flex-wrap gap-2">
            {results.map((r) => (
              <button
                key={r.value}
                onClick={() => setResult(r.value)}
                className={`text-xs px-3 py-2 rounded-lg border transition-colors ${
                  result === r.value ? 'bg-primary text-white border-primary' : 'bg-white text-text-secondary border-border'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="ملاحظات الزيارة..."
            className="w-full border border-border rounded-lg px-3 py-2 text-sm resize-none h-20"
          />
          <button onClick={handleCheckOut} disabled={checkoutBusy} className="w-full bg-accent text-white text-sm py-2.5 rounded-lg active:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {checkoutBusy ? 'جارٍ تحديد موقعك الحالي...' : 'إنهاء الزيارة'}
          </button>
        </div>
      )}

      {visit.status === 'active' && (
        <div className="flex gap-2">
          <button onClick={() => navigate(`/orders/new?customer=${visit.customer_id}&visit=${visit.id}`)} className="flex-1 bg-primary text-white text-xs py-2.5 rounded-lg text-center">طلب</button>
          <button onClick={() => navigate('/collections/new')} className="flex-1 bg-success text-white text-xs py-2.5 rounded-lg text-center">تحصيل</button>
        </div>
      )}
    </div>
  )
}
