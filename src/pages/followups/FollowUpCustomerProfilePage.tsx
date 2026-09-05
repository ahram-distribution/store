import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { followUpWorkspaceService, type FollowUpCustomerRow, type CustomerSalesStats, type TimelineEvent, type CustomerVisitRow, type CustomerVisitAnalysisStats, type SmartReason, SMART_KIND_LABELS, orderTypeLabel, orderTypeDistributionLabel } from '../../services/followUpWorkspaceService'
import { followUpService, type FollowUpAssignee } from '../../services/followUpService'
import { FollowUpContactForm } from '../../components/followups/FollowUpContactForm'
import { SearchableSelect } from '../../components/shared/SearchableSelect'
import { TimeRangeSelector, type FollowUpTimeRange } from '../../components/followups/TimeRangeSelector'
import { formatCurrencyShort, formatDateTime, formatDate } from '../../utils/format'
import toast from 'react-hot-toast'

const CONTACT_METHOD_LABELS: Record<string, string> = {
  call: 'اتصال', visit: 'زيارة', meeting: 'اجتماع', email: 'بريد', sms: 'رسالة', live_chat: 'محادثة', other: 'أخرى',
}

const ACTION_LABELS: Record<string, string> = {
  followup: 'متابعة', contact: 'تواصل', order: 'طلب', audit: 'تعديل', visit: 'زيارة', creation: 'إنشاء العميل',
}

function val(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v)
}

