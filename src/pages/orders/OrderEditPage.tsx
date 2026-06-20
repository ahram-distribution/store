import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort } from '../../utils/format'
import { UNIT_LABELS, ORDER_STATUS_LABELS } from '../../types/order-display'
import toast from 'react-hot-toast'

function getToken() {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function OrderEditPage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const [order, setOrder] = useState<any>(null)
  const [tiers, setTiers] = useState<any[]>([])
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null)
  const [items, setItems] = useState<any[]>([])
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!id) return
    const token = getToken()
    if (!token) { setLoading(false); return }

    Promise.all([
      supabase.rpc('get_unified_order', { p_token: token, p_id: id }),
      supabase.rpc('get_governed_tiers', { p_token: token }),
    ]).then(([orderRes, tiersRes]) => {
      const raw = (orderRes.data as any)
      if (raw?.error) { setLoading(false); return }
      setOrder(raw.order)
      setItems(raw.items || [])
      const q: Record<string, number> = {}
      ;(raw.items || []).forEach((item: any) => { q[item.id] = item.unit_quantity })
      setQuantities(q)
      if (raw.order?.tier_id) setSelectedTierId(raw.order.tier_id)
      setTiers(tiersRes.data || [])
      setLoading(false)
    })
  }, [id])

  const handleQuantityChange = (itemId: string, val: number) => {
    setQuantities(prev => ({ ...prev, [itemId]: Math.max(1, val || 1) }))
  }

  const calcItemTotals = () => {
    let subtotal = 0
    let tierDiscount = 0
    const tier = tiers.find(t => t.id === selectedTierId)
    const discountPercent = tier ? Number(tier.discount_percent || 0) : 0

    items.forEach(item => {
      const qty = quantities[item.id] ?? item.unit_quantity
      const basePrice = item.unit_price || (item.total_price / item.unit_quantity)
      const total = qty * basePrice
      subtotal += total
      if (discountPercent > 0) {
        tierDiscount += total * (discountPercent / 100)
      }
    })

    const netTotal = subtotal - tierDiscount
    const minAmount = tier ? Number(tier.minimum_order_amount || 0) : 0
    const meetsMinimum = !selectedTierId || subtotal >= minAmount
    const remainingForMin = !meetsMinimum && tier ? minAmount - subtotal : 0

    return { subtotal, tierDiscount, netTotal, discountPercent, tier, meetsMinimum, remainingForMin }
  }

  const totals = calcItemTotals()

  const hasChanges = () => {
    return items.some(item => {
      const origQty = item.unit_quantity
      const currentQty = quantities[item.id] ?? item.unit_quantity
      return origQty !== currentQty
    }) || selectedTierId !== (order?.tier_id || null)
  }

  const handleSubmitRevision = async () => {
    const token = getToken()
    if (!token) { toast.error('جلسة منتهية'); return }

    setSubmitting(true)
    const { data, error } = await supabase.rpc('governed_submit_order', {
      p_token: token,
      p_id: id,
    })

    if (error) {
      toast.error(error.message)
      setSubmitting(false)
      return
    }
    if (data && typeof data === 'object' && 'error' in data && data.error) {
      toast.error(String(data.error))
      setSubmitting(false)
      return
    }
    toast.success('تم إرسال التعديلات للمراجعة')
    navigate(`/orders/${id}`)
  }

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري تحميل المنتجات...</div>

  return (
    <div className="space-y-4 pb-4 max-w-4xl mx-auto">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(`/orders/${id}`)} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">تعديل الطلب</h1>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
        <p className="text-xs text-amber-700 font-medium">
          تم إعادة هذا الطلب للتعديل — Revision #{order?.revision_number || 1}
        </p>
        <p className="text-[10px] text-amber-600">
          الحالة الحالية: {ORDER_STATUS_LABELS[order?.status] || order?.status}
          <span className="mx-1 text-text-secondary">|</span> رقم الطلب: {order?.order_number}
        </p>
      </div>

      <div className="bg-white rounded-lg border border-border p-3">
        <h3 className="text-sm font-semibold text-text mb-2">الشريحة السعرية</h3>
        <select
          value={selectedTierId || ''}
          onChange={(e) => setSelectedTierId(e.target.value || null)}
          className="w-full border border-border rounded-lg px-3 py-2 text-sm"
        >
          <option value="">السعر الأساسي</option>
          {tiers.map((t) => (
            <option key={t.id} value={t.id}>{t.name} (خصم {Math.ceil(Number(t.discount_percent || 0))}%)</option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-lg border border-border">
        <div className="px-3 py-2 border-b border-border">
          <h3 className="text-sm font-semibold text-text">المنتجات</h3>
        </div>
        <div className="divide-y divide-border">
          {items.length === 0 ? (
            <div className="px-3 py-4 text-center text-text-secondary text-sm">لا توجد منتجات</div>
          ) : items.map((item: any) => {
            const qty = quantities[item.id] ?? item.unit_quantity
            const unitPrice = item.unit_price || (item.total_price / item.unit_quantity)
            const total = qty * unitPrice
            return (
              <div key={item.id} className="flex items-center justify-between px-3 py-2.5">
                <div className="flex-1">
                  <span className="text-sm text-text">{item.product_name ?? `منتج ${item.product_id}`}</span>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="number"
                      value={quantities[item.id] ?? item.unit_quantity}
                      onChange={(e) => handleQuantityChange(item.id, parseInt(e.target.value) || 1)}
                      min={1}
                      className="w-16 border border-border rounded px-2 py-1 text-xs text-center"
                    />
                    <span className="text-xs text-text-secondary">{UNIT_LABELS[item.unit_type] || item.unit_type}</span>
                    <span className="text-[10px] text-text-secondary">
                      {formatCurrencyShort(unitPrice)}/{UNIT_LABELS[item.unit_type] || item.unit_type}
                    </span>
                  </div>
                </div>
                <span className="text-sm font-semibold text-text">{formatCurrencyShort(total)}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-border p-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-text-secondary">الإجمالي</span>
          <span>{formatCurrencyShort(totals.subtotal)}</span>
        </div>
        {totals.tierDiscount > 0 && (
          <div className="flex justify-between text-sm text-success">
            <span>خصم ({totals.tier?.name}) — {totals.discountPercent}%</span>
            <span>-{formatCurrencyShort(totals.tierDiscount)}</span>
          </div>
        )}
        <hr className="border-border" />
        <div className="flex justify-between text-base font-bold">
          <span>الإجمالي النهائي</span>
          <span>{formatCurrencyShort(totals.netTotal)}</span>
        </div>
      </div>

      {!totals.meetsMinimum && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-xs text-amber-700">
            لم يتم الوصول للحد الأدنى للشريحة. أضف منتجات بقيمة {formatCurrencyShort(totals.remainingForMin)} أو اختر شريحة أخرى.
          </p>
        </div>
      )}

      <button
        onClick={handleSubmitRevision}
        disabled={submitting || (selectedTierId !== null && !totals.meetsMinimum) || (selectedTierId === (order?.tier_id || null) && !hasChanges())}
        className="w-full bg-accent text-white text-sm py-3 rounded-lg disabled:opacity-40 active:opacity-90 transition-colors"
      >
        {submitting ? 'جاري الإرسال...' : 'إرسال التعديلات للمراجعة'}
      </button>
    </div>
  )
}
