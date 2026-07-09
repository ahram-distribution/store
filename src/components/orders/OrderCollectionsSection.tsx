import { formatCurrencyShort, formatDateTime } from '../../utils/format'
import type { UnifiedOrderCollection } from '../../types/unified-order'

interface OrderCollectionsSectionProps {
  collections: UnifiedOrderCollection[]
}

export function OrderCollectionsSection({ collections }: OrderCollectionsSectionProps) {
  if (!collections || collections.length === 0) return null

  const totalCollected = collections.reduce((s, c) => s + Number(c.amount || 0), 0)

  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-5">
      <p className="text-[14px] font-bold text-[#111827] mb-3">التحصيلات</p>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-[#E5E7EB] text-[#9CA3AF] text-[11px]">
              <th className="text-right pb-2 font-medium">التاريخ</th>
              <th className="text-right pb-2 font-medium">الموظف</th>
              <th className="text-left pb-2 font-medium">المبلغ</th>
              <th className="text-left pb-2 font-medium">ملاحظات</th>
            </tr>
          </thead>
          <tbody>
            {collections.map((c, i) => (
              <tr key={c.id || i} className="border-b border-[#F3F4F6] last:border-0">
                <td className="py-2 text-[#111827]">{formatDateTime(c.created_at)}</td>
                <td className="py-2 text-[#6B7280]">{c.collector_name || 'غير متوفر'}</td>
                <td className="py-2 text-left font-semibold text-[#111827]">{formatCurrencyShort(Number(c.amount || 0))}</td>
                <td className="py-2 text-left text-[#6B7280]">{c.notes || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-[#E5E7EB] pt-2 mt-2 flex justify-between items-center">
        <p className="text-[12px] text-[#6B7280] font-medium">الإجمالي</p>
        <p className="text-[15px] font-bold text-[#059669]">{formatCurrencyShort(totalCollected)}</p>
      </div>
    </div>
  )
}