import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { OrderDetailView } from '../../components/orders/OrderDetailView'
import { OrderStatusManager } from '../../components/orders/OrderStatusManager'
import { useCapability } from '../../hooks/useCapability'
import { useAuthStore } from '../../store/auth'
import { isUpperManagement } from '../../utils/roleNormalization'
import toast from 'react-hot-toast'
import type { UnifiedOrder } from '../../types/unified-order'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function OrderDetailPage() {
  console.log("ORDER DETAIL BUILD VERSION: 2026-07-04-A")
  const navigate = useNavigate()
  const { id } = useParams()
  const [data, setData] = useState<UnifiedOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [showOwnerModal, setShowOwnerModal] = useState(false)
  const [employees, setEmployees] = useState<any[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedOwnerId, setSelectedOwnerId] = useState('')
  const [saving, setSaving] = useState(false)

  const user = useAuthStore((s) => s.user)
  const canEditOwner = user?.roles?.some((r) => isUpperManagement(r)) ?? false

  const canReview = useCapability('orders.review')
  const canCompletePreparation = useCapability('warehouse.complete_preparation')
  const canSendToDelivery = useCapability('transportation.send_to_delivery')
  const canManage = useCapability('orders.manage')

  const filteredEmployees = useMemo(() => {
    if (!searchQuery) return employees
    const q = searchQuery.toLowerCase()
    return employees.filter((e) =>
      (e.name || e.full_name || '').toLowerCase().includes(q) ||
      (e.code || '').toLowerCase().includes(q)
    )
  }, [employees, searchQuery])

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

  function handleOpenOwnerModal() {
    const token = getToken()
    if (!token) return
    setSearchQuery('')
    setSelectedOwnerId(data?.order?.owner_id || '')
    supabase.rpc('get_governed_employees', { p_token: token }).then(({ data: empData }) => {
      setEmployees(Array.isArray(empData) ? empData : [])
    })
    setShowOwnerModal(true)
  }

  async function handleSaveOwner() {
    if (!selectedOwnerId || !id) return
    const token = getToken()
    if (!token) return
    setSaving(true)
    try {
      const { data: res, error } = await supabase.rpc('governed_update_order_owner', {
        p_token: token,
        p_order_id: id,
        p_new_owner_id: selectedOwnerId,
      })
      if (error) throw error
      if (res?.error === 'FORBIDDEN') { toast.error('ليس لديك صلاحية'); return }
      if (res?.error) { toast.error(res.error); return }
      toast.success('تم نقل ملكية الطلب بنجاح')
      setShowOwnerModal(false)
      supabase.rpc('get_unified_order', { p_token: token, p_id: id }).then((r) => {
        if (r.error || !r.data) return
        setData(r.data as UnifiedOrder)
      })
    } catch (err: any) {
      toast.error(err.message || 'فشل نقل الملكية')
    } finally {
      setSaving(false)
    }
  }

  function handleStatusSuccess(newStatus: string) {
    toast.success(`تم تغيير الحالة إلى ${newStatus}`)
    const token = getToken()
    if (!token || !id) return
    supabase.rpc('get_unified_order', { p_token: token, p_id: id }).then((res) => {
      if (res.error || !res.data) return
      const raw = res.data
      if (raw?.error) return
      setData(raw as UnifiedOrder)
    })
  }

  function handleStatusError(error: string) {
    toast.error(error)
  }

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  if (!data) return <div className="text-center py-12 text-text-secondary text-sm">الطلب غير موجود</div>

  const canEdit = data.order.status === 'returned_for_revision' || (data.order.status === 'draft' && (data.order.revision_number || 0) >= 1)

  return (
    <>
      <OrderDetailView
        data={data}
        onBack={() => navigate('/orders')}
        onEditCreator={canEditOwner ? handleOpenOwnerModal : undefined}
        actions={
          <div className="flex flex-col gap-1">
            {canEdit && (
              <button onClick={() => navigate(`/orders/${id}/edit`)}
                className="w-full bg-accent text-white text-xs py-2.5 rounded-lg active:opacity-90 flex items-center justify-center gap-1">
                تعديل الطلب
              </button>
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

      {showOwnerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => !saving && setShowOwnerModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-border">
              <h3 className="font-bold text-text text-sm">نقل ملكية الطلب</h3>
            </div>
            <div className="p-4 space-y-3">
              <input
                type="text"
                placeholder="ابحث عن موظف..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent/30"
                autoFocus
              />
              <div className="max-h-60 overflow-y-auto space-y-1">
                {filteredEmployees.length === 0 ? (
                  <p className="text-text-secondary text-xs text-center py-4">لا يوجد موظفين</p>
                ) : (
                  filteredEmployees.map((emp) => (
                    <button
                      key={emp.id}
                      onClick={() => setSelectedOwnerId(emp.id)}
                      className={`w-full text-right px-3 py-2.5 rounded-lg text-sm transition-colors ${
                        selectedOwnerId === emp.id
                          ? 'bg-accent/10 text-accent border border-accent/30'
                          : 'hover:bg-gray-50 text-text border border-transparent'
                      }`}
                    >
                      <span className="font-medium">{emp.name || emp.full_name}</span>
                      {emp.role_type && <span className="text-text-secondary text-[10px] mr-2">— {emp.role_type}</span>}
                    </button>
                  ))
                )}
              </div>
            </div>
            <div className="flex gap-2 p-4 border-t border-border">
              <button
                onClick={() => setShowOwnerModal(false)}
                disabled={saving}
                className="flex-1 py-2.5 rounded-lg text-sm border border-border text-text-secondary hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                onClick={handleSaveOwner}
                disabled={!selectedOwnerId || saving}
                className="flex-1 py-2.5 rounded-lg text-sm bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {saving ? 'جاري الحفظ...' : 'حفظ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
