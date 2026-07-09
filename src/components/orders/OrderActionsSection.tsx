interface OrderActionsSectionProps {
  onPdf: (compact: boolean) => void
  onWhatsApp: () => void
  onCopyMessage: () => void
}

export function OrderActionsSection({ onPdf, onWhatsApp, onCopyMessage }: OrderActionsSectionProps) {
  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-5">
      <p className="text-[14px] font-bold text-[#111827] mb-4">إجراءات</p>
      <div className="grid grid-cols-4 gap-3">
        <button onClick={() => onPdf(false)}
          className="bg-[#2563EB] text-white text-[13px] py-3 rounded-lg active:opacity-90 transition-colors hover:bg-[#1D4ED8] font-medium h-[44px]">
          PDF
        </button>
        <button onClick={() => onPdf(true)}
          className="bg-[#059669] text-white text-[13px] py-3 rounded-lg active:opacity-90 transition-colors hover:bg-[#047857] font-medium h-[44px]">
          PDF A5
        </button>
        <button onClick={onWhatsApp}
          className="bg-[#059669] text-white text-[13px] py-3 rounded-lg active:opacity-90 transition-colors hover:bg-[#047857] font-medium h-[44px]">
          مشاركة واتساب
        </button>
        <button onClick={onCopyMessage}
          className="bg-[#6B7280] text-white text-[13px] py-3 rounded-lg active:opacity-90 transition-colors hover:bg-[#4B5563] font-medium h-[44px]">
          نسخ الرسالة
        </button>
      </div>
    </div>
  )
}