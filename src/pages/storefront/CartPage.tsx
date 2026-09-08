import { useNavigate } from 'react-router-dom'
import { useEffect, useState, useMemo, useCallback } from 'react'
import { useCartStore } from '../../store/cart'
import { useAuthStore } from '../../store/auth'
import { TierSelector } from '../../components/storefront/TierSelector'
import { PaymentMethodSelector } from '../../components/storefront/PaymentMethodSelector'
import { ShippingMethodSelector } from '../../components/storefront/ShippingMethodSelector'
import { TierMinimumNotice } from '../../components/storefront/TierMinimumNotice'
import { TierCompanyRulesNotice } from '../../components/storefront/TierCompanyRulesNotice'
import { EmptyCart } from '../../components/storefront/EmptyCart'
import { SearchableSelect } from '../../components/shared/SearchableSelect'
import { formatCurrencyShort, formatArabicAmountWithCurrency, formatTierName } from '../../utils/format'
import { formatNumber } from '../../utils/numbers'
import { UNIT_LABELS } from '../../types/order-display'
import { supabase } from '../../lib/supabase'
import toast from 'react-hot-toast'
import type { CartItem as CartItemType } from '../../types/storefront'
import { checkCartAvailability, buildBusinessStatusCard, type AvailabilityResult } from '../../utils/cart-availability'
import { BusinessStatusCard } from '../../components/storefront/BusinessStatusCard'

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

