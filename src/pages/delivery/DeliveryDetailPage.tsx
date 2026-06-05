import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase'
import { OrderStatusManager } from '../../components/orders/OrderStatusManager'
import { useCapability } from '../../hooks/useCapability'

function getToken() { try { return localStorage.getItem('session_token') } catch { return null } }

const statusLabels: Record<string, string> = {
  assigned: 'تم التعيين', out_for_delivery: 'قيد التوصيل', delivered: 'تم التسليم', failed: 'فشل', returned: 'مرتجع'
}
const failureReasons = [
  { value: 'customer_unavailable', label: 'العميل غير متاح' },
  { value: 'customer_rejected', label: 'العميل رفض الاستلام' },
  { value: 'address_issue', label: 'مشكلة في العنوان' },
  { value: 'payment_issue', label: 'مشكلة في الدفع' },
  { value: 'other', label: 'أخرى' },
]

export function DeliveryDetailPage() {
  const { id } = useParams(); const navigate = useNavigate()
  const [detail, setDetail] = useState<any>(null); const [loading, setLoading] = useState(true)
  const [reason, setReason] = useState(''); const [notes, setNotes] = useState('')
  const canManage = useCapability('orders.manage')

  const load = () => {
    const token = getToken(); if (!token) return
    supabase.rpc('governed_get_delivery', { p_token: token, p_delivery_id: id }).then(({ data }) => {
      if (data) setDetail(data); setLoading(false)
    })
  }

  useEffect(() => { load() }, [id])

  const act = async (fn: string, extra?: any) => {
    const token = getToken(); if (!token) { toast.error('جلسة منتهية'); return }
    const { error } = await supabase.rpc(fn, { p_token: token, p_delivery_id: id, ...extra })
    if (error) { toast.error(error.message); return }
    toast.success('تم'); load()
  }

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  if (!detail) return <div className="text-center py-12 text-text-secondary text-sm">لم يتم العثور على التوصيل</div>

  const dt = detail.delivery; const o = detail.order; const c = detail.customer; const emp = detail.assigned_employee

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-success to-green-700 text-white rounded-xl p-5">
        <p className="text-sm opacity-90">التوصيل</p>
        <h2 className="text-xl font-bold mt-1">تفاصيل التوصيل</h2>
      </div>
      <div className="bg-white rounded-xl border border-border p-4 space-y-2">
        <p className="text-sm font-semibold text-text">{c?.company_name}</p>
        <p className="text-xs text-text-secondary">الطلب: {o?.order_number} - {o?.total_amount?.toLocaleString()} ج.م</p>
        <p className="text-xs text-text-secondary">الحالة: <span className="font-semibold">{statusLabels[dt?.status]}</span></p>
        <p className="text-xs text-text-secondary">المندوب: {emp?.code || 'غير معين'}</p>
        {dt?.assigned_at && <p className="text-xs text-text-secondary">تاريخ التعيين: {new Date(dt.assigned_at).toLocaleString('ar-EG')}</p>}
        {dt?.started_at && <p className="text-xs text-text-secondary">بدء التوصيل: {new Date(dt.started_at).toLocaleString('ar-EG')}</p>}
        {dt?.completed_at && <p className="text-xs text-text-secondary">اكتمل: {new Date(dt.completed_at).toLocaleString('ar-EG')}</p>}
        {dt?.failure_reason && <p className="text-xs text-red-600">سبب الفشل: {failureReasons.find(f => f.value === dt.failure_reason)?.label || dt.failure_reason}</p>}
        {dt?.notes && <p className="text-xs text-text-secondary">ملاحظات: {dt.notes}</p>}
      </div>
      {dt?.status === 'assigned' && (
        <button onClick={() => act('governed_start_delivery')} className="w-full bg-primary text-white rounded-xl p-3 text-sm font-semibold">بدء التوصيل</button>
      )}
      {dt?.status === 'out_for_delivery' && (
        <>
          <button onClick={() => act('governed_complete_delivery', { p_notes: notes })} className="w-full bg-success text-white rounded-xl p-3 text-sm font-semibold">تأكيد التسليم</button>
          <div className="bg-white rounded-xl border border-border p-4 space-y-3">
            <h3 className="text-sm font-semibold text-text">تسليم فاشل</h3>
            <select value={reason} onChange={e => setReason(e.target.value)} className="w-full border border-border rounded-lg p-2 text-sm">
              <option value="">اختر السبب...</option>
              {failureReasons.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="ملاحظات" rows={2} className="w-full border border-border rounded-lg p-2 text-sm" />
            <div className="flex gap-2">
              <button onClick={() => act('governed_fail_delivery', { p_reason: reason, p_notes: notes })} disabled={!reason} className="flex-1 bg-red-600 text-white rounded-xl p-2 text-sm font-semibold disabled:opacity-50">تسجيل فشل</button>
              <button onClick={() => act('governed_return_delivery', { p_notes: notes })} className="flex-1 bg-warning text-white rounded-xl p-2 text-sm font-semibold">إرجاع للمخزن</button>
            </div>
          </div>
        </>
      )}
      {canManage && (
        <OrderStatusManager
          orderId={dt?.order_id}
          currentStatus={dt?.status || 'sent_to_delivery'}
          canReview={false}
          canCompletePreparation={false}
          canSendToDelivery={false}
          canManage={true}
          onSuccess={() => load()}
          onError={(err) => toast.error(err)}
        />
      )}
      <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="ملاحظات عامة" rows={2} className="w-full border border-border rounded-lg p-2 text-sm" />
      <button onClick={() => navigate('/delivery')} className="w-full bg-surface text-text rounded-xl p-3 text-sm">العودة للقائمة</button>
    </div>
  )
}
