import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCartStore } from '../../store/cart'
import { useAccountStore } from '../../store/account'
import { useOrdersStore } from '../../store/orders'
import { formatCurrencyShort } from '../../utils/format'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { UNIT_LABELS } from '../../types/order-display'
import { GuidedError } from '../../components/shared/GuidedError'
import toast from 'react-hot-toast'
import type { OrderRecord, OrderItemRecord, OrderStatus } from '../../types/storefront'

export function CheckoutPage() {
  const navigate = useNavigate()
  const { items, products, getSelectedTier, getTotals, resetOrderContext } = useCartStore()
  const { addresses, defaultAddressId } = useAccountStore()
  const { addOrder } = useOrdersStore()
  const [notes, setNotes] = useState('')
  const [selectedAddressId, setSelectedAddressId] = useState(defaultAddressId || '')
  const [paymentMethod, setPaymentMethod] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)

  const selectedTier = getSelectedTier()
  const totals = getTotals()
  const defaultAddr = addresses.find((a) => a.id === selectedAddressId)

  if (items.length === 0) {
    navigate('/cart')
    return null
  }

  const handleSubmit = async () => {
    const blockedItem = items.find((item) => {
      const product = products.find((p) => p.id === item.productId)
      if (!product || !product.isActive || product.isOutOfStock) return true
      if (!product.unitPrices.some((u) => u.unitType === item.unitType)) return true
      return false
    })
    if (blockedItem) {
      toast.error('السلة تحتوي على منتجات غير متوفرة حالياً. يرجى العودة للسلة وإزالتها.')
      navigate('/cart')
      return
    }

    if (selectedTier && !totals.meetsTierMinimum) {
      toast.error('لم يتم الوصول إلى الحد الأدنى للشريحة')
      navigate('/cart')
      return
    }
    if (!paymentMethod) {
      toast.error('يرجى اختيار طريقة الدفع')
      return
    }

    setSubmitting(true)

    const orderId = crypto.randomUUID?.() || Math.random().toString(36).slice(2)
    const seq = Math.floor(Math.random() * 999999) + 1
    const orderNumber = `AHR-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`
    const now = new Date().toISOString()

    const orderRecord: OrderRecord = {
      id: orderId,
      orderNumber,
      status: 'submitted',
      subtotal: totals.subtotal,
      discountAmount: totals.tierDiscount,
      totalAmount: totals.netTotal,
      notes: notes || undefined,
      tierId: selectedTier?.id,
      tierName: selectedTier?.name,
      revisionNumber: 1,
      submittedAt: now,
      createdAt: now,
      itemCount: items.length,
    }

    const orderItems: OrderItemRecord[] = items.map((item, i) => ({
      id: crypto.randomUUID?.() || Math.random().toString(36).slice(2) + i,
      productId: item.productId,
      productName: item.productName,
      unitType: item.unitType,
      unitQuantity: item.unitQuantity,
      pieceQuantity: item.pieceQuantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
    }))

    addOrder(orderRecord)

    const state = {
      order: orderRecord,
      items: orderItems,
      address: defaultAddr,
      paymentMethod,
      paymentLabel: paymentLabels[paymentMethod] || paymentMethod,
    }
    sessionStorage.setItem('lastOrder', JSON.stringify(state))

    resetOrderContext()
    toast.success('تم إرسال الطلب بنجاح!')
    navigate('/order-success')
  }

  const paymentLabels: Record<string, string> = {
    cash: 'نقداً',
    bank_transfer: 'تحويل بنكي',
    cheque: 'شيك',
    deposit: 'إيداع',
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/order-review')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">إتمام الطلب</h1>
      </div>

      {selectedTier && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="text-xs text-blue-800">
            <span className="font-semibold">الشريحة: {selectedTier.name}</span>
            {' | '}خصم يصل إلى {Math.ceil(selectedTier.discountPercent)}% | الحد الأدنى: {formatCurrencyShort(selectedTier.minimumOrderAmount)}
          </div>
        </div>
      )}

      {addresses.length > 0 && (
        <div className="bg-white rounded-lg border border-border p-3">
          <h3 className="text-sm font-semibold text-text mb-2">عنوان الشحن</h3>
          <select
            value={selectedAddressId}
            onChange={(e) => setSelectedAddressId(e.target.value)}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm"
          >
            {addresses.map((a) => (
              <option key={a.id} value={a.id}>{a.label}: {a.street}, {a.city}</option>
            ))}
          </select>
        </div>
      )}

      <div className="bg-white rounded-lg border border-border p-3">
        <h3 className="text-sm font-semibold text-text mb-2">طريقة الدفع</h3>
        <div className="flex flex-wrap gap-2">
          {Object.entries(paymentLabels).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setPaymentMethod(key)}
              className={`text-xs px-3 py-2 rounded-lg border transition-colors ${
                paymentMethod === key ? 'bg-primary text-white border-primary' : 'bg-white text-text-secondary border-border'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-border p-3">
        <h3 className="text-sm font-semibold text-text mb-2">ملاحظات الطلب</h3>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="أي ملاحظات إضافية..."
          className="w-full border border-border rounded-lg px-3 py-2 text-sm resize-none h-20"
        />
      </div>

      <div className="bg-white rounded-lg border border-border p-3 space-y-2">
        <h3 className="text-sm font-semibold text-text">المنتجات</h3>
        <div className="divide-y divide-border">
          {items.map((item) => (
            <div key={`${item.productId}-${item.unitType}`} className="flex justify-between py-2 text-sm">
              <span className="text-text-secondary">{item.productName} - {item.unitQuantity} {UNIT_LABELS[item.unitType]}</span>
              <span className="text-text font-semibold">{formatCurrencyShort(item.totalPrice)}</span>
            </div>
          ))}
        </div>
        <hr className="border-border" />
        <div className="flex justify-between text-sm text-text-secondary">
          <span>الإجمالي</span>
          <span>{formatCurrencyShort(totals.subtotal)}</span>
        </div>
        {totals.tierDiscount > 0 && (
          <div className="flex justify-between text-sm text-success">
            <span>خصم ({selectedTier?.name})</span>
            <span>-{formatCurrencyShort(totals.tierDiscount)}</span>
          </div>
        )}
        <hr className="border-border" />
        <div className="flex justify-between text-base font-bold text-text">
          <span>الإجمالي النهائي</span>
          <span>{formatCurrencyShort(totals.netTotal)}</span>
        </div>
      </div>

      {selectedTier && !totals.meetsTierMinimum && (
        <GuidedError
          title="لم يتم الوصول إلى الحد الأدنى للشريحة"
          reason={`الحد الأدنى لشريحة ${selectedTier.name} هو ${formatCurrencyShort(selectedTier.minimumOrderAmount)}`}
          correctiveAction={`أضف منتجات بقيمة ${formatCurrencyShort(totals.remainingForMinimum)} على الأقل للوصول للحد الأدنى`}
          navigationTarget="/cart"
          navigationLabel="العودة للسلة"
        />
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <p className="text-xs text-amber-700">
          عند إرسال الطلب، يتم تجميد الأسعار النهائية لكل منتج. لن تتأثر أسعار هذا الطلب بأي تغييرات مستقبلية.
        </p>
      </div>

      <button
        onClick={handleSubmit}
        disabled={submitting || !paymentMethod || (selectedTier !== null && !totals.meetsTierMinimum)}
        className="w-full bg-success text-white text-sm py-3 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed active:opacity-90 transition-colors"
      >
        {submitting ? 'جاري الإرسال...' : 'تأكيد وإرسال الطلب'}
      </button>
    </div>
  )
}
