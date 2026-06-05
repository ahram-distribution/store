import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useVisitsStore } from '../../store/visits'
import { formatDateTime } from '../../utils/format'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { locationService } from '../../services/location'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function VisitDetailPage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const { activeVisit, updateVisit, setActiveVisit } = useVisitsStore()
  const [visit, setVisit] = useState<any>(null)
  const [customerName, setCustomerName] = useState('')
  const [loading, setLoading] = useState(true)
  const [notes, setNotes] = useState('')
  const [result, setResult] = useState('')

  useEffect(() => {
    if (!id) return
    const token = getToken()
    if (!token) { setLoading(false); return }

    const loadVisit = async () => {
      let cid: string | undefined
      if (activeVisit?.id === id) {
        setVisit(activeVisit)
        cid = (activeVisit as any).customer_id || (activeVisit as any).customerId
      } else {
        const { data: visitData } = await supabase.rpc('get_governed_visit', { p_token: token, p_id: id })
        if (visitData) {
          setVisit(visitData as any)
          cid = (visitData as any).customer_id
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

    const { locationId, gps } = await locationService.captureAndStoreLocation()

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
        p_id: visit.id,
        p_end_location_id: locationId,
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

      <div className="bg-white rounded-lg border border-border p-3 space-y-1">
        <p className="text-sm"><span className="text-text-secondary">العميل: </span>
          <button onClick={() => navigate(`/customers/${visit.customer_id}`)} className="text-text font-semibold hover:text-primary transition-colors cursor-pointer">{customerName || visit.customer_id}</button>
        </p>
        {visit.check_in_at && <p className="text-sm"><span className="text-text-secondary">تسجيل الدخول: </span><span className="text-text">{formatDateTime(visit.check_in_at)}</span></p>}
        {(visit.start_accuracy_meters != null) && (
          <p className="text-sm">
            <span className="text-text-secondary">دقة البداية: </span>
            <span className={locationService.formatAccuracy(visit.start_accuracy_meters).className}>
              {locationService.formatAccuracy(visit.start_accuracy_meters).detail} — {locationService.formatAccuracy(visit.start_accuracy_meters).label}
            </span>
          </p>
        )}
        {visit.check_out_at && <p className="text-sm"><span className="text-text-secondary">تسجيل الخروج: </span><span className="text-text">{formatDateTime(visit.check_out_at)}</span></p>}
        {(visit.end_accuracy_meters != null) && (
          <p className="text-sm">
            <span className="text-text-secondary">دقة النهاية: </span>
            <span className={locationService.formatAccuracy(visit.end_accuracy_meters).className}>
              {locationService.formatAccuracy(visit.end_accuracy_meters).detail} — {locationService.formatAccuracy(visit.end_accuracy_meters).label}
            </span>
          </p>
        )}
        {visit.notes && <p className="text-sm"><span className="text-text-secondary">ملاحظات: </span><span className="text-text">{visit.notes}</span></p>}
      </div>

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
