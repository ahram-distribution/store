import { type ResultsSummaryProps } from '../../types/data-list'

export function ResultsSummary({
  total,
  filters,
  onRefresh,
  refreshState,
  dateFrom,
  dateTo,
  lastRefresh,
  executionTimeMs,
  serverSource,
}: ResultsSummaryProps) {
  const dateRangeActive = dateFrom || dateTo

  return (
    <div className="bg-white rounded-xl border border-border p-3.5 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-text">
            عدد النتائج: {total.toLocaleString('ar-EG')}
          </p>
          {dateRangeActive && (
            <p className="text-[11px] text-text-secondary mt-0.5">
              {dateFrom && <span>من {dateFrom}</span>}
              {dateFrom && dateTo && <span> </span>}
              {dateTo && <span>إلى {dateTo}</span>}
            </p>
          )}
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={refreshState === 'loading'}
            className="border border-border rounded-lg px-2.5 py-1.5 text-xs text-text-secondary font-medium hover:bg-surface active:bg-surface/70 transition-colors disabled:opacity-50"
          >
            {refreshState === 'loading' ? 'جاري التحديث...' : 'تحديث'}
          </button>
        )}
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
