import type { CartTotals, TierConfig } from '../../types/storefront'
import { formatCurrencyShort } from '../../utils/format'

interface CartSummaryProps {
  totals: CartTotals
  selectedTier: TierConfig | null
}

export function CartSummary({ totals, selectedTier }: CartSummaryProps) {
  return (
    <div className="bg-white rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold text-text mb-3">ملخص الطلب</h3>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between text-text-secondary">
          <span>إجمالي المنتجات</span>
          <span>{formatCurrencyShort(totals.productSubtotal)}</span>
        </div>

        {totals.dealTotal > 0 && (
          <div className="flex justify-between text-amber-600">
            <span>العروض</span>
            <span>{formatCurrencyShort(totals.dealTotal)}</span>
          </div>
        )}

        {totals.tierDiscount > 0 && (
          <div className="flex justify-between text-success">
            <span>خصم الشريحة ({selectedTier?.name})</span>
            <span>-{formatCurrencyShort(totals.tierDiscount)}</span>
          </div>
        )}

        <hr className="border-border" />

        <div className="flex justify-between text-text font-semibold text-base">
          <span>الإجمالي النهائي</span>
          <span>{formatCurrencyShort(totals.netTotal)}</span>
        </div>
      </div>
    </div>
  )
}
