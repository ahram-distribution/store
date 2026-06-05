import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { OrderStatusManager } from '../../components/orders/OrderStatusManager'
import { useCapability } from '../../hooks/useCapability'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function ApprovalQueuePage() {
  const navigate = useNavigate()
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const canReview = useCapability('orders.review')
  const canManage = useCapability('orders.manage')

  const loadOrders = useCallback(async () => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    const { data } = await supabase.rpc('get_governed_orders', { p_token: token })
    if (data) {
      const submitted = (Array.isArray(data) ? data : []).filter((o: any) => o.status === 'submitted')
      setOrders(submitted)
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadOrders() }, [loadOrders])

  const getAge = (createdAt: string) => {
    const diff = Date.now() - new Date(createdAt).getTime()
    const hours = Math.floor(diff / (1000 * 60 * 60))
    if (hours < 24) return `${hours} ساعة`
    const days = Math.floor(hours / 24)
    return `${days} يوم`
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">طلبات بانتظار الاعتماد</h1>
      </div>

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : orders.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">لا توجد طلبات بانتظار الاعتماد</div>
      ) : (
        <div className="space-y-2">
          {orders.map((o: any) => (
            <div key={o.id} className="bg-white rounded-xl border border-border p-3">
              <div className="flex items-start justify-between mb-1">
                <div className="flex-1 min-w-0 ml-2">
                  <button onClick={() => navigate(`/orders/${o.id}`)} className="text-sm font-bold text-primary hover:underline">
                    {o.order_number || o.id?.slice(0, 8)}
                  </button>
                  <p className="text-xs text-text-secondary truncate">{o.customer_name || '—'}</p>
                </div>
                <span className="text-[10px] bg-accent/10 text-accent px-2 py-0.5 rounded-full shrink-0">{getAge(o.created_at)}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-text-secondary mb-2">
                <span>{o.employee_name || o.responsible_name || '—'}</span>
                <span className="font-semibold text-text">{Number(o.total_amount || 0).toLocaleString('ar-EG')} ج</span>
              </div>
              <div className="flex gap-2">
                <OrderStatusManager
                  orderId={o.id}
                  currentStatus="submitted"
                  canReview={canReview && !canManage}
                  canCompletePreparation={false}
                  canSendToDelivery={false}
                  canManage={canManage}
                  onSuccess={() => {
                    toast.success('تم تحديث حالة الطلب')
                    setOrders((prev) => prev.filter((x) => x.id !== o.id))
                  }}
                  onError={(err) => toast.error(err)}
                />
                <button
                  onClick={() => navigate(`/orders/${o.id}`)}
                  className="shrink-0 bg-surface text-text text-xs py-2.5 px-3 rounded-lg border border-border"
                >
                  عرض
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
