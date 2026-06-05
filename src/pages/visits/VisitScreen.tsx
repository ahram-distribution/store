import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useVisitsStore } from '../../store/visits'
import { locationService } from '../../services/location'
import type { FreshLocation } from '../../services/location'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

type VisitStep = 'select_customer' | 'location' | 'active' | 'checkout' | 'done'

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
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'detecting' | 'done' | 'failed'>('idle')
  const [gpsError, setGpsError] = useState<string>('')
  const [capturedGps, setCapturedGps] = useState<FreshLocation | null>(null)
  const [activeVisit, setActiveVisit] = useState<any>(null)
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
          setStep('location')
          startCapture()
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

  const startCapture = async () => {
    setGpsStatus('detecting')
    setGpsError('')
    const result = await locationService.captureFreshLocation()
    if (result.success && result.location) {
      setCapturedGps(result.location)
      setGpsStatus('done')
    } else {
      setGpsError(result.error?.message || 'فشل تحديد الموقع')
      setGpsStatus('failed')
    }
  }

  const handleSelectCustomer = (c: any) => {
    setSelectedCustomer(c)
    setStep('location')
    setCapturedGps(null)
    startCapture()
  }

  const handleStartVisit = async () => {
    if (!token || !selectedCustomer) return
    if (storeActiveVisit) {
      toast.error('لا يمكن فتح زيارتين في وقت واحد. أنهِ الزيارة الحالية أولاً.')
      setSubmitting(false)
      return
    }
    setSubmitting(true)

    const { locationId, gps } = await locationService.captureAndStoreLocation()

    const { data, error } = await supabase.rpc('governed_checkin_visit', {
      p_token: token,
      p_customer_id: selectedCustomer.id,
      p_start_location_id: locationId,
      p_latitude: gps?.latitude || null,
      p_longitude: gps?.longitude || null,
    })
    if (error) {
      toast.error('فشل بدء الزيارة: ' + error.message)
      setSubmitting(false)
      return
    }
    setActiveVisit(data as any)
    setStoreActiveVisit(data as any)
    setStep('active')
    setSubmitting(false)
    toast.success('تم بدء الزيارة')
  }

  const handleCheckout = async () => {
    if (!token || !activeVisit) return
    if (!result) {
      toast.error('يرجى اختيار نتيجة الزيارة')
      return
    }
    setSubmitting(true)

    const { locationId, gps } = await locationService.captureAndStoreLocation()

    const { error } = await supabase.rpc('governed_checkout_visit', {
      p_token: token,
      p_visit_id: activeVisit.id,
      p_end_location_id: locationId,
      p_latitude: gps?.latitude || null,
      p_longitude: gps?.longitude || null,
      p_visit_result: result,
      p_notes: notes || null,
    })
    if (error) {
      toast.error('فشل إنهاء الزيارة: ' + error.message)
      setSubmitting(false)
      return
    }
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
                className="w-full bg-white rounded-xl border border-border p-3 text-right active:bg-surface transition-colors"
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

      {step === 'location' && selectedCustomer && (
        <div className="space-y-4">
          <div className="bg-gradient-to-br from-primary to-primary-dark text-white rounded-2xl p-4">
            <p className="text-[11px] opacity-80">العميل</p>
            <p className="text-lg font-bold mt-0.5">{selectedCustomer.company_name}</p>
          </div>

          <div className="bg-white rounded-xl border border-border p-4 text-center">
            {gpsStatus === 'detecting' && (
              <div className="py-4">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <p className="text-sm text-text-secondary">جاري تحديد موقعك...</p>
              </div>
            )}
            {gpsStatus === 'done' && capturedGps && (
              <div className="py-4">
                <p className="text-2xl mb-1">✅</p>
                <p className="text-sm font-semibold text-text">تم تحديد الموقع</p>
                <p className="text-[10px] text-text-secondary mt-1">
                  ({locationService.formatAccuracy(capturedGps.accuracy).detail} - {locationService.formatAccuracy(capturedGps.accuracy).label})
                </p>
              </div>
            )}
            {gpsStatus === 'failed' && (
              <div className="py-4">
                <p className="text-2xl mb-1">⚠️</p>
                <p className="text-sm text-text-secondary">{gpsError || 'تعذر تحديد الموقع'}</p>
                <button onClick={startCapture}
                  className="mt-3 bg-primary text-white text-xs px-4 py-2 rounded-lg active:opacity-90 transition-colors">
                  إعادة المحاولة
                </button>
              </div>
            )}
          </div>

          <button
            onClick={handleStartVisit}
            disabled={submitting || gpsStatus !== 'done'}
            className="w-full bg-primary text-white text-sm py-3 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed active:bg-primary-dark transition-colors"
          >
            {submitting ? 'جاري البدء...' : 'بدء الزيارة'}
          </button>
        </div>
      )}

      {step === 'active' && activeVisit && (
        <div className="space-y-4">
          <div className="bg-gradient-to-br from-accent to-accent-dark text-white rounded-2xl p-4">
            <p className="text-[11px] opacity-80">زيارة نشطة</p>
            <p className="text-lg font-bold mt-0.5">{activeCustomer?.company_name || activeVisit.customer_name || activeVisit.customer_id}</p>
            <p className="text-[11px] opacity-80 mt-1">{activeVisit.code}</p>
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
          <div className="bg-gradient-to-br from-success to-green-700 text-white rounded-2xl p-6 text-center">
            <p className="text-lg font-bold">تم إنهاء الزيارة</p>
            <p className="text-sm opacity-80 mt-1">
              {APPROVED_RESULTS.find((r) => r.value === result)?.label}
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => {
                setSelectedCustomer(null)
                setCapturedGps(null)
                setActiveVisit(null)
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
