import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort, safeFormatDateTime } from '../../utils/format'

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

interface IntelligenceData {
  summary: Record<string, unknown>
  orders: Record<string, unknown>[]
  visits: Record<string, unknown>[]
  products: Record<string, unknown>[]
  companies: Record<string, unknown>[]
  insights: Record<string, unknown>
  filter_options: Record<string, unknown>
}

function FilterBar({ from, to, setFrom, setTo, loading, onRefresh, filterOptions, activeStatus, setActiveStatus }: {
  from: string; to: string
  setFrom: (v: string) => void; setTo: (v: string) => void
  loading: boolean; onRefresh: () => void
  filterOptions: Record<string, unknown>
  activeStatus: string; setActiveStatus: (v: string) => void
}) {
  const statuses = (filterOptions?.statuses as string[]) || []
  return (
    <div className="bg-white rounded-xl border border-border p-3 space-y-2">
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
      {statuses.length > 0 && (
        <div className="flex gap-1 overflow-x-auto">
          <button onClick={() => setActiveStatus('')}
            className={`shrink-0 text-[10px] px-2 py-1 rounded-md font-semibold ${!activeStatus ? 'bg-primary text-white' : 'bg-surface text-text-secondary'}`}>
            الكل
          </button>
          {statuses.map(s => (
            <button key={s} onClick={() => setActiveStatus(s)}
              className={`shrink-0 text-[10px] px-2 py-1 rounded-md font-semibold ${activeStatus === s ? 'bg-primary text-white' : 'bg-surface text-text-secondary'}`}>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SummaryCards({ summary }: { summary: Record<string, unknown> }) {
  const items = [
    { label: 'إجمالي الطلبات', value: fmt(safeNum(summary.total_orders)), color: 'text-primary' },
    { label: 'إجمالي المشتريات', value: formatCurrencyShort(safeNum(summary.total_value)), color: 'text-success' },
    { label: 'متوسط الطلب', value: formatCurrencyShort(safeNum(summary.avg_order_value)), color: 'text-accent' },
    { label: 'عدد الزيارات', value: fmt(safeNum(summary.total_visits)), color: 'text-blue-600' },
    { label: 'أيام نشطة', value: fmt(safeNum(summary.active_days)), color: 'text-text' },
    { label: 'آخر طلب', value: safeDate(summary.last_order_date), color: 'text-text-secondary' },
  ]
  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map(item => (
        <div key={item.label} className="bg-white rounded-xl border border-border p-2.5 text-center">
          <div className={`text-sm font-bold ${item.color}`}>{item.value}</div>
          <div className="text-[8px] text-text-secondary mt-0.5">{item.label}</div>
        </div>
      ))}
    </div>
  )
}

function ProductsAnalysis({ products }: { products: Record<string, unknown>[] }) {
  const [expanded, setExpanded] = useState(false)
  const display = expanded ? products : products.slice(0, 5)
  if (products.length === 0) return null
  return (
    <div className="bg-white rounded-xl border border-border p-3">
      <h3 className="text-sm font-bold text-text mb-2">أكثر الأصناف شراءً</h3>
      <div className="space-y-1.5">
        {display.map((p, i) => (
          <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-text truncate">{safeStr(p.product_name)}</div>
              <div className="text-[9px] text-text-secondary">{safeStr(p.company_name)}</div>
            </div>
            <div className="text-right shrink-0 mr-2">
              <div className="text-xs font-bold text-primary">{formatCurrencyShort(safeNum(p.total_value))}</div>
              <div className="text-[9px] text-text-secondary">
                {fmt(safeNum(p.total_pieces))} قطعة | {fmt(safeNum(p.order_count))} طلب
              </div>
              {(safeNum(p.qty_dozen) > 0 || safeNum(p.qty_carton) > 0) && (
                <div className="text-[8px] text-text-secondary">
                  {safeNum(p.qty_piece) > 0 && `${fmt(safeNum(p.qty_piece))} قطعة `}
                  {safeNum(p.qty_dozen) > 0 && `${fmt(safeNum(p.qty_dozen))} دستة `}
                  {safeNum(p.qty_carton) > 0 && `${fmt(safeNum(p.qty_carton))} كرتونة`}
                </div>
              )}
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

function CompaniesAnalysis({ companies }: { companies: Record<string, unknown>[] }) {
  if (companies.length === 0) return null
  return (
    <div className="bg-white rounded-xl border border-border p-3">
      <h3 className="text-sm font-bold text-text mb-2">الشركات الموردة</h3>
      <div className="space-y-1.5">
        {companies.map((c, i) => (
          <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] font-bold text-text-secondary w-5">{i + 1}</span>
              <div>
                <div className="text-xs font-semibold text-text truncate">{safeStr(c.company_name)}</div>
                <div className="text-[9px] text-text-secondary">{fmt(safeNum(c.order_count))} طلبات</div>
              </div>
            </div>
            <div className="text-right shrink-0 mr-2">
              <div className="text-xs font-bold text-primary">{formatCurrencyShort(safeNum(c.total_spent))}</div>
              <div className="text-[9px] text-text-secondary">{fmtPct(safeNum(c.share_pct))} من الإجمالي</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function InsightsPanel({ insights }: { insights: Record<string, unknown> }) {
  if (!insights || Object.keys(insights).length === 0) return null
  return (
    <div className="bg-white rounded-xl border border-border p-3 space-y-3">
      <h3 className="text-sm font-bold text-text">تحليل سلوك العميل</h3>
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-surface rounded-lg p-2.5 text-center">
          <div className="text-lg font-bold text-accent">{insights.repeat_customer ? '🔄 نعم' : '🆕 لا'}</div>
          <div className="text-[9px] text-text-secondary">عميل متكرر</div>
        </div>
        <div className="bg-surface rounded-lg p-2.5 text-center">
          <div className="text-lg font-bold text-primary">{safeStr(insights.peak_day_name as string, '-')}</div>
          <div className="text-[9px] text-text-secondary">أيام الذروة</div>
        </div>
        <div className="bg-surface rounded-lg p-2.5 text-center">
          <div className="text-sm font-bold text-text">{insights.avg_days_between_orders ? fmt(safeNum(insights.avg_days_between_orders as number)) + ' يوم' : '-'}</div>
          <div className="text-[9px] text-text-secondary">متوسط الفترة بين الطلبات</div>
        </div>
        <div className="bg-surface rounded-lg p-2.5 text-center">
          <div className={`text-sm font-bold ${insights.trend === 'زيادة' ? 'text-success' : insights.trend === 'انخفاض' ? 'text-danger' : 'text-text'}`}>
            {safeStr(insights.trend as string, '-')}
          </div>
          <div className="text-[9px] text-text-secondary">اتجاه الشراء</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex justify-between bg-surface rounded-lg px-2.5 py-2">
          <span className="text-text-secondary">القيمة الشهرية</span>
          <span className="font-bold">{formatCurrencyShort(safeNum(insights.value_per_month as number))}</span>
        </div>
        <div className="flex justify-between bg-surface rounded-lg px-2.5 py-2">
          <span className="text-text-secondary">أشهر النشاط</span>
          <span className="font-bold">{fmt(safeNum(insights.total_months_active as number))} شهر</span>
        </div>
      </div>
    </div>
  )
}

function OrdersTab({ orders }: { orders: Record<string, unknown>[] }) {
  if (orders.length === 0) return <div className="text-center py-6 text-text-secondary text-xs">لا توجد طلبات</div>
  return (
    <div className="space-y-1.5 max-h-80 overflow-y-auto">
      {orders.map((o, i) => (
        <div key={i} className="bg-white rounded-lg border border-border p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-text">{safeStr(o.order_number)}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface text-text-secondary font-semibold">{safeStr(o.status)}</span>
          </div>
          <div className="flex items-center justify-between mt-1 text-[10px] text-text-secondary">
            <span>{safeDate(o.created_at)}</span>
            <span className="font-bold text-primary">{formatCurrencyShort(safeNum(o.total_amount))}</span>
          </div>
          {o.owner_name && <div className="text-[9px] text-text-secondary mt-0.5">بواسطة: {safeStr(o.owner_name)}</div>}
        </div>
      ))}
    </div>
  )
}

function VisitsTab({ visits }: { visits: Record<string, unknown>[] }) {
  if (visits.length === 0) return <div className="text-center py-6 text-text-secondary text-xs">لا توجد زيارات</div>
  return (
    <div className="space-y-1.5 max-h-80 overflow-y-auto">
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
  )
}

export default function CustomerIntelligencePanel({ customerId, customerName }: { customerId: string; customerName?: string }) {
  const [data, setData] = useState<IntelligenceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeSubTab, setActiveSubTab] = useState<'summary' | 'orders' | 'visits' | 'products' | 'companies' | 'insights'>('summary')

  const today = new Date()
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)
  const [from, setFrom] = useState(thirtyDaysAgo.toISOString().split('T')[0])
  const [to, setTo] = useState(today.toISOString().split('T')[0])
  const [activeStatus, setActiveStatus] = useState('')

  const fetchData = async () => {
    if (!customerId) return
    setLoading(true)
    const token = getToken()
    if (!token) { setLoading(false); return }
    const filters: Record<string, string> = {}
    if (activeStatus) filters.status = activeStatus
    const { data: result, error } = await supabase.rpc('get_customer_intelligence', {
      p_token: token, p_customer_id: customerId,
      p_from: from, p_to: to,
      p_filters: filters,
    })
    if (result && !error && !(result as any).error) {
      setData(result as unknown as IntelligenceData)
    }
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [customerId, activeStatus])

  const summary = data?.summary || {}
  const filterOptions = data?.filter_options || {}

  const subTabs = [
    { key: 'summary', label: 'ملخص' },
    { key: 'orders', label: `طلبات (${safeNum(summary.total_orders)})` },
    { key: 'visits', label: `زيارات (${safeNum(summary.total_visits)})` },
    { key: 'products', label: 'منتجات' },
    { key: 'companies', label: 'شركات' },
    { key: 'insights', label: 'سلوك' },
  ] as const

  return (
    <div className="space-y-3">
      <FilterBar from={from} to={to} setFrom={setFrom} setTo={setTo}
        loading={loading} onRefresh={fetchData}
        filterOptions={filterOptions}
        activeStatus={activeStatus} setActiveStatus={setActiveStatus} />

      <div className="flex gap-1 overflow-x-auto">
        {subTabs.map(t => (
          <button key={t.key} onClick={() => setActiveSubTab(t.key)}
            className={`shrink-0 text-[10px] px-2.5 py-1.5 rounded-lg font-semibold transition-colors ${activeSubTab === t.key ? 'bg-primary text-white' : 'bg-surface text-text-secondary border border-border/50'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-8 text-text-secondary text-sm">جاري التحميل...</div>
      ) : !data ? (
        <div className="text-center py-8 text-text-secondary text-sm">لا توجد بيانات</div>
      ) : (
        <>
          {activeSubTab === 'summary' && (
            <div className="space-y-3">
              <SummaryCards summary={summary} />
              <InsightsPanel insights={data.insights} />
            </div>
          )}
          {activeSubTab === 'orders' && <OrdersTab orders={data.orders} />}
          {activeSubTab === 'visits' && <VisitsTab visits={data.visits} />}
          {activeSubTab === 'products' && <ProductsAnalysis products={data.products} />}
          {activeSubTab === 'companies' && <CompaniesAnalysis companies={data.companies} />}
          {activeSubTab === 'insights' && <InsightsPanel insights={data.insights} />}
        </>
      )}
    </div>
  )
}
