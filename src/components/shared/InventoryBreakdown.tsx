interface InventoryBreakdownProps {
  quantity: number
  cartonQuantity: number
  className?: string
}

export function InventoryBreakdown({ quantity, cartonQuantity, className }: InventoryBreakdownProps) {
  const qty = Number(quantity) || 0
  const carton = Number(cartonQuantity) || 0

  const dozens = Math.trunc(qty / 12)
  const dozenRemainder = qty - dozens * 12
  const cartons = carton > 0 ? Math.trunc(qty / carton) : 0
  const cartonRemainder = carton > 0 ? qty - cartons * carton : qty

  return (
    <div className={className}>
      <div className="text-[11px] font-bold text-text-secondary mb-1">المخزون الحالي</div>
      <div className="space-y-0.5 text-[12px]">
        <div className="flex items-center gap-1">
          <span>📦</span>
          {carton > 0 ? (
            <span className="font-semibold text-text">{cartons} كرتونة + {cartonRemainder} قطعة</span>
          ) : (
            <span className="font-medium text-text-secondary">حجم الكرتونة غير محدد</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span>📚</span>
          <span className="font-semibold text-text">{dozens} دستة + {dozenRemainder} قطعة</span>
        </div>
        <div className="flex items-center gap-1">
          <span>🧴</span>
          <span className="font-semibold text-text">{qty} قطعة</span>
        </div>
      </div>
    </div>
  )
}
