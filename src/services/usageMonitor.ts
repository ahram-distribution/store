import { useAuthStore } from '../store/auth'

// ---------------------------------------------------------------------------
// "استهلاك Supabase" — Executive Administration usage monitor service.
//
// SECURITY: this file contains NO secrets. The Supabase Management API token,
// service-role key and GitHub PAT never reach the browser. All Management API
// calls are proxied by the server-side Edge Function `usage-monitor`, which
// re-validates the app session (validate_session) and enforces the
// Executive-Administration role before forwarding.
//
// DATA HONESTY (checked live against the current token — 2026-09-20):
//   🟢 مقيس فعليًا   — the current authorized Management API actually returns it
//   🟡 تحليل / تقدير — built from code evidence or explicit assumptions, never official
//   ⚪ غير متاح       — not exposed by the current authorized API path (404 / backend error)
//
// Verified against the full public Management API OpenAPI spec (115 paths):
// the API exposes ONLY usage.api-counts, usage.api-requests-count, logs(.all),
// metrics (Prometheus scrape) and edge functions.combined-stats. The real
// Egress / billing-cycle / MAU / realtime-usage numbers shown on the Supabase
// Dashboard come from a PRIVATE, session-only dashboard API
// (app.supabase.com/api/platform/projects/...) which rejects requests without
// a browser dashboard session ({"success":false,"message":"Endpoint not
// supported on hosted"}) and is deliberately NOT a supported server-side
// surface — using browser session credentials is out of scope.
//
// Edge-function invocation counts ARE measurable via the documented
// combined-stats endpoint (sum of request_count), and are shown as a 🟢 row.
//
// Period support (verified 2026-09-21): usage.api-counts documents only
// 15min|30min|1hr|3hr|1day|3day|7day — a 30-day period is NOT supported and is
// flagged as such, never estimated. logs.all in this project rejects
// count()/group-by and timestamp-where filters and retains very few rows, so
// per-endpoint traffic numbers come only from the aggregated visible rows
// (best-effort, labelled "محسوب من السجلات المتاحة") or are internal analysis
// from code evidence — never a fabricated per-operation count.
//
// The main owner screen shows ONLY 🟢 measured numbers. Anything ⚪ lives in
// the compact "التفاصيل الفنية" availability matrix, and anything 🟡 is
// clearly labelled as analysis/estimate — never as an actual consumption figure.
// Egress bytes are NOT measurable via the public API → no estimate is ever
// presented as consumption on the owner screen.
// ---------------------------------------------------------------------------

export const USAGE_MONITOR_FN = 'usage-monitor'

// Verified Free-plan limits (documented by Supabase; checked 2026-09-20).
export const FREE_PLAN = {
  plan: 'Free',
  verified_at: '2026-09-20',
  source: 'Supabase docs — supabase.com/pricing + docs/guides/platform',
  database_limit_bytes: 500 * 1024 * 1024, // 500 MB
  storage_limit_bytes: 1024 * 1024 * 1024, // 1 GB
  egress_uncached_limit_bytes: 5 * 1024 * 1024 * 1024, // 5 GB
  egress_cached_limit_bytes: 5 * 1024 * 1024 * 1024, // 5 GB
  edge_invocations_limit: 500_000, // شهريًا (موثق)
  realtime_max_connections: 200, // اتصال متزامن (موثق)
  mau_limit: 50_000, // مستخدم نشط شهريًا (موثق)
} as const

// ---------------------------------------------------------------------------
// Types mirrored from the actual Supabase Management API responses.
// ---------------------------------------------------------------------------

export interface UsagePoint {
  timestamp: string
  total_auth_requests: number
  total_realtime_requests: number
  total_rest_requests: number
  total_storage_requests: number
}

export interface UsageCountsSeries {
  interval: string
  points: UsagePoint[] | null
}

export interface ServiceHealth {
  name: string
  healthy: boolean
  status: string
}

export interface EndpointRow {
  n: number
  url?: string | null
  method?: string | null
}

export type UsagePeriod = '24h' | '7d' | '30d'

export interface UsagePeriodInfo {
  selected: UsagePeriod
  counts: string
  edge: string
  endpoints: string
  counts_note?: string
}

export interface UsageMonitorMeta {
  project: string
  source: string
  generated_at_utc: string
  measured: boolean
  period: UsagePeriodInfo
}

export interface ResourceSizes {
  database_size_bytes: number | null
  storage_size_bytes: number | null
}

export interface EdgeFunctionInvocation {
  id: string
  slug: string
  invocations: number
}

export interface UsageEdge {
  invocations_24h_total: number | null
  per_function: EdgeFunctionInvocation[] | null
}

export interface TopEndpointStat {
  method: string
  url: string
  count: number
}

export interface TopEndpointsInfo {
  rows: number
  endpoints: TopEndpointStat[]
}

export interface UsageMonitorPayload {
  meta: UsageMonitorMeta
  total_requests: { count?: number } | UsagePoint[] | null
  counts_by_service: UsageCountsSeries[]
  health: ServiceHealth[] | null
  top_endpoints?: TopEndpointsInfo | null
  resources: ResourceSizes
  edge?: UsageEdge
  unavailable: { egress_bytes: string; billing_cycle: string }
}

// ---------------------------------------------------------------------------
// Confidence labels.
// ---------------------------------------------------------------------------

export type Confidence = 'measured' | 'estimated' | 'unavailable'

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  measured: '🟢 مقيس فعليًا',
  estimated: '🟡 تحليل / تقدير',
  unavailable: '⚪ غير متاح من الواجهة الحالية',
}

// ---------------------------------------------------------------------------
// The three categories the owner screen must never mix:
//   official     — measured by the authorized Supabase Management API
//   internal     — the system's own traffic/behaviour analysis (never official)
//   unavailable  — not exposed by the authorized API path (Dashboard-only)
// ---------------------------------------------------------------------------

