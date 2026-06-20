import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import { returnService, type ReturnItemInput } from '../../services/returns'
import { formatCurrencyShort } from '../../utils/format'
import { UNIT_LABELS } from '../../types/order-display'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface OrderItemRow {
  id: string
  product_id: string
  unit_type: string
  unit_quantity: number
  piece_quantity: number
  unit_price: number
  total_price: number
  product_name?: string
}

export function ReturnNewPage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const isCustomer = user?.identity_type === 'customer'

  const [orders, setOrders] = useState<any[]>([])
  const [loadingOrders, setLoadingOrders] = useState(true)
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [orderItems, setOrderItems] = useState<OrderItemRow[]>([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [returnItems, setReturnItems] = useState<Record<string, { quantity: number; unit_type: string; reason: string; product_id: string }>>({})
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoadingOrders(false); return }
    supabase.rpc('get_unified_orders', { p_token: token }).then(({ data }) => {
      let result = (data as any[]) || []
      result = result.filter((o: any) => o.status === 'delivered')
      setOrders(result)
      setLoadingOrders(false)
    })
  }, [])

  useEffect(() => {
    if (!selectedOrderId) { setOrderItems([]); return }
    setLoadingItems(true)
    const token = getToken()
    if (!token) return
    supabase.rpc('get_unified_order', { p_token: token, p_id: selectedOrderId }).then(({ data }) => {
      const order = data as any
      const items = (order?.items as any[]) || []
      const enriched = items.map((i: any) => ({
        ...i,
        product_name: i.product_name || i.product_id,
      }))
      setOrderItems(enriched)
      const initial: Record<string, { quantity: number; unit_type: string; reason: string; product_id: string }> = {}
      enriched.forEach((item: any) => {
        initial[item.product_id] = { quantity: 0, unit_type: item.unit_type, reason: '', product_id: item.product_id }
      })
      setReturnItems(initial)
      setLoadingItems(false)
    })
  }, [selectedOrderId])

  const selectedOrder = orders.find((o) => o.id === selectedOrderId)

  const updateReturnItem = (productId: string, field: string, value: any) => {
    setReturnItems((prev) => ({
      ...prev,
      [productId]: { ...prev[productId], [field]: value },
    }))
  }

  const hasAnyItems = Object.values(returnItems).some((ri) => ri.quantity > 0)

  const handleSubmit = async () => {
    if (!selectedOrderId) return
    const items: ReturnItemInput[] = Object.values(returnItems)
      .filter((ri) => ri.quantity > 0)
      .map((ri) => ({
        product_id: ri.product_id,
        unit_type: ri.unit_type as 'piece' | 'dozen' | 'carton',
        quantity: ri.quantity,
        reason: ri.reason || undefined,
      }))
    if (items.length === 0) { toast.error('اختر منتج واحد على الأقل'); return }
    setSubmitting(true)
    const result = await returnService.create(selectedOrderId, selectedOrder.customer_id, notes || null, items)
    setSubmitting(false)
    if (!result.success) {
      toast.error(result.error || 'فشل إنشاء المرتجع')
      return
    }
    toast.success('تم إنشاء المرتجع بنجاح')
    navigate('/returns/' + result.return!.id)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/returns')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">مرتجع جديد</h1>
      </div>

      {loadingOrders ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : orders.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">لا توجد طلبات مكتملة لإنشاء مرتجع</div>
      ) : (
        <>
          <div className="bg-white rounded-lg border border-border">
            <div className="px-3 py-2 border-b border-border">
              <h3 className="text-sm font-semibold text-text">اختر الطلب</h3>
            </div>
            <div className="divide-y divide-border max-h-60 overflow-y-auto">
              {orders.map((order) => (
                <div
                  key={order.id}
                  onClick={() => setSelectedOrderId(order.id)}
                  className={`px-3 py-2.5 cursor-pointer transition-colors ${
                    selectedOrderId === order.id ? 'bg-primary/5 border-r-2 border-primary' : 'active:bg-surface'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-text">{order.order_number || order.id.slice(0, 8)}</span>
                    <span className="text-sm font-bold text-danger">{formatCurrencyShort(order.total_amount)}</span>
                  </div>
                  <div className="text-xs text-text-secondary mt-0.5">{order.customer_name || ''}</div>
                </div>
              ))}
            </div>
          </div>

          {selectedOrderId && (
            <>
              {loadingItems ? (
                <div className="text-center py-8 text-text-secondary text-sm">جاري تحميل المنتجات...</div>
              ) : (
                <div className="space-y-2">
                  {orderItems.map((item) => {
                    const ri = returnItems[item.product_id]
                    if (!ri) return null
                    return (
                      <div key={item.id} className="bg-white rounded-lg border border-border p-3">
                        <div className="text-sm font-semibold text-text mb-2">{item.product_name}</div>
                        <div className="text-xs text-text-secondary mb-2">
                          متوفر: {item.unit_quantity} {UNIT_LABELS[item.unit_type] || 'قطعة'} | السعر: {formatCurrencyShort(item.unit_price)} للوحدة
                        </div>
                        <div className="flex gap-3">
                          <div className="flex-1">
                            <label className="text-xs text-text-secondary block mb-1">الكمية المرتجعة</label>
                            <input
                              type="number"
                              min={0}
                              max={item.unit_quantity}
                              value={ri.quantity}
                              onChange={(e) => updateReturnItem(item.product_id, 'quantity', Math.max(0, Math.min(item.unit_quantity, parseInt(e.target.value) || 0)))}
                              className="w-full border border-border rounded-lg px-3 py-2 text-sm text-text"
                            />
                          </div>
                          <div className="flex-1">
                            <label className="text-xs text-text-secondary block mb-1">السبب</label>
                            <input
                              value={ri.reason}
                              onChange={(e) => updateReturnItem(item.product_id, 'reason', e.target.value)}
                              placeholder="اختياري"
                              className="w-full border border-border rounded-lg px-3 py-2 text-sm text-text"
                            />
                          </div>
                        </div>
                      </div>
                    )
                  })}

                  <div className="bg-white rounded-lg border border-border p-3">
                    <label className="text-xs text-text-secondary block mb-1">ملاحظات إضافية</label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                      className="w-full border border-border rounded-lg px-3 py-2 text-sm text-text resize-none"
                    />
                  </div>

                  <button
                    onClick={handleSubmit}
                    disabled={!hasAnyItems || submitting}
                    className="w-full bg-primary text-white text-sm py-3 rounded-lg disabled:opacity-50 active:opacity-90 transition-colors"
                  >
                    {submitting ? 'جاري الإنشاء...' : 'إنشاء المرتجع'}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
