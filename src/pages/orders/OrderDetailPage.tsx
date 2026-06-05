import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { OrderDetailView } from '../../components/orders/OrderDetailView'
import { OrderStatusManager } from '../../components/orders/OrderStatusManager'
import { useCapability } from '../../hooks/useCapability'
import { locationService } from '../../services/location'
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
  const [customer, setCustomer] = useState<any>(null)
  const [creator, setCreator] = useState<any>(null)
  const [owner, setOwner] = useState<any>(null)
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
    ]).then(async ([orderRes, itemsRes, historyRes]) => {
      if (orderRes.error || !orderRes.data) { setLoading(false); return }
      const raw = orderRes.data
      setOrder(raw)
      if (itemsRes.data && Array.isArray(itemsRes.data)) setItems(itemsRes.data.map((i: any) => ({ ...i, products: { product_name: i.product_name, legacy_code: i.legacy_code, image_url: i.image_url, companies: { company_name: i.company_name } } })))
      if (historyRes.data) setHistory(Array.isArray(historyRes.data) ? historyRes.data : [])

      const cusId = raw.customer_id
      const empCreatorId = raw.created_by
      const empOwnerId = raw.owner_id

      if (cusId) {
        let custRes, contRes;
        try { custRes = await supabase.rpc('get_governed_customer', { p_token: token, p_id: cusId }); } catch { custRes = null; }
        try { contRes = await supabase.rpc('get_governed_customer_contacts', { p_token: token, p_customer_id: cusId }); } catch { contRes = null; }

        if (custRes?.data) {
          const c = Array.isArray(custRes.data) ? custRes.data[0] : custRes.data
          const contacts = Array.isArray(contRes?.data) ? contRes.data : []
          const primaryContact = contacts.find((c2: any) => c2.is_primary) || contacts[0]
          const phone = primaryContact?.phone || c.phone || ''
          let address = raw.customer_address || ''
          let mapsUrl = ''
          if (c.location_id) {
            const loc = await locationService.fetchLocation(c.location_id)
            if (loc) {
              address = loc.formatted_address || address
              mapsUrl = loc.google_maps_url
            }
          }
          setCustomer({ id: cusId, name: c.company_name || c.customer_name || c.name || raw.customer_name || '', phone, address, mapsUrl })
        } else {
          setCustomer({ id: cusId, name: raw.customer_name || '', phone: raw.customer_phone || '', address: raw.customer_address || '', mapsUrl: '' })
        }
      }

      if (empCreatorId) {
        let empRes;
        try { empRes = await supabase.rpc('get_governed_employee', { p_token: token, p_employee_id: empCreatorId }); } catch { empRes = null; }
        if (empRes?.data && !empRes.data.error) setCreator({ id: empCreatorId, name: empRes.data.full_name || '', role: empRes.data.role || '', phone: empRes.data.phone || '', address: '', mapsUrl: '' })
      }

      if (empOwnerId && empOwnerId !== empCreatorId) {
        let empRes;
        try { empRes = await supabase.rpc('get_governed_employee', { p_token: token, p_employee_id: empOwnerId }); } catch { empRes = null; }
        if (empRes?.data && !empRes.data.error) setOwner({ id: empOwnerId, name: empRes.data.full_name || '', role: empRes.data.role || '', phone: empRes.data.phone || '', address: '', mapsUrl: '' })
      } else if (empOwnerId) {
        setOwner(creator)
      }

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
      customer={customer}
      creator={creator}
      owner={owner}
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
