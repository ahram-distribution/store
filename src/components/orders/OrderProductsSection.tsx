import { Fragment, useMemo, useState } from 'react'
import { formatCurrencyShort } from '../../utils/format'
import { formatNumber } from '../../utils/numbers'
import { UNIT_LABELS } from '../../types/order-display'
import { formatMixedQuantity } from '../../utils/quantity-format'
import type { UnitType } from '../../types/storefront'
import type { UnifiedOrder, UnifiedOrderItem, InventorySnapshotItem, ReservationStatus } from '../../types/unified-order'

interface CompanyGroup {
  company: string
  items: UnifiedOrderItem[]
  subtotal: number
}

interface OrderProductsSectionProps {
  items: UnifiedOrderItem[]
  order: UnifiedOrder['order']
  mode?: 'view' | 'edit'
  onQuantityChange?: (productId: string, unitType: string, newQty: number) => void
  onRemoveItem?: (productId: string, unitType: string) => void
  onPriceChange?: (productId: string, unitType: string, newPrice: number) => void
  onAddProduct?: (companyName: string) => void
  shortageProductIds?: Set<string>
  inventorySnapshot?: InventorySnapshotItem[]
}

const RESERVATION_STATUS_META: Record<ReservationStatus, { icon: string; text: string; cls: string }> = {
  sufficient: { icon: '🟢', text: 'جاهز للاعتماد', cls: 'text-emerald-700' },
  prior_reservation: { icon: '🟡', text: 'يوجد حجز سابق على هذا الصنف — قد تتغير الكمية عند الاعتماد', cls: 'text-amber-700' },
  shortage: { icon: '🔴', text: 'الكمية المطلوبة أكبر من المتاح', cls: 'text-red-600' },
}

