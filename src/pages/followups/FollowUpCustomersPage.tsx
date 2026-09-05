import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { followUpWorkspaceService, type FollowUpCustomerRow, type SmartReason, fetchSmartReasonsBatched, SMART_KIND_LABELS } from '../../services/followUpWorkspaceService'
import { TimeRangeSelector, type FollowUpTimeRange } from '../../components/followups/TimeRangeSelector'
import { formatCurrencyShort } from '../../utils/format'

const STATUS_FILTERS: Array<{ key: string; label: string }> = [
  { key: 'all', label: 'الكل' },
  { key: 'due_today', label: 'مستحقة اليوم' },
  { key: 'overdue', label: 'متأخرة' },
  { key: 'upcoming', label: 'قادمة' },
  { key: 'no_follow_up', label: 'بدون متابعة' },
  { key: 'declining', label: 'متراجعون' },
  { key: 'stopped', label: 'متوقفون' },
  { key: 'no_contact_30d', label: 'بدون تواصل 30+ يوم' },
  { key: 'new_30d', label: 'عملاء جدد' },
]

function fmt(days: number | null | undefined, what: string): string {
  if (days === null || days === undefined) return ''
  return days === 0 ? `${what} اليوم` : `منذ ${days} يوم`
}

export function FollowUpCustomersPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialStatus = searchParams.get('status') || 'all'

  const [rows, setRows] = useState<FollowUpCustomerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [rangeUnavailable, setRangeUnavailable] = useState(false)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState(initialStatus)
  const [assigneeId, setAssigneeId] = useState<string>('')
  const [range, setRange] = useState<FollowUpTimeRange>({ preset: 'since_creation', label: 'منذ إنشاء العميل', from: null, to: null })
  const [reasons, setReasons] = useState<Record<string, SmartReason>>({})

  const setParamStatus = (key: string) => {
    setStatus(key)
    const next = new URLSearchParams(searchParams)
    if (key === 'all') next.delete('status')
    else next.set('status', key)
    setSearchParams(next, { replace: true })
  }

  const rangeActive = range.preset === 'custom' ? range.from !== null || range.to !== null : range.from !== null

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await followUpWorkspaceService.getScreening({
        search: search || undefined,
        assigneeId: assigneeId || null,
        status: status === 'all' ? 'all' : status,
        limit: 500,
        customerId: null,
        dateFrom: range.from,
        dateTo: range.to,
      })
      if (res.available) { setRows(res.data.rows); setUnavailable(false); setRangeUnavailable(!res.data.extended) }
      else { setRows([]); setUnavailable(true); setRangeUnavailable(false) }
    } catch {
      setRows([]); setUnavailable(false)
    }
    setLoading(false)
  }, [search, assigneeId, status, range])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    let cancelled = false
    setReasons({})
    const attentionIds = rows.filter((r) => r.requires_attention).map((r) => r.id)
    if (attentionIds.length === 0) return
    fetchSmartReasonsBatched(attentionIds, 20).then((m) => { if (!cancelled) setReasons(m) })
    return () => { cancelled = true }
  }, [rows])

  const summary = useMemo(() => {
    const flags = {
      dueToday: 0, overdue: 0, noContact: 0, declining: 0, stopped: 0,
    }
    rows.forEach((r) => {
      if (r.due_follow_up_at && r.has_open_follow_up) {
        const d = new Date(r.due_follow_up_at)
        const today = new Date()
        if (d.getTime() < today.getTime()) flags.overdue++
        else {
          const start = new Date(); start.setHours(0, 0, 0, 0)
          const end = new Date(); end.setHours(23, 59, 59, 999)
          if (d >= start && d <= end) flags.dueToday++
        }
      }
      if (r.days_since_contact === null || (r.days_since_contact ?? 999) >= 30) flags.noContact++
      if (r.trend30d_pct !== null && (r.trend30d_pct ?? 0) < 0) flags.declining++
      if (r.days_since_last_order !== null && (r.days_since_last_order ?? 0) >= 45) flags.stopped++
    })
    return flags
  }, [rows])

  const visible = rows

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/followups')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">كل العملاء — متابعة</h1>
        <button onClick={() => navigate('/orders')} className="mr-auto bg-white border border-border text-xs px-3 py-1.5 rounded-lg font-semibold text-text">
          الطلبات
        </button>
      </div>

      <div className="bg-white rounded-lg border border-border p-3 space-y-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="بحث بالاسم / الكود / الهاتف..."
          className="w-full bg-surface rounded-lg px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setParamStatus(f.key)}
              className={`text-[11px] px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                status === f.key ? 'bg-primary text-white' : 'bg-surface text-text-secondary hover:bg-neutral-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <TimeRangeSelector value={range} onChange={setRange} layout="row" />
      </div>

      {unavailable && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-[11px] text-amber-700 leading-relaxed">
          قائمة المتابعة الكاملة غير متاحة حتى يُطبّق تحديث قاعدة البيانات 0023 في النظام — حالياً تظهر المتابعات المسجلة فقط.
        </div>
      )}

      {rangeUnavailable && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-[11px] text-amber-700 leading-relaxed">
          تحليل الفترات الزمنية يُطبّق مع تحديث قاعدة البيانات 0024 — تُعرض حالياً بيانات الحساب الإجمالية.
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : visible.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">لا يوجد عملاء مطابقون</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <div className="bg-white rounded-lg border border-border p-2 text-center">
              <div className="text-lg font-bold text-danger" dir="ltr">{summary.overdue}</div>
              <div className="text-[10px] text-text-muted">متأخرة</div>
            </div>
            <div className="bg-white rounded-lg border border-border p-2 text-center">
              <div className="text-lg font-bold text-amber-600" dir="ltr">{summary.dueToday}</div>
              <div className="text-[10px] text-text-muted">اليوم</div>
            </div>
            <div className="bg-white rounded-lg border border-border p-2 text-center">
              <div className="text-lg font-bold text-danger" dir="ltr">{summary.noContact}</div>
              <div className="text-[10px] text-text-muted">بلا تواصل 30+</div>
            </div>
            <div className="bg-white rounded-lg border border-border p-2 text-center">
              <div className="text-lg font-bold text-danger" dir="ltr">{summary.declining}</div>
              <div className="text-[10px] text-text-muted">متراجعون</div>
            </div>
            <div className="bg-white rounded-lg border border-border p-2 text-center">
              <div className="text-lg font-bold text-amber-600" dir="ltr">{summary.stopped}</div>
              <div className="text-[10px] text-text-muted">متوقفون</div>
            </div>
          </div>

          <div className="space-y-2">
            {visible.map((c) => {
              const att = (c.due_follow_up_at && c.has_open_follow_up) ||
                (c.days_since_contact === null || (c.days_since_contact ?? 999) >= 30) ||
                c.trend30d_pct !== null && (c.trend30d_pct ?? 0) < 0 ||
                (c.days_since_last_order !== null && (c.days_since_last_order ?? 0) >= 45)
              return (
                <div key={c.id} className={`bg-white rounded-lg border p-2.5 ${att ? 'border-amber-200' : 'border-border'}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => navigate(`/followups/customers/${c.id}`)} className="text-xs font-bold text-text truncate hover:text-primary">
                      {c.company_name || 'عميل'}
                    </button>
                    {c.code && <span className="text-[10px] text-text-muted" dir="ltr">{c.code}</span>}
                    {att && <span className="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">يحتاج انتباه</span>}
                    <span className="mr-auto flex gap-1">
                      <button onClick={() => navigate(`/followups/new/${c.id}`)} className="text-[10px] text-primary font-semibold bg-primary/10 px-2 py-1 rounded-lg">متابعة</button>
                      <button onClick={() => navigate(`/followups/customers/${c.id}`)} className="text-[10px] text-text-secondary font-semibold bg-white border border-border px-2 py-1 rounded-lg">الملف</button>
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[10px] text-text-secondary">
                    {c.phone && <span dir="ltr">{c.phone}</span>}
                    {c.owner_name && <span>المالك: {c.owner_name}</span>}
                    {c.follow_up_assignee_name && <span>المسؤول: {c.follow_up_assignee_name}</span>}
                    {c.responsible_name && <span>المسؤول بالعميل: {c.responsible_name}</span>}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-[10px]">
                    {c.due_follow_up_at && c.has_open_follow_up
                      ? <span className="text-danger">📅 متابعة: {new Date(c.due_follow_up_at).toLocaleDateString('ar-EG-u-nu-latn')} ({c.open_follow_up_status})</span>
                      : <span className="text-text-muted">لا توجد متابعة مفتوحة</span>}
                    <span className={fmt(c.days_since_contact, 'آخر تواصل') ? ((c.days_since_contact ?? 999) >= 30 ? 'text-danger' : 'text-text-secondary') : 'text-text-muted'}>
                      {c.days_since_contact === null ? 'بدون تواصل مسجل' : fmt(c.days_since_contact, 'آخر تواصل')}
                    </span>
                    <span className="text-text-secondary">
                      {c.days_since_last_order === null && c.no_orders_ever ? 'بدون طلبات' : fmt(c.days_since_last_order, 'آخر طلب')}
                    </span>
                    {c.trend30d_pct !== null && (
                      <span className={c.trend30d_pct < 0 ? 'text-danger' : 'text-emerald-600'}>
                        المبيعات: {c.trend30d_pct > 0 ? '+' : ''}{c.trend30d_pct}% (30 يوم)
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-[10px] text-text-secondary">
                    <span>عمر العميل: {c.customer_age_days !== undefined && c.customer_age_days !== null ? `${c.customer_age_days} يوم` : '—'}</span>
                    <span title="إجمالي التاريخ منذ إنشاء العميل (طلبات / مبيعات / زيارات / تواصل / متابعات)">
                      منذ الإنشاء: {c.total_orders ?? 0} طلب · {formatCurrencyShort(c.total_sales ?? 0)} · {c.total_visits ?? 0} زيارة · {c.total_contacts ?? 0} تواصل · {c.total_follow_ups ?? 0} متابعة
                    </span>
                    {rangeActive && (c.range_order_count !== undefined || c.range_visit_count !== undefined) && (
                      <span className="text-primary" title={`تحليل الفترة ${range.label}`}>
                        في الفترة ({range.label}): {c.range_order_count ?? 0} طلب · {formatCurrencyShort(c.range_total_sales ?? 0)} · {c.range_visit_count ?? 0} زيارة · {c.range_contact_count ?? 0} تواصل · {c.range_follow_up_count ?? 0} متابعة (منها {c.range_completed_follow_ups ?? 0} مكتملة)
                      </span>
                    )}
                    {c.range_last_order_date && (
                      <span>آخر طلب بالمجال: {new Date(c.range_last_order_date).toLocaleDateString('ar-EG-u-nu-latn')}</span>
                    )}
                  </div>
                  {reasons[c.id] && (
                    <div className="mt-0.5 text-[10px] text-amber-700 leading-snug">
                      <span className="font-semibold">{SMART_KIND_LABELS[reasons[c.id].kind] || reasons[c.id].kind}:</span> {reasons[c.id].reason}
                    </div>
                  )}
                </div>
              )
            })}
            <div className="text-[10px] text-text-muted text-center">{visible.length} عميل</div>
          </div>
        </>
      )}
    </div>
  )
}