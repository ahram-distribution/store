import { computeDateRange } from '../../lib/dateRange'
import { normalizeArabic } from '../../utils/smartSearch'

export interface CreditFilters {
  datePreset: string
  dateFrom: string
  dateTo: string
  status: string
  search: string
}

export const DEFAULT_CREDIT_FILTERS: CreditFilters = {
  datePreset: 'all',
  dateFrom: '',
  dateTo: '',
  status: '',
  search: '',
}

const DATE_PRESETS = [
  { key: 'all', label: 'كل الفترات' },
  { key: 'today', label: 'اليوم' },
  { key: 'yesterday', label: 'الأمس' },
  { key: 'week', label: 'هذا الأسبوع' },
  { key: 'month', label: 'هذا الشهر' },
  { key: 'prev_month', label: 'الشهر السابق' },
  { key: 'custom', label: 'فترة' },
]

const STATUS_OPTIONS = [
  { value: '', label: 'كل الحالات' },
  { value: 'uncollected', label: 'غير محصلة' },
  { value: 'partially_collected', label: 'محصلة جزئياً' },
  { value: 'fully_collected', label: 'محصلة بالكامل' },
]

interface CreditFilterBarProps {
  filters: CreditFilters
  onChange: (filters: CreditFilters) => void
  searchPlaceholder?: string
  showOverdue?: boolean
}

export function CreditFilterBar({ filters, onChange, searchPlaceholder, showOverdue }: CreditFilterBarProps) {
  const statusOptions = showOverdue
    ? [...STATUS_OPTIONS, { value: 'overdue', label: 'متأخرة' }]
    : STATUS_OPTIONS

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {DATE_PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => onChange({ ...filters, datePreset: p.key, dateFrom: '', dateTo: '' })}
            className={`shrink-0 text-[10px] px-2.5 py-1 rounded-lg font-semibold transition-colors ${
              filters.datePreset === p.key ? 'bg-primary text-white' : 'bg-surface text-text-secondary border border-border/50'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {filters.datePreset === 'custom' && (
        <div className="flex gap-2">
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => onChange({ ...filters, dateFrom: e.target.value })}
            className="flex-1 text-xs px-2 py-1.5 rounded-lg border border-border bg-surface focus:outline-none focus:border-primary"
          />
          <span className="text-xs text-text-secondary self-center">إلى</span>
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => onChange({ ...filters, dateTo: e.target.value })}
            className="flex-1 text-xs px-2 py-1.5 rounded-lg border border-border bg-surface focus:outline-none focus:border-primary"
          />
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          placeholder={searchPlaceholder || 'بحث...'}
          className="flex-1 text-xs px-3 py-2 rounded-lg border border-border bg-surface focus:outline-none focus:border-primary transition-colors"
        />
        <select
          value={filters.status}
          onChange={(e) => onChange({ ...filters, status: e.target.value })}
          className="w-[150px] shrink-0 border border-border rounded-lg px-2 py-2 text-xs bg-white focus:outline-none focus:border-primary"
        >
          {statusOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    </div>
  )
}

export interface CreditSearchableInvoice {
  order_number: string
  reference_number?: string | null
  customer_name: string
  phone?: string | null
  check_number?: string | null
  check_holder?: string | null
  credit_status: string
  overdue?: boolean
  delivered_at?: string | null
}

function resolveDateRange(f: CreditFilters): { from: string; to: string } | null {
  if (f.datePreset === 'all') return null
  if (f.datePreset === 'custom') {
    if (!f.dateFrom || !f.dateTo) return null
    const r = computeDateRange('custom', f.dateFrom, f.dateTo)
    return { from: r.dateFrom, to: r.dateTo }
  }
  const r = computeDateRange(f.datePreset as Parameters<typeof computeDateRange>[0])
  return { from: r.dateFrom, to: r.dateTo }
}

export function applyCreditFilters<T extends CreditSearchableInvoice>(list: T[], f: CreditFilters): T[] {
  const range = resolveDateRange(f)
  const q = f.search.trim() ? normalizeArabic(f.search.trim()) : ''

  return list.filter((inv) => {
    if (f.status) {
      if (f.status === 'overdue') {
        if (!inv.overdue) return false
      } else if ((inv.credit_status || '') !== f.status) {
        return false
      }
    }

    if (range) {
      const d = inv.delivered_at
      if (!d) return false
      if (d < range.from || d > range.to) return false
    }

    if (q) {
      const hay = normalizeArabic(
        [inv.order_number, inv.reference_number, inv.customer_name, inv.phone, inv.check_number, inv.check_holder]
          .map((v) => (v == null ? '' : String(v)))
          .join(' ')
      )
      if (!hay.includes(q)) return false
    }

    return true
  })
}
