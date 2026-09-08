import { useCartStore } from '../../store/cart'
import { DiscountOptionSelector, type SelectableDiscountOption } from './DiscountOptionSelector'

export function ShippingMethodSelector() {
  const shippingMethods = useCartStore((s) => s.shippingMethods)
  const selectedShippingMethodId = useCartStore((s) => s.selectedShippingMethodId)
  const selectShippingMethod = useCartStore((s) => s.selectShippingMethod)
  const bonusMode = useCartStore((s) => s.bonusMode)

  const visibleMethods = shippingMethods.filter((m) => m.isActive && m.isVisible)
  const options: SelectableDiscountOption[] = visibleMethods.map((m) => ({
    id: m.id,
    name: m.name,
    discountPercent: m.discountPercent,
  }))

  const selected = visibleMethods.some((m) => m.id === selectedShippingMethodId)

  return (
    <DiscountOptionSelector
      groupLabel="طريقة الشحن"
      noneLabel="بدون طريقة شحن"
      options={options}
      selectedId={selected ? selectedShippingMethodId : null}
      onSelect={selectShippingMethod}
      bonusMode={bonusMode}
    />
  )
}