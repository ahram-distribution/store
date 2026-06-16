import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort } from '../../utils/format'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const fmt = (n: number) => Number.isFinite(n) ? n.toLocaleString('en-EG') : '0'
const fmtPct = (n: number) => Number.isFinite(n) ? n.toFixed(1) + '%' : '0.0%'

function safeNum(v: unknown, fallback = 0): number {
  return typeof v === 'number' && !isNaN(v) ? v : fallback
}

function safeStr(v: unknown, fallback = 'غير متوفر'): string {
  if (v === null || v === undefined || v === '') return fallback
  return String(v)
}

function safeDate(v: unknown): string {
  if (!v) return 'غير متوفر'
  const d = new Date(v as string)
  return isNaN(d.getTime()) ? 'غير متوفر' : d.toLocaleDateString('ar-EG-u-nu-latn')
}

type SubTab = 'summary' | 'products' | 'companies' | 'visits' | 'insights'

function FilterBar({ from, to, setFrom, setTo, loading, onRefresh }: {
  from: string; to: string
  setFrom: (v: string) => void; setTo: (v: string) => void
  loading: boolean; onRefresh: () => void
}) {
  return (
    <div className="bg-white rounded-xl border border-border p-3">
      <div className="flex gap-2">
        <input type="date" value={from} onChange={e => setFrom(e.target.value)}
          className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white" />
        <input type="date" value={to} onChange={e => setTo(e.target.value)}
          className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white" />
        <button onClick={onRefresh} disabled={loading}
          className="bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50">
          {loading ? '...' : 'تحديث'}
        </button>
      </div>
    </div>
  )
}