export function FollowUpCustomerProfilePage() {
  const { customerId } = useParams<{ customerId: string }>()
  const navigate = useNavigate()
  const id = customerId || ''

  const [row, setRow] = useState<FollowUpCustomerRow | null>(null)
  const [stats, setStats] = useState<CustomerSalesStats | null>(null)
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [assignees, setAssignees] = useState<FollowUpAssignee[]>([])
  const [visits, setVisits] = useState<CustomerVisitRow[]>([])
  const [visitStats, setVisitStats] = useState<CustomerVisitAnalysisStats | null>(null)
  const [range, setRange] = useState<FollowUpTimeRange>({ preset: 'since_creation', label: 'منذ الإنشاء', from: null, to: null })
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [timelineAvailable, setTimelineAvailable] = useState(true)
  const [smartReason, setSmartReason] = useState<SmartReason | null>(null)

  const [showContact, setShowContact] = useState(false)
  const [showAssign, setShowAssign] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showFollowUp, setShowFollowUp] = useState(false)

  // assign state
  const [assigneeId, setAssigneeId] = useState('')
  const [assignReason, setAssignReason] = useState('')
  const [savingAssign, setSavingAssign] = useState(false)

  // edit state
  const [editCompany, setEditCompany] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editResponsible, setEditResponsible] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editAddress, setEditAddress] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const r = await followUpWorkspaceService.getScreening({ limit: 1, customerId: id })
      if (!r.available) { setUnavailable(true); setTimelineAvailable(false); return }
      setUnavailable(false)
      setRow(r.data.rows[0] ?? null)
    } catch { setUnavailable(true) }
    setLoading(false)
  }, [id])

  const loadStats = useCallback(async () => {
    if (!id) return
    try {
      const r = await followUpWorkspaceService.getSalesStats(id, { dateFrom: range.from, dateTo: range.to })
      if (r.available) setStats(r.data)
    } catch { /* graceful */ }
  }, [id, range])

  const loadVisits = useCallback(async () => {
    if (!id) return
    try {
      const fromDate = range.from && range.from > '2000-01-01' ? range.from.slice(0, 10) : '2000-01-01'
      const toDate = (range.to ? range.to.slice(0, 10) : new Date().toISOString().slice(0, 10))
      const r = await followUpWorkspaceService.getVisitsAnalysis(id, { dateFrom: fromDate, dateTo: toDate })
      if (r && r.available) { setVisits(r.data.visits); setVisitStats(r.data.stats) }
    } catch { /* graceful */ }
  }, [id, range])

  const loadTimeline = useCallback(async () => {
    if (!id) return
    try {
      const r = await followUpWorkspaceService.getTimeline(id)
      if (r.available) { setTimeline(r.data); setTimelineAvailable(true) }
      else setTimelineAvailable(false)
    } catch { setTimelineAvailable(false) }
  }, [id])

  const loadAssignees = useCallback(async () => {
    try { setAssignees(await followUpService.getAssignees()) } catch { setAssignees([]) }
  }, [])

  const loadSmartReason = useCallback(async () => {
    if (!id) return
    setSmartReason(null)
    try {
      const r = await followUpWorkspaceService.getSmartSuggestions(id)
      if (r.available && r.data && r.data.suggestions.length > 0) {
        const s = r.data.suggestions[0]
        setSmartReason({ kind: s.kind, title: s.title, reason: s.reason })
      }
    } catch { /* graceful */ }
  }, [id])

  useEffect(() => {
    load(); loadStats(); loadTimeline(); loadAssignees(); loadVisits(); loadSmartReason()
  }, [load, loadStats, loadTimeline, loadAssignees, loadVisits, loadSmartReason])

  useEffect(() => {
    if (row) {
      setEditCompany(row.company_name || '')
      setEditPhone(row.phone || '')
      setEditResponsible(row.responsible_name || '')
      setAssigneeId(row.follow_up_assignee_id || '')
    }
  }, [row])

  const saveAssign = async () => {
    if (!id) return
    setSavingAssign(true)
    try {
      await followUpWorkspaceService.assignAssignee(id, assigneeId || null, assignReason || null)
      toast.success(assigneeId ? 'تم تعيين مسؤول المتابعة' : 'تم إلغاء مسؤول المتابعة')
      setShowAssign(false); setAssignReason(''); await load()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'حدث خطأ'
      toast.error(msg === 'FEATURE_UNAVAILABLE' ? 'التعيين غير متاح بعد — يُطبّق مع تحديث 0023' : msg)
    } finally { setSavingAssign(false) }
  }

  const saveEdit = async () => {
    if (!id) return
    setSavingEdit(true)
    try {
      await followUpWorkspaceService.updateCustomer({
        customerId: id,
        companyName: editCompany || null,
        phone: editPhone || null,
        responsibleName: editResponsible || null,
        email: editEmail || null,
        address: editAddress || null,
        notes: editNotes || null,
      })
      toast.success('تم تحديث بيانات العميل')
      setShowEdit(false); await load()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'حدث خطأ'
      toast.error(msg === 'FEATURE_UNAVAILABLE' ? 'تحديث البيانات غير متاح بعد — يُطبّق مع تحديث 0023' : msg)
    } finally { setSavingEdit(false) }
  }

  if (!id) return <div className="text-center py-12 text-text-secondary text-sm">معرّف العميل غير موجود</div>

  const daysStr = (d: number | null | undefined): string => {
    if (d === null || d === undefined) return '—'
    if (d === 0) return 'اليوم'
    return `منذ ${d} يوم`
  }

  const visitsWithDelta = useMemo(() => {
    const sorted = [...visits].sort((a, b) => (a.check_in_at || '').localeCompare(b.check_in_at || ''))
    let prev: string | null = null
    const rows = sorted.map((v) => {
      const delta = prev !== null
        ? Math.max(Math.round((new Date(v.check_in_at || '').getTime() - new Date(prev).getTime()) / 86400000), 0)
        : null
      prev = v.check_in_at || prev
      return { ...v, deltaDays: delta }
    })
    return [...rows].reverse()
  }, [visits])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/followups/customers')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">ملف عميل — متابعة</h1>
        <span className="mr-auto flex gap-1.5">
          <button onClick={() => navigate(`/followups/new/${id}`)} className="bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold">+ متابعة</button>
          <button onClick={() => navigate(`/storefront?customer=${id}`)} className="bg-white border border-border text-xs px-3 py-1.5 rounded-lg font-semibold text-text">إنشاء طلب</button>
        </span>
      </div>

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : unavailable || !row ? (
        <div className="text-center py-12 text-text-secondary text-sm">العميل غير متاح — تحقق من صلاحيتك أو من تفعيل تحديث 0023</div>
      ) : (
        <>
          {/* Header */}
          <div className="bg-white rounded-lg border border-border p-3 space-y-1.5">
            <div className="flex items-center justify-between flex-wrap gap-1">
              <h2 className="text-base font-bold text-text">{row.company_name || 'عميل'}</h2>
              {row.code && <span className="text-[10px] text-text-muted" dir="ltr">{row.code}</span>}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-text-secondary">
              {row.phone && <span dir="ltr">📞 {row.phone}</span>}
              {row.responsible_name && <span>المسؤول: {row.responsible_name}</span>}
              <span>المالك: {row.owner_name || '—'}</span>
              <span>مسؤول المتابعة: {row.follow_up_assignee_name || 'غير معيّن'}</span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[10px]">
              <span className="text-text-secondary">آخر طلب: {row.last_order_date ? `${formatDate(row.last_order_date)} (${daysStr(row.days_since_last_order)})` : 'لا يوجد'}</span>
              <span className={((row.days_since_contact ?? 999) >= 30) || row.days_since_contact === null ? 'text-danger' : 'text-text-secondary'}>
                آخر تواصل: {row.last_contact_date ? `${formatDate(row.last_contact_date)} (${daysStr(row.days_since_contact)})` : 'لا يوجد'}
              </span>
              {row.trend30d_pct !== null && (
                <span className={row.trend30d_pct < 0 ? 'text-danger' : 'text-emerald-600'}>
                  المبيعات (30 يوم): {row.trend30d_pct > 0 ? '+' : ''}{row.trend30d_pct}%
                </span>
              )}
              {row.customer_age_days !== undefined && row.customer_age_days !== null && (
                <span className="text-text-secondary">عميل منذ {row.customer_age_days} يوم (منذ {formatDate(row.created_at)})</span>
              )}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-text-secondary">
              <span>إجمالي التاريخ منذ الإنشاء: {row.total_orders ?? 0} طلب · {formatCurrencyShort(row.total_sales ?? 0)} · {row.total_visits ?? 0} زيارة · {row.total_contacts ?? 0} تواصل · {row.total_follow_ups ?? 0} متابعة (منها {row.completed_follow_ups ?? 0} مكتملة)</span>
              {row.first_follow_up_date && <span>أول متابعة: {formatDate(row.first_follow_up_date)}</span>}
              {row.first_order_date && <span>أول طلب: {formatDate(row.first_order_date)}</span>}
              {row.avg_interval_days !== undefined && row.avg_interval_days !== null && <span>متوسط الفاصل بين الطلبات: {row.avg_interval_days} يوم</span>}
              {row.previous_order_date && <span>الطلب السابق: {formatDate(row.previous_order_date)}</span>}
              {row.previous_visit_date && <span>الزيارة السابقة: {formatDate(row.previous_visit_date)}</span>}
              {!!row.order_types?.length && <span>الطلبات حسب النوع (منذ الإنشاء): {orderTypeDistributionLabel(row.order_types)}</span>}
            </div>
            {row.requires_attention && <div className="text-[10px] bg-amber-50 text-amber-700 rounded px-2 py-1 inline-block">يحتاج انتباه — يستحق المتابعة</div>}
          </div>

          {/* Smart follow-up reason (from get_smart_follow_up_suggestions) */}
          {smartReason && (
            <div className={`rounded-lg border p-3 ${smartReason.kind === 'insufficient' ? 'border-border bg-surface' : 'border-amber-200 bg-amber-50'}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold text-amber-700">سبب المتابعة الذكي</span>
                <span className="text-[10px] font-semibold text-text bg-white border border-amber-200 rounded px-1.5 py-0.5">
                  {SMART_KIND_LABELS[smartReason.kind] || smartReason.kind}
                </span>
                {smartReason.title && <span className="text-[10px] text-amber-700">{smartReason.title}</span>}
              </div>
              <div className="text-[11px] text-amber-800 mt-1 leading-relaxed">{smartReason.reason}</div>
            </div>
          )}

          {/* Actions */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button onClick={() => setShowContact((v) => !v)} className={`bg-white rounded-lg border p-3 text-xs font-semibold text-text ${showContact ? 'border-primary' : 'border-border'}`}>💬 تسجيل تواصل</button>
            <button onClick={() => setShowFollowUp((v) => !v)} className={`bg-white rounded-lg border p-3 text-xs font-semibold text-text ${showFollowUp ? 'border-primary' : 'border-border'}`}>📅 متابعة / موعد</button>
            <button onClick={() => setShowAssign((v) => !v)} className={`bg-white rounded-lg border p-3 text-xs font-semibold text-text ${showAssign ? 'border-primary' : 'border-border'}`}>👤 مسؤول المتابعة</button>
            <button onClick={() => setShowEdit((v) => !v)} className={`bg-white rounded-lg border p-3 text-xs font-semibold text-text ${showEdit ? 'border-primary' : 'border-border'}`}>✏️ تحديث البيانات</button>
          </div>

          {showContact && (
            <div className="bg-white rounded-lg border border-border p-3">
              <FollowUpContactForm customerId={id} customerName={row.company_name || undefined} onDone={load} compact />
            </div>
          )}

          {showFollowUp && (
            <div className="bg-white rounded-lg border border-border p-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-text">متابعة / موعد جديد</h3>
                <button onClick={() => navigate(`/followups/new/${id}`)} className="bg-primary text-white text-[11px] px-2.5 py-1.5 rounded-lg font-semibold">فتح نموذج المتابعة</button>
              </div>
              <div className="text-[11px] text-text-secondary leading-relaxed">
                يُسجل الموعد من نموذج المتابعة الكامل (أولوية، وصف، موعد، مسؤول). التفاصيل تظهر هنا في الخط الزمني فور حفظمها.
              </div>
            </div>
          )}

          {showAssign && (
            <div className="bg-white rounded-lg border border-border p-3 space-y-2">
              <h3 className="text-sm font-bold text-text">تعيين مسؤول المتابعة</h3>
              <SearchableSelect
                items={assignees.map((a) => ({ id: a.id, name: `${a.full_name}${a.code ? ` (${a.code})` : ''}` }))}
                value={assigneeId}
                onChange={setAssigneeId}
                placeholder="اختر موظفاً (أو امسح للإلغاء)"
              />
              <textarea value={assignReason} onChange={(e) => setAssignReason(e.target.value)} rows={2} placeholder="سبب التعيين (اختياري)" className="w-full bg-surface rounded-lg px-3 py-2 text-xs border border-border" />
              <div className="flex gap-2">
                <button onClick={saveAssign} disabled={savingAssign} className="flex-1 bg-primary text-white text-xs py-2 rounded-lg font-semibold disabled:opacity-50">{savingAssign ? 'جاري...' : 'حفظ التعيين'}</button>
                <button onClick={() => setShowAssign(false)} className="px-4 border border-border rounded-lg text-xs text-text-secondary">إلغاء</button>
              </div>
            </div>
          )}

          {showEdit && (
            <div className="bg-white rounded-lg border border-border p-3 space-y-2">
              <h3 className="text-sm font-bold text-text">تحديث بيانات العميل</h3>
              <input value={editCompany} onChange={(e) => setEditCompany(e.target.value)} placeholder="اسم الشركة" className="w-full bg-surface rounded-lg px-3 py-2 text-xs border border-border" />
              <input value={editResponsible} onChange={(e) => setEditResponsible(e.target.value)} placeholder="اسم المسؤول بالعميل" className="w-full bg-surface rounded-lg px-3 py-2 text-xs border border-border" />
              <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="رقم الهاتف" className="w-full bg-surface rounded-lg px-3 py-2 text-xs border border-border" dir="ltr" />
              <input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="البريد الإلكتروني" className="w-full bg-surface rounded-lg px-3 py-2 text-xs border border-border" dir="ltr" />
              <input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} placeholder="العنوان" className="w-full bg-surface rounded-lg px-3 py-2 text-xs border border-border" />
              <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={2} placeholder="ملاحظات" className="w-full bg-surface rounded-lg px-3 py-2 text-xs border border-border" />
              <div className="flex gap-2">
                <button onClick={saveEdit} disabled={savingEdit} className="flex-1 bg-primary text-white text-xs py-2 rounded-lg font-semibold disabled:opacity-50">{savingEdit ? 'جاري...' : 'حفظ التحديث'}</button>
                <button onClick={() => setShowEdit(false)} className="px-4 border border-border rounded-lg text-xs text-text-secondary">إلغاء</button>
              </div>
              <div className="text-[10px] text-text-muted">لا يُغيّر هذا مالك العميل ولا تاريخ الملكية — فقط تصحيح البيانات المسموحة.</div>
            </div>
          )}

          {/* Behavior analysis (period + lifetime) */}
          <div className="bg-white rounded-lg border border-border p-3">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
              <h3 className="text-xs font-bold text-text">تحليل سلوك العميل</h3>
              <TimeRangeSelector value={range} onChange={setRange} layout="row" />
            </div>
            {!stats ? (
              <div className="text-center py-3 text-text-secondary text-xs">لا يوجد تحليل (تُطبّق حقول السلوك مع تحديث 0024)</div>
            ) : (
              <>
                {stats.period && (
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    <div className="bg-surface rounded-lg p-2 text-center"><div className="text-sm font-bold text-text" dir="ltr">{stats.period.order_count}</div><div className="text-[9px] text-text-secondary">طلبات الفترة</div></div>
                    <div className="bg-surface rounded-lg p-2 text-center"><div className="text-sm font-bold text-text">{formatCurrencyShort(stats.period.total_sales)}</div><div className="text-[9px] text-text-secondary">مبيعات الفترة</div></div>
                    <div className="bg-surface rounded-lg p-2 text-center"><div className="text-sm font-bold text-text" dir="ltr">{stats.period.avg_interval_days !== null && stats.period.avg_interval_days !== undefined ? `${stats.period.avg_interval_days} يوم` : '—'}</div><div className="text-[9px] text-text-secondary">متوسط الفاصل بالمجال</div></div>
                    <div className="bg-surface rounded-lg p-2 text-center"><div className="text-sm font-bold text-text" dir="ltr">{stats.visits?.range_count ?? 0}</div><div className="text-[9px] text-text-secondary">زيارات بالمجال</div></div>
                    <div className="bg-surface rounded-lg p-2 text-center"><div className="text-sm font-bold text-text" dir="ltr">{stats.contacts?.range_count ?? 0}</div><div className="text-[9px] text-text-secondary">تواصل بالمجال</div></div>
                    <div className="bg-surface rounded-lg p-2 text-center"><div className="text-sm font-bold text-text" dir="ltr">{stats.follow_ups?.range_count ?? 0}<span className="text-[9px] text-text-muted"> / {stats.follow_ups?.range_completed ?? 0}</span></div><div className="text-[9px] text-text-secondary">متابعات بالمجال (مكتملة)</div></div>
                  </div>
                )}
                {!!stats.period?.order_types?.length && (
                  <div className="mt-1 text-[10px] text-text-secondary">
                    <span className="font-semibold text-text-muted">طلبات الفترة حسب النوع: </span>
                    {orderTypeDistributionLabel(stats.period.order_types)}
                  </div>
                )}
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[10px] text-text-secondary">
                  <span>إجمالي الزيارات: {stats.visits?.total ?? 0}{stats.visits?.last_date ? ` — آخر زيارة ${formatDate(stats.visits.last_date)}` : ''}</span>
                  <span>إجمالي التواصل: {stats.contacts?.total ?? 0}{stats.contacts?.last_result ? ` — آخر نتيجة: ${stats.contacts.last_result}` : ''}</span>
                  <span>إجمالي المتابعات: {stats.follow_ups?.total ?? 0} (مكتملة {stats.follow_ups?.completed ?? 0})</span>
                  {stats.customer?.customer_age_days !== null && stats.customer?.customer_age_days !== undefined && (
                    <span>عمر العميل: {stats.customer.customer_age_days} يوم</span>
                  )}
                </div>
                {visitStats && stats.period && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-[10px] text-text-secondary">
                    <span>نجاح الزيارات بالمجال: {visitStats.success_rate}% ({visitStats.successful_visits}/{visitStats.total_visits})</span>
                    {visitStats.avg_duration_minutes > 0 && <span>متوسط مدة الزيارة: {visitStats.avg_duration_minutes} دقيقة</span>}
                  </div>
                )}
                {visits.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <h4 className="text-[10px] font-semibold text-text-muted mb-1">الزيارات بالمجال ({visits.length})</h4>
                    {visitsWithDelta.slice(0, 6).map((v) => (
                      <div key={v.id} className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] bg-surface rounded px-2 py-1">
                        <span>📍 {formatDateTime(v.check_in_at || '')}</span>
                        <span className="font-semibold text-sky-700">
                          {v.deltaDays === null ? 'أول زيارة' : `الفاصل عن الزيارة السابقة: ${v.deltaDays} يوم`}
                        </span>
                        <span>{v.visit_result || v.status || 'زيارة'}</span>
                        {v.duration_minutes !== null && v.duration_minutes !== undefined && <span>{v.duration_minutes} د</span>}
                        {v.employee_name && <span>{v.employee_name}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Sales stats */}
          <div className="bg-white rounded-lg border border-border p-3">
            <h3 className="text-xs font-bold text-text mb-2">إحصائيات المبيعات (لأغراض المتابعة)</h3>
            {!stats ? (
              <div className="text-center py-3 text-text-secondary text-xs">لا توجد إحصائيات (تُطبّق مع تحديث 0023)</div>
            ) : (
              <>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  <div className="bg-surface rounded-lg p-2 text-center"><div className="text-sm font-bold text-text" dir="ltr">{stats.order_count}</div><div className="text-[9px] text-text-secondary">الطلبات</div></div>
                  <div className="bg-surface rounded-lg p-2 text-center"><div className="text-sm font-bold text-text">{formatCurrencyShort(stats.total_sales)}</div><div className="text-[9px] text-text-secondary">إجمالي المشتريات</div></div>
                  <div className="bg-surface rounded-lg p-2 text-center"><div className="text-sm font-bold text-text">{formatCurrencyShort(stats.avg_order_value)}</div><div className="text-[9px] text-text-secondary">متوسط الطلب</div></div>
                  <div className="bg-surface rounded-lg p-2 text-center"><div className="text-sm font-bold text-text">{stats.avg_interval_days !== null ? `${stats.avg_interval_days} يوم` : '—'}</div><div className="text-[9px] text-text-secondary">متوسط الفاصل</div></div>
                  <div className="bg-surface rounded-lg p-2 text-center"><div className="text-sm font-bold text-text">{stats.days_since_last_order !== null ? `${stats.days_since_last_order} يوم` : '—'}</div><div className="text-[9px] text-text-secondary">منذ آخر طلب</div></div>
                  <div className="bg-surface rounded-lg p-2 text-center">
                    <div className={`text-sm font-bold ${(stats.trend30d_pct ?? 0) < 0 ? 'text-danger' : 'text-emerald-600'}`}>
                      {stats.trend30d_pct === null ? '—' : `${stats.trend30d_pct > 0 ? '+' : ''}${stats.trend30d_pct}%`}
                    </div>
                    <div className="text-[9px] text-text-secondary">الاتجاه (30 يوم)</div>
                  </div>
                </div>
                {!!stats.order_types?.length && (
                  <div className="mt-2 text-[10px] text-text-secondary">
                    <span className="font-semibold text-text-muted">الطلبات حسب النوع: </span>
                    {orderTypeDistributionLabel(stats.order_types)}
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                  {stats.top_products.length > 0 && (
                    <div>
                      <h4 className="text-[10px] font-semibold text-text-muted mb-1">الأكثر شراءً</h4>
                      <div className="space-y-1">
                        {stats.top_products.map((p) => (
                          <div key={p.name} className="flex justify-between text-[10px]">
                            <span className="text-text truncate">{p.name}</span>
                            <span className="text-text-secondary">{p.qty} قطعة — {formatCurrencyShort(p.total)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {stats.top_companies.length > 0 && (
                    <div>
                      <h4 className="text-[10px] font-semibold text-text-muted mb-1">أهم الشركات الموردة</h4>
                      <div className="space-y-1">
                        {stats.top_companies.map((c) => (
                          <div key={c.name} className="flex justify-between text-[10px]">
                            <span className="text-text truncate">{c.name}</span>
                            <span className="text-text-secondary">{formatCurrencyShort(c.total)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Timeline */}
          <div className="bg-white rounded-lg border border-border p-3">
            <h3 className="text-xs font-bold text-text mb-2">الخط الزمني</h3>
            {!timelineAvailable ? (
              <div className="text-center py-4 text-text-secondary text-xs">الخط الزمني غير متاح — يُطبّق مع تحديث 0023</div>
            ) : timeline.length === 0 ? (
              <div className="text-center py-4 text-text-secondary text-xs">لا يوجد نشاط مسجل بعد</div>
            ) : (
              <div className="space-y-2">
                {timeline.map((ev, i) => {
                  const p = ev.payload
                  const color = ev.type === 'order' ? 'text-emerald-700' : ev.type === 'visit' ? 'text-sky-600' : ev.type === 'creation' ? 'text-emerald-600' : ev.type === 'audit' ? 'text-text-muted' : ev.type === 'contact' ? 'text-primary' : 'text-amber-600'
                  const icon = ev.type === 'order' ? '🧾' : ev.type === 'visit' ? '📍' : ev.type === 'creation' ? '🌱' : ev.type === 'contact' ? '💬' : ev.type === 'audit' ? '✏️' : '📅'
                  return (
                    <div key={i} className="flex gap-2 bg-surface rounded-lg p-2.5 text-xs">
                      <span className={color}>{icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between gap-2">
                          <span className={`font-bold ${color}`}>{ACTION_LABELS[ev.type] || ev.type}</span>
                          <span className="text-[9px] text-text-muted">{formatDateTime(ev.ts)}</span>
                        </div>
                        <div className="text-[11px] text-text-secondary mt-0.5 leading-relaxed">
                          {ev.type === 'followup' && <>«{val(p.title)}» — {val(p.status)} · {val(p.priority)}{p.due_at ? ` · موعد ${formatDate(String(p.due_at))}` : ''}{p.result ? ` · النتيجة: ${p.result}` : ''}{p.creator ? ` · ${p.creator}` : ''}</>}
                          {ev.type === 'contact' && <>{CONTACT_METHOD_LABELS[val(p.method)] || val(p.method)}{p.reason ? ` · السبب: ${p.reason}` : ''}{p.result ? ` · النتيجة: ${p.result}` : ''}{p.next_action ? ` · الإجراء: ${p.next_action}` : ''}{p.order_created ? ' · ✅ تم إنشاء طلب' : ''}{p.notes ? ` — ${p.notes}` : ''}</>}
                          {ev.type === 'order' && <>طلب {val(p.order_number)} — {val(p.status)}{p.order_type ? ` · ${orderTypeLabel(String(p.order_type))}` : ''}
                          {p.delta_days === null || p.delta_days === undefined ? ' · أول طلب' : ` · الفاصل عن الطلب السابق: ${Number(p.delta_days)} يوم`}
                           · {val(p.total_amount)} {val(p.sender) ? ` · ${p.sender}` : ''} (ضمن الإحصائيات: {String(p.is_statistical)})</>}
                          {ev.type === 'visit' && <>زيارة {val(p.code)}{p.status ? ` — ${p.status}` : ''}
                          {p.delta_days === null || p.delta_days === undefined ? ' · أول زيارة' : ` · الفاصل عن الزيارة السابقة: ${Number(p.delta_days)} يوم`}
                          {p.visit_result ? ` · النتيجة: ${p.visit_result}` : ''}{p.duration_minutes ? ` · ${p.duration_minutes} د` : ''}{p.employee ? ` · ${p.employee}` : ''}{p.notes ? ` — ${p.notes}` : ''}</>}
                          {ev.type === 'creation' && <>بداية حساب العميل — تاريخ الإنشاء {formatDate(String(p.created_at))}</>}
                          {ev.type === 'audit' && <>{val(p.field) ? `${val(p.field)}: ${val(p.old_value)} ← ${val(p.new_value)}` : val(p.note)}{p.employee ? ` · ${p.employee}` : ''}</>}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}