import { type TierConfig } from '../../types/storefront'
import { formatCurrencyShort } from '../../utils/format'

interface TierSelectorProps {
  tiers: TierConfig[]
  selectedTierId: string | null
  onSelect: (tierId: string | null) => void
  cartTotal: number
}

function marketingPct(pct: number): number { return Math.ceil(pct) }

export function TierSelector({ tiers, selectedTierId, onSelect, cartTotal }: TierSelectorProps) {
  if (tiers.length === 0) return null

  return (
    <div className="bg-white rounded-lg border border-border p-3">
      <h3 className="text-sm font-semibold text-text mb-2">اختر الشريحة السعرية</h3>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onSelect(null)}
          className={`text-xs px-3 py-2 rounded-lg border transition-colors ${
            selectedTierId === null
              ? 'bg-primary text-white border-primary'
              : 'bg-white text-text-secondary border-border'
          }`}
        >
          السعر الأساسي
        </button>

        {tiers.map((tier) => {
          const isSelected = selectedTierId === tier.id
          const buttonStyle = tier.color && isSelected ? { backgroundColor: tier.color, borderColor: tier.color } : {}
          return (
            <button
              key={tier.id}
              onClick={() => onSelect(tier.id)}
              style={buttonStyle}
              className={`text-xs px-3 py-2 rounded-lg border transition-colors ${
                isSelected && !tier.color
                  ? 'bg-accent text-white border-accent'
                  : 'bg-white text-text-secondary border-border'
              }`}
            >
              <div className="flex items-center gap-1">
                {tier.iconUrl && <img src={tier.iconUrl} alt="" className="w-3 h-3" />}
                <span>{tier.name}</span>
              </div>
              <div className="text-[10px] opacity-75">خصم يصل إلى {marketingPct(tier.discountPercent)}%</div>
              {tier.minimumOrderAmount > 0 && (
                <div className="text-[10px] opacity-75">
                  الحد الأدنى: {formatCurrencyShort(tier.minimumOrderAmount)}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
