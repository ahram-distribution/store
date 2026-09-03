import { Fragment, useMemo, useState } from 'react'
import { formatNumber, toEnglishDigits } from '../../utils/numbers'
import { UNIT_LABELS } from '../../types/order-display'
import type { UnifiedOrderItem } from '../../types/unified-order'
import type { BusinessStatusCardData } from '../../utils/cart-availability'

function formatValue(amount: number): string {
  const formatted = formatNumber(amount, { minFractionDigits: 2, maxFractionDigits: 2 })
  return formatted.replace(/\.00$/, '')
}

interface CompanyGroup {
  company: string
  items: UnifiedOrderItem[]
  subtotal: number
  totalPieces: number
}

function lineDisplayPieces(item: UnifiedOrderItem): number {
  const qty = Number(item.unit_quantity || 1)
  if (item.unit_type === 'dozen') return qty * 12
  const stored = Number(item.piece_quantity || 0)
  return stored > 0 ? stored : qty
}

function arabicSortKey(value: string): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670]/g, '')
    .replace(/\u0640/g, '')
    .replace(/[\u0622\u0623\u0625]/g, '\u0627')
    .replace(/\u0629/g, '\u0647')
    .replace(/[\u0649]/g, '\u064A')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function compareArabic(a: string, b: string): number {
  return arabicSortKey(a).localeCompare(arabicSortKey(b), 'ar')
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
      if (!map[companyName]) map[companyName] = { company: companyName, items: [], subtotal: 0, totalPieces: 0 }
      map[companyName].items.push(item)
      map[companyName].subtotal += Number(item.total_price || 0)
      map[companyName].totalPieces += lineDisplayPieces(item)
    }
    return Object.values(map)
      .map((group) => ({
        ...group,
        items: [...group.items].sort((a, b) =>
          compareArabic(a.product_name || '', b.product_name || ''),
        ),
      }))
      .sort((a, b) => compareArabic(a.company, b.company))
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
          <table className="w-full text-[12px] border-separate border-spacing-0">
            <thead>
              <tr className="text-[#475569]">
                <th className="px-3 py-2.5 text-right font-bold text-[11px] uppercase tracking-wide border-b-2 border-[#D9E2EC] bg-[#F1F5F9]">كود الصنف</th>
                <th className="px-3 py-2.5 text-right font-bold text-[11px] uppercase tracking-wide border-b-2 border-[#D9E2EC] bg-[#F1F5F9]">اسم الصنف</th>
                <th className="px-3 py-2.5 text-center font-bold text-[11px] uppercase tracking-wide border-b-2 border-[#D9E2EC] bg-[#F1F5F9]">الكمية</th>
                <th className="px-3 py-2.5 text-center font-bold text-[11px] uppercase tracking-wide border-b-2 border-[#D9E2EC] bg-[#F1F5F9]">الوحدة</th>
                <th className="px-3 py-2.5 text-left font-bold text-[11px] uppercase tracking-wide border-b-2 border-[#D9E2EC] bg-[#F1F5F9]">سعر الوحدة</th>
                <th className="px-3 py-2.5 text-left font-bold text-[11px] uppercase tracking-wide border-b-2 border-[#D9E2EC] bg-[#F1F5F9]">الإجمالي</th>
                {isEdit && <th className="px-2 py-2.5 text-center font-bold text-[11px] uppercase tracking-wide border-b-2 border-[#D9E2EC] bg-[#F1F5F9] w-10">تحديد</th>}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <Fragment key={group.company}>
                  <tr className="bg-[#F0FDF4]">
                    <td colSpan={isEdit ? 7 : 6} className="px-3 py-2 text-[15px] font-extrabold text-[#2563EB] border-t border-t-[#D1FAE5] border-l border-l-[#EEF1F4]">
                      <div className="flex items-center justify-between">
                        <span>شركة {group.company}&nbsp;&nbsp;-&nbsp;&nbsp;إجمالي الأصناف {formatNumber(group.items.length)}&nbsp;&nbsp;-&nbsp;&nbsp;إجمالي القطع {formatNumber(group.totalPieces)}&nbsp;&nbsp;-&nbsp;&nbsp;إجمالي المبلغ {formatValue(group.subtotal)}</span>
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
                    const isDozen = item.unit_type === 'dozen'
                    const displayQty = isDozen ? qty * 12 : qty
                    const displayUnitType = isDozen ? 'piece' : item.unit_type
                    const displayPrice = isDozen ? price / 12 : price
                    const unitLabel = displayUnitType === 'piece' ? UNIT_LABELS.piece : UNIT_LABELS[item.unit_type] || item.unit_type
                    const lineTotal = qty * price
                    const isShortage = shortageProductIds?.has(item.product_id) === true
                    const statusCard = !isEdit ? businessStatusByItem?.[`${item.product_id}:${item.unit_type}`] : undefined
                    const tone = statusCard?.status ?? (isShortage ? 'red' : undefined)
                    const rowBg = tone === 'red' ? 'bg-red-50' : tone === 'yellow' ? 'bg-yellow-50' : tone === 'green' ? 'bg-green-50' : ''
                    const rowHover = tone ? '' : 'hover:bg-[#F9FAFB]'
                    return (
                      <Fragment key={item.id || idx}>
                        <tr className={`${rowHover} transition-colors ${rowBg}`}>
                          <td className="px-3 py-3 border-t border-t-[#F1F3F5] border-l border-l-[#EEF1F4]">
                            <span className="inline-block text-[12px] font-bold font-mono text-blue-700 bg-blue-100 border border-blue-300 px-2.5 py-1 rounded-full" dir="ltr">{item.legacy_code || '—'}</span>
                          </td>
                          <td className="px-3 py-3 border-t border-t-[#F1F3F5] border-l border-l-[#EEF1F4]">
                            <p className="font-semibold text-[#111827]">{item.product_name || 'غير متوفر'}</p>
                          </td>
                          <td className="px-3 py-3 text-center border-t border-t-[#F1F3F5] border-l border-l-[#EEF1F4]">
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
                              <span className={"inline-flex items-center justify-center rounded-full border px-3 py-1 " + (displayUnitType === 'carton' ? 'bg-[#FFFBEB] border-[#F5D58A]' : 'bg-[#EFF6FF] border-[#BFDBFE]')}>
                                <span className={"text-[12px] font-bold " + (displayUnitType === 'carton' ? 'text-[#A16207]' : 'text-[#1D4ED8]')}>{displayQty}</span>
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-center border-t border-t-[#F1F3F5] border-l border-l-[#EEF1F4]">
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
                              <span className={"inline-flex items-center justify-center rounded-full border px-3 py-1 " + (displayUnitType === 'carton' ? 'bg-[#FFFBEB] border-[#F5D58A]' : 'bg-[#EFF6FF] border-[#BFDBFE]')}>
                                <span className={"text-[12px] font-semibold " + (displayUnitType === 'carton' ? 'text-[#8A5A14]' : 'text-[#315A8A]')}>{unitLabel}</span>
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-left border-t border-t-[#F1F3F5] border-l border-l-[#EEF1F4]">
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
                              <span className="text-[13px] font-semibold text-[#334155]" dir="ltr">{formatValue(displayPrice)}</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-left text-[13px] font-bold text-[#111827] border-t border-t-[#F1F3F5] border-l border-l-[#EEF1F4]">{formatValue(lineTotal)}</td>
                          {isEdit && (
                            <td className="px-2 py-3 text-center border-t border-t-[#F1F3F5] border-l border-l-[#EEF1F4]">
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
            <p className="text-[21px] font-bold text-[#059669] mt-0.5">{formatValue(grandTotal)}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
