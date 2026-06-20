import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useCartStore } from '../../store/cart'
import { formatCurrencyShort } from '../../utils/format'
import { UNIT_LABELS } from '../../types/order-display'
import toast from 'react-hot-toast'

function getToken() {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function OrderEditPage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const { tiers, selectedTierId, selectTier, getSelectedTier, getTotals } = useCartStore()
  const [items, setItems] = useState<any[]>([])
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    const token = getToken()
    if (!token) { setLoading(false); return }
    supabase.rpc('get_unified_order', { p_token: token, p_id: id }).then((res) => {
      const data = ((res.data as any)?.items as any[]) || []
      setItems(data)
      const q: Record<string, number> = {}
      data.forEach((item: any) => { q[item.id] = item.unit_quantity })
      setQuantities(q)
      setLoading(false)
    })
  }, [id])

  const selectedTier = getSelectedTier()
  const totals = getTotals()

  const handleSubmitRevision = () => {
    toast.success('تم إرسال التعديلات للمراجعة')
    navigate(`/orders/${id}`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(`/orders/${id}`)} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">تعديل الطلب</h1>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <p className="text-xs text-amber-700">
          تم إعادة هذا الطلب للتعديل. يمكنك تعديل المنتجات والكميات ثم إعادة الإرسال.
        </p>
      </div>

      <div className="bg-white rounded-lg border border-border p-3">
        <h3 className="text-sm font-semibold text-text mb-2">تغيير الشريحة</h3>
        <select
          value={selectedTierId || ''}
          onChange={(e) => selectTier(e.target.value || null)}
          className="w-full border border-border rounded-lg px-3 py-2 text-sm"
        >
          <option value="">السعر الأساسي</option>
          {tiers.map((t) => (
            <option key={t.id} value={t.id}>{t.name} (خصم يصل إلى {Math.ceil(t.discountPercent)}%)</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري تحميل المنتجات...</div>
      ) : (
        <div className="bg-white rounded-lg border border-border">
          <div className="px-3 py-2 border-b border-border"><h3 className="text-sm font-semibold text-text">المنتجات</h3></div>
          <div className="divide-y divide-border">
            {items.length === 0 ? (
              <div className="px-3 py-4 text-center text-text-secondary text-sm">لا توجد منتجات</div>
            ) : items.map((item: any) => {
              const qty = quantities[item.id] ?? item.unit_quantity
              const unitPrice = item.total_price / item.unit_quantity
              const total = qty * unitPrice
              return (
                <div key={item.id} className="flex items-center justify-between px-3 py-2.5">
                  <div className="flex-1">
                    <span className="text-sm text-text">{item.product_name ?? `منتج ${item.product_id}`}</span>
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="number"
                        value={quantities[item.id] ?? item.unit_quantity}
                        onChange={(e) => setQuantities({ ...quantities, [item.id]: Math.max(1, parseInt(e.target.value) || 1) })}
                        min={1}
                        className="w-16 border border-border rounded px-2 py-1 text-xs text-center"
                      />
                      <span className="text-xs text-text-secondary">{UNIT_LABELS[item.unit_type] || item.unit_type}</span>
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-text">{formatCurrencyShort(total)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-border p-4 space-y-2">
        <div className="flex justify-between text-sm"><span className="text-text-secondary">الإجمالي</span><span>{formatCurrencyShort(totals.subtotal)}</span></div>
        {totals.tierDiscount > 0 && <div className="flex justify-between text-sm text-success"><span>خصم ({selectedTier?.name})</span><span>-{formatCurrencyShort(totals.tierDiscount)}</span></div>}
        <hr className="border-border" />
        <div className="flex justify-between text-base font-bold"><span>الإجمالي النهائي</span><span>{formatCurrencyShort(totals.netTotal)}</span></div>
      </div>

      {selectedTier && !totals.meetsTierMinimum && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-xs text-amber-700">
            لم يتم الوصول للحد الأدنى للشريحة. أضف منتجات بقيمة {formatCurrencyShort(totals.remainingForMinimum)} أو اختر شريحة أخرى.
          </p>
        </div>
      )}

      <button
        onClick={handleSubmitRevision}
        disabled={selectedTier !== null && !totals.meetsTierMinimum}
        className="w-full bg-accent text-white text-sm py-3 rounded-lg disabled:opacity-40 active:opacity-90 transition-colors"
      >
        إرسال التعديلات للمراجعة
      </button>
    </div>
  )
}
