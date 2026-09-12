import { Fragment, useMemo, useState } from 'react'
import { formatNumber, toEnglishDigits } from '../../utils/numbers'
import { formatCurrencyShort } from '../../utils/format'
import { UNIT_LABELS } from '../../types/order-display'
import type { UnifiedOrderItem } from '../../types/unified-order'
import type { BusinessStatusCardData } from '../../utils/cart-availability'
import { mainLineCredit, type OrderFinancialPresentation, type BonusGroupResult } from '../../utils/order-benefit-presentation'

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
  discountFactor?: number
  presentation?: OrderFinancialPresentation
}

function BonusTable({ groups, creditPct, bonusStyle }: { groups: BonusGroupResult[]; creditPct: number | null; bonusStyle: boolean }) {
  const colCount = creditPct != null ? 7 : 6
  return (
    <table className="w-full text-[12px] border-separate border-spacing-0">
      <thead>
        <tr className="text-[#475569]">
          <th className="px-3 py-2.5 text-right font-bold text-[11px] uppercase tracking-wide border-b-2 border-[#D9E2EC] bg-[#F1F5F9]">كود الصنف</th>
          <th className="px-3 py-2.5 text-right font-bold text-[11px] uppercase tracking-wide border-b-2 border-[#D9E2EC] bg-[#F1F5F9]">اسم الصنف</th>
          <th className="px-3 py-2.5 text-center font-bold text-[11px] uppercase tracking-wide border-b-2 border-[#D9E2EC] bg-[#F1F5F9]">الكمية</th>
          <th className="px-3 py-2.5 text-center font-bold text-[11px] uppercase tracking-wide border-b-2 border-[#D9E2EC] bg-[#F1F5F9]">الوحدة</th>
          <th className="px-3 py-2.5 text-left font-bold text-[11px] uppercase tracking-wide border-b-2 border-[#D9E2EC] bg-[#F1F5F9]">سعر الوحدة الأساسي</th>
          <th className="px-3 py-2.5 text-left font-bold text-[11px] uppercase tracking-wide border-b-2 border-[#D9E2EC] bg-[#F1F5F9]">الإجمالي</th>
          {creditPct != null && <th className="px-3 py-2.5 text-left font-bold text-[11px] uppercase tracking-wide border-b-2 border-[#D9E2EC] bg-[#F1F5F9]">قيمة البونص</th>}
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <Fragment key={group.company}>
            <tr className={bonusStyle ? 'bg-[#FFFBEB]' : 'bg-[#F0FDF4]'}>
              <td colSpan={colCount} className="px-3 py-2 text-[15px] font-extrabold text-[#B45309] border-t border-l border-[#EEF1F4]" style={bonusStyle ? { borderTopColor: '#FDE68A', color: '#B45309' } : undefined}>
                <div className="flex items-center justify-between">
                  <span>شركة {group.company}&nbsp;&nbsp;-&nbsp;&nbsp;إجمالي الأصناف {formatNumber(group.items.length)}&nbsp;&nbsp;-&nbsp;&nbsp;إجمالي القطع {formatNumber(group.totalPieces)}&nbsp;&nbsp;-&nbsp;&nbsp;إجمالي المبلغ {formatValue(group.subtotal)}</span>
                </div>
              </td>
            </tr>
            {group.items.map((item, idx) => {
              const qty = Number(item.unit_quantity || 1)
              const base = Number(item.base_unit_price || item.unit_price || 0)
              const isDozen = item.unit_type === 'dozen'
              const displayQty = isDozen ? qty * 12 : qty
              const displayUnitType = isDozen ? 'piece' : item.unit_type
              const displayPrice = isDozen ? base / 12 : base
              const unitLabel = displayUnitType === 'piece' ? UNIT_LABELS.piece : UNIT_LABELS[item.unit_type] || item.unit_type
              const lineTotal = qty * base
              const credit = mainLineCredit(item, creditPct)
              return (
                <tr key={item.id || idx} className="hover:bg-[#F9FAFB] transition-colors">
                  <td className="px-3 py-3 border-t border-t-[#F1F3F5] border-l border-l-[#EEF1F4]">
                    <span className="inline-block text-[12px] font-bold font-mono text-blue-700 bg-blue-100 border border-blue-300 px-2.5 py-1 rounded-full" dir="ltr">{item.legacy_code || '—'}</span>
                  </td>
                  <td className="px-3 py-3 border-t border-t-[#F1F3F5] border-l border-l-[#EEF1F4]">
                    <p className="font-semibold text-[#111827]">{item.product_name || 'غير متوفر'}</p>
                  </td>
                  <td className="px-3 py-3 text-center border-t border-t-[#F1F3F5] border-l border-l-[#EEF1F4]">
                    <span className={"inline-flex items-center justify-center rounded-full border px-3 py-1 " + (displayUnitType === 'carton' ? 'bg-[#FFFBEB] border-[#F5D58A]' : 'bg-[#EFF6FF] border-[#BFDBFE]')}>
                      <span className={"text-[12px] font-bold " + (displayUnitType === 'carton' ? 'text-[#A16207]' : 'text-[#1D4ED8]')}>{displayQty}</span>
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center border-t border-t-[#F1F3F5] border-l border-l-[#EEF1F4]">
                    <span className={"inline-flex items-center justify-center rounded-full border px-3 py-1 " + (displayUnitType === 'carton' ? 'bg-[#FFFBEB] border-[#F5D58A]' : 'bg-[#EFF6FF] border-[#BFDBFE]')}>
                      <span className={"text-[12px] font-semibold " + (displayUnitType === 'carton' ? 'text-[#8A5A14]' : 'text-[#315A8A]')}>{unitLabel}</span>
                    </span>
                  </td>
                  <td className="px-3 py-3 text-left border-t border-t-[#F1F3F5] border-l border-l-[#EEF1F4]">
                    <span className="text-[13px] font-semibold text-[#334155]" dir="ltr">{formatValue(displayPrice)}</span>
                  </td>
                  <td className="px-3 py-3 text-left text-[13px] font-bold text-[#111827] border-t border-t-[#F1F3F5] border-l border-l-[#EEF1F4]">{formatValue(lineTotal)}</td>
                  {creditPct != null && (
                    <td className="px-3 py-3 text-left text-[13px] font-bold text-[#059669] border-t border-t-[#F1F3F5] border-l border-l-[#EEF1F4]">
                      {credit != null ? formatValue(credit) : '—'}
                    </td>
                  )}
                </tr>
              )
            })}
          </Fragment>
        ))}
      </tbody>
    </table>
  )
}

