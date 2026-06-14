import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useVisitsStore } from '../../store/visits'
import { formatDateTime } from '../../utils/format'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { locationService } from '../../services/location'
import { getCurrentLocation } from '../../services/gpsService'
import { LocationDisplay } from '../../components/shared/LocationDisplay'
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
  const [customers, setCustomers] = useState<any[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeVisit, setActiveVisit] = useState<any>(null)
  const [startGps, setStartGps] = useState<{ latitude: number; longitude: number; accuracy: number } | null>(null)
  const [startAddress, setStartAddress] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [notes, setNotes] = useState('')
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!token) { setLoading(false); return }
    Promise.all([
      supabase.rpc('get_governed_customers', { p_token: token }),
      supabase.rpc('get_governed_visits', { p_token: token }),
    ]).then(([custRes, visRes]) => {
      if (custRes.data) setCustomers(custRes.data as any[])
      const visits = (visRes.data as any[]) || []
      const active = visits.find((v: any) => v.status === 'active')
      if (active) {
        setActiveVisit(active)
        setStoreActiveVisit(active)
        setStep('active')
        setLoading(false)
        return
      }
      if (preselectedCustomerId && custRes.data) {
        const list = Array.isArray(custRes.data) ? custRes.data : [custRes.data]
        const found = list.find((c: any) => c.id === preselectedCustomerId)
        if (found) {
          setSelectedCustomer(found)
          setSubmitting(true)
          startVisit(found).finally(() => setSubmitting(false))
        }
      }
      setLoading(false)
    })
  }, [token, preselectedCustomerId])

  const customerMap = useMemo(() => {
    const m = new Map<string, any>()
    for (const c of customers) m.set(c.id, c)
    return m
  }, [customers])

  const activeCustomer = useMemo(() => {
    if (selectedCustomer) return selectedCustomer
    if (activeVisit) return customerMap.get(activeVisit.customer_id) || null
    return null
  }, [selectedCustomer, activeVisit, customerMap])

  const filteredCustomers = searchQuery.trim()
    ? customers.filter((c: any) => (c.company_name || '').includes(searchQuery))
    : customers

  const handleSelectCustomer = async (c: any) => {
    setSelectedCustomer(c)
    setSubmitting(true)
    await startVisit(c)
    setSubmitting(false)
  }

  const startVisit = async (customer: any) => {
    if (!token) return
    if (storeActiveVisit) {
      console.warn('[VISIT] FAILED — active visit already exists: ' + storeActiveVisit.id)
      toast.error('لا يمكن فتح زيارتين في وقت واحد. أنهِ الزيارة الحالية أولاً.')
      return
    }

    const result = await getCurrentLocation()

    let locationId: string | null = null
    let gps = result.location
    if (result.success && result.location) {
      locationId = await locationService.saveLocation(result.location)
      setStartGps({ latitude: result.location.latitude, longitude: result.location.longitude, accuracy: result.location.accuracy })
    }
    if (locationId) {
      locationService.fetchLocation(locationId).then(loc => {
        if (loc?.formatted_address) setStartAddress(loc.formatted_address)
      })
    }

    const { data, error } = await supabase.rpc('governed_checkin_visit', {
      p_token: token,
      p_customer_id: customer.id,
      p_start_location_id: locationId,
      p_latitude: gps?.latitude || null,
      p_longitude: gps?.longitude || null,
    })
    if (error) {
      console.error('[VISIT] FAILED — RPC error: ' + error.message)
      toast.error('فشل بدء الزيارة: ' + error.message)
      return
    }
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

    const gpsResult = await getCurrentLocation()

    let locationId: string | null = null
    let gps = gpsResult.location
    if (gpsResult.success && gpsResult.location) {
      locationId = await locationService.saveLocation(gpsResult.location)
    }

    const { error } = await supabase.rpc('governed_checkout_visit', {
      p_token: token,
      p_visit_id: activeVisit.id,
      p_latitude: gps?.latitude || null,
      p_longitude: gps?.longitude || null,
      p_visit_result: result,
      p_notes: notes || null,
    })
    if (error) {
      console.error('[VISIT] FAILED — checkout RPC error: ' + error.message)
      toast.error('فشل إنهاء الزيارة: ' + error.message)
      setSubmitting(false)
      return
    }
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
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ابحث عن عميل..."
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text placeholder:text-text-secondary"
          />
          <div className="space-y-2">
            {filteredCustomers.map((c: any) => (
              <button
                key={c.id}
                onClick={() => handleSelectCustomer(c)}
                disabled={submitting}
                className="w-full bg-white rounded-xl border border-border p-3 text-right active:bg-surface transition-colors disabled:opacity-50"
              >
                <p className="text-sm font-semibold text-text">{c.company_name}</p>
                {c.owner_name && <p className="text-[10px] text-text-secondary">المسؤول: {c.owner_name}</p>}
              </button>
            ))}
            {filteredCustomers.length === 0 && (
              <p className="text-center text-sm text-text-secondary py-8">لا يوجد عملاء مطابقون</p>
            )}
          </div>
        </>
      )}

      {submitting && step === 'select_customer' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <div className="bg-white rounded-2xl p-6 text-center shadow-xl">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-sm text-text-secondary">جاري تحديد الموقع وبدء الزيارة...</p>
          </div>
        </div>
      )}

      {step === 'active' && activeVisit && (
        <div className="space-y-4">
          <div className="bg-gradient-to-br from-accent to-accent-dark text-white rounded-2xl p-4">
            <p className="text-[11px] opacity-80">زيارة نشطة</p>
            <p className="text-lg font-bold mt-0.5">{activeCustomer?.company_name || activeVisit.customer_name || activeVisit.customer_id}</p>
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
            {submitting ? 'جاري الإنهاء...' : 'إنهاء الزيارة'}
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
              <span className="text-text font-semibold">{activeCustomer?.company_name || ''}</span>
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
                  const diff = new Date(endTime).getTime() - new Date(startTime).getTime()
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
                setSelectedCustomer(null)
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