export function OrderProductsSection({ items, order, mode = 'view', onQuantityChange, onRemoveItem, onPriceChange, onAddProduct, shortageProductIds, inventorySnapshot }: OrderProductsSectionProps) {
  const grandTotal = useMemo(() => items.reduce((s, i) => s + Number(i.total_price || 0), 0), [items])
  const totalPieces = useMemo(() => items.reduce((s, i) => s + Number(i.piece_quantity || 0), 0), [items])
  const totalQty = useMemo(() => items.reduce((s, i) => s + Number(i.unit_quantity || 0), 0), [items])

  const snapshotAvailMap = useMemo(() => {
    if (!inventorySnapshot || inventorySnapshot.length === 0) return new Map<string, number>()
    return new Map(inventorySnapshot.map(s => [s.product_id, s.available_quantity]))
  }, [inventorySnapshot])

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

  const isEdit = mode === 'edit'

  return (
    <div>
      <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-[#E5E7EB] bg-[#F9FAFB] flex items-center justify-between">
          <h3 className="text-[14px] font-bold text-[#111827]">المنتجات</h3>
          {isEdit && items.length > 0 && (
            <span className="text-[11px] text-[#6B7280]">{items.length} صنف</span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-[#E5E7EB] bg-[#F3F4F6] text-[#6B7280]">
                <th className="px-3 py-3 text-right font-semibold">كود الصنف</th>
                <th className="px-3 py-3 text-right font-semibold">اسم الصنف</th>
                <th className="px-3 py-3 text-center font-semibold">الوحدة</th>
                <th className="px-3 py-3 text-center font-semibold">الكمية</th>
                <th className="px-3 py-3 text-left font-semibold">سعر الوحدة</th>
                <th className="px-3 py-3 text-left font-semibold">الإجمالي</th>
                {isEdit && <th className="px-2 py-3 text-center font-semibold w-10"></th>}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <Fragment key={group.company}>
                  <tr className="bg-[#F0FDF4] border-b border-[#D1FAE5]">
                    <td colSpan={isEdit ? 7 : 6} className="px-3 py-2 text-[13px] font-bold text-[#059669]">
                      <div className="flex items-center justify-between">
                        <span>{group.company} ({group.items.length})</span>
                        {isEdit && onAddProduct && (
                          <button
                            onClick={() => onAddProduct(group.company)}
                            className="text-[10px] bg-white text-accent px-2.5 py-1 rounded-lg border border-accent/30 hover:bg-accent/5 transition-colors font-medium"
                          >
                            + إضافة منتج
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {group.items.map((item, idx) => {
                    const qty = Number(item.unit_quantity || 1)
                    const price = Number(item.unit_price || 0)
                    const lineTotal = qty * price
                    const snap = inventorySnapshot?.find(s => s.product_id === item.product_id)
                    const reservationStatus: ReservationStatus | null = snap?.reservation_status
                      ?? (snap?.is_sufficient === false ? 'shortage' : null)
                    const isShortage = shortageProductIds?.has(item.product_id)
                      || snap?.is_sufficient === false
                      || reservationStatus === 'shortage'
                    const shortageAvail = snap?.available_quantity ?? snapshotAvailMap.get(item.product_id)
                    const statusMeta = reservationStatus ? RESERVATION_STATUS_META[reservationStatus] : null
                    const statusAppend = reservationStatus === 'shortage' && snap
                      ? `المتاح حاليًا: ${formatMixedQuantity(snap.available_quantity, snap.carton_quantity, item.unit_type as UnitType)}`
                      : null
                    return (
                      <Fragment key={item.id || idx}>
                        <tr className={`border-b border-[#E5E7EB] last:border-0 hover:bg-[#F9FAFB] transition-colors ${isShortage ? 'bg-red-50' : ''}`}>
                          <td className="px-3 py-3">
                            <span className="text-[15px] font-bold text-blue-600 font-mono" dir="ltr">{item.legacy_code || '—'}</span>
                          </td>
                          <td className="px-3 py-3">
                            <p className="font-semibold text-[#111827]">{item.product_name || 'غير متوفر'}</p>
                          </td>
                          <td className="px-3 py-3 text-center text-[#6B7280]">{UNIT_LABELS[item.unit_type] || item.unit_type}</td>
                          <td className="px-3 py-3 text-center">
                            {isEdit && onQuantityChange ? (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  onClick={() => onQuantityChange(item.product_id, item.unit_type, -1)}
                                  className="w-5 h-5 rounded-full bg-[#F3F4F6] text-[#6B7280] text-xs flex items-center justify-center hover:bg-[#E5E7EB] transition-colors"
                                >−</button>
                                <input
                                  type="number"
                                  value={qty}
                                  onChange={e => {
                                    const v = parseInt(e.target.value) || 1
                                    if (v >= 1) onQuantityChange(item.product_id, item.unit_type, v)
                                  }}
                                  className="w-10 text-center text-[12px] font-semibold text-[#111827] border border-[#E5E7EB] rounded px-1 py-0.5"
                                  min="1"
                                />
                                <button
                                  onClick={() => onQuantityChange(item.product_id, item.unit_type, 1)}
                                  className="w-5 h-5 rounded-full bg-[#F3F4F6] text-[#6B7280] text-xs flex items-center justify-center hover:bg-[#E5E7EB] transition-colors"
                                >+</button>
                              </div>
                            ) : (
                              <span className="text-[#111827] font-semibold">{qty}</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-left">
                            {isEdit && onPriceChange ? (
                              <input
                                type="number"
                                value={price}
                                onChange={e => {
                                  const v = Number(e.target.value)
                                  if (v >= 0) onPriceChange(item.product_id, item.unit_type, v)
                                }}
                                className="w-16 text-left text-[12px] font-semibold text-[#111827] border border-[#E5E7EB] rounded px-1 py-0.5"
                                step="0.01"
                                min="0"
                              />
                            ) : (
                              <span className="text-[#111827]">{formatCurrencyShort(price)}</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-left text-[#111827] font-bold">{formatCurrencyShort(lineTotal)}</td>
                          {isEdit && onRemoveItem && (
                            <td className="px-2 py-3 text-center">
                              <button
                                onClick={() => onRemoveItem(item.product_id, item.unit_type)}
                                className="text-[#EF4444] hover:text-[#DC2626] text-xs font-semibold transition-colors"
                                title="حذف الصنف"
                              >
                                ✕
                              </button>
                            </td>
                          )}
                        </tr>
                        {isEdit && isShortage && (
                          <tr className="border-b border-[#E5E7EB] bg-red-50">
                            <td colSpan={isEdit ? 7 : 6} className="px-3 pb-2">
                              <p className="text-[11px] text-danger font-medium">⚠️ الكمية المطلوبة غير متوفرة بالمخزون</p>
                              <p className="text-[11px] text-danger font-medium">
                                المطلوب: {qty}{shortageAvail != null ? ` | المتاح حاليًا: ${formatMixedQuantity(shortageAvail, snap?.carton_quantity, item.unit_type as UnitType)}` : ''}
                              </p>
                            </td>
                          </tr>
                        )}
                        {!isEdit && reservationStatus && statusMeta && (
                          <tr className="border-b border-[#E5E7EB] bg-[#F8FAFC]">
                            <td colSpan={6} className="px-3 py-1.5">
                              <p className={`text-[11px] font-medium ${statusMeta.cls}`}>
                                <span>{statusMeta.icon}</span> {statusMeta.text}
                                {statusAppend ? ` — ${statusAppend}` : ''}
                              </p>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                  {groups.length > 1 && (
                    <tr className="bg-[#F9FAFB] border-b border-[#E5E7EB]">
                      <td colSpan={isEdit ? 5 : 4} className="px-3 py-2 text-left text-[11px] text-[#6B7280] font-medium">إجمالي {group.company}</td>
                      <td className="px-3 py-2 text-left text-[13px] font-bold text-[#111827]" colSpan={isEdit ? 2 : 1}>{formatCurrencyShort(group.subtotal)}</td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {isEdit && onAddProduct && (
          <div className="px-5 py-3 border-t border-[#E5E7EB] bg-[#F9FAFB]">
            <button
              onClick={() => onAddProduct('')}
              className="w-full bg-accent/10 text-accent text-xs py-2 rounded-lg font-semibold hover:bg-accent/20 transition-colors"
            >
              + إضافة منتجات
            </button>
          </div>
        )}
      </div>
      <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-5 mt-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-[11px] text-[#9CA3AF] font-medium">عدد الأصناف</p>
            <p className="text-[13px] font-bold text-[#111827] mt-0.5">{items.length}</p>
          </div>
          <div>
            <p className="text-[11px] text-[#9CA3AF] font-medium">إجمالي الوحدات</p>
            <p className="text-[13px] font-bold text-[#111827] mt-0.5">{formatNumber(totalQty)}</p>
          </div>
          <div>
            <p className="text-[11px] text-[#9CA3AF] font-medium">إجمالي القطع</p>
            <p className="text-[13px] font-bold text-[#111827] mt-0.5">{formatNumber(totalPieces)}</p>
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
