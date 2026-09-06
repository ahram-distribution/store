import { formatArabicAmountWithCurrency, formatCurrencyShort, formatTierName } from '../../utils/format'

interface TierMinimumNoticeProps {
  remainingForMinimum: number
  tierMinimum: number
  tierName: string
  currentAmount: number
  met: boolean
  discountPercent: number
}

export function TierMinimumNotice({
  remainingForMinimum,
  tierMinimum,
  tierName,
  currentAmount,
  met,
  discountPercent,
}: TierMinimumNoticeProps) {
  if (!met && remainingForMinimum <= 0) return null

  if (met) {
    return (
      <div className="rounded-xl border border-success/30 bg-success/10 px-3 py-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-6 h-6 rounded-full bg-success text-white flex items-center justify-center shrink-0 text-xs font-bold">✓</span>
          <div className="min-w-0">
            <div className="text-sm font-bold text-success">تم تحقيق الشريحة</div>
            <div className="text-[11px] text-text-secondary">
              أنت مؤهل لخصم {discountPercent % 1 === 0 ? discountPercent : Number(discountPercent.toFixed(1))}%
            </div>
          </div>
        </div>
        <div className="text-[11px] text-text-secondary text-left shrink-0">
          الشريحة: <span className="font-semibold text-text">{formatTierName(tierName)}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-warning/40 bg-amber-50 p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-5 h-5 rounded-full bg-warning text-white flex items-center justify-center text-[11px] font-bold shrink-0">!</span>
        <h4 className="text-sm font-bold text-amber-800">لم يتم الوصول إلى الحد الأدنى للشريحة</h4>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-white/60 px-2 py-1.5 text-center">
          <div className="text-[10px] text-amber-700">الحد الأدنى</div>
          <div className="text-xs font-semibold text-amber-900">{formatArabicAmountWithCurrency(tierMinimum)}</div>
        </div>
        <div className="rounded-lg bg-white/60 px-2 py-1.5 text-center">
          <div className="text-[10px] text-amber-700">قيمة الطلب الحالية</div>
          <div className="text-xs font-semibold text-amber-900">{formatArabicAmountWithCurrency(currentAmount)}</div>
        </div>
        <div className="rounded-lg bg-amber-200/70 px-2 py-1.5 text-center ring-1 ring-amber-300">
          <div className="text-[10px] font-semibold text-amber-800">المتبقي</div>
          <div className="text-sm font-extrabold text-amber-900">{formatArabicAmountWithCurrency(remainingForMinimum)}</div>
        </div>
      </div>

      <div className="text-[11px] text-amber-700 mt-2">
        الشريحة <span className="font-semibold">{formatTierName(tierName)}</span> تتطلب حداً أدنى من المشتريات ({formatCurrencyShort(tierMinimum)})
      </div>
    </div>
  )
}