import { useState, useEffect } from 'react'
import type { ProductWithPrice, ComputedPrices } from '../../types/storefront'
import type { UnitType } from '../../types/storefront'
import { formatCurrencyShort } from '../../utils/format'

interface ProductCardProps {
  product: ProductWithPrice
  prices: ComputedPrices
  hasTier: boolean
  tierName: string | null
  onAddToCart: (product: ProductWithPrice, unitType: UnitType, quantity: number) => void
}

const unitLabels: Record<UnitType, string> = {
  piece: 'قطعة',
  dozen: 'دستة',
  carton: 'كرتونة',
}

export function ProductCard({ product, prices, hasTier, tierName, onAddToCart }: ProductCardProps) {
  const availableOptions = product.unitPrices.map((up) => ({
    value: up.unitType,
    label: unitLabels[up.unitType],
    price: up.price,
  }))

  const firstAvailable = availableOptions[0]?.value ?? 'piece'
  const [selectedUnit, setSelectedUnit] = useState<UnitType>(firstAvailable)
  const [quantity, setQuantity] = useState(1)

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

  return (
    <div className="bg-white rounded-lg border border-border p-3 flex flex-col gap-2">
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
      </div>

      {/* Product Name + Status */}
      <div className="flex items-start justify-between">
        <h3 className="font-medium text-sm text-text flex-1">{product.productName}</h3>
        {isBlocked && (
          <span className="text-xs text-danger bg-red-50 px-2 py-0.5 rounded shrink-0">
            {!product.isActive ? 'غير متوفر' : product.salesBlocked ? 'نفذت الكمية' : 'نفد من المخزون'}
          </span>
        )}
      </div>

      {/* Prices */}
      {isBlocked ? (
        <div className="text-xs text-danger bg-red-50 rounded px-2 py-1.5">
          {!product.isActive ? 'غير متوفر حالياً' : 'نفذت الكمية — يرجى التواصل لتحديد السعر'}
        </div>
      ) : (
        <div className="text-xs text-text-secondary">
          {product.unitPrices.map((up, i) => (
            <span key={up.unitType}>
              {i > 0 && <span> &middot; </span>}
              {unitLabels[up.unitType]}: {formatCurrencyShort(up.price)}
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

            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              className="text-xs border border-border rounded px-2 py-1.5 w-16 text-center"
            />
          </div>

          <div className="flex items-center justify-between mt-1">
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-text">
                {formatCurrencyShort(effectivePrice * quantity)}
              </span>
              {hasDiscount && (
                <span className="text-xs text-text-secondary line-through">
                  {formatCurrencyShort(basePrice * quantity)}
                </span>
              )}
            </div>

            <button
              onClick={() => onAddToCart(product, selectedUnit, quantity)}
              disabled={isBlocked}
              className="bg-primary text-white text-xs px-3 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed active:bg-primary-dark transition-colors"
            >
              + إضافة
            </button>
          </div>
        </>
      )}
    </div>
  )
}
