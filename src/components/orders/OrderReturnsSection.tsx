import { formatCurrencyShort, formatDate } from '../../utils/format'
import type { UnifiedOrder } from '../../types/unified-order'

interface OrderReturnsSectionProps {
  returns: UnifiedOrder['returns']
}

export function OrderReturnsSection({ returns }: OrderReturnsSectionProps) {
  if (!returns || returns.length === 0) return null

  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-5">
      <p className="text-[14px] font-bold text-[#111827] mb-3">المرتجعات</p>
      <div className="space-y-2">
        {returns.map((r) => (
          <div key={r.id} className="flex items-center justify-between text-[13px] py-2 border-b border-[#E5E7EB] last:border-0">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-[#111827]">{r.code}</span>
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                r.status === 'approved' ? 'bg-[#ECFDF5] text-[#059669]' :
                'bg-[#FFFBEB] text-[#D97706]'
              }`}>
                {r.status === 'approved' ? 'معتمد' : 'قيد المراجعة'}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {r.credit_note_amount != null && <span className="font-bold text-[#111827]">{formatCurrencyShort(r.credit_note_amount)}</span>}
              <span className="text-[#6B7280] text-[12px]">{formatDate(r.created_at)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
