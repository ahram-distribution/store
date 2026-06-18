import { formatCurrencyShort, formatDate } from '../../utils/format'
import type { UnifiedOrder } from '../../types/unified-order'

interface OrderReturnsSectionProps {
  returns: UnifiedOrder['returns']
}

export function OrderReturnsSection({ returns }: OrderReturnsSectionProps) {
  if (!returns || returns.length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-border p-4">
      <p className="text-[10px] font-bold text-text-secondary uppercase mb-2">المرتجعات</p>
      <div className="space-y-1.5">
        {returns.map((r) => (
          <div key={r.id} className="flex items-center justify-between text-xs py-1.5 border-b border-border last:border-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-text">{r.code}</span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                r.status === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                'bg-amber-100 text-amber-700'
              }`}>
                {r.status === 'approved' ? 'معتمد' : 'قيد المراجعة'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {r.credit_note_amount != null && <span className="font-bold text-text">{formatCurrencyShort(r.credit_note_amount)}</span>}
              <span className="text-text-secondary text-[9px]">{formatDate(r.created_at)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
