import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { OrderDetailView } from '../../components/orders/OrderDetailView'
import { OrderStatusManager } from '../../components/orders/OrderStatusManager'
import { useCapability } from '../../hooks/useCapability'
import toast from 'react-hot-toast'
import type { UnifiedOrder } from '../../types/unified-order'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function OrderDetailPage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const [data, setData] = useState<UnifiedOrder | null>(null)
  const [loading, setLoading] = useState(true)

  const canReview = useCapability('orders.review')
  const canCompletePreparation = useCapability('warehouse.complete_preparation')
  const canSendToDelivery = useCapability('transportation.send_to_delivery')
  const canManage = useCapability('orders.manage')

  useEffect(() => {
    if (!id) return
    const token = getToken()
    if (!token) { setLoading(false); return }

    supabase.rpc('get_unified_order', { p_token: token, p_id: id }).then((res) => {
      if (res.error || !res.data) { setLoading(false); return }
      const raw = res.data
      if (raw?.error) { setLoading(false); return }
      setData(raw as UnifiedOrder)
      setLoading(false)
    })
  }, [id])

  function handleStatusSuccess(newStatus: string) {
    toast.success(`تم تغيير الحالة إلى ${newStatus}`)
    window.location.reload()
  }

  function handleStatusError(error: string) {
    toast.error(error)
  }

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  if (!data) return <div className="text-center py-12 text-text-secondary text-sm">الطلب غير موجود</div>

  return (
    <OrderDetailView
      data={data}
      onBack={() => navigate('/orders')}
      actions={data?.order?.status ? (
        <OrderStatusManager
          orderId={id!}
          currentStatus={data.order.status}
          canReview={canReview}
          canCompletePreparation={canCompletePreparation}
          canSendToDelivery={canSendToDelivery}
          canManage={canManage}
          onSuccess={handleStatusSuccess}
          onError={handleStatusError}
        />
      ) : undefined}
    />
  )
}