function SummaryAmount({ amount, symbol, tone }: { amount: number; symbol?: string; tone: 'default' | 'result' | 'credit' | 'final' }) {
  const cls = tone === 'final'
    ? 'text-[22px] font-extrabold text-[#059669]'
    : tone === 'credit'
      ? 'font-bold text-[#059669]'
      : tone === 'result'
        ? 'font-bold text-[#111827] text-[15px]'
        : 'font-semibold text-[#111827]'
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap shrink-0 ${cls}`} dir="ltr">
      {symbol && <span className="text-[11px] font-bold text-[#94A3B8]">{symbol}</span>}
      {formatCurrencyShort(amount)}
    </span>
  )
}

/**
 * FINAL CALCULATION SUMMARY — always rendered AFTER every product group
 * (MAIN company groups + Bonus products) and immediately before the final
 * order totals. Never attaches a percentage to the monetary credit.
 */
function CalculationSummary({ presentation, mode }: { presentation: OrderFinancialPresentation; mode: 'view' }) {
  if (presentation.mode === 'none') return null

  return (
    <div className="bg-[#F8FAFC] border-t border-[#E5E7EB] px-5 py-4">
      <p className="text-[12px] font-bold text-[#111827] mb-3">حساب قيمة الطلب النهائية</p>
      <div className="max-w-xl mx-auto space-y-2.5">
        {presentation.mode === 'bonus' ? (
          <>
            <div className="flex items-center justify-between text-[13px]">
              <span className="min-w-0 flex-1 pr-3 leading-snug text-[#6B7280]">إجمالي الطلب بالسعر الأساسي</span>
              <SummaryAmount amount={presentation.mainBaseTotal} symbol="+" tone="default" />
            </div>
            <div className="flex items-center justify-between text-[13px]">
              <span className="min-w-0 flex-1 pr-3 leading-snug text-[#6B7280]">إجمالي قيمة منتجات البونص</span>
              <SummaryAmount amount={presentation.bonusProductsTotal} symbol="+" tone="default" />
            </div>
            <div className="flex items-center justify-between border-t border-[#E5E7EB] pt-2.5">
              <span className="min-w-0 flex-1 pr-3 leading-snug text-[13px] font-bold text-[#111827]">المطلوب قبل حساب البونص</span>
              <SummaryAmount amount={presentation.beforeBonusTotal} tone="result" symbol="=" />
            </div>
            <div className="flex items-center justify-between text-[13px] pt-1">
              <span className="min-w-0 flex-1 pr-3 leading-snug text-[#6B7280]">إجمالي البونص المستحق</span>
              <SummaryAmount amount={presentation.bonusCredit} tone="credit" symbol="−" />
            </div>
            <div className="flex items-center justify-between border-t border-[#D1D5DB] pt-2.5">
              <span className="min-w-0 flex-1 pr-3 leading-snug text-[13px] font-bold text-[#111827]">المطلوب النهائي بعد خصم البونص</span>
              <SummaryAmount amount={presentation.finalTotal} tone="final" symbol="=" />
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between text-[13px]">
              <span className="min-w-0 flex-1 pr-3 leading-snug text-[#6B7280]">إجمالي الطلب بالسعر الأساسي</span>
              <SummaryAmount amount={presentation.directBaseTotal} symbol="+" tone="default" />
            </div>
            <div className="flex items-center justify-between text-[13px]">
              <span className="min-w-0 flex-1 pr-3 leading-snug text-[#6B7280]">إجمالي الخصم</span>
              <SummaryAmount amount={presentation.directDiscountAmount} tone="credit" symbol="−" />
            </div>
            <div className="flex items-center justify-between border-t border-[#D1D5DB] pt-2.5">
              <span className="min-w-0 flex-1 pr-3 leading-snug text-[13px] font-bold text-[#111827]">المطلوب النهائي بعد الخصم</span>
              <SummaryAmount amount={presentation.finalTotal} tone="final" symbol="=" />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * MOBILE-ONLY (below md) product presentation — view mode only.
 * Every monetary value is passed in PRECOMPUTED by the caller with the EXACT
 * same expressions as the desktop table rows. No financial logic lives here.
 */
function MobileGroupHeader({ company, itemsCount, piecesLabel, subtotalLabel, amber }: {
  company: string
  itemsCount: string
  piecesLabel: string
  subtotalLabel: string
  amber?: boolean
}) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${amber ? 'bg-[#FFFBEB] border-[#FDE68A]' : 'bg-[#F0FDF4] border-[#D1FAE5]'}`}>
      <p className={`text-[13px] font-extrabold leading-snug break-words ${amber ? 'text-[#B45309]' : 'text-[#2563EB]'}`}>
        شركة {company}
      </p>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[#475569]">
        <span>الأصناف: {itemsCount}</span>
        <span>القطع: {piecesLabel}</span>
        <span className="font-bold text-[#111827]">الإجمالي: {subtotalLabel}</span>
      </div>
    </div>
  )
}

