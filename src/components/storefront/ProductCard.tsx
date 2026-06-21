import { useState, useEffect } from 'react'
import type { ProductWithPrice, ComputedPrices } from '../../types/storefront'
import type { UnitType } from '../../types/storefront'
import { formatCurrencyShort } from '../../utils/format'
import { UNIT_LABELS } from '../../types/order-display'

interface ProductCardProps {
  product: ProductWithPrice
  prices: ComputedPrices
  hasTier: boolean
  tierName: string | null
  onAddToCart: (product: ProductWithPrice, unitType: UnitType, quantity: number) => void
  onRemoveFromCart?: (productId: string, unitType: UnitType) => void
  cartItemKeys?: Set<string>
}

export function ProductCard({ product, prices, hasTier, tierName, onAddToCart, onRemoveFromCart, cartItemKeys }: ProductCardProps) {
  const availableOptions = product.unitPrices.map((up) => ({
    value: up.unitType,
    label: UNIT_LABELS[up.unitType],
    price: up.price,
  }))

  const firstAvailable = availableOptions[0]?.value ?? 'piece'
  const [selectedUnit, setSelectedUnit] = useState<UnitType>(firstAvailable)
  const [quantity, setQuantity] = useState(0)

  useEffect(() => {
    if (!availableOptions.find((o) => o.value === selectedUnit)) {
      setSelectedUnit(firstAvailable)
    }
  }, [product.unitPrices])

  const currentUnitPrice = product.unitPrices.find((up) => up.unitType === selectedUnit)
  const effectivePrice = hasTier && currentUnitPrice
    ? currentUnitPrice.price * (1 - prices.discountPercent / 100)
    : currentUnitPrice?.price ?? 0

  const basePrice = currentUnitPrice?.price ?? 0
  const hasDiscount = hasTier && prices.discountPercent > 0
  const isBlocked = product.salesBlocked === true || product.outOfStock === true || !product.isActive

  const itemKey = `${product.id}:${selectedUnit}`
  const isInCart = cartItemKeys?.has(itemKey) ?? false

  return (
    <div className={`bg-white rounded-lg border p-3 flex flex-col gap-2 transition-colors ${isInCart ? 'border-success border-2 bg-success/[0.03]' : 'border-border'}`}>
      {/* Image */}
      {product.imageUrl ? (
        <img
          src={product.imageUrl}
          alt={product.productName}
          className="w-full h-36 object-contain rounded bg-surface"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-36 rounded bg-surface" />
      )}

      {/* Code + Company */}
      <div className="flex items-center gap-1 text-[10px] text-text-secondary">
        <span>كود: {product.legacyCode}</span>
        {product.companyName && (
          <>
            <span>|</span>
            <span>{product.companyName}</span>
          </>
        )}
        {isInCart && (
          <span className="mr-auto text-success font-bold text-[11px]">✓ في السلة</span>
        )}
      </div>

      {/* Product Name + Status */}
      <div className="flex items-start justify-between">
        <h3 className="font-medium text-sm text-text flex-1">{product.productName}</h3>
        {isBlocked && (
          <span className={`text-xs px-2 py-0.5 rounded shrink-0 ${
            product.outOfStock ? 'bg-warning/10 text-warning' : 'bg-red-50 text-danger'
          }`}>
            {!product.isActive ? 'غير متوفر' : product.outOfStock ? 'نفذت الكمية' : 'غير متاح حالياً'}
          </span>
        )}
      </div>

      {/* Prices */}
      {isBlocked ? (
        <div className={`text-xs rounded px-2 py-1.5 ${
          product.outOfStock ? 'bg-warning/10 text-warning' : 'bg-red-50 text-danger'
        }`}>
          {!product.isActive ? 'غير متوفر حالياً' : product.outOfStock ? 'نفذت الكمية' : 'غير متاح حالياً'}
        </div>
      ) : (
        <div className="text-xs text-text-secondary">
          {product.unitPrices.map((up, i) => (
            <span key={up.unitType}>
              {i > 0 && <span> &middot; </span>}
              {UNIT_LABELS[up.unitType]}: {formatCurrencyShort(up.price)}
            </span>
          ))}
        </div>
      )}

      {hasDiscount && (
        <div className="text-xs text-accent bg-amber-50 px-2 py-0.5 rounded">
          خصم الشريحة {tierName}: يصل إلى {Math.ceil(prices.discountPercent)}%
        </div>
      )}

      {!isBlocked && (
        <>
          <div className="flex items-center gap-2 mt-1">
            <select
              value={selectedUnit}
              onChange={(e) => setSelectedUnit(e.target.value as UnitType)}
              className="text-xs border border-border rounded px-2 py-1.5 bg-white flex-1"
            >
              {availableOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {!isInCart && (
            <div className="flex items-center gap-1.5 mt-1">
              <button
                onClick={() => setQuantity(q => Math.max(0, q - 1))}
                className="w-8 h-8 rounded-lg bg-surface text-text-secondary text-sm flex items-center justify-center active:bg-border transition-colors font-bold"
              >
                −
              </button>
              <input
                type="number"
                min={0}
                value={quantity || ''}
                onChange={(e) => setQuantity(Math.max(0, parseInt(e.target.value) || 0))}
                placeholder="0"
                className="text-xs border border-border rounded px-2 py-1.5 w-16 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                onFocus={(e) => e.target.select()}
              />
              <button
                onClick={() => setQuantity(q => q + 1)}
                className="w-8 h-8 rounded-lg bg-surface text-text-secondary text-sm flex items-center justify-center active:bg-border transition-colors font-bold"
              >
                +
              </button>
            </div>
          )}

          <div className="flex items-center justify-between mt-1">
            <div className="flex flex-col">
              {isInCart ? (
                <span className="text-sm font-semibold text-success">تمت الإضافة ✓</span>
              ) : (
                <>
                  <span className="text-sm font-semibold text-text">
                    {quantity > 0 ? formatCurrencyShort(effectivePrice * quantity) : '0'}
                  </span>
                  {hasDiscount && quantity > 0 && (
                    <span className="text-xs text-text-secondary line-through">
                      {formatCurrencyShort(basePrice * quantity)}
                    </span>
                  )}
                </>
              )}
            </div>

            {isInCart ? (
              <button
                onClick={() => onRemoveFromCart?.(product.id, selectedUnit)}
                className="bg-danger/10 text-danger text-xs px-3 py-2 rounded-lg font-semibold active:bg-danger/20 transition-colors"
              >
                إزالة من السلة
              </button>
            ) : (
              <button
                onClick={() => {
                  if (quantity > 0) {
                    onAddToCart(product, selectedUnit, quantity)
                    setQuantity(0)
                  }
                }}
                disabled={quantity < 1}
                className="bg-primary text-white text-xs px-4 py-2 rounded-lg font-semibold disabled:opacity-40 disabled:cursor-not-allowed active:bg-primary-dark transition-colors"
              >
                شراء
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