export type DataKind = 'official' | 'internal' | 'unavailable'

export const DATA_KIND_LABEL: Record<DataKind, string> = {
  official: 'قياس رسمي من Supabase',
  internal: 'تحليل داخلي للنظام',
  unavailable: 'غير متاح',
}

// Periods the owner can select. Only 24h and 7d are backed by documented
// api-counts intervals; 30d is offered so the limitation is visible, but is
// clearly flagged unsupported and never filled with fabricated data.
export const PERIODS: { id: UsagePeriod; label: string; countsAvailable: boolean; hint: string }[] = [
  { id: '24h', label: 'آخر 24 ساعة', countsAvailable: true, hint: 'عدد الطلبات لهذه الفترة فقط' },
  { id: '7d', label: 'آخر 7 أيام', countsAvailable: true, hint: 'عدد الطلبات لهذه الفترة فقط' },
  { id: '30d', label: 'آخر 30 يومًا', countsAvailable: false, hint: 'غير مدعومة من واجهة Supabase' },
]

export function periodLabel(p: UsagePeriod): string {
  return PERIODS.find((x) => x.id === p)?.label ?? p
}

// ---------------------------------------------------------------------------
// Measured resource model — the owner quota dashboard.
// Only rows whose current usage IS measurable appear here.
// ---------------------------------------------------------------------------

export type ResourceStatus = 'ok' | 'watch' | 'warning' | 'danger' | 'info'

