import { formatCurrencyShort } from '../../utils/format'

interface TierMinimumNoticeProps {
  remainingForMinimum: number
  tierMinimum: number
  tierName: string
}

export function TierMinimumNotice({ remainingForMinimum, tierMinimum, tierName }: TierMinimumNoticeProps) {
  if (remainingForMinimum <= 0) return null

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <span className="text-amber-500 text-lg shrink-0 mt-0.5">!</span>
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-amber-800">لم يتم الوصول إلى الحد الأدنى للشريحة</h4>

          <div className="text-xs text-amber-700 space-y-1">
            <p>
              الحد الأدنى لشريحة <strong>{tierName}</strong> هو{' '}
              <strong>{formatCurrencyShort(tierMinimum)}</strong>
            </p>
            <p>
              المبلغ المتبقي للوصول للحد الأدنى:{' '}
              <strong className="text-amber-900">{formatCurrencyShort(remainingForMinimum)}</strong>
            </p>
          </div>

          <div className="text-xs text-amber-700 space-y-1 mt-2">
            <p className="font-semibold">الإجراء المطلوب:</p>
            <ul className="list-disc pr-4 space-y-1">
              <li>أضف منتجات إلى الطلب بقيمة {formatCurrencyShort(remainingForMinimum)} على الأقل</li>
              <li>أو اختر شريحة سعرية أخرى ذات حد أدنى أقل</li>
              <li>أو استخدم السعر الأساسي بدون شريحة</li>
            </ul>
          </div>

          <div className="flex gap-2 mt-2">
            <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded">تصفح المنتجات</span>
            <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded">تغيير الشريحة</span>
          </div>
        </div>
      </div>
    </div>
  )
}
