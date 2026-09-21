import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'
import { isUpperManagement } from '../../utils/roleNormalization'
import {
  fetchUsageMonitor,
  buildResourceRows,
  buildEdgeInvocations,
  buildHotOps,
  summarizeServiceCounts,
  computeExecutiveStatus,
  buildAlerts,
  estimateInternalEgress,
  CONSUMPTION_SOURCES,
  FIXED_ITEMS,
  ROOT_CAUSE,
  HISTORICAL_DISCLAIMER,
  AVAILABILITY_MATRIX,
  PERIODS,
  DATA_KIND_LABEL,
  formatBytes,
  type UsageMonitorPayload,
  type UsagePeriod,
} from '../../services/usageMonitor'

type LoadState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ok'; payload: UsageMonitorPayload }
  | { phase: 'error'; reason: string }

const fmtCount = (n: number): string => n.toLocaleString('ar-EG')

const LEVEL_STYLE: Record<string, { band: string; chip: string }> = {
  safe: { band: 'bg-gradient-to-l from-emerald-700 to-emerald-600', chip: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  watch: { band: 'bg-gradient-to-l from-sky-700 to-sky-600', chip: 'bg-sky-100 text-sky-800 border-sky-300' },
  warning: { band: 'bg-gradient-to-l from-amber-700 to-amber-600', chip: 'bg-amber-100 text-amber-800 border-amber-300' },
  danger: { band: 'bg-gradient-to-l from-red-700 to-red-600', chip: 'bg-red-100 text-red-800 border-red-300' },
}

const RES_STATUS: Record<string, { text: string; cls: string; bar: string }> = {
  ok: { text: 'طبيعي', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', bar: 'bg-emerald-500' },
  watch: { text: 'تحت المراقبة', cls: 'bg-sky-50 text-sky-700 border-sky-200', bar: 'bg-sky-500' },
  warning: { text: 'تحذير', cls: 'bg-amber-50 text-amber-700 border-amber-200', bar: 'bg-amber-500' },
  danger: { text: 'خطر', cls: 'bg-red-50 text-red-700 border-red-200', bar: 'bg-red-500' },
}

const VOLUME_LABEL: Record<string, string> = { high: 'مرتفع', medium: 'متوسط', low: 'منخفض' }
const VOLUME_CLS: Record<string, string> = {
  high: 'bg-amber-100 text-amber-800 border-amber-300',
  medium: 'bg-sky-100 text-sky-800 border-sky-300',
  low: 'bg-emerald-100 text-emerald-800 border-emerald-300',
}

const OPT_LABEL: Record<string, string> = { optimized: 'محسَّن', partial: 'محسَّن جزئيًا', none: 'غير محسَّن' }
const OPT_CLS: Record<string, string> = {
  optimized: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  partial: 'bg-amber-50 text-amber-700 border-amber-200',
  none: 'bg-red-50 text-red-700 border-red-200',
}

const DATA_KIND_CLS: Record<string, string> = {
  official: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  internal: 'bg-sky-50 text-sky-700 border-sky-200',
  unavailable: 'bg-gray-100 text-gray-500 border-gray-300',
}

const ALERT_CLS: Record<string, string> = {
  high: 'border-red-300 bg-red-50',
  medium: 'border-amber-300 bg-amber-50',
  info: 'border-indigo-200 bg-indigo-50',
}

const Section = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <section className={`bg-white rounded-2xl border border-border shadow-sm overflow-hidden ${className}`}>{children}</section>
)

function SectionHead({ color, title, tag }: { color: string; title: string; tag?: string }) {
  return (
    <div className={`${color} px-5 py-3.5 flex flex-wrap items-center justify-between gap-2`}>
      <h2 className="text-sm font-bold text-white">{title}</h2>
      {tag && <span className="text-[10px] bg-white/15 text-white font-bold px-2 py-0.5 rounded-full">{tag}</span>}
    </div>
  )
}

export default function UsageMonitorPage() {
  const nav = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [state, setState] = useState<LoadState>({ phase: 'idle' })
  const [lastRefresh, setLastRefresh] = useState<string | null>(null)
  const [period, setPeriod] = useState<UsagePeriod>('24h')

  const isExec = !!user?.roles?.some((r) => isUpperManagement(r))

  const refresh = useCallback(async (manual: boolean) => {
    setState({ phase: 'loading' })
    try {
      const payload = await fetchUsageMonitor(period)
      setState({ phase: 'ok', payload })
      setLastRefresh(new Date().toLocaleString('ar-EG', { hour12: true }))
    } catch (e) {
      setState({ phase: 'error', reason: String((e as Error).message || e) })
    }
  }, [period])

  useEffect(() => {
    refresh(false)
  }, [refresh])

  const payload = state.phase === 'ok' ? state.payload : null
  const rows = payload ? buildResourceRows(payload) : []
  const edge = payload ? buildEdgeInvocations(payload) : null
  const status = payload ? computeExecutiveStatus(payload) : null
  const alerts = payload ? buildAlerts(payload) : []
  const counts = payload ? summarizeServiceCounts(payload) : null
  const hotOps = payload ? buildHotOps(payload, period) : []
  const est = payload ? estimateInternalEgress(payload) : null

  const db = rows.find((r) => r.id === 'database')
  const storage = rows.find((r) => r.id === 'storage')
  const remOf = (r: { usedBytes: number; limitBytes: number }) => Math.max(0, r.limitBytes - r.usedBytes)
  const pctOf = (used: number, limit: number) => (limit > 0 ? (used / limit) * 100 : 0)

  const topEndpoints = payload?.top_endpoints ?? null
  const logsRows = typeof topEndpoints?.rows === 'number' ? topEndpoints.rows : 0

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header band */}
      <div className="bg-gradient-to-l from-slate-900 via-indigo-900 to-indigo-800 rounded-2xl shadow-lg overflow-hidden">
        <div className="p-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button onClick={() => nav('/dashboard')} className="text-white/70 hover:text-white text-xl" title="رجوع">
              &rarr;
            </button>
            <div>
              <h1 className="text-2xl font-bold text-white">استهلاك النظام</h1>
              <p className="text-xs text-white/70 mt-1">مراقبة استهلاك موارد المشروع — الإدارة العليا فقط</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-white/80" dir="ltr">
              {payload ? payload.meta.project : ''}
            </span>
            <button
              onClick={() => refresh(true)}
              disabled={state.phase === 'loading'}
              className="bg-white text-indigo-900 text-sm font-bold px-4 py-2 rounded-xl shadow hover:bg-indigo-50 active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {state.phase === 'loading' ? 'جاري الفحص...' : 'فحص الاستهلاك الآن'}
            </button>
          </div>
        </div>
        {lastRefresh && (
          <div className="px-6 pb-3 text-[10px] text-white/70">
            آخر فحص: {lastRefresh}
            {payload ? ` — البيانات مقيسة لحظة توليدها (${new Date(payload.meta.generated_at_utc).toLocaleString('ar-EG', { hour12: true })})` : ''}
          </div>
        )}
      </div>

      {/* Period selector */}
      <div className="bg-white rounded-2xl border border-border shadow-sm px-5 py-3 flex flex-wrap items-center gap-3">
        <span className="text-xs font-bold text-text">الفترة:</span>
        <div className="flex items-center gap-2">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              disabled={state.phase === 'loading'}
              className={`text-xs font-bold px-3 py-1.5 rounded-full border transition disabled:opacity-50 ${
                period === p.id ? 'bg-indigo-700 text-white border-indigo-700' : 'bg-white text-text-secondary border-border hover:border-indigo-300'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-text-secondary">
          العداد الرسمي يدعم 24 ساعة و7 أيام فقط — الفترة 30 يومًا تظهر كتنبيه بدون بيانات مخترعة. الوظائف الخادمية تُقاس لآخر 24 ساعة فقط.
        </span>
      </div>

      {!isExec && state.phase !== 'ok' && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5 text-sm text-red-700">هذه الشاشة مخصصة لأعضاء الإدارة العليا فقط.</div>
      )}

      {state.phase === 'idle' && null}

      {state.phase === 'loading' && (
        <div className="bg-white rounded-2xl border border-border shadow-sm p-10 flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <div className="text-sm text-text-secondary">جاري فحص الاستهلاك...</div>
        </div>
      )}

      {state.phase === 'error' && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
          <div className="text-sm font-bold text-red-700 mb-1">تعذر فحص الاستهلاك</div>
          <div className="text-xs text-red-600/90" dir="ltr">
            {state.reason}
          </div>
          <p className="text-[11px] text-red-700/80 mt-3 leading-relaxed">
            السبب الأكثر احتمالاً: الوظيفة الخادمية <span dir="ltr">usage-monitor</span> لم تُنشر بعد، أو رمز الإدارة غير مفعل، أو الواجهة مشغولة. هذه
            الشاشة لا تنقل أي مفاتيح سرية إلى المتصفح.
          </p>
          <button onClick={() => refresh(true)} className="mt-3 text-xs font-bold text-red-700 border border-red-300 rounded-lg px-3 py-1.5 hover:bg-red-100">
            إعادة المحاولة
          </button>
        </div>
      )}

      {payload && status && (
        <>
          {/* Category legend — the three categories are never mixed */}
          <div className="bg-white rounded-2xl border border-border shadow-sm px-5 py-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-text-secondary">
            <span className="font-bold text-text">مستوى دقة الأرقام:</span>
            <span>🟢 مقيس فعليًا</span>
            <span>🟡 تحليل داخلي للنظام (ليس رقمًا رسميًا)</span>
            <span>⚪ غير متاح</span>
          </div>

          {/* 1. حالة المشروع */}
          <div className={`${LEVEL_STYLE[status.level].band} rounded-2xl shadow-lg overflow-hidden text-white`}>
            <div className="p-5 flex flex-wrap items-start justify-between gap-4">
              <div className="flex-1 min-w-[240px]">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-bold">وضع المشروع: {status.label}</h2>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${LEVEL_STYLE[status.level].chip}`}>من قياس فعلي فقط</span>
                </div>
                <ul className="mt-3 space-y-1.5 text-sm text-white/95">
                  {status.reasons.map((r, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-0.5">•</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-white/10 border border-white/25 rounded-2xl px-4 py-3 max-w-xs text-xs leading-relaxed">
                <div className="font-bold mb-1">الخطوة التالية</div>
                <div>{status.action}</div>
              </div>
            </div>
          </div>

          {/* 2. Official measured resources */}
          <Section>
            <SectionHead color="bg-gradient-to-l from-indigo-800 to-indigo-700" title="الموارد المقاسة رسميًا" tag="قياس رسمي من Supabase" />
            <div className="p-5">
              {rows.length === 0 && edge === null && (
                <div className="text-sm text-text-secondary">لا توجد موارد قابلة للقياس من الواجهة الحالية — تُعرَض التفاصيل في القسم الفني بالأسفل.</div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {db && (() => {
                  const pct = pctOf(db.usedBytes, db.limitBytes)
                  const s = RES_STATUS[db.status]
                  return (
                    <div className="border border-border rounded-2xl p-4">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-bold text-text">قاعدة البيانات</div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${DATA_KIND_CLS.official}`}>{DATA_KIND_LABEL.official}</span>
                      </div>
                      <div className="mt-3 text-3xl font-bold text-text" dir="ltr">
                        {formatBytes(db.usedBytes)}
                        <span className="text-xs font-normal text-text-secondary ml-2">من {db.limitLabel}</span>
                      </div>
                      <div className="mt-2 text-xs text-text-secondary">{db.description}</div>
                      <div className="mt-3 flex items-center gap-2">
                        <div className="flex-1 h-2 bg-surface rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${s.bar}`} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
                        </div>
                        <span className="text-[11px] text-text-secondary whitespace-nowrap">{pct.toFixed(1)}%</span>
                      </div>
                    </div>
                  )
                })()}
                {storage && (() => {
                  const pct = pctOf(storage.usedBytes, storage.limitBytes)
                  const s = RES_STATUS[storage.status]
                  return (
                    <div className="border border-border rounded-2xl p-4">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-bold text-text">التخزين (ملفات وصور)</div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${DATA_KIND_CLS.official}`}>{DATA_KIND_LABEL.official}</span>
                      </div>
                      <div className="mt-3 text-3xl font-bold text-text" dir="ltr">
                        {formatBytes(storage.usedBytes)}
                        <span className="text-xs font-normal text-text-secondary ml-2">من {storage.limitLabel}</span>
                      </div>
                      <div className="mt-2 text-xs text-text-secondary">{storage.description}</div>
                      <div className="mt-3 flex items-center gap-2">
                        <div className="flex-1 h-2 bg-surface rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${s.bar}`} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
                        </div>
                        <span className="text-[11px] text-text-secondary whitespace-nowrap">{pct.toFixed(1)}%</span>
                      </div>
                    </div>
                  )
                })()}
                {edge && (() => {
                  const pct = (edge.total / edge.limit) * 100
                  return (
                    <div className="border border-border rounded-2xl p-4">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-bold text-text">الوظائف الخادمية (استدعاءات)</div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${DATA_KIND_CLS.official}`}>{DATA_KIND_LABEL.official}</span>
                      </div>
                      <div className="mt-3 text-3xl font-bold text-text" dir="ltr">
                        {fmtCount(edge.total)}
                        <span className="text-xs font-normal text-text-secondary ml-2">من {fmtCount(edge.limit)} / شهر</span>
                      </div>
                      <div className="mt-2 text-xs text-text-secondary">
                        {edge.byFunction.length > 0 ? edge.byFunction.map((f) => `${f.slug}: ${fmtCount(f.invocations)}`).join(' — ') : ''}
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <div className="flex-1 h-2 bg-surface rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
                        </div>
                        <span className="text-[11px] text-text-secondary whitespace-nowrap">{pct.toFixed(3)}%</span>
                      </div>
                      <div className="mt-2 text-[11px] text-text-secondary leading-relaxed">
                        مقاسة من واجهة Supabase الموثقة ({edge.period}) — المتاح هو آخر 24 ساعة فقط، وليست دورة الفوترة الكاملة.
                      </div>
                    </div>
                  )
                })()}
                {counts && (
                  <div className="border border-border rounded-2xl p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-bold text-text">طلبات النظام (REST)</div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${DATA_KIND_CLS.official}`}>{DATA_KIND_LABEL.official}</span>
                    </div>
                    <div className="mt-3 text-3xl font-bold text-text" dir="ltr">
                      {fmtCount(counts.rest)}
                    </div>
                    <div className="mt-2 text-xs text-text-secondary">{counts.windowLabel} — عدد طلبات النظام.</div>
                    <div className="mt-3 flex items-center gap-2">
                      <div className="flex-1 h-2 bg-surface rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-indigo-500" style={{ width: '8%' }} />
                      </div>
                      <span className="text-[11px] text-text-secondary whitespace-nowrap">المقيس فقط</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Section>

          {/* 3. Official Egress card — never fabricated */}
          <div className="border border-amber-300 bg-amber-50 rounded-2xl p-5">
            <div className="flex flex-wrap items-start gap-3">
              <div className="text-lg">🌐</div>
              <div className="flex-1 min-w-[260px]">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-sm font-bold text-text">النقل للخارج (Egress)</h2>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${DATA_KIND_CLS.unavailable}`}>
                    {DATA_KIND_LABEL.unavailable} عبر واجهة النظام الحالية
                  </span>
                </div>
                <p className="mt-3 text-2xl font-bold text-amber-900">غير متاح عبر واجهة النظام الحالية</p>
                <p className="mt-2 text-sm font-bold text-amber-900">القيمة الرسمية متاحة من Supabase Dashboard → Usage.</p>
                <ul className="mt-2 space-y-1.5 text-xs text-amber-900/80 leading-relaxed list-disc pr-5">
                  <li>
                    أرقام الفوترة (الـEgress الفعلي، دورة الفوترة، التخزين المؤقت) تظهر فقط داخل لوحة Supabase من واجهة داخلية خاصة بجلسة المتصفح
                    (app.supabase.com/api/platform/...)، وليست جزءًا من واجهة Management API العامة التي نستخدمها بأمان من الخادم.
                  </li>
                  <li>
                    استخدام بيانات جلسة المتصفح أو الرموز الخاصة محظور وفقًا لسياسة الأمان هنا — لذلك لا نعرض رقمًا تقديريًا كأنه الاستهلاك الرسمي.
                  </li>
                </ul>
                <p className="mt-2 text-[11px] text-amber-800 leading-relaxed">
                  إذا وفّرت Supabase قيمة Egress رسمية عبر واجهة موثقة في المستقبل، ستظهر هنا تلقائيًا. حد الخطة المجانية الموثق: 5 GB نقل خارجي غير مخزّن +
                  5 GB من التخزين المؤقت.
                </p>
              </div>
            </div>
          </div>

          {/* 4. المتبقي من الحدود */}
          <Section>
            <SectionHead color="bg-gradient-to-l from-emerald-700 to-emerald-600" title="المتبقي من الحدود" />
            <div className="p-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {db && (
                  <div className="border border-emerald-200 bg-emerald-50/40 rounded-2xl p-4">
                    <div className="text-xs text-emerald-700">المتبقي من قاعدة البيانات</div>
                    <div className="mt-1 text-2xl font-bold text-emerald-800" dir="ltr">
                      {formatBytes(remOf(db))} <span className="text-xs font-normal">من أصل {db.limitLabel}</span>
                    </div>
                    <div className="text-[11px] text-emerald-700">{DATA_KIND_LABEL.official}</div>
                  </div>
                )}
                {storage && (
                  <div className="border border-emerald-200 bg-emerald-50/40 rounded-2xl p-4">
                    <div className="text-xs text-emerald-700">المتبقي من التخزين</div>
                    <div className="mt-1 text-2xl font-bold text-emerald-800" dir="ltr">
                      {formatBytes(remOf(storage))} <span className="text-xs font-normal">من أصل {storage.limitLabel}</span>
                    </div>
                    <div className="text-[11px] text-emerald-700">{DATA_KIND_LABEL.official}</div>
                  </div>
                )}
                {!db && (
                  <div className="border border-gray-200 bg-gray-50 rounded-2xl p-4">
                    <div className="text-xs text-text-secondary">المتبقي من قاعدة البيانات</div>
                    <div className="mt-1 text-xl font-bold text-text-secondary">غير متاح من الواجهة</div>
                  </div>
                )}
              </div>
              <div className="mt-4 border border-gray-200 bg-gray-50 rounded-2xl p-4">
                <div className="text-xs text-text-secondary">المتبقي من حد الـEgress</div>
                <div className="mt-1 text-xl font-bold text-text-secondary">
                  غير متاح عبر واجهة النظام الحالية — الرقم الرسمي في لوحة تحكم Supabase ⚪
                </div>
              </div>
            </div>
          </Section>

          {/* 5. مصادر استهلاك النظام */}
          <Section>
            <SectionHead color="bg-gradient-to-l from-blue-700 to-blue-600" title="مصادر استهلاك النظام" />
            <div className="p-5 space-y-5">
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <div className="text-xs font-bold text-text">النشاط المقاس لكل خدمة — {counts?.windowLabel}</div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${DATA_KIND_CLS.official}`}>{DATA_KIND_LABEL.official}</span>
                </div>
                {counts && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="border border-border rounded-xl p-3">
                      <div className="text-[11px] text-text-secondary">طلبات النظام (REST)</div>
                      <div className="text-lg font-bold text-text">{fmtCount(counts.rest)}</div>
                    </div>
                    <div className="border border-border rounded-xl p-3">
                      <div className="text-[11px] text-text-secondary">التحديث اللحظي (Realtime)</div>
                      <div className="text-lg font-bold text-text">{fmtCount(counts.realtime)}</div>
                    </div>
                    <div className="border border-border rounded-xl p-3">
                      <div className="text-[11px] text-text-secondary">المصادقة (Auth)</div>
                      <div className="text-lg font-bold text-text">{fmtCount(counts.auth)}</div>
                    </div>
                    <div className="border border-border rounded-xl p-3">
                      <div className="text-[11px] text-text-secondary">التخزين (Storage)</div>
                      <div className="text-lg font-bold text-text">{fmtCount(counts.storage)}</div>
                    </div>
                  </div>
                )}
                <p className="mt-2 text-[11px] text-text-secondary leading-relaxed">{counts?.countsNote}</p>
              </div>

              <div>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <div className="text-xs font-bold text-text">العمليات الدورية المسببة للحركة (تحليل من الكود)</div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${DATA_KIND_CLS.internal}`}>{DATA_KIND_LABEL.internal}</span>
                </div>
                <div className="space-y-3">
                  {CONSUMPTION_SOURCES.map((s) => (
                    <div key={s.id} className="border border-border rounded-2xl p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-bold text-text">{s.title}</div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${VOLUME_CLS[s.volume]}`}>التكرار: {VOLUME_LABEL[s.volume]}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${OPT_CLS[s.optimized]}`}>{OPT_LABEL[s.optimized]}</span>
                        {s.canReduce ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-amber-100 text-amber-800 border-amber-300">ما زال يمكن تقليله</span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-emerald-100 text-emerald-800 border-emerald-300">يعمل بكفاءة</span>
                        )}
                      </div>
                      <p className="mt-1.5 text-xs text-text-secondary">{s.why}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[11px] text-text-secondary leading-relaxed">
                  تحليل داخلي لنمط الطلبات في النظام — بدون أرقام وهمية. العدد الفعلي لكل عملية غير متاح عبر الواجهة الرسمية؛ راجع جدول «أكثر العمليات
                  استهلاكًا للحركة».
                </p>
              </div>

              {topEndpoints && topEndpoints.endpoints.length > 0 && (
                <div>
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <div className="text-xs font-bold text-text">النشاط الأكثر ورودًا في سجلات النظام المتاحة</div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${DATA_KIND_CLS.internal}`}>محسوب من السجلات المتاحة</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs min-w-[480px]">
                      <thead>
                        <tr className="text-text-secondary border-b border-border">
                          <th className="text-right py-2 font-semibold">الطريقة</th>
                          <th className="text-right py-2 font-semibold">الوجهة</th>
                          <th className="text-right py-2 font-semibold">العدد</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topEndpoints.endpoints.slice(0, 12).map((e, i) => (
                          <tr key={i} className="border-b border-border/60">
                            <td className="py-2 pl-2">
                              <span className="text-[10px] font-bold bg-surface text-text-secondary rounded px-1.5 py-0.5">{e.method || '—'}</span>
                            </td>
                            <td className="py-2 px-2 text-text-secondary break-all" dir="ltr">
                              {e.url}
                            </td>
                            <td className="py-2 px-2 font-bold text-text">{fmtCount(e.count)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-[11px] text-text-secondary">عدد السجلات المتاحة للتحليل في هذه اللحظة: {logsRows} — سجل فقط (تواجد محدود).</p>
                </div>
              )}
            </div>
          </Section>

          {/* 6. أكثر العمليات استهلاكًا للحركة */}
          <Section>
            <SectionHead color="bg-gradient-to-l from-rose-700 to-rose-600" title="أكثر العمليات استهلاكًا للحركة" tag="تحليل داخلي + أرقام تاريخية معلّمة" />
            <div className="p-5 overflow-x-auto">
              <table className="w-full text-xs min-w-[820px]">
                <thead>
                  <tr className="text-text-secondary border-b border-border">
                    <th className="text-right py-2 font-semibold">العملية</th>
                    <th className="text-right py-2 font-semibold">عدد الاستدعاءات</th>
                    <th className="text-right py-2 font-semibold">الفترة</th>
                    <th className="text-right py-2 font-semibold">مستوى التكرار</th>
                    <th className="text-right py-2 font-semibold">سبب الأهمية</th>
                    <th className="text-right py-2 font-semibold">الإجراء الحالي</th>
                  </tr>
                </thead>
                <tbody>
                  {hotOps.map((d) => (
                    <tr key={d.id} className="border-b border-border/60 align-top">
                      <td className="py-2.5 pl-2 font-bold text-text whitespace-nowrap">{d.operation}</td>
                      <td className="py-2.5 px-2">
                        {d.calls !== null ? (
                          <div className="font-bold text-text" dir="ltr">
                            {fmtCount(d.calls)}
                          </div>
                        ) : (
                          <div className="text-text-secondary">—</div>
                        )}
                        <div className="text-[10px] text-text-secondary leading-relaxed">{d.callsExtra}</div>
                      </td>
                      <td className="py-2.5 px-2 text-text-secondary whitespace-nowrap">
                        {d.id === 'catalog' && d.calls === null ? 'قياس سابق (7 أيام)' : d.period}
                      </td>
                      <td className="py-2.5 px-2 whitespace-nowrap">
                        <span className={`text-[10px] font-bold rounded-full border px-2 py-0.5 ${VOLUME_CLS[d.frequency]}`}>{VOLUME_LABEL[d.frequency]}</span>
                      </td>
                      <td className="py-2.5 px-2 text-text-secondary leading-relaxed">{d.why}</td>
                      <td className="py-2.5 px-2 text-text-secondary leading-relaxed">{d.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-[11px] text-text-secondary leading-relaxed">
                عدد الاستدعاءات الحالي لكل عملية غير متاح عبر الواجهة الرسمية — تُستخدم الأرقام المتاحة من السجلات فقط، أو تُوصف الحالة بأسلوب واقعي دون
                رقم. لا يُخترع أي رقم بايت لحجم الاستجابة.
              </p>
            </div>
          </Section>

          {/* 7. لماذا استُهلكت حصة المشروع القديم؟ */}
          <Section>
            <SectionHead color="bg-gradient-to-l from-slate-700 to-slate-600" title={ROOT_CAUSE.title} tag="تحليل تاريخي" />
            <div className="p-5 space-y-4">
              <div className="border border-slate-200 bg-slate-50 rounded-2xl p-4">
                <div className="text-xs font-bold text-text mb-1">السبب الرئيسي</div>
                <div className="text-lg font-bold text-slate-900">「{ROOT_CAUSE.mainCause}」</div>
              </div>
              <div className="border border-indigo-200 bg-indigo-50 rounded-2xl p-4 text-xs leading-relaxed">
                <span className="font-bold text-indigo-900">للسجل فقط: </span>
                <span className="text-indigo-900">{HISTORICAL_DISCLAIMER}</span>
              </div>
              <div>
                <div className="text-xs font-bold text-text mb-2">الأدلة من الفحص السابق</div>
                <ul className="space-y-1.5 text-xs text-text-secondary leading-relaxed">
                  {ROOT_CAUSE.evidence.map((e, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-0.5 text-slate-400">•</span>
                      <span>{e}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="border border-amber-200 bg-amber-50 rounded-2xl p-4 text-xs leading-relaxed">
                <div className="font-bold text-amber-900 mb-1">تقدير داخلي تاريخي (ليس رقمًا رسميًا)</div>
                <div className="text-amber-900">{ROOT_CAUSE.estimatedTotal}</div>
                <div className="mt-2 text-[11px] text-amber-800">{ROOT_CAUSE.label}</div>
              </div>
              <div>
                <div className="text-xs font-bold text-text mb-2">سلوكيات مساهمة إضافية</div>
                <ul className="space-y-1 text-[11px] text-text-secondary leading-relaxed">
                  {ROOT_CAUSE.additional.map((a, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-0.5 text-slate-400">•</span>
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Section>

          {/* 8. إجراءات تقليل الاستهلاك المنفذة */}
          <Section>
            <SectionHead color="bg-gradient-to-l from-teal-700 to-teal-600" title="إجراءات تقليل الاستهلاك المنفذة" tag="من تنفيذ التحسينات" />
            <div className="p-5">
              <table className="w-full text-xs min-w-[560px]">
                <thead>
                  <tr className="text-text-secondary border-b border-border">
                    <th className="text-right py-2 font-semibold">العنصر</th>
                    <th className="text-right py-2 font-semibold">ما الذي تغيّر</th>
                    <th className="text-right py-2 font-semibold">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {FIXED_ITEMS.map((f) => (
                    <tr key={f.id} className="border-b border-border/60">
                      <td className="py-2.5 pl-2 font-bold text-text">{f.item}</td>
                      <td className="py-2.5 px-2 text-text-secondary">{f.change}</td>
                      <td className="py-2.5 px-2 whitespace-nowrap">
                        <span className="text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5">{f.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-[11px] text-text-secondary leading-relaxed">
                لا نُدّعي تحقيق تخفيض بالجيجابايت لأن قياس النقل الرسمي غير متاح عبر الواجهة — التحسينات المؤكدة هي سلوكية (قلة عدد الطلبات والمزامنات) لا
                تقديرًا للحجم.
              </p>
            </div>
          </Section>

          {/* 9. إنذارات المالك */}
          <Section>
            <SectionHead
              color="bg-gradient-to-l from-red-700 to-red-600"
              title="إنذارات المالك"
              tag={alerts.length === 0 ? 'لا توجد إنذارات' : `${alerts.length} تنبيه`}
            />
            <div className="p-5 space-y-3">
              {alerts.length === 0 && <div className="text-sm text-text-secondary">لا توجد إنذارات حالية — كل الموارد المقيسة ضمن الحدود الآمنة.</div>}
              {alerts.map((a) => (
                <div key={a.id} className={`border rounded-2xl p-4 ${ALERT_CLS[a.severity]}`}>
                  <div className="text-sm font-bold text-text">{a.title}</div>
                  <p className="mt-1 text-xs text-text-secondary leading-relaxed">{a.body}</p>
                  <p className="mt-1.5 text-[11px] text-text leading-relaxed">
                    <span className="font-bold">الإجراء المقترح: </span>
                    {a.action}
                  </p>
                </div>
              ))}
            </div>
          </Section>

          {/* 10. التفاصيل الفنية (collapsed) */}
          <details className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden" dir="rtl">
            <summary className="px-5 py-3.5 text-sm font-bold text-text cursor-pointer select-none hover:bg-surface transition-colors">
              🔧 التفاصيل الفنية (للمسؤول التقني) — اضغط للعرض
            </summary>
            <div className="px-5 pb-5 space-y-4 text-[11px]">
              <div>
                <div className="font-bold text-text mb-2">متاح من الواجهة الحالية / غير متاح:</div>
                <div className="space-y-1">
                  {AVAILABILITY_MATRIX.map((a) => (
                    <div key={a.metric} className="flex items-start justify-between gap-3 border-b border-border/60 pb-1.5">
                      <span className="text-text">{a.metric}</span>
                      <span className={`text-left shrink-0 font-bold ${a.kind === 'measured' ? 'text-emerald-700' : 'text-gray-500'}`}>
                        {a.kind === 'measured' ? '🟢 مقيس' : '⚪ غير متاح'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {est && (
                <div className="border border-amber-200 bg-amber-50 rounded-2xl p-4">
                  <div className="font-bold text-amber-900 mb-1">تقدير النقل للخارج (داخلي)</div>
                  <div className="text-lg font-bold text-amber-900" dir="ltr">
                    {est.estimate_gb < 0.001 ? `${(est.estimate_gb * 1024).toFixed(1)} MB` : `≈ ${est.estimate_gb.toFixed(3)} GB`}
                  </div>
                  <p className="mt-1 text-amber-900 leading-relaxed">{est.basis}</p>
                  <p className="mt-2 text-[11px] text-amber-800 font-bold leading-relaxed">
                    يرجى الانتباه: {est.label}. فقط تقدير افتراضي لحجم الاستجابة — ليس استهلاك Supabase الرسمي ولا يُستخدم لحساب باقي الحد.
                  </p>
                </div>
              )}

              <div>
                <div className="font-bold text-text mb-2">الآليات التقنية المسببة للاستهلاك (مرجع الكود):</div>
                <div className="space-y-1.5">
                  {CONSUMPTION_SOURCES.map((s) => (
                    <div key={s.id} className="flex flex-col sm:flex-row sm:items-start gap-1 border-b border-border/60 pb-1.5">
                      <span className="font-bold text-text sm:min-w-[180px]">{s.title}</span>
                      <span className="text-text-secondary" dir="ltr">
                        {s.technical} — {s.evidence}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <p className="text-text-secondary leading-relaxed">
                الأمان: لا يصل أي مفتاح سري إلى المتصفح. الطلبات تمر عبر الوظيفة الخادمية <span dir="ltr">usage-monitor</span> التي تتحقق من جلسة المستخدم
                ودوره (الإدارة العليا) قبل جلب البيانات باسم المشروع. تُقبل الطلبات فقط من أصول مصرح بها (لا يمّا wildcard في CORS).
              </p>
            </div>
          </details>
        </>
      )}
    </div>
  )
}