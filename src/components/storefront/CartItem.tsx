import type { CartItem as CartItemType } from '../../types/storefront'
import { formatCurrencyShort } from '../../utils/format'
import { UNIT_LABELS } from '../../types/order-display'

interface CartItemProps {
  item: CartItemType
  onUpdateQuantity: (productId: string, unitType: string, quantity: number) => void
  onRemove: (productId: string, unitType: string) => void
}

export function CartItem({ item, onUpdateQuantity, onRemove }: CartItemProps) {
  return (
    <div className="bg-white rounded-lg border border-border p-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-medium text-text truncate">{item.productName}</h4>
        <div className="text-xs text-text-secondary mt-0.5">
          {UNIT_LABELS[item.unitType] || item.unitType} &middot; {formatCurrencyShort(item.unitPrice)} للوحدة
        </div>
        <div className="text-xs text-text-secondary">
          إجمالي القطع: {item.pieceQuantity.toLocaleString('ar-EG-u-nu-latn')}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => onUpdateQuantity(item.productId, item.unitType, item.unitQuantity - 1)}
          className="w-7 h-7 flex items-center justify-center rounded-full border border-border text-text-secondary text-sm"
        >
          -
        </button>
        <span className="text-sm font-semibold text-text w-6 text-center">{item.unitQuantity}</span>
        <button
          onClick={() => onUpdateQuantity(item.productId, item.unitType, item.unitQuantity + 1)}
          className="w-7 h-7 flex items-center justify-center rounded-full border border-border text-text-secondary text-sm"
        >
          +
        </button>
      </div>

      <div className="flex flex-col items-end gap-1 min-w-[70px]">
        <span className="text-sm font-semibold text-text">{formatCurrencyShort(item.totalPrice)}</span>
        <button
          onClick={() => onRemove(item.productId, item.unitType)}
          className="text-xs text-danger"
        >
          حذف
        </button>
      </div>
    </div>
  )
}
