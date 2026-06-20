import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { OrderStatusManager } from '../../components/orders/OrderStatusManager'
import { useCapability } from '../../hooks/useCapability'
import toast from 'react-hot-toast'
import { formatCurrencyShort } from '../../utils/format'

function getToken() { try { return localStorage.getItem('session_token') } catch { return null } }

interface DeliveryItem {
  id: string; order_id: string; order_number: string; customer_name: string; status: string
  assigned_to_name: string | null; assigned_at: string; started_at: string | null; completed_at: string | null
  failure_reason: string | null; notes: string | null; total_amount: number
}

const statusLabels: Record<string, string> = {
  assigned: 'تم التعيين', out_for_delivery: 'قيد التوصيل', delivered: 'تم التسليم', failed: 'فشل', returned: 'مرتجع'
}
const statusColors: Record<string, string> = {
  assigned: 'bg-blue-100 text-blue-700', out_for_delivery: 'bg-yellow-100 text-yellow-700',
  delivered: 'bg-green-100 text-green-700', failed: 'bg-red-100 text-red-700', returned: 'bg-gray-100 text-gray-600'
}

export function DeliveryPage() {
  const navigate = useNavigate(); const [searchParams] = useSearchParams()
  const [items, setItems] = useState<DeliveryItem[]>([]); const [loading, setLoading] = useState(true)
  const [employees, setEmployees] = useState<{ id: string; code: string }[]>([])
  const [filter, setFilter] = useState(searchParams.get('filter') || '')
  const [showAssign, setShowAssign] = useState<string | null>(null)
  const [assignEmp, setAssignEmp] = useState('')
  const canManage = useCapability('orders.manage')

  useEffect(() => {
    const token = getToken(); if (!token) return
    Promise.all([
      supabase.rpc('get_governed_deliveries', { p_token: token, p_status_filter: filter || null }),
      supabase.rpc('get_governed_employees', { p_token: token }),
    ]).then(([d, e]) => {
      if (d.data) setItems(d.data as DeliveryItem[])
      const empData = (e.data as any[]) || []
      setEmployees(empData.filter((emp: any) => emp.is_active).map((emp: any) => ({ id: emp.id, code: emp.code })))
      setLoading(false)
    })
  }, [filter])

  const assign = async (deliveryId: string) => {
    const token = getToken(); if (!token || !assignEmp) return
    await supabase.rpc('governed_assign_delivery', { p_token: token, p_delivery_id: deliveryId, p_employee_id: assignEmp })
    setShowAssign(null); setAssignEmp('')
    const { data } = await supabase.rpc('get_governed_deliveries', { p_token: token, p_status_filter: filter || null })
    if (data) setItems(data as DeliveryItem[])
  }

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>

  const statuses = ['', 'assigned', 'out_for_delivery', 'delivered', 'failed', 'returned'] as const

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-success to-green-700 text-white rounded-xl p-5">
        <p className="text-sm opacity-90">النقل والتوصيل</p>
        <h2 className="text-xl font-bold mt-1">إدارة التوصيل</h2>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {statuses.map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-semibold ${filter === s ? 'bg-success text-white' : 'bg-white border border-border text-text-secondary'}`}>
            {s ? statusLabels[s] : 'الكل'} ({items.length})
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {items.map(item => (
          <div key={item.id} className="bg-white rounded-xl border border-border p-4">
            <div className="flex items-center justify-between mb-2">
              <span className={`text-xs px-2 py-1 rounded-full ${statusColors[item.status]}`}>{statusLabels[item.status]}</span>
              <span className="text-sm font-semibold text-text">{item.customer_name}</span>
            </div>
            <div className="text-xs text-text-secondary space-y-1">
              <p>الطلب: {item.order_number} - {formatCurrencyShort(item.total_amount)}</p>
              <p>المندوب: {item.assigned_to_name || 'غير معين'}</p>
              {item.started_at && <p>بدء: {new Date(item.started_at).toLocaleString('ar-EG-u-nu-latn')}</p>}
              {item.completed_at && <p>اكتمل: {new Date(item.completed_at).toLocaleString('ar-EG-u-nu-latn')}</p>}
              {item.failure_reason && <p className="text-red-600">السبب: {item.failure_reason}</p>}
            </div>
            <div className="flex gap-2 mt-3">
              {item.status === 'assigned' && (
                <button onClick={() => navigate(`/delivery/${item.id}`)} className="flex-1 bg-primary text-white rounded-xl p-2 text-xs">بدء التوصيل</button>
              )}
              {['assigned', 'out_for_delivery'].includes(item.status) && (
                <button onClick={() => navigate(`/delivery/${item.id}`)} className="flex-1 bg-accent text-white rounded-xl p-2 text-xs">تحديث</button>
              )}
              {item.status === 'assigned' && (
                <>
                  {showAssign === item.id ? (
                    <div className="flex gap-1 flex-1">
                      <select value={assignEmp} onChange={e => setAssignEmp(e.target.value)} className="flex-1 border border-border rounded-lg p-1 text-xs">
                        <option value="">مندوب...</option>
                        {employees.map(e => <option key={e.id} value={e.id}>{e.code}</option>)}
                      </select>
                      <button onClick={() => assign(item.id)} className="bg-success text-white rounded-xl px-3 text-xs">تعيين</button>
                    </div>
                  ) : (
                    <button onClick={() => { setShowAssign(item.id); setAssignEmp('') }} className="flex-1 bg-surface text-text rounded-xl p-2 text-xs">تعيين مندوب</button>
                  )}
                </>
              )}
            </div>
            {canManage && (
              <OrderStatusManager
                orderId={item.order_id}
                currentStatus={item.status}
                canReview={false}
                canCompletePreparation={false}
                canSendToDelivery={false}
                canManage={true}
                onSuccess={async () => {
                  const token = getToken(); if (!token) return
                  const { data } = await supabase.rpc('get_governed_deliveries', { p_token: token, p_status_filter: filter || null })
                  if (data) setItems(data as DeliveryItem[])
                }}
                onError={(err) => toast.error(err)}
              />
            )}
          </div>
        ))}
        {items.length === 0 && <p className="text-center text-text-secondary text-sm py-8">لا توجد توصيلات</p>}
      </div>
    </div>
  )
}
