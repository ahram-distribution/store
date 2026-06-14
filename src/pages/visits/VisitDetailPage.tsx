import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useVisitsStore } from '../../store/visits'
import { formatDateTime } from '../../utils/format'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { locationService } from '../../services/location'
import { getCurrentLocation } from '../../services/gpsService'
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

export function VisitDetailPage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const { activeVisit, updateVisit, setActiveVisit } = useVisitsStore()
  const [visit, setVisit] = useState<any>(null)
  const [customerName, setCustomerName] = useState('')
  const [employeeName, setEmployeeName] = useState('')
  const [startAddress, setStartAddress] = useState('')
  const [endAddress, setEndAddress] = useState('')
  const [loading, setLoading] = useState(true)
  const [notes, setNotes] = useState('')
  const [result, setResult] = useState('')

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
          locationService.reverseGeocode(startLat, startLng).then(a => { if (a) setStartAddress(a) })
        }
        if (endLat && endLng) {
          locationService.reverseGeocode(endLat, endLng).then(a => { if (a) setEndAddress(a) })
        }
      }
      if (cid) {
        const { data } = await supabase.rpc('get_governed_customer', { p_token: token, p_id: cid })
        if (data) setCustomerName(Array.isArray(data) ? data[0]?.company_name : data?.company_name || '')
      }
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

    const gpsResult = await getCurrentLocation()
    let locationId = null
    let gps = null
    if (gpsResult.success && gpsResult.location) {
      gps = gpsResult.location
      locationId = await locationService.saveLocation(gpsResult.location)
    }

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
        p_latitude: gps?.latitude || null,
        p_longitude: gps?.longitude || null,
        p_visit_result: result,
        p_notes: notes || null,
      })
    }
    setActiveVisit(null)
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
          const diff = new Date(endTime).getTime() - new Date(startTime).getTime()
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

        const hasStartGps = visit.check_in_latitude != null && visit.check_in_longitude != null
        const hasEndGps = visit.check_out_latitude != null && visit.check_out_longitude != null

        return (
          <div className="bg-white rounded-xl border border-border overflow-hidden">
            <div className={'px-4 py-2.5 flex items-center justify-between ' + headerBg}>
              <span className={'text-xs px-2.5 py-0.5 rounded-full font-semibold ' + codeBg}>
                {visit.code || '—'}
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
                      {startAddress && <span className="text-blue-500">- {startAddress}</span>}
                    </p>
                  </div>
                )}
                {hasEndGps && (
                  <div className="bg-emerald-50/70 border border-emerald-200/50 rounded-lg px-3.5 py-2.5">
                    <p className="text-[11px] text-emerald-700 font-semibold mb-1">نهاية الزيارة</p>
                    <p className="text-[13px] flex items-center flex-wrap gap-x-2">
                      <a href={locationService.buildGoogleMapsUrl(Number(visit.check_out_latitude), Number(visit.check_out_longitude))} target="_blank" rel="noopener noreferrer" className="inline-block bg-emerald-600 text-white text-[11px] px-3 py-1 rounded-full font-semibold">فتح الخريطة</a>
                      {endAddress && <span className="text-emerald-500">- {endAddress}</span>}
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
          <button onClick={handleCheckOut} className="w-full bg-accent text-white text-sm py-2.5 rounded-lg active:opacity-90 transition-colors">
            إنهاء الزيارة
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
