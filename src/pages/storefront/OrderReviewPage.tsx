import { useState, useMemo, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useCartStore } from '../../store/cart'
import { useAuthStore } from '../../store/auth'
import { formatCurrencyShort, formatArabicAmountWithCurrency, formatTierName } from '../../utils/format'
import { supabase } from '../../lib/supabase'
import { sendWhatsAppFromDisplay } from '../../lib/whatsapp'
import { buildOrderDisplayData, UNIT_LABELS } from '../../types/order-display'
import toast from 'react-hot-toast'
import { lifeSignalService } from '../../services/lifeSignalService'
import { checkCartAvailability, buildBusinessStatusCard, type AvailabilityResult } from '../../utils/cart-availability'
import { formatMixedQuantity } from '../../utils/quantity-format'
import { BusinessStatusCard } from '../../components/storefront/BusinessStatusCard'
import type { CartItem as CartItemType, ProductWithPrice, UnitType } from '../../types/storefront'
import { TierCompanyRulesNotice } from '../../components/storefront/TierCompanyRulesNotice'

const COMPANY_COLORS = [
  { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-800', header: 'bg-blue-500' },
  { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-800', header: 'bg-emerald-500' },
  { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-800', header: 'bg-amber-500' },
  { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-800', header: 'bg-rose-500' },
  { bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-800', header: 'bg-violet-500' },
  { bg: 'bg-cyan-50', border: 'border-cyan-200', text: 'text-cyan-800', header: 'bg-cyan-500' },
  { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-800', header: 'bg-orange-500' },
  { bg: 'bg-pink-50', border: 'border-pink-200', text: 'text-pink-800', header: 'bg-pink-500' },
]

function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h) + id.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function OrderReviewPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const orderType = useCartStore((s) => s.orderType)
  const { items, dealItems, flashOfferItems, products, getSelectedTier, getSelectedPaymentMethod, getSelectedShippingMethod, getTotals, resetOrderContext, selectedCustomer, editingOrderId, bonusMode, bonusItems, bonusOverflowApproved, geographicContext } = useCartStore()
  const user = useAuthStore((s) => s.user)
  const [submitting, setSubmitting] = useState(false)

  const selectedTier = getSelectedTier()
  const selectedPaymentMethod = getSelectedPaymentMethod()
  const selectedShippingMethod = getSelectedShippingMethod()
  const totals = getTotals()
  const [availabilityByItem, setAvailabilityByItem] = useState<Record<string, AvailabilityResult>>({})

  const cartEmpty = items.length === 0 && dealItems.length === 0 && flashOfferItems.length === 0 && bonusItems.length === 0

  useEffect(() => {
    if (cartEmpty) navigate('/cart')
  }, [cartEmpty, navigate])

  useEffect(() => {
    let active = true
    Promise.all(items.map(async (item) => [
      `${item.productId}:${item.unitType}`,
      await checkCartAvailability(item.productId, item.unitQuantity, item.unitType),
    ] as const)).then((results) => {
      if (active) setAvailabilityByItem(Object.fromEntries(results))
    })
    return () => { active = false }
  }, [items])

  const productCompanyMap = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>()
    for (const p of products) {
      map.set(p.id, { id: p.companyId, name: p.companyName })
    }
    return map
  }, [products])

  const groups = useMemo(() => {
    const grouped = new Map<string, { companyName: string; items: CartItemType[]; subtotal: number }>()
    for (const item of items) {
      const company = productCompanyMap.get(item.productId)
      const companyId = company?.id || item.companyId || 'unknown'
      const companyName = company?.name || item.companyName || 'غير معروف'
      if (!grouped.has(companyId)) {
        grouped.set(companyId, { companyName, items: [], subtotal: 0 })
      }
      const g = grouped.get(companyId)!
      g.items.push(item)
      g.subtotal += item.totalPrice
    }
    return Array.from(grouped.entries()).map(([id, g]) => ({ id, ...g }))
  }, [items, productCompanyMap])

  if (cartEmpty) {
    return null
  }

  const handleSubmit = async () => {
    const blockedItem = [...items, ...bonusItems].find((item) => {
      const product = products.find((p) => p.id === item.productId)
      return product && (!product.isActive || product.isOutOfStock)
    })
    if (blockedItem) {
      toast.error('الطلب يحتوي على منتجات نفذت الكمية. يرجى العودة إلى السلة وإزالتها.')
      navigate('/cart')
      return
    }

    if (selectedTier && !totals.meetsTierMinimum) {
      toast.error(`لم يتم الوصول إلى الحد الأدنى للشريحة (${formatArabicAmountWithCurrency(totals.tierMinimum)})`)
      navigate('/cart')
      return
    }

    if (selectedTier && !totals.meetsCompanyRules) {
      if (totals.companyRule && !totals.companyRule.meetsMinimumCompanies) {
        const needed = (totals.companyRule.minimumCompanyCount ?? 0) - totals.companyRule.distinctCompanyCount
        toast.error(needed > 0 ? `تنويع الشركات غير كافٍ — أضف منتجات من ${needed} شركة أخرى` : 'تنويع الشركات غير محقق')
      } else {
        toast.error('تنويع الشركات غير محقق')
      }
      navigate('/cart')
      return
    }

    if (bonusMode && (totals.bonusOverflow ?? 0) > 0 && !bonusOverflowApproved) {
      toast.error('لم تتم الموافقة على الزيادة عن رصيد البونص. يرجى الموافقة عليها في سلة التسوق.')
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

    let order: any = null
    try {
      const orderItems = items.map((item) => {
        const base = {
          product_id: item.productId,
          unit_type: item.unitType,
          unit_quantity: item.unitQuantity,
          piece_quantity: item.pieceQuantity,
          unit_price: Math.round(item.unitPrice * 100) / 100,
          total_price: Math.round(item.totalPrice * 100) / 100,
        }
        if (!bonusMode) return base
        const baseUnitPrice = Math.round((item.baseUnitPrice >= 0 ? item.baseUnitPrice : item.unitPrice) * 100) / 100
        return { ...base, base_unit_price: baseUnitPrice }
      })

      const bonusItemsPayload = bonusItems.map((item) => ({
        product_id: item.productId,
        unit_type: item.unitType,
        unit_quantity: item.unitQuantity,
        piece_quantity: item.pieceQuantity,
        base_unit_price: Math.round((item.baseUnitPrice >= 0 ? item.baseUnitPrice : item.unitPrice) * 100) / 100,
        unit_price: Math.round(item.unitPrice * 100) / 100,
      }))

      if (editingOrderId) {
        const { error: replaceError, data: replaceData } = await supabase.rpc('governed_replace_order_contents', {
          p_token: token,
          p_id: editingOrderId,
          p_items: orderItems,
        })
        if (replaceError) { toast.error('تعذر تحديث الطلب الآن. يرجى المحاولة مرة أخرى.'); setSubmitting(false); return }
        if (replaceData && typeof replaceData === 'object' && 'error' in replaceData && replaceData.error) {
          toast.error('تعذر تحديث الطلب الآن. يرجى مراجعة الطلب ثم المحاولة.'); setSubmitting(false); return
        }
        order = { id: editingOrderId }
        lifeSignalService.notifyBusiness('order_created')

        const { data: submitData, error: submitError } = await supabase.rpc('governed_submit_order', {
          p_token: token,
          p_id: editingOrderId,
        })
        if (submitError) {
          toast.error('تم تحديث الطلب، وتعذر إرساله الآن. يرجى المحاولة مرة أخرى.')
          setSubmitting(false); return
        }
        if (submitData && typeof submitData === 'object' && 'error' in submitData && submitData.error) {
          toast.error('تعذر إرسال الطلب الآن. يرجى مراجعة الطلب ثم المحاولة.', { duration: 6000 })
          setSubmitting(false)
          return
        }
        supabase.rpc('governed_update_order_discount_options', {
          p_token: token,
          p_order_id: editingOrderId,
          p_tier_id: selectedTier?.id || null,
          p_payment_method_option_id: selectedPaymentMethod?.id || null,
          p_shipping_method_option_id: selectedShippingMethod?.id || null,
          p_reason: 'تحديث خيارات الخصم أثناء تعديل الطلب',
        }).then(() => {}).catch(() => {})
        toast.success('تم تحديث الطلب وإرساله بنجاح!')
      } else {
        const { data: created, error: createError } = await supabase.rpc('governed_create_order', {
          p_token: token,
          p_customer_id: customerId,
          p_tier_id: selectedTier?.id || null,
          p_notes: null,
          p_items: orderItems,
          p_execution_location_id: null,
          p_execution_latitude: null,
          p_execution_longitude: null,
          p_execution_accuracy_meters: null,
          p_execution_captured_at: null,
          p_order_type: orderType || 'cash',
          p_payment_method_option_id: selectedPaymentMethod?.id || null,
          p_shipping_method_option_id: selectedShippingMethod?.id || null,
          ...(bonusMode
            ? {
                p_bonus_items: bonusItemsPayload,
                p_bonus_mode_used: true,
                p_bonus_credit: Math.round(totals.bonusCredit * 100) / 100,
                p_bonus_products_total: Math.round(totals.bonusProductsTotal * 100) / 100,
                p_bonus_applied: Math.round(totals.bonusApplied * 100) / 100,
                p_bonus_unused: Math.round(totals.bonusUnused * 100) / 100,
                p_bonus_overflow: Math.round(totals.bonusOverflow * 100) / 100,
                p_main_base_total: Math.round(totals.mainBaseTotal * 100) / 100,
                p_bonus_overflow_approved: bonusOverflowApproved,
                p_bonus_governorate_id: geographicContext?.governorateId || null,
              }
            : {}),
        })
        if (createError) { toast.error('تعذر تجهيز الطلب للإرسال. يرجى المحاولة مرة أخرى.'); setSubmitting(false); return }
        if (!created) { toast.error('تعذر تجهيز الطلب للإرسال. يرجى المحاولة مرة أخرى.'); setSubmitting(false); return }
        if (created && typeof created === 'object' && 'error' in created && created.error) {
          toast.error('تعذر تجهيز الطلب للإرسال. يرجى مراجعة الطلب ثم المحاولة.'); setSubmitting(false); return
        }
        order = created
        lifeSignalService.notifyBusiness('order_created')

        if (flashOfferItems.length > 0) {
          const offerPayload = flashOfferItems.map((d) => ({ offer_id: d.dealId, quantity: d.quantity }))
          await supabase.rpc('governed_add_order_flash_offers', { p_token: token, p_order_id: order.id, p_offers: offerPayload }).then(() => {}).catch(() => {})
        }

        if (dealItems.length > 0) {
          const dealPayload = dealItems.map((d) => ({ deal_id: d.dealId, quantity: d.quantity }))
          await supabase.rpc('governed_add_order_daily_deals', { p_token: token, p_order_id: order.id, p_deals: dealPayload }).then(() => {}).catch(() => {})
        }

        const { data: submitData, error: submitError } = await supabase.rpc('governed_submit_order', {
          p_token: token,
          p_id: order.id,
        })
        if (submitError) {
          toast.error('تم حفظ الطلب، وتعذر إرساله الآن. يرجى المحاولة مرة أخرى.')
          setSubmitting(false)
          return
        }
        if (submitData && typeof submitData === 'object' && 'error' in submitData && submitData.error) {
          toast.error('تعذر إرسال الطلب الآن. يرجى مراجعة الطلب ثم المحاولة.', { duration: 6000 })
          setSubmitting(false)
          return
        }
        toast.success('تم إرسال الطلب بنجاح!')
      }
    } catch (err: any) {
      toast.error('حدث خطأ أثناء إنشاء الطلب')
      setSubmitting(false)
      return
    }

    try {
      const orderRes = await supabase.rpc('get_unified_order', { p_token: token, p_id: order.id })
      if (orderRes.error || !orderRes.data || orderRes.data?.error) throw orderRes.error || new Error('no order')
      const fullOrder = orderRes.data
      const display = buildOrderDisplayData({ order: fullOrder.order, items: fullOrder.items, liveCustomer: fullOrder.customer })
      console.log('ORDER_REVIEW_DISPLAY_DATA', display)
      sendWhatsAppFromDisplay(display)
    } catch (e) { console.error('WHATSAPP_OPEN_FAILED', e) }

    setSubmitting(false)
    resetOrderContext()
    navigate('/orders')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/cart')} className="text-text-secondary text-lg">
          &larr;
        </button>
        <h1 className="text-lg font-bold text-text">مراجعة الطلب</h1>
      </div>

      <div className="bg-white rounded-lg border border-border p-3">
        <p className="text-[10px] font-bold text-text-secondary uppercase mb-2">معلومات العميل</p>
        <p className="text-sm font-bold text-primary">{selectedCustomer?.name || user?.full_name || 'غير متوفر'}</p>
        {selectedCustomer?.code && <p className="text-[10px] text-text-secondary font-mono" dir="ltr">{selectedCustomer.code}</p>}
        {selectedCustomer?.phone && <p className="text-xs text-text-secondary mt-0.5" dir="ltr">{selectedCustomer.phone}</p>}
      </div>

      {selectedTier && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="text-xs text-blue-800">
            <span className="font-semibold">الشريحة: {formatTierName(selectedTier.name)}</span>
            {' | '}خصم {selectedTier.discountPercent}%
            {' | '}الحد الأدنى: {formatArabicAmountWithCurrency(selectedTier.minimumOrderAmount)}
          </div>
        </div>
      )}

      {selectedPaymentMethod && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="text-xs text-blue-800">
            <span className="font-semibold">طريقة الدفع: {selectedPaymentMethod.name}</span>
            {' | '}خصم {selectedPaymentMethod.discountPercent}%
          </div>
        </div>
      )}

      {selectedShippingMethod && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="text-xs text-blue-800">
            <span className="font-semibold">طريقة الشحن: {selectedShippingMethod.name}</span>
            {' | '}خصم {selectedShippingMethod.discountPercent}%
          </div>
        </div>
      )}

      {/* Company-grouped Items (same visual as Cart page) */}
      {groups.map((group) => {
        const colorIdx = hashId(group.id) % COMPANY_COLORS.length
        const colors = COMPANY_COLORS[colorIdx]
        return (
          <div key={group.id} className={`${colors.bg} border ${colors.border} rounded-xl overflow-hidden`}>
            <div className={`${colors.header} px-4 py-3 flex items-center justify-between`}>
              <h2 className="text-sm font-bold text-white">{group.companyName}</h2>
              <span className="text-xs text-white/80">{group.items.length} منتج</span>
            </div>
            <div className="divide-y divide-white/60">
              {group.items.map((item) => (
                <div key={`${item.productId}-${item.unitType}`} className="px-4 py-3">
                  <div className="flex gap-3">
                    <div className="w-16 h-16 rounded-lg bg-white border border-border shrink-0 overflow-hidden">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt={item.productName} className="w-full h-full object-contain" />
                      ) : (
                        <div className="w-full h-full bg-surface flex items-center justify-center">
                          <span className="text-xs text-text-secondary">صورة</span>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <h4 className="text-sm font-semibold text-text leading-tight truncate">{item.productName}</h4>
                      <div className="text-xs text-text-secondary">
                        <span>{item.unitQuantity} {UNIT_LABELS[item.unitType]}</span>
                        <span className="mx-1">&middot;</span>
                        <span>{formatCurrencyShort(item.unitPrice)} للوحدة</span>
                      </div>
                      <div className="text-xs text-text-secondary">
                        {formatMixedQuantity(
                          item.pieceQuantity,
                          products.find((product) => product.id === item.productId)?.cartonQuantity,
                          item.unitType
                        )}
                      </div>
                      {availabilityByItem[`${item.productId}:${item.unitType}`] && (
                        <BusinessStatusCard
                          data={buildBusinessStatusCard(availabilityByItem[`${item.productId}:${item.unitType}`])}
                          className="mt-2"
                        />
                      )}
                    </div>
                    <div className="flex items-center">
                      <span className="text-sm font-bold text-text">{formatCurrencyShort(item.totalPrice)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className={`px-4 py-2.5 border-t ${colors.border} ${colors.text} flex items-center justify-between`}>
              <span className="text-xs font-semibold">إجمالي {group.companyName}</span>
              <span className="text-sm font-bold">{formatCurrencyShort(group.subtotal)}</span>
            </div>
          </div>
        )
      })}

      {flashOfferItems.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-amber-500 text-white">
            <h3 className="text-sm font-bold">عروض الساعة ({flashOfferItems.length})</h3>
          </div>
          <div className="divide-y divide-amber-100">
            {flashOfferItems.map((offer) => (
              <div key={offer.dealId} className="flex items-center justify-between px-4 py-3">
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
        <div className="bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-amber-500 text-white">
            <h3 className="text-sm font-bold">العروض اليومية ({dealItems.length})</h3>
          </div>
          <div className="divide-y divide-amber-100">
            {dealItems.map((deal) => (
              <div key={deal.dealId} className="flex items-center justify-between px-4 py-3">
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

      {/* Block 2 — Entitlement (رصيد بونص الشرائح) breakdown */}
      {bonusMode && (
        <div className="bg-violet-50 border border-violet-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-violet-500 text-white flex items-center justify-between">
            <h3 className="text-sm font-bold">رصيد بونص الشرائح</h3>
            <span className="text-xs text-white/85">الخصم الفعلي</span>
          </div>
          <div className="divide-y divide-violet-100">
            <div className="px-4 py-2.5 flex items-center justify-between text-sm">
              <span className="text-text-secondary">الشريحة ({selectedTier ? formatTierName(selectedTier.name) : '—'})</span>
              <span className="font-semibold text-violet-700">{formatCurrencyShort(totals.bonusSummary?.tierCredit ?? 0)}</span>
            </div>
            <div className="px-4 py-2.5 flex items-center justify-between text-sm">
              <span className="text-text-secondary">طريقة الدفع ({selectedPaymentMethod?.name ?? '—'})</span>
              <span className="font-semibold text-violet-700">{formatCurrencyShort(totals.bonusSummary?.paymentCredit ?? 0)}</span>
            </div>
            <div className="px-4 py-2.5 flex items-center justify-between text-sm">
              <span className="text-text-secondary">طريقة الشحن ({selectedShippingMethod?.name ?? '—'})</span>
              <span className="font-semibold text-violet-700">{formatCurrencyShort(totals.bonusSummary?.shippingCredit ?? 0)}</span>
            </div>
          </div>
          <div className="px-4 py-2.5 border-t border-violet-200 text-violet-700 flex items-center justify-between">
            <span className="text-xs font-semibold">إجمالي رصيد البونص</span>
            <span className="text-sm font-bold">{formatCurrencyShort(totals.bonusCredit ?? 0)}</span>
          </div>
        </div>
      )}

      {/* Block 3 — Bonus products (منتجات البونص) */}
      {bonusMode && bonusItems.length > 0 && (
        <div className="bg-violet-50 border border-violet-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-violet-500 text-white">
            <h3 className="text-sm font-bold">بونص شرائح ({bonusItems.length})</h3>
          </div>
          <div className="divide-y divide-violet-100">
            {bonusItems.map((item) => (
              <div key={`bonus-${item.productId}-${item.unitType}`} className="px-4 py-3 flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-white border border-violet-200 shrink-0 overflow-hidden">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.productName} className="w-full h-full object-contain" />
                  ) : (
                    <div className="w-full h-full bg-white flex items-center justify-center">
                      <span className="text-sm">🎁</span>
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold text-text leading-tight truncate">{item.productName}</h4>
                  <div className="text-xs text-text-secondary">
                    {item.unitQuantity} {UNIT_LABELS[item.unitType]} &middot; {formatCurrencyShort(item.unitPrice)} للوحدة
                  </div>
                </div>
                <span className="text-sm font-bold text-violet-700">{formatCurrencyShort(item.totalPrice)}</span>
              </div>
            ))}
          </div>
          <div className="px-4 py-2.5 border-t border-violet-200 text-violet-700 flex items-center justify-between">
            <span className="text-xs font-semibold">إجمالي منتجات البونص</span>
            <span className="text-sm font-bold">{formatCurrencyShort(totals.bonusProductsTotal ?? 0)}</span>
          </div>
        </div>
      )}

      {/* Block 4 — Totals */}
      <div className="bg-white rounded-xl border border-border p-4 space-y-2.5">
        <div className="text-xs font-bold text-text-secondary">ملخص الطلب</div>
        {bonusMode ? (
          <>
            <div className="flex justify-between text-sm text-text">
              <span>المنتجات الرئيسية</span>
              <span className="font-medium">{formatCurrencyShort(totals.mainBaseTotal ?? 0)}</span>
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
            <div className="flex justify-between text-sm text-text">
              <span>الشريحة</span>
              <span className="font-medium">{selectedTier ? formatTierName(selectedTier.name) : '—'}</span>
            </div>
            <div className="flex justify-between text-sm text-text">
              <span>الدفع</span>
              <span className="font-medium">{selectedPaymentMethod?.name ?? '—'}</span>
            </div>
            <div className="flex justify-between text-sm text-text">
              <span>الشحن</span>
              <span className="font-medium">{selectedShippingMethod?.name ?? '—'}</span>
            </div>
            <hr className="border-border" />
            <div className="flex justify-between text-sm text-text">
              <span>إجمالي رصيد البونص</span>
              <span className="font-semibold text-primary">{formatCurrencyShort(totals.bonusCredit ?? 0)}</span>
            </div>
            {bonusItems.length > 0 && (
              <div className="flex justify-between text-sm text-text">
                <span>منتجات البونص</span>
                <span className="font-medium">{formatCurrencyShort(totals.bonusProductsTotal ?? 0)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm text-success">
              <span>المغطى من الرصيد</span>
              <span className="font-semibold">{formatCurrencyShort(totals.bonusApplied ?? 0)}</span>
            </div>
            {(totals.bonusUnused ?? 0) > 0 && (
              <div className="flex justify-between text-sm text-text-secondary">
                <span>غير المستخدم</span>
                <span>{formatCurrencyShort(totals.bonusUnused ?? 0)}</span>
              </div>
            )}
            {(totals.bonusOverflow ?? 0) > 0 && (
              <div className="flex justify-between text-sm text-danger">
                <span>الزيادة عن الرصيد</span>
                <span className="font-semibold">{formatCurrencyShort(totals.bonusOverflow ?? 0)}</span>
              </div>
            )}
            <hr className="border-border" />
            <div className="flex justify-between text-lg font-extrabold text-text">
              <span>الإجمالي المستحق</span>
              <span>{formatCurrencyShort(totals.netTotal)}</span>
            </div>
          </>
        ) : (
          <>
        <div className="flex justify-between text-sm text-text-secondary">
          <span>إجمالي المنتجات (الأساسي)</span>
          <span>{formatCurrencyShort(totals.productBaseSubtotal)}</span>
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
            <span>خصم الشريحة ({selectedTier?.name ?? ''})</span>
            <span>-{formatCurrencyShort(totals.tierDiscount)}</span>
          </div>
        )}
        {totals.paymentDiscount > 0 && (
          <div className="flex justify-between text-sm text-success">
            <span>خصم طريقة الدفع ({selectedPaymentMethod?.name ?? ''})</span>
            <span>-{formatCurrencyShort(totals.paymentDiscount)}</span>
          </div>
        )}
        {totals.shippingDiscount > 0 && (
          <div className="flex justify-between text-sm text-success">
            <span>خصم طريقة الشحن ({selectedShippingMethod?.name ?? ''})</span>
            <span>-{formatCurrencyShort(totals.shippingDiscount)}</span>
          </div>
        )}
        <hr className="border-border" />
        <div className="flex justify-between text-base font-bold text-text">
          <span>الإجمالي النهائي</span>
          <span>{formatCurrencyShort(totals.netTotal)}</span>
        </div>
          </>
        )}
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <p className="text-xs text-amber-700">
          عند إرسال الطلب، يتم تجميد الأسعار النهائية لكل منتج. لن تتأثر أسعار هذا الطلب بأي تغييرات مستقبلية في الأسعار أو الخصومات.
        </p>
      </div>

      {selectedTier && totals.companyRule && !totals.meetsCompanyRules && (
        <TierCompanyRulesNotice companyRule={totals.companyRule} tier={selectedTier} />
      )}

      <button
        onClick={handleSubmit}
        disabled={submitting || (selectedTier !== null && (!totals.meetsTierMinimum || !totals.meetsCompanyRules)) || (bonusMode && (totals.bonusOverflow ?? 0) > 0 && !bonusOverflowApproved)}
        className="w-full bg-success text-white text-sm py-3 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed active:opacity-90 transition-colors"
      >
        {submitting ? 'جاري الإرسال...' : 'تأكيد وإرسال الطلب'}
      </button>
    </div>
  )
}
