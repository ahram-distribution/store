import { useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useCartStore } from '../../store/cart'
import { CartItem } from '../../components/storefront/CartItem'
import { CartSummary } from '../../components/storefront/CartSummary'
import { TierSelector } from '../../components/storefront/TierSelector'
import { TierMinimumNotice } from '../../components/storefront/TierMinimumNotice'
import { EmptyCart } from '../../components/storefront/EmptyCart'
import { formatCurrencyShort } from '../../utils/format'
import toast from 'react-hot-toast'

export function CartPage() {
  const navigate = useNavigate()
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const s = useCartStore as unknown as { persist: { hasHydrated: () => boolean; onFinishHydration: (fn: () => void) => () => void } }
    if (s.persist.hasHydrated()) {
      setHydrated(true)
    } else {
      const unsub = s.persist.onFinishHydration(() => setHydrated(true))
      return unsub
    }
  }, [])

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
    getTotals,
  } = useCartStore()

  const selectedTier = getSelectedTier()
  const totals = getTotals()

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
      toast.error(`الحد الأدنى للشريحة ${formatCurrencyShort(totals.tierMinimum)} — أضف منتجات بقيمة ${formatCurrencyShort(totals.remainingForMinimum)}`)
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

      {/* Tier Selector */}
      <TierSelector
        tiers={tiers}
        selectedTierId={selectedTierId}
        onSelect={selectTier}
        cartTotal={totals.netTotal}
      />

      {/* Tier Minimum Notice */}
      {selectedTier && (
        <TierMinimumNotice
          remainingForMinimum={totals.remainingForMinimum}
          tierMinimum={totals.tierMinimum}
          tierName={selectedTier.name}
        />
      )}

      {/* Flash Offer Items */}
      {flashOfferItems.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-text mb-2">عروض الساعة</h3>
          <div className="space-y-2">
            {flashOfferItems.map((offer) => (
              <div key={offer.dealId} className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-semibold text-text block truncate">{offer.dealTitle}</span>
                    <span className="text-xs text-text-secondary">الكمية: {offer.quantity}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-bold text-danger">{formatCurrencyShort(offer.totalPrice)}</span>
                  </div>
                </div>
                <button
                  onClick={() => removeFlashOffer(offer.dealId)}
                  className="text-xs text-danger mt-1"
                >
                  إزالة
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Deal Items */}
      {dealItems.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-text mb-2">العروض اليومية</h3>
          <div className="space-y-2">
            {dealItems.map((deal) => (
              <div key={deal.dealId} className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-semibold text-text block truncate">{deal.dealTitle}</span>
                    <span className="text-xs text-text-secondary">الكمية: {deal.quantity}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-bold text-danger">{formatCurrencyShort(deal.totalPrice)}</span>
                  </div>
                </div>
                <button
                  onClick={() => removeDeal(deal.dealId)}
                  className="text-xs text-danger mt-1"
                >
                  إزالة
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cart Items */}
      <div className="space-y-2">
        {items.map((item) => (
          <CartItem
            key={`${item.productId}-${item.unitType}`}
            item={item}
            onUpdateQuantity={updateQuantity}
            onRemove={removeItem}
          />
        ))}
      </div>

      {/* Summary */}
      <CartSummary totals={totals} selectedTier={selectedTier} />

      {/* Actions */}
      <div className="space-y-2">
        <button
          onClick={handleContinue}
          disabled={selectedTier !== null && !totals.meetsTierMinimum && items.length > 0}
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
