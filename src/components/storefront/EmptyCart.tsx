interface EmptyCartProps {
  onBrowseProducts: () => void
}

export function EmptyCart({ onBrowseProducts }: EmptyCartProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="w-20 h-20 rounded-full bg-surface flex items-center justify-center mb-4">
        <span className="text-3xl text-text-secondary">🛒</span>
      </div>
      <h3 className="text-base font-semibold text-text mb-1">السلة فارغة</h3>
      <p className="text-xs text-text-secondary text-center mb-4">
        لم تقم بإضافة أي منتجات بعد. تصفح المنتجات واختر ما تحتاجه.
      </p>
      <button
        onClick={onBrowseProducts}
        className="bg-primary text-white text-sm px-6 py-2.5 rounded-lg active:bg-primary-dark transition-colors"
      >
        تصفح المنتجات
      </button>
    </div>
  )
}
