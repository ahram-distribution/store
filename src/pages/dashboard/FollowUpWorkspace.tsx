import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { followUpWorkspaceService, type DashboardSummary, type FollowUpCustomerRow, type SmartReason, fetchSmartReasonsBatched, SMART_KIND_LABELS } from '../../services/followUpWorkspaceService'
import { useAuthStore } from '../../store/auth'
import { isUpperManagement } from '../../utils/roleNormalization'

interface CounterDef {
  key: keyof DashboardSummary
  label: string
  icon: string
  tone: string
  path: string
  whenZero?: boolean
}

const COUNTERS: CounterDef[] = [
  { key: 'due_today', label: 'مستحقة اليوم', icon: '⏰', tone: 'text-amber-600', path: '/followups/today' },
  { key: 'overdue', label: 'متأخرة', icon: '⚠️', tone: 'text-danger', path: '/followups/today' },
  { key: 'upcoming', label: 'قادمة', icon: '📅', tone: 'text-primary', path: '/followups/notebook' },
  { key: 'executed_30d', label: 'منفذة (30 يوم)', icon: '✅', tone: 'text-emerald-600', path: '/followups/analytics' },
  { key: 'no_contact_30d', label: 'بدون تواصل 30 يوم', icon: '📵', tone: 'text-danger', path: '/followups/customers?status=no_contact_30d' },
  { key: 'new_30d', label: 'عملاء جدد', icon: '🆕', tone: 'text-primary', path: '/followups/customers?status=new_30d' },
  { key: 'declined', label: 'متراجعون', icon: '📉', tone: 'text-danger', path: '/followups/customers?status=declining' },
  { key: 'stopped', label: 'متوقفون', icon: '⛔', tone: 'text-text-secondary', path: '/followups/customers?status=stopped' },
]

const MODULE_TILES = [
  { label: 'لوحة المتابعة', path: '/followups', icon: '🧭', hint: 'متابعات اليوم والمتأخرة' },
  { label: 'كل العملاء', path: '/followups/customers', icon: '👥', hint: 'قائمة المتابعة لكل العملاء' },
  { label: 'المفكرة اليومية', path: '/followups/notebook', icon: '📒', hint: 'اليوم / القادم / المتأخر / المكتمل' },
  { label: 'متابعة جديدة', path: '/followups/new', icon: '➕', hint: 'تسجيل متابعة جديدة' },
  { label: 'تحليل العملاء', path: '/followups/analytics', icon: '📊', hint: 'المقترحات الذكية والتحليل' },
  { label: 'التقارير', path: '/followups/reports', icon: '📈', hint: 'تقارير وتصدير Excel/Word' },
  { label: 'قائمة المتابعات', path: '/followups/queue', icon: '🗂️', hint: 'كل المتابعات المفتوحة' },
  { label: 'الطلبات', path: '/orders', icon: '🧾', hint: 'كل الطلبات والفترات' },
]

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch { return '—' }
}

function attentionReason(row: FollowUpCustomerRow): string[] {
  const reasons: string[] = []
  if (row.due_follow_up_at && row.has_open_follow_up) {
    const days = Math.floor((Date.now() - new Date(row.due_follow_up_at).getTime()) / 86400000)
    reasons.push(days >= 0 ? `متابعة متأخرة ${days} يوم` : `لديه متابعة قريبة`)
  }
  if ((row.days_since_contact === null || (row.days_since_contact ?? 999) >= 30)) reasons.push('بدون تواصل 30+ يوم')
  if (row.trend30d_pct !== null && (row.trend30d_pct ?? 0) < 0) reasons.push(`تراجع المبيعات (${row.trend30d_pct}%)`)
  if (row.days_since_last_order !== null && (row.days_since_last_order ?? 0) >= 45) reasons.push(`آخر طلب قبل ${row.days_since_last_order} يوم`)
  return reasons
}

