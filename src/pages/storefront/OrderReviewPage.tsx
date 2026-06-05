import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCartStore } from '../../store/cart'
import { useAuthStore } from '../../store/auth'
import { formatCurrencyShort } from '../../utils/format'
import { supabase } from '../../lib/supabase'
import { sendFullOrderToWhatsApp } from '../../lib/whatsapp'
import { locationService } from '../../services/location'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function OrderReviewPage() {
  const navigate = useNavigate()
  const { items, dealItems, flashOfferItems, products, getSelectedTier, getTotals, clearCart, selectedCustomer } = useCartStore()
  const user = useAuthStore((s) => s.user)
  const [submitting, setSubmitting] = useState(false)

  const selectedTier = getSelectedTier()
  const totals = getTotals()

  if (items.length === 0 && dealItems.length === 0 && flashOfferItems.length === 0) {
    navigate('/cart')
    return null
  }

  const unitLabels: Record<string, string> = {
    piece: 'قطعة',
    dozen: 'دستة',
    carton: 'كرتونة',
  }

  const handleSubmit = async () => {
    const blockedItem = items.find((item) => {
      const product = products.find((p) => p.id === item.productId)
      return product?.salesBlocked === true
    })
    if (blockedItem) {
      toast.error('الطلب يحتوي على منتجات نفذت الكمية. يرجى العودة إلى السلة وإزالتها.')
      navigate('/cart')
      return
    }

    if (selectedTier && !totals.meetsTierMinimum) {
      toast.error(`لم يتم الوصول إلى الحد الأدنى للشريحة (${formatCurrencyShort(totals.tierMinimum)})`)
      navigate('/cart')
      return
    }

    const token = getToken()
    if (!token) {
      toast.error('يجب تسجيل الدخول أولاً')
      return
    }

    const customerId = user?.identity_type === 'customer'
      ? user.customer_id
      : user?.identity_type === 'employee'
        ? selectedCustomer?.id || null
        : null
    if (!customerId) {
      toast.error('حساب العميل غير متاح')
      return
    }

    setSubmitting(true)

    const { locationId, gps } = await locationService.captureAndStoreLocation()

    try {
      const orderItems = items.map((item) => ({
        product_id: item.productId,
        unit_type: item.unitType,
        unit_quantity: item.unitQuantity,
        piece_quantity: item.pieceQuantity,
        unit_price: Math.round(item.unitPrice * 100) / 100,
        total_price: Math.round(item.totalPrice * 100) / 100,
      }))

      const { data: order, error: createError } = await supabase.rpc('governed_create_order', {
        p_token: token,
        p_customer_id: customerId,
        p_tier_id: selectedTier?.id || null,
        p_notes: null,
        p_items: orderItems,
        p_execution_location_id: locationId,
        p_execution_latitude: gps?.latitude || null,
        p_execution_longitude: gps?.longitude || null,
        p_execution_accuracy_meters: gps?.accuracy || null,
        p_execution_captured_at: gps?.capturedAt || null,
      })

      if (createError) {
        toast.error('فشل إنشاء الطلب: ' + createError.message)
        setSubmitting(false)
        return
      }

      if (!order) {
        toast.error('فشل إنشاء الطلب')
        setSubmitting(false)
        return
      }

      const orderId = (order as any).id

      // Add flash offers to the order if any
      if (flashOfferItems.length > 0) {
        const offerPayload = flashOfferItems.map((d) => ({
          offer_id: d.dealId,
          quantity: d.quantity,
        }))
        const { error: foError } = await supabase.rpc('governed_add_order_flash_offers', {
          p_token: token,
          p_order_id: orderId,
          p_offers: offerPayload,
        })
        if (foError) {
          toast.error('تم إنشاء الطلب ولكن فشل إضافة عروض الساعة: ' + foError.message)
          setSubmitting(false)
          return
        }
      }

      // Add daily deals to the order if any
      if (dealItems.length > 0) {
        const dealPayload = dealItems.map((d) => ({
          deal_id: d.dealId,
          quantity: d.quantity,
        }))
        const { error: dealError } = await supabase.rpc('governed_add_order_daily_deals', {
          p_token: token,
          p_order_id: orderId,
          p_deals: dealPayload,
        })
        if (dealError) {
          toast.error('تم إنشاء الطلب ولكن فشل إضافة العروض: ' + dealError.message)
          setSubmitting(false)
          return
        }
      }

      const { error: submitError } = await supabase.rpc('governed_submit_order', {
        p_token: token,
        p_id: orderId,
      })

      if (submitError) {
        toast.error('تم إنشاء الطلب كمسودة ولكن فشل الإرسال: ' + submitError.message)
        setSubmitting(false)
        return
      }

      toast.success('تم إرسال الطلب بنجاح!')
      sendFullOrderToWhatsApp(order, { name: (user as any)?.user_metadata?.full_name || '' }, null, null, items)
      clearCart()
      navigate('/orders')
    } catch (err: any) {
      toast.error('حدث خطأ أثناء إنشاء الطلب')
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/cart')} className="text-text-secondary text-lg">
          &larr;
        </button>
        <h1 className="text-lg font-bold text-text">مراجعة الطلب</h1>
      </div>

      {selectedTier && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="text-xs text-blue-800">
            <span className="font-semibold">الشريحة: {selectedTier.name}</span>
            {' | '}خصم يصل إلى {Math.ceil(selectedTier.discountPercent)}%
            {' | '}الحد الأدنى: {formatCurrencyShort(selectedTier.minimumOrderAmount)}
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-border">
        <div className="px-3 py-2 border-b border-border">
          <h3 className="text-sm font-semibold text-text">المنتجات ({items.length})</h3>
        </div>
        <div className="divide-y divide-border">
          {items.map((item) => (
            <div key={`${item.productId}-${item.unitType}`} className="flex items-center justify-between px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <span className="text-sm text-text truncate block">{item.productName}</span>
                <span className="text-xs text-text-secondary">
                  {item.unitQuantity} {unitLabels[item.unitType]} &middot;
                  {formatCurrencyShort(item.unitPrice)} للوحدة
                </span>
              </div>
              <span className="text-sm font-semibold text-text">{formatCurrencyShort(item.totalPrice)}</span>
            </div>
          ))}
        </div>
      </div>

      {flashOfferItems.length > 0 && (
        <div className="bg-white rounded-lg border border-amber-200">
          <div className="px-3 py-2 border-b border-amber-200 bg-amber-50">
            <h3 className="text-sm font-semibold text-amber-800">عروض الساعة ({flashOfferItems.length})</h3>
          </div>
          <div className="divide-y divide-amber-100">
            {flashOfferItems.map((offer) => (
              <div key={offer.dealId} className="flex items-center justify-between px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-text truncate block">{offer.dealTitle}</span>
                  <span className="text-xs text-text-secondary">الكمية: {offer.quantity}</span>
                </div>
                <span className="text-sm font-bold text-danger">{formatCurrencyShort(offer.totalPrice)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {dealItems.length > 0 && (
        <div className="bg-white rounded-lg border border-amber-200">
          <div className="px-3 py-2 border-b border-amber-200 bg-amber-50">
            <h3 className="text-sm font-semibold text-amber-800">العروض اليومية ({dealItems.length})</h3>
          </div>
          <div className="divide-y divide-amber-100">
            {dealItems.map((deal) => (
              <div key={deal.dealId} className="flex items-center justify-between px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-text truncate block">{deal.dealTitle}</span>
                  <span className="text-xs text-text-secondary">الكمية: {deal.quantity}</span>
                </div>
                <span className="text-sm font-bold text-danger">{formatCurrencyShort(deal.totalPrice)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-border p-4 space-y-2">
        <div className="flex justify-between text-sm text-text-secondary">
          <span>إجمالي المنتجات</span>
          <span>{formatCurrencyShort(totals.productSubtotal)}</span>
        </div>
        {flashOfferItems.length > 0 && (
          <div className="flex justify-between text-sm text-amber-600">
            <span>عروض الساعة</span>
            <span>{formatCurrencyShort(flashOfferItems.reduce((s, o) => s + o.totalPrice, 0))}</span>
          </div>
        )}
        {totals.dealTotal > 0 && (
          <div className="flex justify-between text-sm text-amber-600">
            <span>العروض اليومية</span>
            <span>{formatCurrencyShort(totals.dealTotal)}</span>
          </div>
        )}
        {totals.tierDiscount > 0 && (
          <div className="flex justify-between text-sm text-success">
            <span>خصم الشريحة ({selectedTier?.name})</span>
            <span>-{formatCurrencyShort(totals.tierDiscount)}</span>
          </div>
        )}
        <hr className="border-border" />
        <div className="flex justify-between text-base font-bold text-text">
          <span>الإجمالي النهائي</span>
          <span>{formatCurrencyShort(totals.netTotal)}</span>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <p className="text-xs text-amber-700">
          عند إرسال الطلب، يتم تجميد الأسعار النهائية لكل منتج. لن تتأثر أسعار هذا الطلب بأي تغييرات مستقبلية في الأسعار أو الخصومات.
        </p>
      </div>

      <button
        onClick={handleSubmit}
        disabled={submitting || (selectedTier !== null && !totals.meetsTierMinimum)}
        className="w-full bg-success text-white text-sm py-3 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed active:opacity-90 transition-colors"
      >
        {submitting ? 'جاري الإرسال...' : 'تأكيد وإرسال الطلب'}
      </button>
    </div>
  )
}