export function CartPage() {
  const navigate = useNavigate()
  const [hydrated, setHydrated] = useState(false)
  const { token: authToken, user } = useAuthStore()
const isDirectCustomer = user?.identity_type === 'customer'
  const [editingCustomer, setEditingCustomer] = useState(false)
  const [customers, setCustomers] = useState<any[]>([])
  const [availabilityByItem, setAvailabilityByItem] = useState<Record<string, AvailabilityResult>>({})

  useEffect(() => {
    const s = useCartStore as unknown as { persist: { hasHydrated: () => boolean; onFinishHydration: (fn: () => void) => () => void } }
    if (s.persist.hasHydrated()) {
      setHydrated(true)
    } else {
      const unsub = s.persist.onFinishHydration(() => setHydrated(true))
      return unsub
    }
  }, [])

  const fetchCustomers = useCallback(async () => {
    if (!authToken || customers.length > 0) return
    const { data } = await supabase.rpc('get_governed_customers', { p_token: authToken })
    if (Array.isArray(data)) setCustomers(data)
  }, [authToken, customers.length])

  const {
    items,
    dealItems,
    flashOfferItems,
    products,
    tiers,
    selectedTierId,
    selectTier,
    updateQuantity,
    removeItem,
    removeDeal,
    removeFlashOffer,
    getSelectedTier,
    getSelectedPaymentMethod,
    getSelectedShippingMethod,
    getTotals,
    selectedCustomer,
    setSelectedCustomer,
    geographicContext,
    geoResolveEpoch,
    ensureGeoItemAdjustments,
  } = useCartStore()

  const selectedTier = getSelectedTier()
  const selectedPaymentMethod = getSelectedPaymentMethod()
  const selectedShippingMethod = getSelectedShippingMethod()
  const totals = getTotals()

  useEffect(() => {
    if (products.length > 0) {
      ensureGeoItemAdjustments(products)
    }
  }, [products, geographicContext?.governorateId, geoResolveEpoch, ensureGeoItemAdjustments])

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

  if (!hydrated) return null

  if (items.length === 0 && dealItems.length === 0 && flashOfferItems.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-bold text-text">سلة التسوق</h1>
        <EmptyCart onBrowseProducts={() => navigate('/storefront')} />
      </div>
    )
  }

  const handleContinue = () => {
    const blockedItem = items.find((item) => {
      const product = products.find((p) => p.id === item.productId)
      if (!product) return false
      if (!product.isActive || product.isOutOfStock) return true
      if (!product.unitPrices.some((u) => u.unitType === item.unitType)) return true
      return false
    })
    if (blockedItem) {
      toast.error('السلة تحتوي على منتجات غير متوفرة حالياً. يرجى إزالتها للمتابعة.')
      return
    }

    if (selectedTier && !totals.meetsTierMinimum) {
      toast.error(`الحد الأدنى للشريحة ${formatArabicAmountWithCurrency(totals.tierMinimum)} — أضف منتجات بقيمة ${formatArabicAmountWithCurrency(totals.remainingForMinimum)}`)
      return
    }
    if (selectedTier && !totals.meetsCompanyRules) {
      if (totals.companyRule && !totals.companyRule.meetsMinimumCompanies) {
        const needed = (totals.companyRule.minimumCompanyCount ?? 0) - totals.companyRule.distinctCompanyCount
        toast.error(needed > 0 ? `تنوع الشركات غير كافٍ — أضف منتجات من ${needed} شركة أخرى` : 'تنوع الشركات غير محقق')
      } else {
        toast.error('لا بد من إعادة توزيع المشتريات بين الشركات بما لا يتجاوز الحد الأقصى لكل شركة')
      }
      return
    }
    if (items.length === 0 && (dealItems.length > 0 || flashOfferItems.length > 0)) {
      navigate('/order-review')
      return
    }
    navigate('/order-review')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/storefront')} className="text-text-secondary text-lg">
            &larr;
          </button>
          <h1 className="text-lg font-bold text-text">سلة التسوق</h1>
        </div>
        <span className="text-xs text-text-secondary">{items.length} منتج</span>
      </div>

      {/* Order Context Card */}
      {items.length > 0 && (
        <div className="bg-white rounded-xl border border-border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <div className="text-xs text-text-secondary">العميل</div>
              {editingCustomer ? (
                <SearchableSelect
                  items={customers.map((c: any) => ({ id: c.id, name: c.company_name || '' }))}
                  value={selectedCustomer?.id || ''}
                  onChange={(id) => {
                    const c = customers.find((c: any) => c.id === id)
                    if (c) {
                      setSelectedCustomer({ id: c.id, name: c.company_name || '', phone: c.phone || '', code: c.code || '' })
                    }
                    setEditingCustomer(false)
                  }}
                  placeholder="اختر العميل"
                />
              ) : (
                <div className="text-sm font-semibold text-text truncate">{selectedCustomer?.name || 'غير محدد'}</div>
              )}
            </div>
            {!editingCustomer && !isDirectCustomer && (
              <button onClick={() => { setEditingCustomer(true); fetchCustomers() }} className="text-xs text-primary font-semibold shrink-0 ml-3">تغيير</button>
            )}
          </div>
        </div>
      )}

      {/* Tier Selector */}
      <TierSelector
        tiers={tiers}
        selectedTierId={selectedTierId}
        onSelect={selectTier}
        cartTotal={totals.netTotal}
      />

      {/* Payment + Shipping method selectors */}
      <PaymentMethodSelector />
      <ShippingMethodSelector />

      {/* Compact tier summary */}
      {selectedTier && (
        <div className="rounded-xl border border-primary/20 bg-primary/[0.03] p-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <div className="text-[11px] text-text-secondary">الشريحة الحالية</div>
            <div className="text-sm font-bold text-text text-left">{formatTierName(selectedTier.name)}</div>
            <div className="text-[11px] text-text-secondary">الخصم</div>
            <div className="text-sm font-bold text-success text-left">
              {selectedTier.discountPercent % 1 === 0 ? selectedTier.discountPercent : Number(selectedTier.discountPercent.toFixed(1))}%
            </div>
            <div className="text-[11px] text-text-secondary">الحد الأدنى</div>
            <div className="text-sm font-semibold text-text text-left">
              {formatArabicAmountWithCurrency(totals.tierMinimum)}
            </div>
            <div className="text-[11px] text-text-secondary">المتبقي</div>
            {totals.meetsTierMinimum ? (
              <div className="text-sm font-bold text-success text-left">✓ تم تحقيق الشريحة</div>
            ) : (
              <div className="text-sm font-bold text-warning text-left">
                {formatArabicAmountWithCurrency(totals.remainingForMinimum)}
              </div>
            )}
          </div>
        </div>
      )}

      {selectedTier && !totals.meetsTierMinimum && (
        <TierMinimumNotice
          remainingForMinimum={totals.remainingForMinimum}
          tierMinimum={totals.tierMinimum}
          tierName={selectedTier.name}
          currentAmount={totals.productBaseSubtotal}
          met={false}
          discountPercent={selectedTier.discountPercent}
        />
      )}

      {selectedTier && totals.companyRule && !totals.meetsCompanyRules && (
        <TierCompanyRulesNotice companyRule={totals.companyRule} tier={selectedTier} />
      )}

      {/* Flash Offer Items */}
      {flashOfferItems.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-amber-500 text-white">
            <h3 className="text-sm font-bold">عروض الساعة</h3>
          </div>
          <div className="divide-y divide-amber-100">
            {flashOfferItems.map((offer) => (
              <div key={offer.dealId} className="flex items-center justify-between px-4 py-3">
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-semibold text-text block truncate">{offer.dealTitle}</span>
                  <span className="text-xs text-text-secondary">الكمية: {offer.quantity}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-danger">{formatCurrencyShort(offer.totalPrice)}</span>
                  <button onClick={() => removeFlashOffer(offer.dealId)} className="text-xs text-danger font-semibold">
                    حذف
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Deal Items */}
      {dealItems.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-amber-500 text-white">
            <h3 className="text-sm font-bold">العروض اليومية</h3>
          </div>
          <div className="divide-y divide-amber-100">
            {dealItems.map((deal) => (
              <div key={deal.dealId} className="flex items-center justify-between px-4 py-3">
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-semibold text-text block truncate">{deal.dealTitle}</span>
                  <span className="text-xs text-text-secondary">الكمية: {deal.quantity}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-danger">{formatCurrencyShort(deal.totalPrice)}</span>
                  <button onClick={() => removeDeal(deal.dealId)} className="text-xs text-danger font-semibold">
                    حذف
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Company-grouped Cart Items */}
      {groups.map((group) => {
        const colorIdx = hashId(group.id) % COMPANY_COLORS.length
        const colors = COMPANY_COLORS[colorIdx]
        return (
          <div key={group.id} className={`${colors.bg} border ${colors.border} rounded-xl overflow-hidden`}>
            {/* Company Header */}
            <div className={`${colors.header} px-4 py-3 flex items-center justify-between`}>
              <h2 className="text-sm font-bold text-white">{group.companyName}</h2>
              <span className="text-xs text-white/80">{group.items.length} منتج</span>
            </div>

            {/* Product Items */}
            <div className="divide-y divide-white/60">
              {group.items.map((item) => {
                const product = products.find((p) => p.id === item.productId)
                return (
                  <div key={`${item.productId}-${item.unitType}`} className="px-4 py-3">
                    <div className="flex gap-3">
                      {/* Product Image */}
                      <div className="w-16 h-16 rounded-lg bg-white border border-border shrink-0 overflow-hidden">
                        {item.imageUrl ? (
                          <img src={item.imageUrl} alt={item.productName} className="w-full h-full object-contain" />
                        ) : (
                          <div className="w-full h-full bg-surface flex items-center justify-center">
                            <span className="text-xs text-text-secondary">صورة</span>
                          </div>
                        )}
                      </div>

                      {/* Info + Controls */}
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <h4 className="text-sm font-semibold text-text leading-tight truncate">{item.productName}</h4>
                        <div className="text-xs text-text-secondary">
                          {UNIT_LABELS[item.unitType]} &middot; {formatCurrencyShort(item.unitPrice)} للوحدة
                        </div>
                        <div className="text-xs text-text-secondary">
                          {formatNumber(item.pieceQuantity)} قطعة
                        </div>
                        {availabilityByItem[`${item.productId}:${item.unitType}`] && (
                          <BusinessStatusCard
                            data={buildBusinessStatusCard(availabilityByItem[`${item.productId}:${item.unitType}`])}
                            className="mt-2"
                          />
                        )}
                      </div>

                      {/* Total + Controls Column */}
                      <div className="flex flex-col items-end justify-between">
                        <span className="text-sm font-bold text-text">{formatCurrencyShort(item.totalPrice)}</span>
                        <div className="flex items-center gap-2 mt-1">
                          <button
                            onClick={() => updateQuantity(item.productId, item.unitType, Math.max(0, item.unitQuantity - 1))}
                            className="w-7 h-7 flex items-center justify-center rounded-lg bg-white border border-border text-text-secondary text-sm active:bg-surface transition-colors"
                          >
                            −
                          </button>
                          <span className="text-sm font-semibold text-text w-6 text-center">{item.unitQuantity}</span>
                          <button
                            onClick={async () => {
                              const finalQty = item.unitQuantity + 1
                              const key = `${item.productId}:${item.unitType}`
                              const result = await checkCartAvailability(item.productId, finalQty, item.unitType)
                              if (!result.available) {
                                setAvailabilityByItem((prev) => ({ ...prev, [key]: result }))
                                return
                              }
                              updateQuantity(item.productId, item.unitType, finalQty)
                            }}
                            className="w-7 h-7 flex items-center justify-center rounded-lg bg-white border border-border text-text-secondary text-sm active:bg-surface transition-colors"
                          >
                            +
                          </button>
                        </div>
                        <button
                          onClick={() => removeItem(item.productId, item.unitType)}
                          className="text-xs text-danger font-semibold mt-1"
                        >
                          حذف
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Company Subtotal */}
            <div className={`px-4 py-2.5 border-t ${colors.border} ${colors.text} flex items-center justify-between`}>
              <span className="text-xs font-semibold">إجمالي {group.companyName}</span>
              <span className="text-sm font-bold">{formatCurrencyShort(group.subtotal)}</span>
            </div>
          </div>
        )
      })}

      {/* Grand Total */}
      <div className="bg-white rounded-xl border border-border p-4 space-y-2.5">
        <div className="text-xs font-bold text-text-secondary">ملخص الطلب</div>
        <div className="flex justify-between text-sm text-text">
          <span>إجمالي المنتجات (الأساسي)</span>
          <span className="font-medium">{formatCurrencyShort(totals.productBaseSubtotal)}</span>
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
            <span>خصم الشريحة ({selectedTier ? formatTierName(selectedTier.name) : ''})</span>
            <span className="font-semibold">-{formatCurrencyShort(totals.tierDiscount)}</span>
          </div>
        )}
        {totals.paymentDiscount > 0 && (
          <div className="flex justify-between text-sm text-success">
            <span>خصم طريقة الدفع ({selectedPaymentMethod?.name ?? ''})</span>
            <span className="font-semibold">-{formatCurrencyShort(totals.paymentDiscount)}</span>
          </div>
        )}
        {totals.shippingDiscount > 0 && (
          <div className="flex justify-between text-sm text-success">
            <span>خصم طريقة الشحن ({selectedShippingMethod?.name ?? ''})</span>
            <span className="font-semibold">-{formatCurrencyShort(totals.shippingDiscount)}</span>
          </div>
        )}
        <hr className="border-border" />
        <div className="flex justify-between text-lg font-extrabold text-text">
          <span>الإجمالي النهائي</span>
          <span>{formatCurrencyShort(totals.netTotal)}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-2">
        <button
          onClick={handleContinue}
          disabled={selectedTier !== null && (!totals.meetsTierMinimum || !totals.meetsCompanyRules) && items.length > 0}
          className="w-full bg-primary text-white text-sm py-3 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed active:bg-primary-dark transition-colors"
        >
          متابعة الطلب
        </button>

        <button
          onClick={() => navigate('/storefront')}
          className="w-full bg-white text-primary text-sm py-3 rounded-lg border border-primary active:bg-surface transition-colors"
        >
          إضافة المزيد من المنتجات
        </button>
      </div>
    </div>
  )
}
