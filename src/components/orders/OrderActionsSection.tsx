interface OrderActionsSectionProps {
  onPdf: (compact: boolean) => void
  onWhatsApp: () => void
  onCopyMessage: () => void
}

export function OrderActionsSection({ onPdf, onWhatsApp, onCopyMessage }: OrderActionsSectionProps) {
  return (
    <div className="bg-white rounded-xl border border-border p-4">
      <p className="text-[10px] font-bold text-text-secondary uppercase mb-3">الإجراءات</p>
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => onPdf(false)} className="flex-1 min-w-[80px] bg-primary text-white text-xs py-2.5 rounded-lg active:opacity-90 transition-colors">
          PDF
        </button>
        <button onClick={() => onPdf(true)} className="flex-1 min-w-[80px] bg-emerald-600 text-white text-xs py-2.5 rounded-lg active:opacity-90 transition-colors">
          PDF A5
        </button>
        <button onClick={onWhatsApp} className="flex-1 min-w-[80px] bg-green-600 text-white text-xs py-2.5 rounded-lg active:opacity-90 transition-colors">
          مشاركة واتساب
        </button>
        <button onClick={onCopyMessage} className="flex-1 min-w-[80px] bg-gray-600 text-white text-xs py-2.5 rounded-lg active:opacity-90 transition-colors">
          نسخ الرسالة
        </button>
      </div>
    </div>
  )
}
