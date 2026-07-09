import { Fragment, useMemo } from 'react'
import { formatCurrencyShort } from '../../utils/format'
import { UNIT_LABELS } from '../../types/order-display'
import type { UnifiedOrder, UnifiedOrderItem } from '../../types/unified-order'

interface CompanyGroup {
  company: string
  items: UnifiedOrderItem[]
  subtotal: number
}

interface OrderProductsSectionProps {
  items: UnifiedOrderItem[]
  order: UnifiedOrder['order']
}

export function OrderProductsSection({ items, order }: OrderProductsSectionProps) {
  const grandTotal = useMemo(() => items.reduce((s, i) => s + Number(i.total_price || 0), 0), [items])
  const totalPieces = useMemo(() => items.reduce((s, i) => s + Number(i.piece_quantity || 0), 0), [items])
  const totalQty = useMemo(() => items.reduce((s, i) => s + Number(i.unit_quantity || 0), 0), [items])

  const groups: CompanyGroup[] = useMemo(() => {
    const map: Record<string, CompanyGroup> = {}
    for (const item of items) {
      const companyName = item.company_name || 'أخرى'
      if (!map[companyName]) map[companyName] = { company: companyName, items: [], subtotal: 0 }
      map[companyName].items.push(item)
      map[companyName].subtotal += Number(item.total_price || 0)
    }
    return Object.values(map)
  }, [items])

  return (
    <div>
      <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-[#E5E7EB] bg-[#F9FAFB]">
          <h3 className="text-[14px] font-bold text-[#111827]">المنتجات</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-[#E5E7EB] bg-[#F3F4F6] text-[#6B7280]">
                <th className="px-3 py-3 text-right w-10 font-semibold"></th>
                <th className="px-3 py-3 text-right font-semibold">الصنف</th>
                <th className="px-3 py-3 text-center font-semibold">الوحدة</th>
                <th className="px-3 py-3 text-center font-semibold">الكمية</th>
                <th className="px-3 py-3 text-left font-semibold">السعر</th>
                <th className="px-3 py-3 text-left font-semibold">الإجمالي</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <Fragment key={group.company}>
                  <tr className="bg-[#F0FDF4] border-b border-[#D1FAE5]">
                    <td colSpan={6} className="px-3 py-2 text-[13px] font-bold text-[#059669]">{group.company} ({group.items.length})</td>
                  </tr>
                  {group.items.map((item, idx) => {
                    const qty = Number(item.unit_quantity || 1)
                    const price = Number(item.unit_price || 0)
                    const lineTotal = qty * price
                    return (
                      <tr key={item.id || idx} className="border-b border-[#E5E7EB] last:border-0 hover:bg-[#F9FAFB] transition-colors">
                        <td className="px-2 py-3">
                          {item.image_url ? (
                            <img src={item.image_url} alt="" className="w-8 h-8 rounded-lg object-contain bg-[#F9FAFB] border border-[#E5E7EB]" />
                          ) : (
                            <div className="w-8 h-8 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] flex items-center justify-center text-[#9CA3AF] text-[9px]">—</div>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <p className="font-semibold text-[#111827]">{item.product_name || 'غير متوفر'}</p>
                          {item.legacy_code && <p className="text-[10px] text-[#9CA3AF] font-mono mt-0.5" dir="ltr">{item.legacy_code}</p>}
                        </td>
                        <td className="px-3 py-3 text-center text-[#6B7280]">{UNIT_LABELS[item.unit_type] || item.unit_type}</td>
                        <td className="px-3 py-3 text-center text-[#111827] font-semibold">{qty}</td>
                        <td className="px-3 py-3 text-left text-[#111827]">{formatCurrencyShort(price)}</td>
                        <td className="px-3 py-3 text-left text-[#111827] font-bold">{formatCurrencyShort(lineTotal)}</td>
                      </tr>
                    )
                  })}
                  {groups.length > 1 && (
                    <tr className="bg-[#F9FAFB] border-b border-[#E5E7EB]">
                      <td colSpan={5} className="px-3 py-2 text-left text-[11px] text-[#6B7280] font-medium">إجمالي {group.company}</td>
                      <td className="px-3 py-2 text-left text-[13px] font-bold text-[#111827]">{formatCurrencyShort(group.subtotal)}</td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-5 mt-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-[11px] text-[#9CA3AF] font-medium">عدد الأصناف</p>
            <p className="text-[13px] font-bold text-[#111827] mt-0.5">{items.length}</p>
          </div>
          <div>
            <p className="text-[11px] text-[#9CA3AF] font-medium">إجمالي الوحدات</p>
            <p className="text-[13px] font-bold text-[#111827] mt-0.5">{totalQty.toLocaleString('en-EG')}</p>
          </div>
          <div>
            <p className="text-[11px] text-[#9CA3AF] font-medium">إجمالي القطع</p>
            <p className="text-[13px] font-bold text-[#111827] mt-0.5">{totalPieces.toLocaleString('en-EG')}</p>
          </div>
          <div className="text-left">
            <p className="text-[11px] text-[#9CA3AF] font-medium">الإجمالي النهائي</p>
            <p className="text-[21px] font-bold text-[#059669] mt-0.5">{formatCurrencyShort(grandTotal)}</p>
          </div>
        </div>
      </div>
    </div>
  )
}