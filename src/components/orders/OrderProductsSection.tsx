import { Fragment, useMemo, useState } from 'react'
import { formatCurrencyShort } from '../../utils/format'
import { formatNumber, toEnglishDigits } from '../../utils/numbers'
import { UNIT_LABELS } from '../../types/order-display'
import type { UnifiedOrderItem } from '../../types/unified-order'
import type { BusinessStatusCardData } from '../../utils/cart-availability'

interface CompanyGroup {
  company: string
  items: UnifiedOrderItem[]
  subtotal: number
}

interface OrderProductsSectionProps {
  items: UnifiedOrderItem[]
  mode?: 'view' | 'edit'
  onQuantityChange?: (productId: string, unitType: string, newQty: number) => void
  onRemoveItem?: (productId: string, unitType: string) => void
  onPriceChange?: (productId: string, unitType: string, newPrice: number) => void
  onUnitChange?: (productId: string, oldUnit: string, newUnit: string) => void
  unitOptions?: Record<string, string[]>
  onDeleteSelected?: (keys: Array<{ productId: string; unitType: string }>) => void
  onAddProduct?: (companyName: string) => void
  shortageProductIds?: Set<string>
  businessStatusByItem?: Record<string, BusinessStatusCardData>
}

export function OrderProductsSection({ items, mode = 'view', onQuantityChange, onRemoveItem, onPriceChange, onUnitChange, unitOptions, onDeleteSelected, onAddProduct, shortageProductIds, businessStatusByItem }: OrderProductsSectionProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const toggleSelected = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const handleDeleteSelected = () => {
    if (!onDeleteSelected || selected.size === 0) return
    if (!window.confirm(`هل أنت متأكد من حذف ${selected.size} صنف؟`)) return
    const keys = [...selected].map(k => {
      const sep = k.lastIndexOf(':')
      return { productId: k.slice(0, sep), unitType: k.slice(sep + 1) }
    })
    onDeleteSelected(keys)
    setSelected(new Set())
  }
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

  const isEdit = mode === 'edit'

  return (
    <div>
      <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-[#E5E7EB] bg-[#F9FAFB] flex items-center justify-between">
          <h3 className="text-[14px] font-bold text-[#111827]">المنتجات</h3>
          {isEdit && items.length > 0 && (
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-[#6B7280]">{items.length} صنف</span>
              {selected.size > 0 && (
                <button
                  onClick={handleDeleteSelected}
                  className="text-[11px] bg-[#FEF2F2] text-[#DC2626] px-2.5 py-1 rounded-lg border border-[#FECACA] hover:bg-[#FEE2E2] transition-colors font-medium"
                >
                  حذف المحدد ({selected.size})
                </button>
              )}
            </div>
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
                {isEdit && <th className="px-2 py-3 text-center font-semibold w-10">تحديد</th>}
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
                    const isShortage = shortageProductIds?.has(item.product_id) === true
                    const statusCard = !isEdit ? businessStatusByItem?.[`${item.product_id}:${item.unit_type}`] : undefined
                    const tone = statusCard?.status ?? (isShortage ? 'red' : undefined)
                    const rowBg = tone === 'red' ? 'bg-red-50' : tone === 'yellow' ? 'bg-yellow-50' : tone === 'green' ? 'bg-green-50' : ''
                    const rowHover = tone ? '' : 'hover:bg-[#F9FAFB]'
                    return (
                      <Fragment key={item.id || idx}>
                        <tr className={`border-b border-[#E5E7EB] last:border-0 ${rowHover} transition-colors ${rowBg}`}>
                          <td className="px-3 py-3">
                            <span className="text-[15px] font-bold text-blue-600 font-mono" dir="ltr">{item.legacy_code || '—'}</span>
                          </td>
                          <td className="px-3 py-3">
                            <p className="font-semibold text-[#111827]">{item.product_name || 'غير متوفر'}</p>
                          </td>
                          <td className="px-3 py-3 text-center">
                            {isEdit && onUnitChange && unitOptions ? (
                              (() => {
                                const opts = unitOptions[item.product_id] || []
                                const options = opts.includes(item.unit_type) ? opts : [item.unit_type, ...opts]
                                return (
                                  <select
                                    value={item.unit_type}
                                    onChange={e => {
                                      if (e.target.value !== item.unit_type) onUnitChange(item.product_id, item.unit_type, e.target.value)
                                    }}
                                    className="text-[11px] font-semibold text-[#111827] border border-[#E5E7EB] rounded px-1 py-0.5 bg-white"
                                  >
                                    {options.map(u => (
                                      <option key={u} value={u}>{UNIT_LABELS[u] || u}</option>
                                    ))}
                                  </select>
                                )
                              })()
                            ) : (
                              <span className="text-[#6B7280]">{UNIT_LABELS[item.unit_type] || item.unit_type}</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-center">
                            {isEdit && onQuantityChange ? (
                              <input
                                type="text"
                                inputMode="numeric"
                                dir="ltr"
                                lang="en"
                                value={qty}
                                onChange={e => {
                                  const raw = toEnglishDigits(e.target.value).replace(/[^0-9]/g, '')
                                  if (raw === '') return
                                  const v = parseInt(raw, 10)
                                  if (v >= 1) onQuantityChange(item.product_id, item.unit_type, v)
                                }}
                                className="w-12 text-center text-[12px] font-semibold text-[#111827] border border-[#E5E7EB] rounded px-1 py-0.5"
                              />
                            ) : (
                              <span className="text-[#111827] font-semibold">{qty}</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-left">
                            {isEdit && onPriceChange ? (
                              <input
                                type="text"
                                inputMode="decimal"
                                dir="ltr"
                                lang="en"
                                value={price}
                                onChange={e => {
                                  const raw = toEnglishDigits(e.target.value).replace(/[^0-9.]/g, '')
                                  if (raw === '' || raw === '.') return
                                  const v = Number(raw)
                                  if (Number.isFinite(v) && v >= 0) onPriceChange(item.product_id, item.unit_type, v)
                                }}
                                className="w-16 text-left text-[12px] font-semibold text-[#111827] border border-[#E5E7EB] rounded px-1 py-0.5"
                              />
                            ) : (
                              <span className="text-[#111827]">{formatCurrencyShort(price)}</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-left text-[#111827] font-bold">{formatCurrencyShort(lineTotal)}</td>
                          {isEdit && (
                            <td className="px-2 py-3 text-center">
                              <input
                                type="checkbox"
                                checked={selected.has(`${item.product_id}:${item.unit_type}`)}
                                onChange={() => toggleSelected(`${item.product_id}:${item.unit_type}`)}
                                className="w-4 h-4 accent-[#2563EB] cursor-pointer"
                              />
                            </td>
                          )}
                        </tr>
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
