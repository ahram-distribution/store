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
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      <div className="px-3 py-2 border-b border-border bg-surface/50 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-text">المنتجات</h3>
        {order.notes && (
          <span className="text-[9px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded">ملاحظات</span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-border bg-surface/50 text-text-secondary">
              <th className="px-2 py-1.5 text-right w-10"></th>
              <th className="px-2 py-1.5 text-right">الصنف</th>
              <th className="px-2 py-1.5 text-center">الوحدة</th>
              <th className="px-2 py-1.5 text-center">الكمية</th>
              <th className="px-2 py-1.5 text-left">السعر</th>
              <th className="px-2 py-1.5 text-left">الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <Fragment key={group.company}>
                <tr className="bg-primary/5 border-b border-primary/20">
                  <td colSpan={6} className="px-2 py-1.5 text-xs font-bold text-primary-dark">{group.company} ({group.items.length})</td>
                </tr>
                {group.items.map((item, idx) => {
                  const qty = Number(item.unit_quantity || 1)
                  const price = Number(item.unit_price || 0)
                  const lineTotal = qty * price
                  return (
                    <tr key={item.id || idx} className="border-b border-border last:border-0">
                      <td className="px-1 py-1.5">
                        {item.image_url ? (
                          <img src={item.image_url} alt="" className="w-7 h-7 rounded object-contain bg-surface" />
                        ) : (
                          <div className="w-7 h-7 rounded bg-surface flex items-center justify-center text-text-secondary text-[8px]">—</div>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <p className="text-text font-medium">{item.product_name || 'غير متوفر'}</p>
                        {item.legacy_code && <p className="text-[9px] text-text-secondary font-mono" dir="ltr">{item.legacy_code}</p>}
                      </td>
                      <td className="px-2 py-1.5 text-center text-text-secondary">{UNIT_LABELS[item.unit_type] || item.unit_type}</td>
                      <td className="px-2 py-1.5 text-center text-text">{qty}</td>
                      <td className="px-2 py-1.5 text-left text-text">{formatCurrencyShort(price)}</td>
                      <td className="px-2 py-1.5 text-left text-text font-semibold">{formatCurrencyShort(lineTotal)}</td>
                    </tr>
                  )
                })}
                {groups.length > 1 && (
                  <tr className="bg-surface/30 border-b border-border">
                    <td colSpan={5} className="px-2 py-1 text-left text-[10px] text-text-secondary">إجمالي {group.company}</td>
                    <td className="px-2 py-1 text-left text-xs font-bold text-text">{formatCurrencyShort(group.subtotal)}</td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-border px-3 py-2 space-y-1 bg-surface/20">
        <div className="flex justify-between text-xs">
          <span className="text-text-secondary">عدد الأصناف</span>
          <span className="font-semibold text-text">{items.length}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-text-secondary">إجمالي الوحدات</span>
          <span className="font-semibold text-text">{totalQty.toLocaleString('en-EG')}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-text-secondary">إجمالي القطع</span>
          <span className="font-semibold text-text">{totalPieces.toLocaleString('en-EG')}</span>
        </div>
        <hr className="border-border" />
        <div className="flex justify-between text-sm font-bold">
          <span className="text-text-secondary">الإجمالي النهائي</span>
          <span className="text-text">{formatCurrencyShort(grandTotal)}</span>
        </div>
        {order.notes && (
          <div className="mt-1 text-[10px] p-2 bg-amber-50 border border-amber-200 rounded-lg">
            <span className="text-text-secondary">ملاحظات: </span><span className="text-text">{order.notes}</span>
          </div>
        )}
      </div>
    </div>
  )
}
