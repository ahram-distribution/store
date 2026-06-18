import { useMemo } from 'react'
import { formatCurrencyShort, formatDate } from '../../utils/format'
import type { UnifiedCollectionSummary } from '../../types/unified-order'

interface OrderCollectionsSectionProps {
  collections: UnifiedCollectionSummary[]
  grandTotal: number
}

export function OrderCollectionsSection({ collections, grandTotal }: OrderCollectionsSectionProps) {
  const collectedAmount = useMemo(() => {
    if (!collections?.length) return 0
    return collections
      .filter(c => c.status !== 'pending' && c.amount != null)
      .reduce((s, c) => s + Number(c.amount), 0)
  }, [collections])

  const collectionPercentage = grandTotal > 0 ? Math.min(Math.round((collectedAmount / grandTotal) * 100), 100) : 0

  const lastCollection = useMemo(() => {
    if (!collections?.length) return null
    const completed = collections.filter(c => c.status !== 'pending' && c.collected_at)
    if (!completed.length) return null
    completed.sort((a, b) => new Date(b.collected_at!).getTime() - new Date(a.collected_at!).getTime())
    return completed[0]
  }, [collections])

  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      <div className="px-3 py-2 border-b border-border bg-surface/50">
        <h3 className="text-xs font-semibold text-text">التحصيلات</h3>
      </div>
      <div className="p-3 space-y-2">
        <div className="bg-surface/40 rounded-lg border border-border p-3 space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-text-secondary">إجمالي الطلب</span>
            <span className="font-bold text-text">{formatCurrencyShort(grandTotal)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-text-secondary text-green-700">تم التحصيل</span>
            <span className="font-bold text-green-700">{formatCurrencyShort(collectedAmount)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-text-secondary">المتبقى</span>
            <span className="font-bold text-text">{formatCurrencyShort(Math.max(grandTotal - collectedAmount, 0))}</span>
          </div>
          <hr className="border-border" />
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-secondary">نسبة التحصيل</span>
            <div className="flex items-center gap-2">
              <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${collectionPercentage}%` }} />
              </div>
              <span className="font-bold text-text min-w-[3ch] text-left">{collectionPercentage}%</span>
            </div>
          </div>
          {lastCollection && (
            <>
              <hr className="border-border" />
              <div className="flex justify-between text-xs">
                <span className="text-text-secondary">آخر تحصيل</span>
                <span className="font-bold text-text">{formatCurrencyShort(Number(lastCollection.amount))}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-secondary">تاريخ آخر تحصيل</span>
                <span className="font-medium text-text">{lastCollection.collected_at ? formatDate(lastCollection.collected_at) : '—'}</span>
              </div>
            </>
          )}
        </div>

        <div className="space-y-1">
          {collections.map((c) => (
            <div key={c.id} className="flex items-center justify-between py-1.5 border-b border-border last:border-0 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-medium text-text">{c.code}</span>
                <span className="text-text-secondary">{c.method}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                  c.status === 'approved' || c.status === 'treasury_posted' ? 'bg-emerald-100 text-emerald-700' :
                  'bg-gray-100 text-gray-500'
                }`}>
                  {c.status === 'approved' ? 'معتمد' : c.status === 'treasury_posted' ? 'مرحل للخزينة' : 'معلق'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-text">{formatCurrencyShort(Number(c.amount))}</span>
                {c.collected_at && <span className="text-text-secondary text-[9px]">{formatDate(c.collected_at)}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
