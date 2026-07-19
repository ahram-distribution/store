import { type ResultsSummaryProps } from '../../types/data-list'
import { formatCurrencyWhole } from '../../utils/format'

export function ResultsSummary({
  total,
  totalValue,
  filters,
  onRefresh,
  refreshState,
  dateFrom,
  dateTo,
  lastRefresh,
  executionTimeMs,
  serverSource,
  title,
  unit,
  valueLabel,
  onReset,
  resetLabel,
}: ResultsSummaryProps) {
  const dateRangeActive = dateFrom || dateTo
  const hasValue = totalValue != null && totalValue > 0

  return (
    <div className="bg-white rounded-xl border border-border p-3.5 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          {title ? (
            <>
              <p className="text-xs text-text-secondary font-medium">{title}</p>
              <p className="text-lg font-bold text-text mt-0.5">
                {total.toLocaleString('ar-EG')}{unit ? ' ' + unit : ''}
              </p>
              {hasValue && (
                <p className="text-sm font-semibold text-text mt-0.5">
                  {valueLabel || 'إجمالي القيمة'}: <span className="font-bold text-primary">{formatCurrencyWhole(totalValue!)}</span>
                </p>
              )}
            </>
          ) : (
            <p className="text-sm font-bold text-text">
              عدد النتائج: {total.toLocaleString('ar-EG')}
            </p>
          )}
          {dateRangeActive && (
            <p className="text-[11px] text-text-secondary mt-0.5">
              {dateFrom && <span>من {dateFrom}</span>}
              {dateFrom && dateTo && <span> </span>}
              {dateTo && <span>إلى {dateTo}</span>}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onReset && (
            <button
              onClick={onReset}
              className="text-[11px] px-2.5 py-1.5 rounded-lg border border-danger/30 text-danger bg-danger/5 font-semibold active:bg-danger/10 transition-colors"
            >
              {resetLabel || 'إعادة تعيين الفلاتر لعرض الكل'}
            </button>
          )}
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={refreshState === 'loading'}
              className="bg-primary text-white rounded-lg px-3 py-2 text-xs font-semibold shadow-sm active:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-1.5"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {refreshState === 'loading' ? 'جاري التحديث...' : 'تحديث'}
            </button>
          )}
        </div>
      </div>

      {filters.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <span
              key={f.id}
              className="inline-flex items-center gap-1 bg-surface border border-border/50 rounded-lg px-2 py-1 text-[10px] text-text-secondary font-medium"
            >
              {f.label}: {f.value}
            </span>
          ))}
        </div>
      )}

      {(lastRefresh || executionTimeMs != null || serverSource) && (
        <div className="flex items-center gap-3 text-[10px] text-text-muted">
          {lastRefresh && <span>آخر تحديث: {lastRefresh}</span>}
          {executionTimeMs != null && <span>الاستجابة: {executionTimeMs}ms</span>}
          {serverSource && <span>المصدر: {serverSource}</span>}
        </div>
      )}
    </div>
  )
}
