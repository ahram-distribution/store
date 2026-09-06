import { type TierConfig } from '../../types/storefront'
import { DiscountOptionSelector, type SelectableDiscountOption } from './DiscountOptionSelector'

interface TierSelectorProps {
  tiers: TierConfig[]
  selectedTierId: string | null
  onSelect: (tierId: string | null) => void
  cartTotal: number
}

export function TierSelector({ tiers, selectedTierId, onSelect }: TierSelectorProps) {
  if (tiers.length === 0) return null

  const options: SelectableDiscountOption[] = tiers.map((tier) => ({
    id: tier.id,
    name: tier.name,
    discountPercent: tier.discountPercent,
    minimumOrderAmount: tier.minimumOrderAmount,
    color: tier.color,
    iconUrl: tier.iconUrl,
  }))

  return (
    <DiscountOptionSelector
      groupLabel="اختر شريحتك السعرية"
      noneLabel="السعر الأساسي"
      options={options}
      selectedId={selectedTierId}
      onSelect={onSelect}
      showMinimum
    />
  )
}