export interface ResourceRow {
  id: string
  label: string
  description: string
  usedBytes: number
  limitBytes: number
  limitLabel: string
  status: ResourceStatus
  note: string
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || !isFinite(bytes)) return 'غير متاح'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = bytes
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u++
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`
}

function ratioStatus(used: number, limit: number): ResourceStatus {
  const r = used / Math.max(1, limit)
  if (r >= 0.9) return 'danger'
  if (r >= 0.75) return 'warning'
  if (r >= 0.5) return 'watch'
  return 'ok'
}

// Returns ONLY measured resources. If a value is not measurable the row is
// omitted entirely (it appears in the technical availability matrix instead).
export function buildResourceRows(payload: UsageMonitorPayload): ResourceRow[] {
  const db = payload.resources?.database_size_bytes
  const storage = payload.resources?.storage_size_bytes
  const rows: ResourceRow[] = []
  if (db !== null && typeof db === 'number' && isFinite(db)) {
    rows.push({
      id: 'database',
      label: 'قاعدة البيانات',
      description: 'مساحة بيانات المشروع الفعلية؛ عند تجاوز السقف يدخل وضع «القراءة فقط»',
      usedBytes: db,
      limitBytes: FREE_PLAN.database_limit_bytes,
      limitLabel: '500 MB',
      status: ratioStatus(db, FREE_PLAN.database_limit_bytes),
      note: 'سقف موثق في خطة Free',
    })
  }
  if (storage !== null && typeof storage === 'number' && isFinite(storage)) {
    rows.push({
      id: 'storage',
      label: 'التخزين (ملفات وصور)',
      description: 'حجم الملفات المخزنة (الشعارات وصور المنتجات...)',
      usedBytes: storage,
      limitBytes: FREE_PLAN.storage_limit_bytes,
      limitLabel: '1 GB',
      status: ratioStatus(storage, FREE_PLAN.storage_limit_bytes),
      note: 'سقف موثق في خطة Free',
    })
  }
  return rows
}

// ---------------------------------------------------------------------------
// Measured edge-function invocations — from the DOCUMENTED Management API
// endpoint functions.combined-stats (sum of request_count over the last 24h).
// A real 🟢 metric, presented as a count row (not bytes). null when the
// endpoint fails or the deployed function predates metric collection.
// ---------------------------------------------------------------------------

export interface EdgeInvocationMetric {
  total: number
  limit: number
  period: string
  byFunction: EdgeFunctionInvocation[]
}

export function buildEdgeInvocations(payload: UsageMonitorPayload): EdgeInvocationMetric | null {
  const total = payload.edge?.invocations_24h_total
  if (typeof total !== 'number' || !isFinite(total) || total < 0) return null
  return {
    total,
    limit: FREE_PLAN.edge_invocations_limit,
    period: 'آخر 24 ساعة فقط',
    byFunction: Array.isArray(payload.edge?.per_function) ? payload.edge.per_function : [],
  }
}

// ---------------------------------------------------------------------------
// Executive status — answers "هل المشروع في أمان؟" using MEASURED data only.
// ---------------------------------------------------------------------------

export interface ExecutiveStatus {
  level: 'safe' | 'watch' | 'warning' | 'danger'
  label: string
  reasons: string[]
  action: string
}

const LABEL_OF: Record<ExecutiveStatus['level'], string> = {
  safe: 'طبيعي',
  watch: 'تحت المراقبة',
  warning: 'تحذير',
  danger: 'خطر',
}

export function computeExecutiveStatus(payload: UsageMonitorPayload): ExecutiveStatus {
  const rows = buildResourceRows(payload)
  const rank: Record<ResourceStatus, number> = { ok: 0, info: 0, watch: 1, warning: 2, danger: 3 }
  let worst: ResourceStatus = 'ok'
  let worstRow: ResourceRow | null = null
  for (const r of rows) {
    if (rank[r.status] > rank[worst]) {
      worst = r.status
      worstRow = r
    }
  }

  const unhealthy = (payload.health || []).filter((h) => h.healthy === false)
  const reasons: string[] = []
  let level: ExecutiveStatus['level'] = 'safe'

  if (worstRow && rank[worst] >= 2) {
    const pct = ((worstRow.usedBytes / worstRow.limitBytes) * 100).toFixed(0)
    reasons.push(`${worstRow.label} تستخدم ${formatBytes(worstRow.usedBytes)} من سقف ${worstRow.limitLabel} (${pct}%).`)
  }
  if (unhealthy.length > 0) {
    reasons.push(`إحدى الخدمات غير متاحة حاليًا: ${unhealthy.map((h) => h.name).join('، ')}.`)
  }
  if (reasons.length === 0) {
    if (rows.length > 0) {
      reasons.push('المشروع يعمل داخل الحدود المقيسة (قاعدة البيانات والتخزين).')
    } else {
      reasons.push('لا توجد موارد قابلة للقياس من الواجهة الحالية — الحالة بناءً على صحة الخدمات فقط.')
    }
  }

  if (worst === 'danger') level = 'danger'
  else if (worst === 'warning') level = 'warning'
  else if (worst === 'watch') level = 'watch'
  else if (unhealthy.length > 0) level = 'warning'

  const action: Record<ExecutiveStatus['level'], string> = {
    safe: 'لا حاجة لاتخاذ إجراء الآن — الموارد المقيسة ضمن الحدود.',
    watch: 'راقب النمو؛ يمكنك تقليل البنود المذكورة في «لو عايز نقلل الاستهلاك».',
    warning: 'ننصح بالمراجعة وتقليل الاستهلاك قبل الوصول إلى السقف.',
    danger: 'إجراء عاجل: قلّل أكبر مصادر الاستهلاك أو ناقش الترقية مع المسؤول التقني.',
  }

  return { level, label: LABEL_OF[level], reasons, action: action[level] }
}

export interface AlertItem {
  id: string
  severity: 'high' | 'medium' | 'info'
  title: string
  body: string
  action: string
}

// Alerts are built ONLY from measured metrics. No assumptions.
export function buildAlerts(payload: UsageMonitorPayload): AlertItem[] {
  const alerts: AlertItem[] = []
  const rows = buildResourceRows(payload)

  const db = rows.find((r) => r.id === 'database')
  if (db) {
    const pct = (db.usedBytes / db.limitBytes) * 100
    if (pct >= 90) {
      alerts.push({
        id: 'db-danger',
        severity: 'high',
        title: 'قاعدة البيانات قاربت على الامتلاء',
        body: `تستخدم ${formatBytes(db.usedBytes)} من أصل ${db.limitLabel} (${pct.toFixed(0)}%). عند تجاوز السقف يدخل المشروع وضع «القراءة فقط».`,
        action: 'راجع أكبر الجداول مع المسؤول التقني، أو خفّض البيانات غير الضرورية.',
      })
    } else if (pct >= 75) {
      alerts.push({
        id: 'db-warning',
        severity: 'medium',
        title: 'قاعدة البيانات في مرحلة الإنذار',
        body: `تستخدم ${formatBytes(db.usedBytes)} من أصل ${db.limitLabel} (${pct.toFixed(0)}%).`,
        action: 'راقب النمو وقلّل البيانات غير الضرورية قبل الوصول إلى السقف.',
      })
    }
  }

  const st = rows.find((r) => r.id === 'storage')
  if (st) {
    const pct = (st.usedBytes / st.limitBytes) * 100
    if (pct >= 90) {
      alerts.push({
        id: 'storage-danger',
        severity: 'high',
        title: 'تخزين الملفات قارب على الامتلاء',
        body: `يستخدم ${formatBytes(st.usedBytes)} من أصل ${st.limitLabel} (${pct.toFixed(0)}%).`,
        action: 'احذف الملفات القديمة غير المستخدمة.',
      })
    } else if (pct >= 75) {
      alerts.push({
        id: 'storage-warning',
        severity: 'medium',
        title: 'تخزين الملفات في مرحلة الإنذار',
        body: `يستخدم ${formatBytes(st.usedBytes)} من أصل ${st.limitLabel} (${pct.toFixed(0)}%).`,
        action: 'راجع الملفات المخزنة وتخلص من غير الضروري.',
      })
    }
  }

  const unhealthy = (payload.health || []).filter((h) => h.healthy === false)
  for (const h of unhealthy) {
    alerts.push({
      id: 'health-' + h.name,
      severity: 'high',
      title: `خدمة غير متاحة: ${h.name}`,
      body: 'تظهر هذه الخدمة بغير السليمة في فحص المشروع الأخير.',
      action: 'أعد الفحص أو افتح لوحة Supabase للتحقق.',
    })
  }

  // Edge-function invocation growth (real combined-stats count × 30 days as an
  // explicit monthly-rate extrapolation — not an official Egress figure).
  const edge = buildEdgeInvocations(payload)
  if (edge) {
    const monthlyRatePct = ((edge.total * 30) / edge.limit) * 100
    if (monthlyRatePct >= 50) {
      alerts.push({
        id: 'edge-growth',
        severity: 'medium',
        title: 'نمو في استدعاءات الوظائف الخادمية',
        body: `${edge.total.toLocaleString('en')} استدعاء خلال آخر 24 ساعة؛ بمعدل شهري ≈ ${monthlyRatePct.toFixed(0)}% من حد ${edge.limit.toLocaleString('en')}.`,
        action: 'راقب النمو وحدد أكثر الدوال استخدامًا من التفاصيل الفنية.',
      })
    }
  }

  // Unusual API volume — real 24h count vs the 7-day daily average.
  const spike = trafficSpikeFactor(payload)
  if (spike.above) {
    alerts.push({
      id: 'traffic-spike',
      severity: 'medium',
      title: 'ارتفاع غير معتاد في حجم الطلبات',
      body: `طلبات آخر 24 ساعة بلغت ${spike.factor?.toFixed(1)}× متوسط اليوم خلال آخر 7 أيام.`,
      action: 'راجع «مصادر استهلاك النظام» لتحديد أكثر العمليات نشاطًا.',
    })
  }

  // Official Egress is Dashboard-only; the system never fabricates an alert for it.
  alerts.push({
    id: 'egress-unavailable',
    severity: 'info',
    title: 'تنبيه Egress الرسمي غير متاح داخل النظام',
    body: 'واجهة النظام المستخدمة لا تُظهر بايتات النقل للخارج الفعلية — القيمة الرسمية من Supabase Dashboard فقط.',
    action: 'لوحة تحكم Supabase → Usage لمراجعة Egress الرسمي ودورة الفوترة.',
  })

  return alerts
}

// ---------------------------------------------------------------------------
// Owner-facing consumption sources — built from code evidence (Task 1 audit).
// Volume levels are 🟡 analysis (frequency + response size), NOT a measured
// byte attribution. Per-feature measured counts are not exposed by the API.
// ---------------------------------------------------------------------------

export type VolumeLevel = 'high' | 'medium' | 'low'
export type OptState = 'optimized' | 'partial' | 'none'

export interface ConsumptionSource {
  id: string
  title: string
  why: string
  volume: VolumeLevel
  optimized: OptState
  technical: string
  evidence: string
  canReduce: boolean
  action: string
}

export const CONSUMPTION_SOURCES: ConsumptionSource[] = [
  {
    id: 'catalog',
    title: 'تحميل كتالوج المنتجات',
    why: 'يُطلب عند فتح شاشات المتجر والطلب لعرض الأصناف والأسعار',
    volume: 'high',
    optimized: 'optimized',
    technical: 'RPC: get_governed_products — مع تخزين مؤقت بالذاكرة 60 ثانية + منع الطلبات المتكررة المتزامنة',
    evidence: 'src/services/governedCatalog.ts',
    canReduce: true,
    action: 'تقسيم الكتالوج إلى صفحات/دفعات أو تقليل الحقول المرسلة يخفض الاستهلاك أكثر.',
  },
  {
    id: 'discounts',
    title: 'خيارات الخصومات والأسعار',
    why: 'تُقرأ عند تجهيز السلة والطلب',
    volume: 'high',
    optimized: 'optimized',
    technical: 'RPC: get_governed_discount_options — ذاكرة مؤقتة 60 ثانية تُحدَّث عند تغيير البيانات',
    evidence: 'src/services/discountOptions.ts',
    canReduce: true,
    action: 'دمجها ضمن استجابة الكتالوج يقلل عدد الطلبات.',
  },
  {
    id: 'company-profile',
    title: 'ملف بيانات الشركة (الستور)',
    why: 'يُقرأ عند فتح المتجر لعرض الشعار والبيانات',
    volume: 'medium',
    optimized: 'optimized',
    technical: 'RPC: get_company_profile — محفوظ محليًا (localStorage)',
    evidence: 'src/hooks/useCompanyProfile.ts',
    canReduce: false,
    action: 'يعمل بكفاءة (قراءة محلية) — لا حاجة لتقليله.',
  },
  {
    id: 'heartbeat',
    title: 'نبض الجلسة (تبقى الحساب نشطًا)',
    why: 'يُرسل دوريًا للحفاظ على الجلسة والتعرف على «يعمل الآن»',
    volume: 'high',
    optimized: 'optimized',
    technical: 'RPC: heartbeat — كل 60 ثانية، ويتوقف تمامًا عند إخفاء الشاشة',
    evidence: 'src/services/heartbeatService.ts',
    canReduce: true,
    action: 'إطالة الفاصل إلى 3-5 دقائق يقلل الطلبات لكنه يخفّض دقة «يعمل الآن».',
  },
  {
    id: 'dashboards',
    title: 'لوحات المتابعة اللحظية (المبيعات/العمليات/الحضور)',
    why: 'تستفسر دوريًا لتحديث الأرقام أمام المتابعين',
    volume: 'high',
    optimized: 'optimized',
    technical: 'RPCs: get_sales_manager_cc وغيرها — تُتوقف تلقائيًا عندما تكون الصفحة مخفية في الخلفية',
    evidence: 'src/pages/sales-manager/SalesManagerCCPage.tsx',
    canReduce: true,
    action: 'إطالة فترة التحديث على الشاشة يقلل الاستهلاك أكثر.',
  },
  {
    id: 'order-detail',
    title: 'تفاصيل الطلب (تحديث بيانات العميل)',
    why: 'أثناء فتح الطلب تتم مزامنة صامتة لبيانات العميل كل 15 ثانية',
    volume: 'medium',
    optimized: 'partial',
    technical: 'RPC: get_unified_order — يتوقف أثناء الخفاء وعند وضع التعديل',
    evidence: 'src/pages/orders/OrderDetailPage.tsx',
    canReduce: true,
    action: 'يمكن إطالة الفاصل إلى 30-60 ثانية لتقليل أكبر.',
  },
  {
    id: 'tracking',
    title: 'نقاط التتبع أثناء الزيارة',
    why: 'تُرسل أثناء تسجيل الزيارات لموقع المندوب',
    volume: 'medium',
    optimized: 'optimized',
    technical: 'يُجمَّع ويرسل على دفعات كل 30 ثانية بدلًا من كل نقطة على حدة',
    evidence: 'src/services/trackingEngine.ts',
    canReduce: false,
    action: 'يعمل بكفاءة (تجميع) — لا حاجة لتقليله.',
  },
]

// ---------------------------------------------------------------------------
// Old-project quota exhaustion — evidence-based, business language (Task 1).
// Clearly marked as analysis 🟡, NOT an official byte attribution.
// ---------------------------------------------------------------------------

export interface RootCauseCause {
  title: string
  label: string
  mainCause: string
  evidence: string[]
  estimatedTotal: string
  additional: string[]
}

export const ROOT_CAUSE: RootCauseCause = {
  title: 'لماذا استُهلكت حصة المشروع القديم؟',
  label: 'تحليل تاريخي لسبب الاستهلاك في المشروع القديم — وليس إحالة فوترة Egress رسمية من Supabase',
  mainCause: 'تحميل كتالوج المنتجات بشكل متكرر وبحجم كبير.',
  evidence: [
    '135,711 طلب REST خلال فترة 7 أيام (قياس سابق).',
    '2,649 نشاطًا لحظيًا (Realtime) خلال نفس الفترة (قياس سابق).',
    '1,408 استدعاءً لوظيفة عرض الكتالوج (get_governed_products).',
    'حجم استجابة الكتالوج يُقاس بما يقارب 2.5–3.5 MB لكل استدعاء.',
    'الاستجابة تشمل المنتجات + وحدات المنتجات (product_units) + المخزون.',
  ],
  estimatedTotal:
    'إذا طُبقت تلك الأرقام التقديرية على استدعاءات الكتالوج، تُنقل خلالها بيانات استجابة تُقدَّر بنحو 3.5–4.9 GB فقط من هذا المصدر — تقدير تاريخي داخلي.',
  additional: [
    'نبض الجلسة كل 60 ثانية.',
    'تحديث لوحات المتابعة كل 30 ثانية.',
    'استدعاءات متكررة للجلسات ورسائل النشاط.',
    'إرسال نقاط التتبع على دفعات.',
    'طلبات متكررة لبيانات الشركة والمكافآت والخصومات والكتالوج.',
  ],
}

// Explicit historical-vs-billing distinction, shown prominently on the screen.
export const HISTORICAL_DISCLAIMER =
  'هذه الأرقام تحليل تاريخي للمشروع القديم استُخلص من سجلات وقياسات سابقة، وليست إحالة فوترة Egress رسمية من Supabase — القيمة الرسمية الحالية متاحة فقط من Supabase Dashboard → Usage.'

// ---------------------------------------------------------------------------
// Task-1 fixes — owner-facing "ما الذي تم إصلاحه؟"
// ---------------------------------------------------------------------------

export interface FixedItem {
  id: string
  item: string
  change: string
  status: string
}

export const FIXED_ITEMS: FixedItem[] = [
  { id: 'catalog', item: 'تحميل كتالوج المنتجات', change: 'Cache ومشاركة البيانات بين الشاشات', status: 'تم التحسين' },
  { id: 'catalog-dedup', item: 'طلبات الكتالوج المتزامنة', change: 'منع تكرار الطلبات المتزامنة (inflight dedup)', status: 'تم التحسين' },
  { id: 'catalog-invalidate', item: 'تحديث بيانات الكتالوج', change: 'إبطال الذاكرة المؤقتة عند تغيير البيانات (mutation invalidation)', status: 'تم التحسين' },
  { id: 'discounts', item: 'خيارات الخصومات', change: 'Cache تُحدَّث عند تغير البيانات', status: 'تم التحسين' },
  { id: 'company', item: 'بيانات الشركة', change: 'Cache محلية', status: 'تم التحسين' },
  { id: 'cache-invalidate', item: 'إبطال ذواكر مؤقتة ذات صلة', change: 'إبطال ذاكرة الخصومات/الشركة عند تغيّر بياناتها', status: 'تم التحسين' },
  { id: 'heartbeat', item: 'نبض الجلسة (Heartbeat)', change: 'يتوقف عند عدم استخدام الشاشة', status: 'تم التحسين' },
  { id: 'dashboards', item: 'تحديث لوحات المتابعة', change: 'يتوقف عند وجود الشاشة في الخلفية', status: 'تم التحسين' },
  { id: 'polling-gates', item: 'مؤقتات الاستعلام', change: 'إيقاف مؤقتات الخلفية عند إخفاء/عدم التركيز (hidden-tab gates)', status: 'تم التحسين' },
  { id: 'order-detail', item: 'تحديث تفاصيل الطلب', change: 'تم تقليل التكرار/إيقافه في الخلفية', status: 'تم التحسين' },
  { id: 'session-activity', item: 'استدعاءات الجلسة والنشاط', change: 'تقليل الاستدعاءات المتكررة غير الضرورية', status: 'تم التحسين' },
  { id: 'tracking', item: 'إرسال نقاط التتبع', change: 'تحسين جودة الإرسال (تجميع)', status: 'تم التحسين' },
]

// ---------------------------------------------------------------------------
// "لو عايز نقلل الاستهلاك" — owner decision table.
// ---------------------------------------------------------------------------

export interface ReductionDecisionRow {
  id: string
  title: string
  importance: 'أساسي' | 'هام' | 'اختياري'
  volume: VolumeLevel
  why: string
  optimized: OptState
  canReduce: boolean
  action: string
}

const SOURCE = (id: string): ConsumptionSource => CONSUMPTION_SOURCES.find((s) => s.id === id)!

export const REDUCTION_DECISIONS: ReductionDecisionRow[] = [
  {
    id: 'catalog',
    title: SOURCE('catalog').title,
    importance: 'أساسي',
    volume: SOURCE('catalog').volume,
    why: 'يُطلب عند فتح شاشات المتجر والطلب',
    optimized: SOURCE('catalog').optimized,
    canReduce: true,
    action: 'نعم — تقسيم الكتالوج إلى صفحات يقلل حجم كل طلب.',
  },
  {
    id: 'discounts',
    title: SOURCE('discounts').title,
    importance: 'أساسي',
    volume: SOURCE('discounts').volume,
    why: 'تُقرأ عند تجهيز السلة والطلب',
    optimized: SOURCE('discounts').optimized,
    canReduce: true,
    action: 'نعم — دمجها مع الكتالوج يقلل عدد الطلبات.',
  },
  {
    id: 'company-profile',
    title: SOURCE('company-profile').title,
    importance: 'أساسي',
    volume: SOURCE('company-profile').volume,
    why: 'يُقرأ عند فتح المتجر للشعار والبيانات',
    optimized: SOURCE('company-profile').optimized,
    canReduce: false,
    action: 'لا — يعمل بذاكرة محلية.',
  },
  {
    id: 'heartbeat',
    title: SOURCE('heartbeat').title,
    importance: 'هام',
    volume: SOURCE('heartbeat').volume,
    why: 'يُرسل دوريًا للحفاظ على الجلسة',
    optimized: SOURCE('heartbeat').optimized,
    canReduce: true,
    action: 'نعم — إطالة الفاصل إلى 3-5 دقائق (مع دقة أقل لـ«يعمل الآن»).',
  },
  {
    id: 'dashboards',
    title: SOURCE('dashboards').title,
    importance: 'هام',
    volume: SOURCE('dashboards').volume,
    why: 'تستفسر دوريًا لتحديث الأرقام',
    optimized: SOURCE('dashboards').optimized,
    canReduce: true,
    action: 'نعم — إطالة فترة التحديث على الشاشة.',
  },
  {
    id: 'order-detail',
    title: SOURCE('order-detail').title,
    importance: 'هام',
    volume: SOURCE('order-detail').volume,
    why: 'مزامنة صامتة لبيانات العميل أثناء فتح الطلب',
    optimized: SOURCE('order-detail').optimized,
    canReduce: true,
    action: 'نعم — إطالة الفاصل إلى 30-60 ثانية.',
  },
  {
    id: 'tracking',
    title: SOURCE('tracking').title,
    importance: 'هام',
    volume: SOURCE('tracking').volume,
    why: 'يُرسل نقاط التتبع أثناء الزيارة',
    optimized: SOURCE('tracking').optimized,
    canReduce: false,
    action: 'لا — يعمل بتجميع بكفاءة.',
  },
]

// ---------------------------------------------------------------------------
// Technical availability matrix — compact, used only in "التفاصيل الفنية".
// ---------------------------------------------------------------------------

export interface AvailabilityRow {
  metric: string
  kind: 'measured' | 'unavailable'
  note: string
}

export const AVAILABILITY_MATRIX: AvailabilityRow[] = [
  { metric: 'قاعدة البيانات (الحجم بالبايت)', kind: 'measured', note: 'استعلام قراءة-فقط آمن من الخادم' },
  { metric: 'التخزين (حجم الملفات بالبايت)', kind: 'measured', note: 'استعلام قراءة-فقط آمن من الخادم' },
  { metric: 'عدد طلبات REST / Auth / Realtime / Storage', kind: 'measured', note: 'نقاط نهاية استخدام لوحة التحكم' },
  { metric: 'عدد استدعاءات Edge Functions', kind: 'measured', note: 'combined-stats الموثق — نافذة آخر 24 ساعة' },
  { metric: 'حالة الخدمات (health)', kind: 'measured', note: 'نقطة خصائص المشروع' },
  { metric: 'Egress بالبايت (النقل للخارج) ودورة الفوترة', kind: 'unavailable', note: 'تظهر فقط في لوحة تحكم Supabase (واجهة داخلية خاصة بجلسة المتصفح) — لا توجد نقطة نهاية عامة' },
  { metric: 'عدد الرسائل الفعلية في Realtime', kind: 'unavailable', note: 'لا تظهر إلا عبر لوحة تحكم Supabase (واجهة خاصة بجلسة المتصفح)' },
  { metric: 'عدد المستخدمين النشطين شهريًا (MAU)', kind: 'unavailable', note: 'لا تظهر إلا عبر لوحة تحكم Supabase (واجهة خاصة بجلسة المتصفح)' },
  { metric: 'توزيع الطلبات تفصيلًا لكل ميزة', kind: 'unavailable', note: 'سجلات logs.all لا تدعم count()/تجميع وتحتفظ بصفوف قليلة — التحليل لكل ميزة من الكود (تحليل داخلي 🟡)' },
]

// ---------------------------------------------------------------------------
// History — measured request counts only (today / last 7 days).
// ---------------------------------------------------------------------------

export function buildHistorySeries(payload: UsageMonitorPayload): { interval: string; label: string; points: UsagePoint[]; total: number }[] {
  const out: { interval: string; label: string; points: UsagePoint[]; total: number }[] = []
  for (const series of payload.counts_by_service || []) {
    if (series.interval !== '1day' && series.interval !== '7day') continue
    const pts = (series.points as UsagePoint[]).filter((p) => p && typeof p === 'object')
    const total = pts.reduce((s, p) => s + p.total_auth_requests + p.total_realtime_requests + p.total_rest_requests + p.total_storage_requests, 0)
    out.push({ interval: series.interval, label: series.interval === '1day' ? 'اليوم' : 'آخر 7 أيام', points: pts, total })
  }
  return out
}

export function summarizeCounts(payload: UsageMonitorPayload): {
  totalCount: number
  rest7d: number
  auth7d: number
  realtime7d: number
  storage7d: number
} {
  let totalCount = 0
  let rest7d = 0
  let auth7d = 0
  let realtime7d = 0
  let storage7d = 0

  if (payload.total_requests) {
    if (Array.isArray(payload.total_requests)) {
      for (const p of payload.total_requests) totalCount += p.total_rest_requests + p.total_auth_requests + p.total_realtime_requests + p.total_storage_requests
    } else if (typeof payload.total_requests.count === 'number') {
      totalCount = payload.total_requests.count
    }
  }

  const seven = payload.counts_by_service?.find((s) => s.interval === '7day')
  if (seven?.points?.length) {
    for (const p of seven.points) {
      rest7d += p.total_rest_requests
      auth7d += p.total_auth_requests
      realtime7d += p.total_realtime_requests
      storage7d += p.total_storage_requests
    }
  }

  return { totalCount, rest7d, auth7d, realtime7d, storage7d }
}

// ---------------------------------------------------------------------------
// Official service counts for the SELECTED period. The backend always returns
// both documented intervals (1day/7day); a 30-day selection is not supported
// by usage.api-counts and falls back to the latest supported window with an
// explicit note — no fabricated 30-day numbers.
// ---------------------------------------------------------------------------

export interface ServiceCounts {
  total: number
  rest: number
  auth: number
  realtime: number
  storage: number
  seriesInterval: string
  windowLabel: string
  countsNote: string
}

export function summarizeServiceCounts(payload: UsageMonitorPayload): ServiceCounts {
  const picked = payload.meta?.period?.selected ?? '24h'
  const wanted = picked === '7d' ? '7day' : '1day'
  const series = payload.counts_by_service?.find((s) => s.interval === wanted) ?? payload.counts_by_service?.[0]
  const pts = (series?.points as UsagePoint[] | null)?.filter((p) => p && typeof p === 'object') ?? []
  let rest = 0
  let auth = 0
  let realtime = 0
  let storage = 0
  for (const p of pts) {
    rest += p.total_rest_requests || 0
    auth += p.total_auth_requests || 0
    realtime += p.total_realtime_requests || 0
    storage += p.total_storage_requests || 0
  }
  const windowLabel = picked === '7d' ? 'آخر 7 أيام' : picked === '30d' ? 'آخر 7 أيام (الأحدث المدعوم)' : 'آخر 24 ساعة'
  const countsNote =
    picked === '30d'
      ? 'لا يدعم استعلام Supabase فترات 30 يومًا — تُعرض آخر 7 أيام المدعومة فقط، دون أرقام مخترعة.'
      : `قياس رسمي من Supabase (${wanted === '7day' ? 'آخر 7 أيام' : 'آخر 24 ساعة'})`
  return {
    total: rest + auth + realtime + storage,
    rest,
    auth,
    realtime,
    storage,
    seriesInterval: series?.interval ?? wanted,
    windowLabel,
    countsNote,
  }
}

// Has the 24h window already exceeded ~2× the 7-day daily average? Real data +
// arithmetic only — used to raise a "unusual traffic" alert, never an Egress one.
export function trafficSpikeFactor(payload: UsageMonitorPayload): { factor: number | null; above: boolean } {
  const seven = payload.counts_by_service?.find((s) => s.interval === '7day')
  const one = payload.counts_by_service?.find((s) => s.interval === '1day')
  const sum = (s?: UsageCountsSeries): number => {
    if (!s?.points) return 0
    let n = 0
    for (const p of s.points as UsagePoint[]) {
      n += p.total_rest_requests + p.total_auth_requests + p.total_realtime_requests + p.total_storage_requests
    }
    return n
  }
  const dailyAvg = sum(seven) / Math.max(1, 7)
  const today = sum(one)
  if (today <= 0 || dailyAvg <= 0) return { factor: null, above: false }
  const factor = today / dailyAvg
  return { factor, above: factor >= 2 && today >= 200 }
}

// ---------------------------------------------------------------------------
// "أكثر العمليات استهلاكًا للحركة" — owner table. Call counts come ONLY from
// the aggregated visible log rows when a match exists (real), the catalog row
// additionally carries the previously established 1,408 figure explicitly
// labelled as historical analysis. Nothing else invents a number.
// ---------------------------------------------------------------------------

export interface HotOpRow {
  id: string
  operation: string
  calls: number | null
  callsExtra: string
  period: string
  frequency: VolumeLevel
  why: string
  action: string
}

const OP_DEFS: {
  id: string
  operation: string
  patterns: string[]
  frequency: VolumeLevel
  why: string
  action: string
}[] = [
  {
    id: 'catalog',
    operation: 'تحميل كتالوج المنتجات',
    patterns: ['get_governed_products'],
    frequency: 'high',
    why: 'يُطلب عند فتح شاشات المتجر والطلب لعرض الأصناف والأسعار؛ عدد الاستدعاءات مرتفع وقد يساهم في زيادة نقل البيانات.',
    action: 'يعمل حاليًا بذاكرة مؤقتة (60 ثانية) ومنع التكرار المتزامن؛ تقسيم الكتالوج يقلل أكثر.',
  },
  {
    id: 'heartbeat',
    operation: 'نبض الجلسة (إبقاء الحساب نشطًا)',
    patterns: ['/rpc/heartbeat'],
    frequency: 'high',
    why: 'يُرسل دوريًا للحفاظ على الجلسة ومعرفة «يعمل الآن»؛ تكرار مرتفع وقد يساهم في زيادة نقل البيانات.',
    action: 'يتوقف تمامًا عند إخفاء الشاشة؛ إطالة الفاصل إلى 3-5 دقائق تقلل الطلبات.',
  },
  {
    id: 'dashboards',
    operation: 'لوحات المتابعة اللحظية',
    patterns: ['get_sales_manager_cc', 'manager_cc', 'dashboard'],
    frequency: 'high',
    why: 'تستفسر بشكل دوري لتحديث الأرقام أمام المتابعين؛ تكرار مرتفع وقد يساهم في زيادة نقل البيانات.',
    action: 'تتوقف تلقائيًا عند وجود الشاشة في الخلفية؛ إطالة فترة التحديث تقلل الاستهلاك.',
  },
  {
    id: 'order-detail',
    operation: 'تفاصيل الطلب (مزامنة العميل)',
    patterns: ['get_unified_order', 'unified_order'],
    frequency: 'medium',
    why: 'مزامنة صامتة لبيانات العميل أثناء فتح الطلب كل فترة قصيرة.',
    action: 'يتوقف أثناء الخفاء ووضع التعديل؛ إطالة الفاصل إلى 30-60 ثانية تقلل أكثر.',
  },
  {
    id: 'tracking',
    operation: 'نقاط تتبع المندوب',
    patterns: ['sync_tracking_points', 'tracking_points', 'tracking'],
    frequency: 'medium',
    why: 'يُرسل مواقع المندوب أثناء الزيارة؛ يُجمَّع حاليًا ويرسل على دفعات.',
    action: 'يعمل بتجميع بكفاءة — لا حاجة لتقليله حاليًا.',
  },
  {
    id: 'session',
    operation: 'التحقق من الجلسة والمصادقة',
    patterns: ['validate_session', '/auth/v1'],
    frequency: 'high',
    why: 'التحقق من جلسة المستخدم عند بدء الطلبات؛ تكرار مرتفع بشكل طبيعي.',
    action: 'يُدار محليًا مع إعادة تحقق عند الحاجة — مراقَب ولا يتطلب تخفيضًا الآن.',
  },
  {
    id: 'company-profile',
    operation: 'بيانات الشركة (الستور)',
    patterns: ['get_company_profile', 'company_profiles'],
    frequency: 'medium',
    why: 'يُقرأ عند فتح المتجر للشعار والبيانات؛ محفوظ محليًا الآن.',
    action: 'يعمل بذاكرة محلية — لا حاجة لتقليله.',
  },
  {
    id: 'bonus-config',
    operation: 'الخصومات والمكافآت والإعدادات',
    patterns: ['get_governed_bonus_config', 'get_governed_discount_options', 'discount_options'],
    frequency: 'medium',
    why: 'تُقرأ عند تجهيز السلة والطلب؛ مقروءة من ذاكرة مؤقتة تُحدَّث عند تغيير البيانات.',
    action: 'يعمل بذاكرة مؤقتة — يمكن دمجه مع الكتالوج لتقليل إضافي.',
  },
]

function logCountFor(payload: UsageMonitorPayload, patterns: string[]): { count: number; measured: boolean } {
  const eps = payload.top_endpoints?.endpoints
  if (!Array.isArray(eps) || eps.length === 0) return { count: 0, measured: false }
  let sum = 0
  for (const e of eps) {
    const u = String(e.url || '').toLowerCase()
    if (patterns.some((p) => u.includes(p))) sum += e.count
  }
  return { count: sum, measured: true }
}

export function buildHotOps(payload: UsageMonitorPayload, period: UsagePeriod): HotOpRow[] {
  return OP_DEFS.map((d) => {
    const { count, measured } = logCountFor(payload, d.patterns)
    const calls = measured && count > 0 ? count : null
    const callsExtra = !measured
      ? d.id === 'catalog'
        ? 'قياس سابق: 1,408 استدعاء (تحليل تاريخي — وليس إحالة فوترة رسمية)'
        : 'العدد الحالي غير متاح عبر الواجهة الرسمية'
      : 'محسوب من السجلات المتاحة'
    return {
      id: d.id,
      operation: d.operation,
      calls,
      callsExtra,
      period: measured ? 'من السجلات المتاحة' : '—',
      frequency: d.frequency,
      why: d.why,
      action: d.action,
    }
  })
}

// ---------------------------------------------------------------------------
// Egress — the actual number is NOT exposed by the current authorized API
// (verified live: usage.egress -> 404). The internal estimate below is used
// ONLY inside the collapsible technical section and clearly labelled
// "تقدير داخلي — ليس استهلاك Supabase الفعلي". It is NEVER presented as
// consumption on the owner screen, and never used to compute a remaining
// balance or a forecast.
// ---------------------------------------------------------------------------

export interface InternalEgressEstimate {
  estimate_gb: number
  request_basis: number
  basis: string
  disclaimer: string
  label: string
}

const AVG_PAYLOAD_MB = 0.047 // ~48 KB متوسط افتراضي ثابت — افتراض صريح 🟡

export function estimateInternalEgress(payload: UsageMonitorPayload): InternalEgressEstimate {
  const counts = summarizeCounts(payload)
  const requestBasis = counts.rest7d > 0 ? counts.rest7d : counts.totalCount
  const estimateGb = (requestBasis * AVG_PAYLOAD_MB) / 1024
  return {
    estimate_gb: estimateGb,
    request_basis: requestBasis,
    basis: `مبنى على عدد طلبات REST المقاس فعلًا (${requestBasis.toLocaleString('en')} طلب) مضروبًا في متوسط حجم استجابة افتراضي ثابت (~48 KB).`,
    disclaimer:
      'هذا رقم تقديري داخلي فقط وليس استهلاك Supabase الفعلي — الواجهة المستخدمة لا تُظهر البايتات المنقولة فعليًا، لذلك لا يمكن حساب المتبقي من حد Egress بشكل موثوق.',
    label: 'تقدير داخلي — ليس استهلاك Supabase الفعلي',
  }
}

// ---------------------------------------------------------------------------
// Invoker — calls the server-side Edge Function with the caller's own session
// token. No polling here: the page triggers it manually ("فحص الاستهلاك الآن").
// The optional period is validated server-side against documented intervals.
// ---------------------------------------------------------------------------

export async function fetchUsageMonitor(period: UsagePeriod = '24h'): Promise<UsageMonitorPayload> {
  const token = useAuthStore.getState().token
  if (!token) throw new Error('no_session')

  const baseUrl = import.meta.env.VITE_SUPABASE_URL || ''
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
  if (!baseUrl) throw new Error('no_supabase_url')

  const url = `${baseUrl.replace(/\/$/, '')}/functions/v1/${USAGE_MONITOR_FN}?period=${encodeURIComponent(period)}`
  const resp = await fetch(url, {
    headers: {
      apikey: anonKey,
      Authorization: 'Bearer ' + token,
    },
    signal: AbortSignal.timeout(25000),
  })

  if (!resp.ok) {
    const bodyText = await resp.text().catch(() => '')
    throw new Error(mapFunctionError(resp.status, bodyText))
  }

  const data = (await resp.json()) as UsageMonitorPayload
  if (!data || typeof data !== 'object' || !data.meta) {
    throw new Error('unexpected_response')
  }
  return data
}

function mapFunctionError(status: number, bodyText: string): string {
  if (status === 401 || status === 403) return 'forbidden'
  if (status === 404) return 'not_deployed'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'function_error'
  let message = ''
  try {
    const j = JSON.parse(bodyText)
    message = j?.error || j?.message || ''
  } catch {
    message = bodyText.slice(0, 200)
  }
  return message || `http_${status}`
}