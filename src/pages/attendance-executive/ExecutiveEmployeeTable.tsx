import { useMemo, useState } from 'react'
import type { ExecEmployeeRow } from '../../types/executiveFollowup'
import {
  CONNECTION_COLORS, CONNECTION_LABELS, STATUS_COLORS, STATUS_LABELS,
  fmtDateTime, fmtMinutes, fmtMoney, fmtNum,
} from './executiveFormat'

interface ColumnDef {
  key: string
  label: string
  optional?: boolean
  render: (e: ExecEmployeeRow) => React.ReactNode
  className?: string
}

const BASE_COLUMNS: ColumnDef[] = [
  {
    key: 'name', label: 'الموظف',
    render: (e) => (
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-primary-dark text-white flex items-center justify-center text-xs font-bold shrink-0">
          {e.name.trim().charAt(0) || '؟'}
        </div>
        <div className="min-w-0">
          <div className="text-xs font-bold text-text truncate flex items-center gap-1">
            {e.name}
            {!e.is_active && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">غير نشط</span>}
          </div>
          <div className="text-[10px] text-text-secondary truncate">{e.code || ''}{e.role_name ? ` — ${e.role_name}` : ''}</div>
        </div>
      </div>
    ),
  },
  {
    key: 'status', label: 'الحالة',
    className: 'text-xs',
    render: (e) => {
      const st = e.live?.status
      return (
        <span className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] font-bold ${STATUS_COLORS[st || ''] || STATUS_COLORS.no_start}`}>
          {STATUS_LABELS[st || ''] || '—'}
        </span>
      )
    },
  },
  {
    key: 'connection', label: 'الاتصال',
    render: (e) => (
      <span className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] font-bold ${CONNECTION_COLORS[e.connection_status] || CONNECTION_COLORS.no_data}`}>
        {CONNECTION_LABELS[e.connection_status] || e.connection_status || '—'}
      </span>
    ),
  },
  {
    key: 'attendance_window', label: 'بداية ونهاية العمل',
    render: (e) => (
      <div className="min-w-[118px]">
        <div className="text-[10px] font-bold text-text">{e.live?.start_time ? `بدأ ${fmtDateTime(e.live.start_time)}` : e.first_activity_at ? `أول نشاط ${fmtDateTime(e.first_activity_at)}` : 'لم يبدأ'}</div>
        <div className="text-[10px] text-text-secondary mt-0.5">{e.live?.end_time ? `انتهى ${fmtDateTime(e.live.end_time)}` : e.live?.start_time ? `حتى الآن: ${fmtMinutes(e.live.net_minutes)}` : '—'}</div>
      </div>
    ),
  },
  {
    key: 'current_location', label: 'آخر موقع معروف',
    render: (e) => (
      <div className="min-w-[115px] text-[10px]">
        {e.live?.last_location?.has_location ? (
          <>
            <div className="font-bold text-blue-700">موقع مسجل</div>
            <div className="text-text-secondary">{e.live.last_location.at ? fmtDateTime(e.live.last_location.at) : 'وقت غير متاح'}</div>
          </>
        ) : <span className="text-text-secondary">لا يوجد موقع مسجل</span>}
      </div>
    ),
  },
  {
    key: 'policy', label: 'النطاق ونظام العمل',
    render: (e) => {
      const p = e.policy
      const fixed = p?.schedule_type !== 'flexible'
      const shown = p?.show_in_screen !== false
      return (
        <div className="flex flex-col gap-1 min-w-[150px]">
          <div className="flex items-center gap-1 flex-wrap">
            <span className={`inline-flex px-1.5 py-0.5 rounded-full border text-[10px] font-bold ${shown ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
              {shown ? 'مشمول' : 'غير مشمول'}
            </span>
            <span className={`inline-flex px-1.5 py-0.5 rounded-full border text-[10px] font-bold ${fixed ? 'bg-violet-50 text-violet-700 border-violet-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
              {fixed ? 'مكتبي' : 'ميداني'}
            </span>
            <span className={`inline-flex px-1.5 py-0.5 rounded-full border text-[10px] font-bold ${p?.source === 'employee_override' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-gray-50 text-gray-600 border-gray-200'}`}>
              {p?.source === 'employee_override' ? 'تجاوز فردي' : p?.source === 'role_default' ? 'افتراضي الدور' : 'النظام الافتراضي'}
            </span>
          </div>
          <div className="text-[9px] text-text-secondary">
            {p?.official_start_time || '10:00'} ← {p?.official_end_time || '20:00'} · حضور {p?.attendance_enabled ? '✓' : '✗'} · موقع {p?.follow_up_enabled ? '✓' : '✗'}
          </div>
          {!shown && <div className="text-[9px] text-red-500">مستثنى من الفهرسة ونظام التحكم</div>}
          {fixed === false && shown && <div className="text-[9px] text-amber-600">بدون حساب تأخير/انصراف مبكر (ميداني)</div>}
        </div>
      )
    },
  },
  {
    key: 'worked_days', label: 'أيام عمل', className: 'text-left font-mono text-xs',
    render: (e) => fmtNum(e.period.worked_days),
  },
  {
    key: 'present', label: 'حضور', className: 'text-left font-mono text-xs',
    render: (e) => fmtMinutes(e.period.present_minutes),
  },
  {
    key: 'late', label: 'دقائق تأخير', className: 'text-left font-mono text-xs text-amber-600',
    render: (e) => e.period.late_minutes_total ? fmtNum(e.period.late_minutes_total) : <span className="text-gray-300">0</span>,
  },
  {
    key: 'orders', label: 'طلبات', className: 'text-left font-mono text-xs',
    render: (e) => fmtNum(e.period.orders),
  },
  {
    key: 'sales', label: 'صافي مبيعات', className: 'text-left font-mono text-xs text-blue-700',
    render: (e) => e.period.sales ? fmtMoney(e.period.sales) : <span className="text-gray-300">0</span>,
  },
  {
    key: 'visits', label: 'زيارات', className: 'text-left font-mono text-xs',
    render: (e) => fmtNum(e.period.visits),
  },
  {
    key: 'collections', label: 'تحصيلات (قيمة)', className: 'text-left font-mono text-xs',
    render: (e) => e.period.collection_amount ? fmtMoney(e.period.collection_amount) : <span className="text-gray-300">0</span>,
  },
]

const OPTIONAL_COLUMNS: ColumnDef[] = [
  {
    key: 'auto_closed', label: 'إغلاق تلقائي', className: 'text-left font-mono text-xs text-red-600',
    render: (e) => fmtNum(e.period.auto_closed_days),
  },
  {
    key: 'new_customers', label: 'عملاء جدد', className: 'text-left font-mono text-xs',
    render: (e) => fmtNum(e.period.new_customers),
  },
  {
    key: 'distance', label: 'المسافة كم', className: 'text-left font-mono text-xs',
    render: (e) => e.period.distance_meters ? fmtNum(e.period.distance_meters / 1000) : '—',
  },
  {
    key: 'last_activity', label: 'آخر نشاط',
    render: (e) => (
      <div className="text-[10px] text-text-secondary">{e.last_activity_at ? fmtDateTime(e.last_activity_at) : '—'}</div>
    ),
  },
]

const DEFAULT_HIDDEN = new Set(['auto_closed', 'distance'])

export function ExecutiveEmployeeTable({
  employees, total, loading, page, pageSize, sort, onSort, onPage, onPageSize, onRowClick,
}: {
  employees: ExecEmployeeRow[]
  total: number
  loading: boolean
  page: number
  pageSize: number
  sort: string
  onSort: (s: string) => void
  onPage: (p: number) => void
  onPageSize: (s: number) => void
  onRowClick: (e: ExecEmployeeRow) => void
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set(DEFAULT_HIDDEN))
  const [showCols, setShowCols] = useState(false)

  const columns = useMemo(() => [...BASE_COLUMNS, ...OPTIONAL_COLUMNS.filter((c) => !hidden.has(c.key))], [hidden])
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const pageNumbers = useMemo(() => {
    const out: number[] = []
    for (let i = 0; i < pages; i++) out.push(i)
    return out
  }, [pages])

  const toggleCol = (key: string) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <div className="text-xs font-bold text-text">القوى العاملة الخاضعة للحضور والمتابعة ({fmtNum(total)})</div>
        <div className="relative">
          <button
            onClick={() => setShowCols((v) => !v)}
            className="text-[10px] font-bold text-text-secondary hover:text-primary px-2 py-1 rounded-lg hover:bg-surface"
          >
            الأعمدة ▾
          </button>
          {showCols && (
            <div className="absolute z-20 left-0 top-7 bg-white border border-border rounded-xl shadow-xl p-3 w-48 grid grid-cols-1 gap-1" dir="rtl">
              {OPTIONAL_COLUMNS.map((c) => (
                <label key={c.key} className="flex items-center gap-2 text-[11px] text-text cursor-pointer px-1 py-0.5 rounded-md hover:bg-surface">
                  <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => toggleCol(c.key)} className="accent-blue-600" />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50">
              {columns.map((c) => (
                <th key={c.key} className="px-3 py-2 text-right text-[10px] font-bold text-text-secondary whitespace-nowrap border-b border-border select-none">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && !employees.length ? (
              <tr><td colSpan={columns.length} className="p-10 text-center text-sm text-text-secondary">جاري تحميل الموظفين...</td></tr>
            ) : employees.length === 0 ? (
              <tr><td colSpan={columns.length} className="p-10 text-center text-sm text-text-secondary">لا توجد قوى عاملة مطابقة للفلاتر.</td></tr>
            ) : (
              employees.map((e) => (
                <tr key={e.employee_id} onClick={() => onRowClick(e)} className="border-b border-border hover:bg-blue-50/40 cursor-pointer transition-colors">
                  {columns.map((c) => (
                    <td key={c.key} className={`px-3 py-2 ${c.className || ''}`}>{c.render(e)}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-gray-50/70">
        <div className="flex items-center gap-2">
          <select
            value={String(pageSize)}
            onChange={(ev) => { onPageSize(Number(ev.target.value)); onPage(0) }}
            className="text-[10px] rounded-lg border border-border bg-white px-1.5 py-1"
          >
            {[25, 50, 100].map((s) => <option key={s} value={String(s)}>{s} / صفحة</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <button disabled={page === 0} onClick={() => onPage(page - 1)} className="w-7 h-7 rounded-lg border border-border text-xs font-bold disabled:opacity-30">›</button>
          {pageNumbers.length > 7
            ? (
              <>
                {[0].map((p) => <NumBtn key={p} p={p} cur={page} goto={onPage} />)}
                <span className="text-[10px] text-text-secondary">…</span>
                {page > 2 && page < pages - 3 ? <NumBtn key={page} p={page} cur={page} goto={onPage} /> : null}
                {page > 2 && page < pages - 3 ? <span className="text-[10px] text-text-secondary">…</span> : null}
                {[pages - 1].map((p) => <NumBtn key={p} p={p} cur={page} goto={onPage} />)}
              </>
            )
            : pageNumbers.map((p) => <NumBtn key={p} p={p} cur={page} goto={onPage} />)}
          <button disabled={page >= pages - 1} onClick={() => onPage(page + 1)} className="w-7 h-7 rounded-lg border border-border text-xs font-bold disabled:opacity-30">‹</button>
        </div>
      </div>
      <div className="px-4 pb-2 -mt-1 text-[9px] text-text-secondary">ترتيب: {sort === 'connection' ? 'حالة الاتصال' : sort === 'sales' ? 'صافي المبيعات' : sort === 'present' ? 'دقائق الحضور' : sort === 'days' ? 'أيام العمل' : 'الاسم'}</div>
    </div>
  )
}

function NumBtn({ p, cur, goto }: { p: number; cur: number; goto: (p: number) => void }) {
  return (
    <button
      onClick={() => goto(p)}
      className={`w-7 h-7 rounded-lg text-[11px] font-bold ${p === cur ? 'bg-primary text-white' : 'border border-border text-text-secondary'}`}
    >{p + 1}</button>
  )
}