function SummaryCards({ data }: { data: Record<string, unknown> }) {
  const stats = data.stats as Record<string, unknown> || {}
  const customer = data.customer as Record<string, unknown> || {}
  const items = [
    { label: 'إجمالي الطلبات', value: fmt(safeNum(stats.total_orders)), color: 'text-primary' },
    { label: 'إجمالي المشتريات', value: formatCurrencyShort(safeNum(stats.total_sales)), color: 'text-success' },
    { label: 'متوسط الطلب', value: formatCurrencyShort(safeNum(stats.avg_order_value)), color: 'text-accent' },
    { label: 'عدد الزيارات', value: fmt(safeNum(stats.visit_count)), color: 'text-blue-600' },
    { label: 'الزيارات الناجحة', value: fmt(safeNum(stats.successful_visits)), color: 'text-success' },
    { label: 'أيام نشطة', value: fmt(safeNum(stats.active_days)), color: 'text-text' },
  ]
  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-border p-3 space-y-1.5">
        <h3 className="text-sm font-bold text-text mb-1.5">بيانات العميل</h3>
        <div className="flex justify-between text-xs"><span className="text-text-secondary">الكود</span><span className="font-semibold">{safeStr(customer.code)}</span></div>
        <div className="flex justify-between text-xs"><span className="text-text-secondary">الهاتف</span><span className="font-semibold" dir="ltr">{safeStr(customer.phone)}</span></div>
        <div className="flex justify-between text-xs"><span className="text-text-secondary">المسؤول</span><span className="font-semibold">{safeStr(customer.responsible_name)}</span></div>
        <div className="flex justify-between text-xs"><span className="text-text-secondary">الموظف</span><span className="font-semibold">{safeStr(customer.owner_name)}</span></div>
        <div className="flex justify-between text-xs"><span className="text-text-secondary">التصنيف</span><span className="font-semibold">{safeStr(customer.tier_name)}</span></div>
        <div className="flex justify-between text-xs"><span className="text-text-secondary">آخر طلب</span><span className="font-semibold">{safeDate(stats.last_order_date)}</span></div>
        <div className="flex justify-between text-xs"><span className="text-text-secondary">آخر زيارة</span><span className="font-semibold">{safeDate(stats.last_visit_date)}</span></div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {items.map(item => (
          <div key={item.label} className="bg-white rounded-xl border border-border p-2.5 text-center">
            <div className={`text-sm font-bold ${item.color}`}>{item.value}</div>
            <div className="text-[8px] text-text-secondary mt-0.5">{item.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ProductsAnalysis({ products }: { products: Record<string, unknown>[] }) {
  const [expanded, setExpanded] = useState(false)
  const display = expanded ? products : products.slice(0, 5)
  if (!products || products.length === 0) return <div className="text-center py-6 text-text-secondary text-xs">لا توجد منتجات</div>
  return (
    <div className="bg-white rounded-xl border border-border p-3">
      <h3 className="text-sm font-bold text-text mb-2">تحليل المنتجات</h3>
      <div className="space-y-1.5">
        {display.map((p, i) => (
          <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-text truncate">{safeStr(p.product_name)}</div>
              <div className="text-[9px] text-text-secondary">{safeStr(p.company_name)} | {safeStr(p.unit_type)}</div>
            </div>
            <div className="text-right shrink-0 mr-2">
              <div className="text-xs font-bold text-primary">{formatCurrencyShort(safeNum(p.total_value))}</div>
              <div className="text-[9px] text-text-secondary">
                {fmt(safeNum(p.total_quantity))} | {fmt(safeNum(p.total_orders_count))} طلب
              </div>
            </div>
          </div>
        ))}
      </div>
      {products.length > 5 && (
        <button onClick={() => setExpanded(!expanded)}
          className="w-full text-center text-[10px] text-primary font-semibold py-1.5 mt-1">
          {expanded ? 'عرض أقل' : `عرض الكل (${products.length})`}
        </button>
      )}
    </div>
  )
}

function CompaniesAnalysis({ companies, totalValue }: { companies: Record<string, unknown>[]; totalValue: number }) {
  if (!companies || companies.length === 0) return <div className="text-center py-6 text-text-secondary text-xs">لا توجد شركات</div>
  return (
    <div className="bg-white rounded-xl border border-border p-3">
      <h3 className="text-sm font-bold text-text mb-2">تحليل الشركات</h3>
      <div className="space-y-1.5">
        {companies.map((c, i) => (
          <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] font-bold text-text-secondary w-5">{i + 1}</span>
              <div>
                <div className="text-xs font-semibold text-text truncate">{safeStr(c.company_name)}</div>
                <div className="text-[9px] text-text-secondary">{fmt(safeNum(c.orders_count))} طلبات</div>
              </div>
            </div>
            <div className="text-right shrink-0 mr-2">
              <div className="text-xs font-bold text-primary">{formatCurrencyShort(safeNum(c.total_value))}</div>
              <div className="text-[9px] text-text-secondary">{fmtPct(safeNum(c.percentage_share))} من الإجمالي</div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 pt-2 border-t border-border/30 text-[10px] text-text-secondary text-center">
        إجمالي المشتريات: {formatCurrencyShort(totalValue)}
      </div>
    </div>
  )
}

function VisitsAnalysis({ visits, stats }: { visits: Record<string, unknown>[]; stats: Record<string, unknown> }) {
  if (!visits || visits.length === 0) return <div className="text-center py-6 text-text-secondary text-xs">لا توجد زيارات</div>
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-white rounded-xl border border-border p-2.5 text-center">
          <div className="text-sm font-bold text-primary">{fmt(safeNum(stats.total_visits))}</div>
          <div className="text-[8px] text-text-secondary">إجمالي الزيارات</div>
        </div>
        <div className="bg-white rounded-xl border border-border p-2.5 text-center">
          <div className="text-sm font-bold text-success">{fmt(safeNum(stats.successful_visits))}</div>
          <div className="text-[8px] text-text-secondary">ناجحة</div>
        </div>
        <div className="bg-white rounded-xl border border-border p-2.5 text-center">
          <div className="text-sm font-bold text-accent">{fmt(safeNum(stats.avg_duration_minutes))} د</div>
          <div className="text-[8px] text-text-secondary">متوسط المدة</div>
        </div>
      </div>
      <div className="bg-white rounded-xl border border-border p-3">
        <div className="flex justify-between text-xs mb-2">
          <span className="text-text-secondary">نسبة النجاح</span>
          <span className="font-bold text-success">{fmtPct(safeNum(stats.success_rate))}</span>
        </div>
        <div className="flex justify-between text-xs mb-2">
          <span className="text-text-secondary">آخر زيارة</span>
          <span className="font-semibold">{safeDate(stats.last_visit_date)}</span>
        </div>
      </div>
      <div className="space-y-1.5 max-h-64 overflow-y-auto">
        {visits.map((v, i) => (
          <div key={i} className="bg-white rounded-lg border border-border p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-text">{safeStr(v.code)}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${v.status === 'completed' ? 'bg-success/10 text-success' : 'bg-amber-10 text-amber-600'}`}>
                {v.status === 'completed' ? 'مكتملة' : safeStr(v.status)}
              </span>
            </div>
            <div className="flex items-center justify-between mt-1 text-[10px] text-text-secondary">
              <span>{safeDate(v.check_in_at)}</span>
              {v.duration_minutes != null && <span>{fmt(safeNum(v.duration_minutes))} دقيقة</span>}
            </div>
            <div className="text-[9px] text-text-secondary mt-0.5">الموظف: {safeStr(v.employee_name)} | النتيجة: {safeStr(v.visit_result)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function InsightsPanel({ insights }: { insights: Record<string, unknown> }) {
  if (!insights || Object.keys(insights).length === 0) return <div className="text-center py-6 text-text-secondary text-xs">لا توجد بيانات كافية</div>
  return (
    <div className="bg-white rounded-xl border border-border p-3 space-y-3">
      <h3 className="text-sm font-bold text-text">تحليل سلوك العميل</h3>
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-surface rounded-lg p-2.5 text-center">
          <div className="text-lg font-bold text-accent">{insights.repeat_customer ? '🔄 نعم' : '🆕 لا'}</div>
          <div className="text-[9px] text-text-secondary">عميل متكرر</div>
        </div>
        <div className="bg-surface rounded-lg p-2.5 text-center">
          <div className="text-lg font-bold text-primary">{safeStr(insights.most_active_day as string, '-')}</div>
          <div className="text-[9px] text-text-secondary">أيام الذروة</div>
        </div>
        <div className="bg-surface rounded-lg p-2.5 text-center">
          <div className="text-sm font-bold text-text">{insights.avg_days_between_orders ? fmt(safeNum(insights.avg_days_between_orders as number)) + ' يوم' : '-'}</div>
          <div className="text-[9px] text-text-secondary">متوسط الفترة بين الطلبات</div>
        </div>
        <div className="bg-surface rounded-lg p-2.5 text-center">
          <div className={`text-sm font-bold ${insights.growth_trend === 'زيادة' ? 'text-success' : insights.growth_trend === 'انخفاض' ? 'text-danger' : 'text-text'}`}>
            {safeStr(insights.growth_trend as string, '-')}
          </div>
          <div className="text-[9px] text-text-secondary">اتجاه الشراء</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex justify-between bg-surface rounded-lg px-2.5 py-2">
          <span className="text-text-secondary">درجة الاحتفاظ</span>
          <span className="font-bold">{fmt(safeNum(insights.retention_score as number))}/5</span>
        </div>
        <div className="flex justify-between bg-surface rounded-lg px-2.5 py-2">
          <span className="text-text-secondary">أشهر النشاط</span>
          <span className="font-bold">{fmt(safeNum(insights.months_active as number))} شهر</span>
        </div>
      </div>
      <div className="text-xs">
        <div className="flex justify-between bg-surface rounded-lg px-2.5 py-2">
          <span className="text-text-secondary">معدل التكرار (أيام)</span>
          <span className="font-bold">{insights.purchase_frequency ? fmt(safeNum(insights.purchase_frequency as number)) + ' يوم' : '-'}</span>
        </div>
      </div>
    </div>
  )
}

export default function CustomerIntelligencePanel({ customerId, customerName }: { customerId: string; customerName?: string }) {
  const [activeTab, setActiveTab] = useState<SubTab>('summary')
  const [loading, setLoading] = useState(true)

  const today = new Date()
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)
  const [from, setFrom] = useState(thirtyDaysAgo.toISOString().split('T')[0])
  const [to, setTo] = useState(today.toISOString().split('T')[0])

  const [profileData, setProfileData] = useState<Record<string, unknown> | null>(null)
  const [productsData, setProductsData] = useState<Record<string, unknown>[]>([])
  const [companiesData, setCompaniesData] = useState<Record<string, unknown>[]>([])
  const [companiesTotal, setCompaniesTotal] = useState(0)
  const [visitsData, setVisitsData] = useState<Record<string, unknown>[]>([])
  const [visitsStats, setVisitsStats] = useState<Record<string, unknown>>({})
  const [insightsData, setInsightsData] = useState<Record<string, unknown> | null>(null)

  const token = getToken()

  const fetchProfile = async () => {
    if (!token || !customerId) return
    const { data, error } = await supabase.rpc('get_customer_full_profile', { p_token: token, p_customer_id: customerId, p_from: from, p_to: to })
    if (data && !error && !(data as any).error) setProfileData(data as Record<string, unknown>)
  }

  const fetchProducts = async () => {
    if (!token || !customerId) return
    const { data, error } = await supabase.rpc('get_customer_products_analysis', { p_token: token, p_customer_id: customerId, p_from: from, p_to: to })
    if (data && !error && !(data as any).error) {
      const d = data as Record<string, unknown>
      setProductsData((d.products || []) as Record<string, unknown>[])
    }
  }

  const fetchCompanies = async () => {
    if (!token || !customerId) return
    const { data, error } = await supabase.rpc('get_customer_companies_analysis', { p_token: token, p_customer_id: customerId, p_from: from, p_to: to })
    if (data && !error && !(data as any).error) {
      const d = data as Record<string, unknown>
      setCompaniesData((d.companies || []) as Record<string, unknown>[])
      setCompaniesTotal(safeNum(d.total_value))
    }
  }

  const fetchVisits = async () => {
    if (!token || !customerId) return
    const { data, error } = await supabase.rpc('get_customer_visits_analysis', { p_token: token, p_customer_id: customerId, p_from: from, p_to: to })
    if (data && !error && !(data as any).error) {
      const d = data as Record<string, unknown>
      setVisitsData((d.visits || []) as Record<string, unknown>[])
      setVisitsStats((d.stats || {}) as Record<string, unknown>)
    }
  }

  const fetchInsights = async () => {
    if (!token || !customerId) return
    const { data, error } = await supabase.rpc('get_customer_behavior_insights', { p_token: token, p_customer_id: customerId, p_from: from, p_to: to })
    if (data && !error && !(data as any).error) {
      const d = data as Record<string, unknown>
      setInsightsData((d.insights || null) as Record<string, unknown> | null)
    }
  }

  const fetchAll = async () => {
    if (!customerId) return
    setLoading(true)
    await Promise.all([fetchProfile(), fetchProducts(), fetchCompanies(), fetchVisits(), fetchInsights()])
    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [customerId])

  const subTabs = [
    { key: 'summary' as SubTab, label: 'ملخص' },
    { key: 'products' as SubTab, label: 'منتجات' },
    { key: 'companies' as SubTab, label: 'شركات' },
    { key: 'visits' as SubTab, label: 'زيارات' },
    { key: 'insights' as SubTab, label: 'سلوك' },
  ]

  return (
    <div className="space-y-3">
      <FilterBar from={from} to={to} setFrom={setFrom} setTo={setTo}
        loading={loading} onRefresh={fetchAll} />

      <div className="flex gap-1 overflow-x-auto">
        {subTabs.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`shrink-0 text-[10px] px-2.5 py-1.5 rounded-lg font-semibold transition-colors ${activeTab === t.key ? 'bg-primary text-white' : 'bg-surface text-text-secondary border border-border/50'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-8 text-text-secondary text-sm">جاري التحميل...</div>
      ) : (
        <>
          {activeTab === 'summary' && (
            <div className="space-y-3">
              {profileData && <SummaryCards data={profileData} />}
              {insightsData && <InsightsPanel insights={insightsData} />}
            </div>
          )}
          {activeTab === 'products' && <ProductsAnalysis products={productsData} />}
          {activeTab === 'companies' && <CompaniesAnalysis companies={companiesData} totalValue={companiesTotal} />}
          {activeTab === 'visits' && <VisitsAnalysis visits={visitsData} stats={visitsStats} />}
          {activeTab === 'insights' && <InsightsPanel insights={insightsData || {}} />}
        </>
      )}
    </div>
  )
}
