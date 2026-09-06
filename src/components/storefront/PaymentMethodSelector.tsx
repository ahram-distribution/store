import { useCartStore } from '../../store/cart'
import { DiscountOptionSelector, type SelectableDiscountOption } from './DiscountOptionSelector'

export function PaymentMethodSelector() {
  const paymentMethods = useCartStore((s) => s.paymentMethods)
  const selectedPaymentMethodId = useCartStore((s) => s.selectedPaymentMethodId)
  const selectPaymentMethod = useCartStore((s) => s.selectPaymentMethod)

  const visibleMethods = paymentMethods.filter((m) => m.isActive && m.isVisible)
  const options: SelectableDiscountOption[] = visibleMethods.map((m) => ({
    id: m.id,
    name: m.name,
    discountPercent: m.discountPercent,
  }))

  const selected = visibleMethods.some((m) => m.id === selectedPaymentMethodId)

  return (
    <DiscountOptionSelector
      groupLabel="طريقة الدفع"
      noneLabel="نقدي / بدون طريقة"
      options={options}
      selectedId={selected ? selectedPaymentMethodId : null}
      onSelect={selectPaymentMethod}
    />
  )
}