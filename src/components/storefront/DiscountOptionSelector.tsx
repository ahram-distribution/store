import { formatCurrencyShort, formatArabicAmountWithCurrency, formatTierName } from '../../utils/format'

export interface SelectableDiscountOption {
  id: string
  name: string
  discountPercent: number
  minimumOrderAmount?: number
  color?: string | null
  iconUrl?: string | null
}

interface DiscountOptionSelectorProps {
  groupLabel: string
  noneLabel: string
  options: SelectableDiscountOption[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  showMinimum?: boolean
  baseAmount?: number
  hideTitle?: boolean
  bonusMode?: boolean
}

function displayName(name: string): string {
  return formatTierName(name)
}

function percentText(pct: number): string {
  return pct % 1 === 0 ? String(pct) : Number(pct.toFixed(1)).toString()
}

/** Shared commercial selection card used by tiers, payment and shipping. */
export function DiscountOptionSelector({
  groupLabel,
  noneLabel,
  options,
  selectedId,
  onSelect,
  showMinimum,
  baseAmount,
  hideTitle,
  bonusMode,
}: DiscountOptionSelectorProps) {
  if (options.length === 0) return null

  const actualValue = (pct: number) => (baseAmount ?? 0) * (pct / 100)
  const selectedBase = selectedId === null

  return (
    <div className="rounded-xl border border-border bg-white p-3">
      {!hideTitle && (
        <h3 className="text-sm font-bold text-text mb-2.5">{groupLabel}</h3>
      )}

      <div className="grid grid-cols-1 gap-2">
        {/* Base-price option */}
        <button
          onClick={() => onSelect(null)}
          className={`w-full text-right rounded-xl transition-all flex items-center gap-3 ${
            selectedBase
              ? 'border-2 border-primary bg-primary/[0.06] px-3 py-2.5'
              : 'border border-border bg-white px-3 py-2.5 hover:bg-surface'
          }`}
        >
          <span
            className={`w-5 h-5 rounded-full flex items-center justify-center text-white shrink-0 ${
              selectedBase ? 'bg-primary' : 'bg-surface text-transparent'
            }`}
          >
            ✓
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-semibold text-text truncate">{noneLabel}</span>
            <span className="block text-[11px] text-text-secondary mt-0.5">{bonusMode ? 'بدون بونص' : 'بدون خصم'}</span>
          </span>
        </button>

        {/* Configured options */}
        {options.map((option) => {
          const isSelected = selectedId === option.id
          return (
            <button
              key={option.id}
              onClick={() => onSelect(option.id)}
              className={`w-full text-right rounded-xl transition-all flex items-center gap-3 ${
                isSelected
                  ? 'border-2 border-primary bg-primary/[0.06] px-3 py-2.5'
                  : 'border border-border bg-white px-3 py-2.5 hover:bg-surface'
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-white shrink-0 ${
                  isSelected ? 'bg-primary' : 'bg-surface text-transparent'
                }`}
              >
                ✓
              </span>

              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-1.5">
                  {option.iconUrl && <img src={option.iconUrl} alt="" className="w-4 h-4 shrink-0" />}
                  <span className="block text-sm font-semibold text-text truncate">{displayName(option.name)}</span>
                </span>
                <span className="flex items-center gap-2 mt-1 flex-wrap">
                  {option.discountPercent > 0 ? (
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-success/10 text-success">
                      {bonusMode ? `بونص ${percentText(option.discountPercent)}%` : `خصم ${percentText(option.discountPercent)}%`}
                    </span>
                  ) : (
                    <span className="text-[11px] text-text-secondary">{bonusMode ? 'بدون بونص' : 'بدون خصم'}</span>
                  )}
                  {showMinimum && option.minimumOrderAmount !== undefined && option.minimumOrderAmount > 0 && (
                    <span className="text-[11px] text-text-secondary">
                      الحد الأدنى: {formatArabicAmountWithCurrency(option.minimumOrderAmount)}
                    </span>
                  )}
                  {!bonusMode && baseAmount !== undefined && baseAmount > 0 && option.discountPercent > 0 && (
                    <span className="text-[11px] text-success/90">
                      ≈ {formatCurrencyShort(Math.round(actualValue(option.discountPercent) * 100) / 100)}
                    </span>
                  )}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}