import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useVisitsStore } from '../../store/visits'
import { formatDateTime } from '../../utils/format'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { RemoteSearchableSelect } from '../../components/shared/RemoteSearchableSelect'
import { locationService } from '../../services/location'
import { getStrictLocation } from '../../services/gpsService'
import { trackingEngine } from '../../services/trackingEngine'
import { LocationDisplay } from '../../components/shared/LocationDisplay'
import { lifeSignalService } from '../../services/lifeSignalService'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

type VisitStep = 'select_customer' | 'active' | 'done'

const APPROVED_RESULTS = [
  { value: 'order_taken', label: 'تم إنشاء طلب' },
  { value: 'follow_up', label: 'تمت متابعة فقط' },
  { value: 'customer_closed', label: 'العميل مغلق' },
  { value: 'no_responsible_person', label: 'العميل غير موجود' },
  { value: 'order_rejected', label: 'رفض الطلب' },
  { value: 'collection_taken', label: 'زيارة تحصيل' },
  { value: 'new_customer', label: 'عميل جديد' },
]

export function VisitScreen() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const preselectedCustomerId = searchParams.get('customer')
  const token = getToken()
  const { activeVisit: storeActiveVisit, setActiveVisit: setStoreActiveVisit } = useVisitsStore()
  const [step, setStep] = useState<VisitStep>('select_customer')
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [activeVisit, setActiveVisit] = useState<any>(null)
  const [startGps, setStartGps] = useState<{ latitude: number; longitude: number; accuracy: number } | null>(null)
  const [startAddress, setStartAddress] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [notes, setNotes] = useState('')
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [locating, setLocating] = useState(false)

  useEffect(() => {
    if (!token) { setLoading(false); return }
    supabase.rpc('get_governed_visits', { p_token: token, p_status: 'active', p_page: 1, p_per_page: 5 }).then(async ({ data }) => {
      const visits = Array.isArray(data) ? data : []
      const active = visits.find((v: any) => v.status === 'active')
      if (active) {
        setActiveVisit(active)
        setStoreActiveVisit(active)
        setCustomerName(active.customer_name || '')
        setStep('active')
        setLoading(false)
        return
      }
      if (preselectedCustomerId) {
        const { data: custData } = await supabase.rpc('get_governed_customer', {
          p_token: token.trim(), p_id: preselectedCustomerId,
        })
        const row = Array.isArray(custData) ? custData[0] : custData
        if (row && row.company_name) {
          setSelectedCustomerId(preselectedCustomerId)
          setCustomerName(String(row.company_name))
          setSubmitting(true)
          await startVisit(row)
          setSubmitting(false)
        }
      }
      setLoading(false)
    })
  }, [token, preselectedCustomerId])

  const loadCustomerOptions = useCallback(async (query: string) => {
    const t = getToken()
    if (!t) return []
    const { data } = await supabase.rpc('get_governed_customers', {
      p_token: t.trim(), p_search: query || null, p_page: 1, p_per_page: 20,
    })
    const rows = Array.isArray(data) ? data : []
    return rows.map((c: any) => ({ id: c.id, name: c.company_name }))
  }, [])

  const resolveCustomerLabel = useCallback(async (id: string) => {
    const t = getToken()
    if (!t) return null
    const { data } = await supabase.rpc('get_governed_customer', { p_token: t.trim(), p_id: id })
    if (!data) return null
    const row = Array.isArray(data) ? data[0] : data
    return row && row.company_name ? String(row.company_name) : null
  }, [])

  const handleStartSelected = async () => {
    if (!selectedCustomerId || submitting) return
    setSubmitting(true)
    const label = await resolveCustomerLabel(selectedCustomerId).catch(() => null)
    if (label) setCustomerName(label)
    await startVisit({ id: selectedCustomerId })
    setSubmitting(false)
  }

  const startVisit = async (customer: any) => {
    if (!token) return
    if (storeActiveVisit) {
      console.warn('[VISIT] FAILED — active visit already exists: ' + storeActiveVisit.id)
      toast.error('لا يمكن فتح زيارتين في وقت واحد. أنهِ الزيارة الحالية أولاً.')
      return
    }

    setLocating(true)
    const result = await getStrictLocation()
    setLocating(false)

    if (!result.success || !result.location) {
      toast.error('لا يمكن بدء الزيارة قبل تحديد موقعك الحالي.')
      toast.error('تعذر تحديد موقعك الحالي. تأكد من تشغيل خدمة الموقع ثم حاول مرة أخرى.')
      return
    }

    let locationId: string | null = null
    const gps = result.location
    locationId = await locationService.saveLocation(gps)
    setStartGps({ latitude: gps.latitude, longitude: gps.longitude, accuracy: gps.accuracy })
    trackingEngine.recordActionPoint({
      latitude: gps.latitude,
      longitude: gps.longitude,
      accuracy: gps.accuracy,
      pointType: 'visit_checkin',
    }).catch(() => {})
    if (locationId) {
      locationService.fetchLocation(locationId).then(loc => {
        if (loc?.formatted_address) setStartAddress(loc.formatted_address)
      })
    }

    const { data, error } = await supabase.rpc('governed_checkin_visit', {
      p_token: token,
      p_customer_id: customer.id,
      p_start_location_id: locationId,
      p_latitude: gps.latitude,
      p_longitude: gps.longitude,
    })
    if (error) {
      console.error('[VISIT] FAILED — RPC error: ' + error.message)
      toast.error('فشل بدء الزيارة: ' + error.message)
      return
    }
    lifeSignalService.notifyBusiness('visit_checkin')
    setStartTime(new Date().toISOString())

    const { data: dbData, error: dbError } = await supabase
      .from('visits')
      .select('id, customer_id, employee_id, check_in_latitude, check_in_longitude, check_in_accuracy, start_location_id, status, code, started_at, created_at')
      .eq('id', (data as any)?.id)
      .single()
    if (dbError) {
      console.warn('[VISIT] DB verify query failed: ' + dbError.message)
    }

    const visitData = { ...(data as any), customer_id: customer.id }
    setActiveVisit(visitData)
    setStoreActiveVisit(visitData)
    setStep('active')
    toast.success('تم بدء الزيارة')
  }

  const handleCheckout = async () => {
    if (!token || !activeVisit) return
    if (!result) {
      toast.error('يرجى اختيار نتيجة الزيارة')
      return
    }
    setSubmitting(true)
    setLocating(true)

    const gpsResult = await getStrictLocation()
    setLocating(false)

    if (!gpsResult.success || !gpsResult.location) {
      toast.error('لا يمكن إنهاء الزيارة قبل تسجيل موقع الانتهاء.')
      toast.error('تعذر تحديد موقعك الحالي. تأكد من تشغيل خدمة الموقع ثم حاول مرة أخرى.')
      setSubmitting(false)
      return
    }

    let locationId: string | null = null
    const gps = gpsResult.location
    locationId = await locationService.saveLocation(gps)
    trackingEngine.recordActionPoint({
      latitude: gps.latitude,
      longitude: gps.longitude,
      accuracy: gps.accuracy,
      pointType: 'visit_checkout',
    }).catch(() => {})

    const { error } = await supabase.rpc('governed_checkout_visit', {
      p_token: token,
      p_visit_id: activeVisit.id,
      p_latitude: gps.latitude,
      p_longitude: gps.longitude,
      p_visit_result: result,
      p_notes: notes || null,
    })
    if (error) {
      console.error('[VISIT] FAILED — checkout RPC error: ' + error.message)
      toast.error('فشل إنهاء الزيارة: ' + error.message)
      setSubmitting(false)
      return
    }
    lifeSignalService.notifyBusiness('visit_checkout')
    // Verify checkout in DB (best-effort)
    const { data: dbData, error: dbError } = await supabase
      .from('visits')
      .select('id, status, check_out_at, check_out_latitude, check_out_longitude, check_out_accuracy, visit_result, notes')
      .eq('id', activeVisit.id)
      .single()
    if (dbError) {
      console.warn('[VISIT] DB verify query failed: ' + dbError.message)
    }

    setEndTime(new Date().toISOString())
    setStoreActiveVisit(null)
    toast.success('تم إنهاء الزيارة')
    setStep('done')
    setSubmitting(false)
  }

  if (loading) {
    return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  }

  return (
    <div className="space-y-4 pb-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">الزيارة</h1>
      </div>

      {step === 'select_customer' && (
        <>
          <RemoteSearchableSelect
            value={selectedCustomerId}
            onChange={setSelectedCustomerId}
            loadOptions={loadCustomerOptions}
            resolveLabel={resolveCustomerLabel}
            placeholder="اختر العميل..."
            label="العميل"
            disabled={submitting}
          />
          <button
            onClick={handleStartSelected}
            disabled={!selectedCustomerId || submitting}
            className="w-full bg-success text-white text-xs py-3 rounded-lg disabled:opacity-40 enabled:active:opacity-90 transition-colors"
          >
            + بدء الزيارة
          </button>
        </>
      )}

      {submitting && step === 'select_customer' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <div className="bg-white rounded-2xl p-6 text-center shadow-xl">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-sm text-text-secondary">{locating ? 'جارٍ تحديد موقعك الحالي...' : 'جاري تحديد الموقع وبدء الزيارة...'}</p>
          </div>
        </div>
      )}

      {step === 'active' && activeVisit && (
        <div className="space-y-4">
          <div className="bg-gradient-to-br from-accent to-accent-dark text-white rounded-2xl p-4">
            <p className="text-[11px] opacity-80">زيارة نشطة</p>
            <p className="text-lg font-bold mt-0.5">{customerName || activeVisit.customer_name || activeVisit.customer_id}</p>
            <p className="text-[11px] opacity-80 mt-1">{activeVisit.code}</p>
            {startGps && (
              <div className="mt-2 text-[10px] opacity-70 space-y-0.5">
                <p>دقة البداية: {startGps.accuracy}m</p>
                <p className="flex items-center gap-1">
                  <LocationDisplay lat={startGps.latitude} lng={startGps.longitude} size="sm" />
                </p>
              </div>
            )}
          </div>

          <button
            onClick={() => navigate(`/orders/new?customer=${activeVisit.customer_id}&visit=${activeVisit.id}`)}
            className="w-full bg-primary text-white text-sm py-3 rounded-lg active:bg-primary-dark transition-colors"
          >
            + إنشاء طلب للعميل
          </button>

          <div className="bg-white rounded-xl border border-border p-3 space-y-3">
            <h3 className="text-sm font-semibold text-text">إنهاء الزيارة</h3>
            <div className="flex flex-wrap gap-2">
              {APPROVED_RESULTS.map((r) => (
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
              className="w-full border border-border rounded-lg px-3 py-2 text-sm resize-none h-20 bg-white text-text"
            />
          </div>

          <button
            onClick={handleCheckout}
            disabled={submitting || !result}
            className="w-full bg-accent text-white text-sm py-3 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed active:opacity-90 transition-colors"
          >
            {locating ? 'جارٍ تحديد موقعك الحالي...' : submitting ? 'جاري الإنهاء...' : 'إنهاء الزيارة'}
          </button>
        </div>
      )}

      {step === 'done' && (
        <div className="space-y-4">
          <div className="bg-gradient-to-br from-success to-green-700 text-white rounded-2xl p-4">
            <p className="text-lg font-bold">تم إنهاء الزيارة</p>
            <p className="text-sm opacity-80 mt-1">
              {APPROVED_RESULTS.find((r) => r.value === result)?.label}
            </p>
          </div>

          <div className="bg-white rounded-lg border border-border p-3 space-y-1">
            <p className="text-sm">
              <span className="text-text-secondary">العميل: </span>
              <span className="text-text font-semibold">{customerName || activeVisit?.customer_name || ''}</span>
            </p>
            <p className="text-sm">
              <span className="text-text-secondary">بداية الزيارة: </span>
              <span className="text-text">{startTime ? formatDateTime(startTime) : ''}</span>
            </p>
            <p className="text-sm">
              <span className="text-text-secondary">نهاية الزيارة: </span>
              <span className="text-text">{endTime ? formatDateTime(endTime) : ''}</span>
            </p>
            <p className="text-sm">
              <span className="text-text-secondary">مدة الزيارة: </span>
              <span className="text-text font-semibold">
                {(() => {
                  if (!startTime || !endTime) return ''
                  const s = new Date(startTime).getTime()
                  const e = new Date(endTime).getTime()
                  if (isNaN(s) || isNaN(e)) return ''
                  const diff = e - s
                  const mins = Math.floor(diff / 60000)
                  if (mins < 1) return 'أقل من دقيقة'
                  const hours = Math.floor(mins / 60)
                  const rem = mins % 60
                  if (hours === 0) return rem + ' دقيقة'
                  return hours + ' ساعة ' + (rem > 0 ? rem + ' دقيقة' : '')
                })()}
              </span>
            </p>
          </div>

          {startGps && (
            <div className="bg-white rounded-lg border border-border p-3">
              <p className="text-sm flex items-center gap-1"><span className="text-text-secondary">موقع بدء الزيارة: </span>
                <LocationDisplay lat={startGps.latitude} lng={startGps.longitude} size="md" />
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => {
                setSelectedCustomerId('')
                setCustomerName('')
                setStartGps(null)
                setActiveVisit(null)
                setStartTime('')
                setEndTime('')
                setNotes('')
                setResult('')
                setStep('select_customer')
              }}
              className="flex-1 bg-primary text-white text-sm py-3 rounded-lg active:bg-primary-dark transition-colors"
            >
              زيارة جديدة
            </button>
            <button
              onClick={() => navigate('/visits')}
              className="flex-1 bg-white text-text text-sm py-3 rounded-lg border border-border active:bg-surface transition-colors"
            >
              عرض الزيارات
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
