import { useState } from 'react'
import type { ProductWithPrice, ComputedPrices } from '../../types/storefront'
import type { UnitType } from '../../types/storefront'
import { formatCurrencyShort } from '../../utils/format'
import { UNIT_LABELS } from '../../types/order-display'
import { SearchHighlight } from '../shared/SearchHighlight'
import toast from 'react-hot-toast'
import { Package } from 'lucide-react'

const UNIT_PRIORITY: UnitType[] = ['carton', 'dozen', 'piece']

interface ProductCardProps {
  product: ProductWithPrice
  prices: ComputedPrices
  hasTier: boolean
  tierName: string | null
  onAddToCart: (product: ProductWithPrice, unitType: UnitType, quantity: number) => void
  onRemoveFromCart?: (productId: string, unitType: UnitType) => void
  cartItemKeys?: Set<string>
  searchQuery?: string
}

export function ProductCard({ product, prices, hasTier, tierName, onAddToCart, onRemoveFromCart, cartItemKeys, searchQuery }: ProductCardProps) {
  const sellingUnits = product.availableUnitTypes
  const defaultUnit = UNIT_PRIORITY.find((u) => sellingUnits.includes(u)) ?? sellingUnits[0] ?? 'piece'
  const [selectedUnit, setSelectedUnit] = useState<UnitType>(defaultUnit)
  const [quantity, setQuantity] = useState(0)

  const isBlocked = !product.isActive || product.isOutOfStock

  const itemKey = `${product.id}:${selectedUnit}`
  const isInCart = cartItemKeys?.has(itemKey) ?? false

  const handleToggle = () => {
    if (isInCart) {
      onRemoveFromCart?.(product.id, selectedUnit)
      toast('تمت إزالة المنتج', { icon: '🗑' })
    } else {
      if (quantity > 0) {
        onAddToCart(product, selectedUnit, quantity)
        toast.success('تمت إضافة المنتج للسلة')
      }
    }
  }

  return (
    <div className={`bg-white rounded-lg border p-3 flex flex-col gap-2 transition-colors h-full overflow-hidden ${
      isInCart ? 'border-success/40 bg-success/[0.04]' : 'border-border'
    }`}>
      {/* Image */}
      {product.imageUrl ? (
        <img
          src={product.imageUrl}
          alt={product.productName}
          className="w-full h-36 object-contain rounded bg-surface"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-36 rounded bg-surface flex items-center justify-center">
          <Package className="w-10 h-10 text-text-secondary/30" />
        </div>
      )}

      {/* Product Name — 2 lines max with ellipsis */}
      <div className="flex items-start justify-between gap-1">
        <h3 className="font-medium text-sm text-text flex-1 line-clamp-2" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          <SearchHighlight text={product.productName} query={searchQuery || ''} />
        </h3>
        {isBlocked && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
            product.isOutOfStock ? 'bg-warning/10 text-warning' : 'bg-red-50 text-danger'
          }`}>
            {!product.isActive ? 'غير متوفر' : 'نفذت الكمية'}
          </span>
        )}
      </div>

      {/* Unit Prices — filtered to active selling units only */}
      {isBlocked ? (
        <div className={`text-xs rounded px-2 py-1.5 ${
          product.isOutOfStock ? 'bg-warning/10 text-warning' : 'bg-red-50 text-danger'
        }`}>
          {!product.isActive ? 'غير متوفر حالياً' : 'نفذت الكمية'}
        </div>
      ) : (
        <div className="flex flex-col gap-0.5 text-xs text-text-secondary">
          {product.unitPrices.map((up) => (
            <div key={up.unitType} className="flex items-center justify-between">
              <span>{UNIT_LABELS[up.unitType]}</span>
              <span className="font-medium text-text">{formatCurrencyShort(up.price)}</span>
            </div>
          ))}
        </div>
      )}

      {!isBlocked && (
        <>
          {/* Unit Selector — only selling units */}
          {sellingUnits.length > 1 && (
            <select
              value={selectedUnit}
              onChange={(e) => setSelectedUnit(e.target.value as UnitType)}
              className="text-xs border border-border rounded-lg px-3 h-11 bg-white w-full"
            >
              {UNIT_PRIORITY.filter((u) => sellingUnits.includes(u)).map((u) => (
                <option key={u} value={u}>{UNIT_LABELS[u]}</option>
              ))}
            </select>
          )}

          {/* Quantity + Toggle */}
          {isInCart ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-center gap-3 text-xs text-text-secondary bg-success/[0.06] rounded-lg px-3 py-2">
                <span className="font-medium text-success">{UNIT_LABELS[selectedUnit]}</span>
                <span>×</span>
                <span className="font-semibold text-text">{quantity}</span>
              </div>
              <div className="text-center text-[10px] text-success font-semibold">✔ تم اختيار المنتج</div>
              <button
                onClick={handleToggle}
                className="w-full bg-danger/8 text-danger text-xs py-3 rounded-lg font-semibold active:bg-danger/15 transition-colors"
              >
                إزالة المنتج
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {/* Quantity Controls — responsive, no overflow */}
              <div className="flex items-center gap-1.5 min-w-0">
                <button
                  onClick={() => setQuantity(q => Math.max(0, q - 1))}
                  className="w-9 h-9 sm:w-11 sm:h-11 rounded-lg bg-surface text-text-secondary text-base sm:text-lg flex items-center justify-center active:bg-border transition-colors font-bold shrink-0"
                >
                  −
                </button>
                <input
                  type="number"
                  min={0}
                  value={quantity || ''}
                  onChange={(e) => setQuantity(Math.max(0, parseInt(e.target.value) || 0))}
                  placeholder="0"
                  className="flex-1 min-w-0 h-9 sm:h-11 border border-border rounded-lg px-1 sm:px-2 text-center text-sm font-medium [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  onFocus={(e) => e.target.select()}
                />
                <button
                  onClick={() => setQuantity(q => q + 1)}
                  className="w-9 h-9 sm:w-11 sm:h-11 rounded-lg bg-surface text-text-secondary text-base sm:text-lg flex items-center justify-center active:bg-border transition-colors font-bold shrink-0"
                >
                  +
                </button>
              </div>

              {/* Purchase Button */}
              <button
                onClick={handleToggle}
                disabled={quantity < 1}
                className="w-full bg-primary text-white text-xs py-3 rounded-lg font-semibold disabled:opacity-40 disabled:cursor-not-allowed active:bg-primary-dark transition-colors"
              >
                شراء المنتج
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
