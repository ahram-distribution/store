import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { OrderDetailView } from '../../components/orders/OrderDetailView'
import { OrderStatusManager } from '../../components/orders/OrderStatusManager'
import { useCapability } from '../../hooks/useCapability'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function OrderDetailPage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const [order, setOrder] = useState<any>(null)
  const [items, setItems] = useState<any[]>([])
  const [history, setHistory] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const canReview = useCapability('orders.review')
  const canCompletePreparation = useCapability('warehouse.complete_preparation')
  const canSendToDelivery = useCapability('transportation.send_to_delivery')
  const canManage = useCapability('orders.manage')

  useEffect(() => {
    if (!id) return
    const token = getToken()
    if (!token) { setLoading(false); return }

    Promise.all([
      supabase.rpc('get_governed_order', { p_token: token, p_id: id }),
      supabase.rpc('get_governed_order_items', { p_token: token, p_order_id: id }),
      supabase.rpc('get_governed_order_history', { p_token: token, p_order_id: id }),
    ]).then(([orderRes, itemsRes, historyRes]) => {
      if (orderRes.error || !orderRes.data) { setLoading(false); return }
      const raw = orderRes.data
      if (raw?.error) { setLoading(false); return }
      setOrder(raw)

      if (itemsRes?.data && Array.isArray(itemsRes.data)) {
        const mapped = itemsRes.data.map((i: any) => {
          return { ...i, products: { product_name: i.product_name, legacy_code: i.legacy_code, image_url: i.image_url, companies: { company_name: i.company_name } } }
        })
        setItems(mapped)
      }
      if (historyRes.data) setHistory(Array.isArray(historyRes.data) ? historyRes.data : [])

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
  if (!order) return <div className="text-center py-12 text-text-secondary text-sm">الطلب غير موجود</div>

  return (
    <OrderDetailView
      order={order}
      items={items}
      history={history}
      onBack={() => navigate('/orders')}
      actions={order?.status ? (
        <OrderStatusManager
          orderId={id!}
          currentStatus={order.status}
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