export function FollowUpWorkspace() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const isUpper = useMemo(() => user?.roles?.some(isUpperManagement) ?? false, [user])

  const [dash, setDash] = useState<DashboardSummary | null>(null)
  const [dashAvailable, setDashAvailable] = useState(true)
  const [attention, setAttention] = useState<FollowUpCustomerRow[]>([])
  const [attentionReasons, setAttentionReasons] = useState<Record<string, SmartReason>>({})
  const [loading, setLoading] = useState(true)
  const [notifyMsg, setNotifyMsg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const r = await followUpWorkspaceService.getDashboard()
        if (cancelled) return
        if (!r.available) { setDashAvailable(false); setDash(null); return }
        setDash(r.data)
      } catch { if (!cancelled) { setDashAvailable(false); setDash(null) } }
      try {
        const r = await followUpWorkspaceService.getScreening({ status: 'all', limit: 8 })
        if (cancelled) return
        if (r.available) {
          const att = ((r.data?.rows) ?? []).filter((c) => c.requires_attention)
          setAttention(att)
          if (att.length > 0) {
            fetchSmartReasonsBatched(att.map((c) => c.id), 8).then((m) => { if (!cancelled) setAttentionReasons(m) })
          }
        }
      } catch { /* ignore */ }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  const fireDueNotify = async () => {
    setNotifyMsg('جاري إرسال التذكيرات...')
    try {
      const r = await followUpWorkspaceService.runDueNotifications()
      if (r.enabled) setNotifyMsg(r.notified_employees ? `تم إرسال تذكير لـ ${r.notified_employees} موظف` : 'لا يوجد مستحقات للتذكير الآن')
      else setNotifyMsg('التذكير التلقائي معطّل — يفعّله المشرف من الإعدادات')
    } catch {
      setNotifyMsg('لم تتوفر خدمة التذكير بعد (لم تُفعّل في النظام)')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-lg font-bold text-text">مساحة متابعة العملاء</h1>
        <div className="mr-auto flex gap-1.5">
          <button onClick={() => navigate('/followups/new')} className="bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold">
            + متابعة جديدة
          </button>
          <button onClick={() => navigate('/followups/customers')} className="bg-white border border-border text-xs px-3 py-1.5 rounded-lg font-semibold text-text">
            كل العملاء
          </button>
        </div>
      </div>

      {/* Operational counters */}
      {loading ? (
        <div className="bg-white rounded-lg border border-border p-6 text-center text-text-secondary text-sm">جاري تحميل لوحة المتابعة...</div>
      ) : !dashAvailable || !dash ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-[11px] text-amber-700 leading-relaxed">
          لوحة المتابعة غير متاحة حالياً — تأكد من تحديث قاعدة البيانات بالتحديث 0023 (العدادات والاقتراحات والتقارير تتطلب تطبيقه أولاً).
        </div>
      ) : (
        <>
          <div className="bg-white rounded-lg border border-border p-3 text-[11px] text-text-secondary">
            إجمالي العملاء الواقعون تحت المتابعة: <b className="text-text" dir="ltr">{dash.all_customers ?? 0}</b>
            <button onClick={() => navigate('/followups/customers')} className="mr-2 text-primary font-semibold">عرض القائمة</button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {COUNTERS.map((c) => {
              const value = Number(dash[c.key] ?? 0)
              return (
                <button
                  key={c.key}
                  onClick={() => navigate(c.path)}
                  className="bg-white rounded-lg border border-border p-3 text-right hover:border-primary/40 hover:bg-primary/5 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xl">{c.icon}</span>
                    <span className={`text-2xl font-bold ${value > 0 ? c.tone : 'text-text-muted'}`} dir="ltr">{value}</span>
                  </div>
                  <div className="text-[11px] text-text-secondary mt-1">{c.label}</div>
                </button>
              )
            })}
          </div>

          {/* Today's focus + reminder */}
          <div className="bg-white rounded-lg border border-border p-3">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <h2 className="text-sm font-bold text-text">برنامج اليوم</h2>
              {isUpper && (
                <button onClick={fireDueNotify} className="mr-auto text-[10px] text-primary font-semibold bg-primary/10 px-2 py-1 rounded-lg">إرسال التذكيرات اليومية</button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => navigate('/followups/today')} className="bg-surface rounded-lg px-3 py-2 text-xs text-text hover:bg-primary/10">
                ⏰ متابعات اليوم ({dash.due_today})
              </button>
              <button onClick={() => navigate('/followups/customers?status=no_contact_30d')} className="bg-surface rounded-lg px-3 py-2 text-xs text-text hover:bg-primary/10">
                📵 عملاء بلا تواصل ({dash.no_contact_30d})
              </button>
              <button onClick={() => navigate('/followups/customers?status=declining')} className="bg-surface rounded-lg px-3 py-2 text-xs text-text hover:bg-primary/10">
                📉 متدهورون ({dash.declined})
              </button>
              <button onClick={() => navigate('/followups/customers?status=stopped')} className="bg-surface rounded-lg px-3 py-2 text-xs text-text hover:bg-primary/10">
                ⛔ متوقفون ({dash.stopped})
              </button>
            </div>
            {notifyMsg && <div className="text-[11px] text-text-secondary mt-2">{notifyMsg}</div>}
          </div>

          {/* Smart suggestions */}
          <div className="bg-white rounded-lg border border-border p-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold text-text">يستحق الانتباه الآن</h2>
              <button onClick={() => navigate('/followups/customers')} className="text-[10px] text-primary font-semibold">عرض الكل</button>
            </div>
            {attention.length === 0 ? (
              <div className="text-center py-4 text-text-secondary text-xs">لا عملاء يحتاجون انتباهاً حالياً</div>
            ) : (
              <div className="space-y-2">
                {attention.slice(0, 6).map((c) => (
                  <div key={c.id} className="flex items-center gap-2 bg-surface rounded-lg p-2.5 text-xs">
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-text truncate">{c.company_name || 'عميل'}</div>
                      {attentionReasons[c.id] ? (
                        <div className="text-[10px] font-semibold text-amber-700 leading-snug mt-0.5 truncate" title={attentionReasons[c.id].reason}>
                          {SMART_KIND_LABELS[attentionReasons[c.id].kind] || attentionReasons[c.id].kind} — {attentionReasons[c.id].reason}
                        </div>
                      ) : (
                        <div className="text-[10px] text-text-secondary truncate">
                          {attentionReason(c).join(' • ') || 'يحتاج متابعة'}
                          {c.due_follow_up_at && <span className="text-primary"> — 📅 {fmtDate(c.due_follow_up_at)}</span>}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => navigate(`/followups/new/${c.id}`)} className="text-[10px] text-primary font-semibold bg-primary/10 px-2 py-1 rounded-lg">متابعة</button>
                      <button onClick={() => navigate(`/followups/customers/${c.id}`)} className="text-[10px] text-text-secondary font-semibold bg-white border border-border px-2 py-1 rounded-lg">العميل</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Module tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {MODULE_TILES.map((item) => (
          <button
            key={item.label}
            onClick={() => navigate(item.path)}
            className="bg-white rounded-lg border border-border p-4 text-right hover:border-primary/40 hover:bg-primary/5 transition-colors"
          >
            <div className="text-2xl mb-2">{item.icon}</div>
            <div className="text-sm font-bold text-text">{item.label}</div>
            {item.hint && <div className="text-[11px] text-text-muted mt-0.5">{item.hint}</div>}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-border p-3 text-[11px] text-text-secondary leading-relaxed">
        تُسجل التواصل ونتائج المتابعة داخل ملف العميل (اتصال / زيارة / اجتماع / بريد / رسالة / محادثة)، مع سبب التواصل
        والنتيجة والإجراء التالي وموعد المتابعة القادمة. مالك العميل ومالك الطلب لا يتغيران — فريق المتابعة دور تشغيلي منفصل.
        {dash && dash.scope === 'own' && ' أرقام المتابعات تعكس متابعاتك أنت؛ رؤية العملاء شاملة عبر صلاحية قراءة العملاء.'}
      </div>
    </div>
  )
}