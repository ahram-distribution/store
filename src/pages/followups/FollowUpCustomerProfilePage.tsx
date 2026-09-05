import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { followUpWorkspaceService, type FollowUpCustomerRow, type CustomerSalesStats, type TimelineEvent } from '../../services/followUpWorkspaceService'
import { followUpService, type FollowUpAssignee } from '../../services/followUpService'
import { FollowUpContactForm } from '../../components/followups/FollowUpContactForm'
import { SearchableSelect } from '../../components/shared/SearchableSelect'
import { formatCurrencyShort, formatDateTime, formatDate } from '../../utils/format'
import toast from 'react-hot-toast'

const CONTACT_METHOD_LABELS: Record<string, string> = {
  call: 'اتصال', visit: 'زيارة', meeting: 'اجتماع', email: 'بريد', sms: 'رسالة', live_chat: 'محادثة', other: 'أخرى',
}

const ACTION_LABELS: Record<string, string> = {
  followup: 'متابعة', contact: 'تواصل', order: 'طلب', audit: 'تعديل',
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
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [timelineAvailable, setTimelineAvailable] = useState(true)

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
      const r = await followUpWorkspaceService.getScreening({ limit: 500 })
      if (!r.available) { setUnavailable(true); setTimelineAvailable(false); return }
      setUnavailable(false)
      setRow(r.data.find((c) => c.id === id) ?? null)
    } catch { setUnavailable(true) }
    setLoading(false)
  }, [id])

  const loadStats = useCallback(async () => {
    if (!id) return
    try {
      const r = await followUpWorkspaceService.getSalesStats(id)
      if (r.available) setStats(r.data)
    } catch { /* graceful */ }
  }, [id])

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

  useEffect(() => {
    load(); loadStats(); loadTimeline(); loadAssignees()
  }, [load, loadStats, loadTimeline, loadAssignees])

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
            </div>
            {row.requires_attention && <div className="text-[10px] bg-amber-50 text-amber-700 rounded px-2 py-1 inline-block">يحتاج انتباه — يستحق المتابعة</div>}
          </div>

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
                  const color = ev.type === 'order' ? 'text-emerald-700' : ev.type === 'audit' ? 'text-text-muted' : ev.type === 'contact' ? 'text-primary' : 'text-amber-600'
                  const icon = ev.type === 'order' ? '🧾' : ev.type === 'contact' ? '💬' : ev.type === 'audit' ? '✏️' : '📅'
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
                          {ev.type === 'order' && <>طلب {val(p.order_number)} — {val(p.status)} · {val(p.total_amount)} {val(p.sender) ? ` · ${p.sender}` : ''} (ضمن الإحصائيات: {String(p.is_statistical)})</>}
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