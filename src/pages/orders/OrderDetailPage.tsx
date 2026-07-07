import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { OrderDetailView } from '../../components/orders/OrderDetailView'
import { OrderStatusManager } from '../../components/orders/OrderStatusManager'
import { SupremeOrderEditor } from '../../components/orders/SupremeOrderEditor'
import { useCapability } from '../../hooks/useCapability'
import { useAuthStore } from '../../store/auth'
import { isUpperManagement } from '../../utils/roleNormalization'
import toast from 'react-hot-toast'
import type { UnifiedOrder } from '../../types/unified-order'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

function isSupremeManagementUser(): boolean {
  const user = useAuthStore.getState().user
  if (!user?.roles) return false
  const supremeRoles = ['سوبر أدمن', 'SUPER_ADMIN', 'رئيس مجلس الإدارة', 'أدمن', 'ADMIN', 'CHAIRMAN']
  return user.roles.some((r: any) => {
    const name = typeof r === 'string' ? r : r?.name
    return supremeRoles.includes(name)
  })
}

export function OrderDetailPage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const [data, setData] = useState<UnifiedOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const canReview = useCapability('orders.review')
  const canCompletePreparation = useCapability('warehouse.complete_preparation')
  const canSendToDelivery = useCapability('transportation.send_to_delivery')
  const canManage = useCapability('orders.manage')

  const isSupreme = isSupremeManagementUser()

  function loadOrder() {
    if (!id) return
    setLoading(true)
    const token = getToken()
    if (!token) { setLoading(false); return }

    supabase.rpc('get_unified_order', { p_token: token, p_id: id }).then((res) => {
      if (res.error || !res.data) { setLoading(false); return }
      const raw = res.data
      if (raw?.error) { setLoading(false); return }
      setData(raw as UnifiedOrder)
      setLoading(false)
    })
  }

  useEffect(() => { loadOrder() }, [id])

  function handleStatusSuccess(newStatus: string) {
    toast.success(`تم تغيير الحالة إلى ${newStatus}`)
    loadOrder()
  }

  function handleStatusError(error: string) {
    toast.error(error)
  }

  function handleEditSaved() {
    setEditMode(false)
    loadOrder()
  }

  function handleDeleteOrder() {
    if (!id) return
    setDeleting(true)
    const token = getToken()
    if (!token) { setDeleting(false); return }

    supabase.rpc('governed_supreme_delete_cancelled_order', {
      p_token: token,
      p_order_id: id,
      p_reason: 'حذف بواسطة الإدارة العليا',
    }).then(({ data, error }) => {
      setDeleting(false)
      if (error) { toast.error('فشل حذف الطلب: ' + error.message); return }
      if (data && typeof data === 'object' && 'error' in data && data.error) {
        toast.error(String((data as any).detail || (data as any).error)); return
      }
      toast.success('تم حذف الطلب نهائياً')
      navigate('/orders')
    })
  }

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  if (!data) return <div className="text-center py-12 text-text-secondary text-sm">الطلب غير موجود</div>

  if (editMode) {
    return (
      <SupremeOrderEditor
        orderId={id!}
        initialItems={data.items}
        initialNotes={data.order.notes}
        customerId={data.order.customer_id}
        onSaved={handleEditSaved}
        onCancel={() => setEditMode(false)}
      />
    )
  }

  const canEdit = data.order.status === 'returned_for_revision' || (data.order.status === 'draft' && (data.order.revision_number || 0) >= 1)
  const isCancelled = data.order.status === 'cancelled'

  return (
    <OrderDetailView
      data={data}
      onBack={() => navigate('/orders')}
      actions={
        <div className="flex flex-col gap-1">
          {canEdit && (
            <button onClick={() => navigate(`/orders/${id}/edit`)}
              className="w-full bg-accent text-white text-xs py-2.5 rounded-lg active:opacity-90 flex items-center justify-center gap-1">
              تعديل الطلب
            </button>
          )}
          {isSupreme && (
            <button onClick={() => setEditMode(true)}
              className="w-full bg-accent text-white text-xs py-2.5 rounded-lg active:opacity-90 flex items-center justify-center gap-1">
              تحرير الطلب
            </button>
          )}
          {isSupreme && isCancelled && !deleteConfirm && (
            <button onClick={() => setDeleteConfirm(true)}
              className="w-full bg-danger text-white text-xs py-2.5 rounded-lg active:opacity-90 flex items-center justify-center gap-1">
              حذف الطلب
            </button>
          )}
          {isSupreme && isCancelled && deleteConfirm && (
            <div className="space-y-1">
              <p className="text-[10px] text-text-secondary text-center">هل تريد حذف هذا الطلب نهائياً؟</p>
              <div className="flex gap-1">
                <button onClick={handleDeleteOrder} disabled={deleting}
                  className="flex-1 bg-danger text-white text-xs py-2 rounded-lg active:opacity-90 disabled:opacity-40">
                  {deleting ? 'جاري...' : 'تأكيد الحذف'}
                </button>
                <button onClick={() => setDeleteConfirm(false)}
                  className="flex-1 bg-surface text-text-secondary text-xs py-2 rounded-lg active:opacity-90">
                  إلغاء
                </button>
              </div>
            </div>
          )}
          {data?.order?.status && (
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
          )}
        </div>
      }
    />
  )
}