function MobileProductCard({ name, code, company, displayQty, unitLabel, isCarton, origUnit, netUnit, origLine, netLine, credit, showCredit, toneBg, unitPriceLabel }: {
  name: string
  code: string
  company: string
  displayQty: number
  unitLabel: string
  isCarton: boolean
  origUnit: number | null
  netUnit: number
  origLine: number | null
  netLine: number
  credit?: number | null
  showCredit?: boolean
  toneBg?: string
  unitPriceLabel?: string
}) {
  return (
    <div className={`bg-white rounded-xl border border-[#E5E7EB] p-3 space-y-2 ${toneBg ?? ''}`}>
      <p className="text-[14px] font-bold text-[#111827] leading-snug break-words">{name}</p>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-block text-[11px] font-bold font-mono text-blue-700 bg-blue-100 border border-blue-300 px-2 py-0.5 rounded-full" dir="ltr">{code}</span>
        <span className="text-[11px] text-[#6B7280] break-words">الشركة: {company}</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-[#6B7280]">الكمية:</span>
        <span className={"inline-flex items-center justify-center rounded-full border px-3 py-1 " + (isCarton ? 'bg-[#FFFBEB] border-[#F5D58A]' : 'bg-[#EFF6FF] border-[#BFDBFE]')}>
          <span className={"text-[12px] font-bold " + (isCarton ? 'text-[#A16207]' : 'text-[#1D4ED8]')}>{displayQty}</span>
        </span>
        <span className={"inline-flex items-center justify-center rounded-full border px-3 py-1 " + (isCarton ? 'bg-[#FFFBEB] border-[#F5D58A]' : 'bg-[#EFF6FF] border-[#BFDBFE]')}>
          <span className={"text-[12px] font-semibold " + (isCarton ? 'text-[#8A5A14]' : 'text-[#315A8A]')}>{unitLabel}</span>
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-[#F1F3F5] pt-2">
        <span className="text-[11px] text-[#6B7280] shrink-0">{unitPriceLabel ?? 'سعر الوحدة:'}</span>
        <span className="text-[13px] font-bold text-[#111827] text-left leading-snug" dir="ltr">
          {origUnit != null && <s className="text-[#9CA3AF] font-medium ml-1">{formatValue(origUnit)}</s>}
          {formatValue(netUnit)} ج.م
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-[#6B7280] shrink-0">إجمالي الصنف:</span>
        <span className="text-[14px] font-extrabold text-[#111827] text-left leading-snug" dir="ltr">
          {origLine != null && <s className="text-[#9CA3AF] font-medium ml-1">{formatValue(origLine)}</s>}
          {formatValue(netLine)} ج.م
        </span>
      </div>
      {showCredit && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-[#6B7280] shrink-0">قيمة البونص:</span>
          <span className="text-[13px] font-bold text-[#059669]" dir="ltr">{credit != null ? `${formatValue(credit)} ج.م` : '—'}</span>
        </div>
      )}
    </div>
  )
}

function FinalTotalsCard({ itemCount, totalQty, totalPieces, finalDisplay }: { itemCount: number; totalQty: number; totalPieces: number; finalDisplay: string }) {
  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-5 mt-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <p className="text-[11px] text-[#9CA3AF] font-medium">عدد الأصناف</p>
          <p className="text-[13px] font-bold text-[#111827] mt-0.5">{formatNumber(itemCount)}</p>
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
          <p className="text-[21px] font-bold text-[#059669] mt-0.5">{finalDisplay}</p>
        </div>
      </div>
    </div>
  )
}

export function OrderProductsSection({ items, mode = 'view', onQuantityChange, onRemoveItem, onPriceChange, onUnitChange, unitOptions, onDeleteSelected, onAddProduct, shortageProductIds, businessStatusByItem, discountFactor, presentation }: OrderProductsSectionProps) {
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
  const isBonusView = presentation?.mode === 'bonus' && !isEdit
  const netFactor = !isEdit && !isBonusView && discountFactor && discountFactor > 0 && discountFactor < 1 ? discountFactor : 1
  const net = (amount: number) => Math.round(amount * netFactor * 100) / 100

  const sortedMainGroups = presentation && presentation.mode === 'bonus' ? presentation.mainGroups.map(g => ({
    ...g,
    items: [...g.items].sort((a, b) => compareArabic(a.product_name || '', b.product_name || '')),
  })).sort((a, b) => compareArabic(a.company, b.company)) : []

  const showPersistedTotal = !isEdit && presentation && presentation.mode !== 'none'
  const totalsFinal = showPersistedTotal
    ? formatCurrencyShort(presentation.finalTotal)
    : formatValue(net(grandTotal))

  if (isBonusView && presentation) {
    const p = presentation
    const mainCount = p.mainGroups.reduce((s, g) => s + g.items.length, 0)
    const bonusCount = p.bonusGroup ? p.bonusGroup.items.length : 0
    return (
      <div>
        <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-[#E5E7EB] bg-[#F9FAFB] flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[14px] font-bold text-[#111827]">المنتجات</h3>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[11px] text-[#6B7280]">{mainCount} صنف رئيسي{p.bonusGroup ? ` • ${bonusCount} صنف بونص` : ''}</span>
            </div>
          </div>

          <div className="overflow-x-auto hidden md:block">
            <BonusTable groups={sortedMainGroups} creditPct={p.perLineCreditPct} bonusStyle={false} />
          </div>
          {/* Mobile cards (below md) — same groups, same values, no table */}
          <div className="md:hidden px-3 py-3 space-y-3">
            {sortedMainGroups.map((group) => (
              <div key={group.company} className="space-y-2">
                <MobileGroupHeader
                  company={group.company}
                  itemsCount={formatNumber(group.items.length)}
                  piecesLabel={formatNumber(group.totalPieces)}
                  subtotalLabel={formatValue(group.subtotal)}
                />
                {group.items.map((item, idx) => {
                  const qty = Number(item.unit_quantity || 1)
                  const base = Number(item.base_unit_price || item.unit_price || 0)
                  const isDozen = item.unit_type === 'dozen'
                  const displayQty = isDozen ? qty * 12 : qty
                  const displayUnitType = isDozen ? 'piece' : item.unit_type
                  const displayPrice = isDozen ? base / 12 : base
                  const unitLabel = displayUnitType === 'piece' ? UNIT_LABELS.piece : UNIT_LABELS[item.unit_type] || item.unit_type
                  const lineTotal = qty * base
                  const credit = mainLineCredit(item, p.perLineCreditPct)
                  return (
                    <MobileProductCard
                      key={item.id || idx}
                      name={item.product_name || 'غير متوفر'}
                      code={item.legacy_code || '—'}
                      company={item.company_name || group.company}
                      displayQty={displayQty}
                      unitLabel={unitLabel}
                      isCarton={displayUnitType === 'carton'}
                      origUnit={null}
                      netUnit={displayPrice}
                      origLine={null}
                      netLine={lineTotal}
                      credit={credit}
                      showCredit={p.perLineCreditPct != null}
                      unitPriceLabel="سعر الوحدة الأساسي:"
                    />
                  )
                })}
              </div>
            ))}
          </div>

          {p.bonusGroup && (
            <>
              <div className="overflow-x-auto hidden md:block">
                <BonusTable groups={[p.bonusGroup]} creditPct={null} bonusStyle={true} />
              </div>
              <div className="md:hidden px-3 py-3 space-y-2">
                <MobileGroupHeader
                  company={p.bonusGroup.company}
                  itemsCount={formatNumber(p.bonusGroup.items.length)}
                  piecesLabel={formatNumber(p.bonusGroup.totalPieces)}
                  subtotalLabel={formatValue(p.bonusGroup.subtotal)}
                  amber
                />
                {p.bonusGroup.items.map((item, idx) => {
                  const qty = Number(item.unit_quantity || 1)
                  const base = Number(item.base_unit_price || item.unit_price || 0)
                  const isDozen = item.unit_type === 'dozen'
                  const displayQty = isDozen ? qty * 12 : qty
                  const displayUnitType = isDozen ? 'piece' : item.unit_type
                  const displayPrice = isDozen ? base / 12 : base
                  const unitLabel = displayUnitType === 'piece' ? UNIT_LABELS.piece : UNIT_LABELS[item.unit_type] || item.unit_type
                  const lineTotal = qty * base
                  return (
                    <MobileProductCard
                      key={item.id || idx}
                      name={item.product_name || 'غير متوفر'}
                      code={item.legacy_code || '—'}
                      company={item.company_name || p.bonusGroup!.company}
                      displayQty={displayQty}
                      unitLabel={unitLabel}
                      isCarton={displayUnitType === 'carton'}
                      origUnit={null}
                      netUnit={displayPrice}
                      origLine={null}
                      netLine={lineTotal}
                      unitPriceLabel="سعر الوحدة الأساسي:"
                    />
                  )
                })}
              </div>
            </>
          )}

          <CalculationSummary presentation={p} mode="view" />
        </div>

        <FinalTotalsCard itemCount={mainCount + bonusCount} totalQty={totalQty} totalPieces={totalPieces} finalDisplay={totalsFinal} />
      </div>
    )
  }

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
        <div className={isEdit ? 'overflow-x-auto' : 'overflow-x-auto hidden md:block'}>
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
                        <span>شركة {group.company}&nbsp;&nbsp;-&nbsp;&nbsp;إجمالي الأصناف {formatNumber(group.items.length)}&nbsp;&nbsp;-&nbsp;&nbsp;إجمالي القطع {formatNumber(group.totalPieces)}&nbsp;&nbsp;-&nbsp;&nbsp;إجمالي المبلغ {formatValue(net(group.subtotal))}</span>
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
                              <span className="text-[13px] font-semibold text-[#334155]" dir="ltr">{formatValue(net(displayPrice))}</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-left text-[13px] font-bold text-[#111827] border-t border-t-[#F1F3F5] border-l border-l-[#EEF1F4]">{formatValue(net(lineTotal))}</td>
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
        {/* Mobile cards (below md, view mode only) — same groups, same values, no table */}
        {!isEdit && (
          <div className="md:hidden px-3 py-3 space-y-3">
            {groups.map((group) => (
              <div key={group.company} className="space-y-2">
                <MobileGroupHeader
                  company={group.company}
                  itemsCount={formatNumber(group.items.length)}
                  piecesLabel={formatNumber(group.totalPieces)}
                  subtotalLabel={formatValue(net(group.subtotal))}
                />
                {group.items.map((item, idx) => {
                  const qty = Number(item.unit_quantity || 1)
                  const price = Number(item.unit_price || 0)
                  const base = Number(item.base_unit_price || 0)
                  const discounted = base > 0 && Math.abs(base - price) > 0.009
                  const isDozen = item.unit_type === 'dozen'
                  const displayQty = isDozen ? qty * 12 : qty
                  const displayUnitType = isDozen ? 'piece' : item.unit_type
                  const displayPrice = isDozen ? price / 12 : price
                  const unitLabel = displayUnitType === 'piece' ? UNIT_LABELS.piece : UNIT_LABELS[item.unit_type] || item.unit_type
                  const lineTotal = qty * price
                  const isShortage = shortageProductIds?.has(item.product_id) === true
                  const statusCard = businessStatusByItem?.[`${item.product_id}:${item.unit_type}`]
                  const tone = statusCard?.status ?? (isShortage ? 'red' : undefined)
                  const toneBg = tone === 'red' ? 'bg-red-50' : tone === 'yellow' ? 'bg-yellow-50' : tone === 'green' ? 'bg-green-50' : ''
                  return (
                    <MobileProductCard
                      key={item.id || idx}
                      name={item.product_name || 'غير متوفر'}
                      code={item.legacy_code || '—'}
                      company={item.company_name || group.company}
                      displayQty={displayQty}
                      unitLabel={unitLabel}
                      isCarton={displayUnitType === 'carton'}
                      origUnit={discounted ? (isDozen ? base / 12 : base) : null}
                      netUnit={net(displayPrice)}
                      origLine={discounted ? qty * base : null}
                      netLine={net(lineTotal)}
                      toneBg={toneBg}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        )}
        {!isEdit && presentation && presentation.mode === 'direct' && (
          <CalculationSummary presentation={presentation} mode="view" />
        )}
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
      <FinalTotalsCard itemCount={items.length} totalQty={totalQty} totalPieces={totalPieces} finalDisplay={totalsFinal} />
    </div>
  )
}