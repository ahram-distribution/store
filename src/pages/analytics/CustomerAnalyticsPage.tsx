import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort } from '../../utils/format'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface CustomerCard {
  customer_id: string
  code: string
  company_name: string
  is_active: boolean
  purchase_summary: {
    total_purchases: number
    order_count: number
    avg_order_value: number
    last_order_date: string | null
    first_order_date: string | null
  }
  visit_summary: {
    last_visit_date: string | null
    days_since_last_visit: number | null
    total_visits: number
  }
  credit_status: {
    current_balance: number
    credit_limit: number
    credit_utilization_pct: number
    cash_vs_credit_ratio: number
  }
  risk_indicators: {
    days_since_last_order: number | null
    inactive_risk: boolean
    lost_customer_risk: boolean
  }
  behavior: {
    avg_reorder_interval_days: number
    growth_trend_pct: number
    decline_trend_pct: number
  }
  expected_next_order_date: string | null
  potential_revenue_score: number
}

interface ProductData {
  top_products: { product_id: string; product_name: string; company_name: string; total_spent: number; total_quantity: number; last_purchase_date: string }[]
  repeated_products: { product_id: string; product_name: string; times_ordered: number; total_spent: number }[]
  stopped_products: { product_id: string; product_name: string; last_ordered_date: string; total_spent: number }[]
}

interface BrandData {
  total_spent: number
  brands: { company_id: string; company_name: string; total_spent: number; share_pct: number; trend_pct: number | null }[]
}

export function CustomerAnalyticsPage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const [card, setCard] = useState<CustomerCard | null>(null)
  const [products, setProducts] = useState<ProductData | null>(null)
  const [brands, setBrands] = useState<BrandData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token || !id) return
    Promise.all([
      supabase.rpc('get_customer_card', { p_token: token, p_customer_id: id }),
      supabase.rpc('get_customer_products', { p_token: token, p_customer_id: id }),
      supabase.rpc('get_customer_brands', { p_token: token, p_customer_id: id }),
    ]).then(([c, p, b]) => {
      if (c.data) setCard(c.data as CustomerCard)
      if (p.data) setProducts(p.data as ProductData)
      if (b.data) setBrands(b.data as BrandData)
      setLoading(false)
    })
  }, [id])

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  if (!card) return <div className="text-center py-12 text-text-secondary text-sm">لم يتم العثور على العميل</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-text-secondary text-lg">&larr;</button>
        <div>
          <h1 className="text-lg font-bold text-text">{card.company_name}</h1>
          <span className="text-[10px] text-text-secondary">({card.code})</span>
        </div>
        <span className={`mr-auto text-[10px] px-2 py-0.5 rounded ${card.is_active ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
          {card.is_active ? 'نشط' : 'غير نشط'}
        </span>
      </div>

      <Section title="ملخص المشتريات">
        <StatRow label="إجمالي المشتريات" value={card.purchase_summary.total_purchases != null ? formatCurrencyShort(card.purchase_summary.total_purchases) : ''} />
        <StatRow label="عدد الطلبات" value={card.purchase_summary.order_count?.toString()} />
        <StatRow label="متوسط قيمة الطلب" value={card.purchase_summary.avg_order_value != null ? formatCurrencyShort(card.purchase_summary.avg_order_value) : ''} />
        {card.purchase_summary.last_order_date && <StatRow label="آخر طلب" value={new Date(card.purchase_summary.last_order_date).toLocaleDateString('ar-EG-u-nu-latn')} />}
      </Section>

      <Section title="ملخص الزيارات">
        <StatRow label="إجمالي الزيارات" value={card.visit_summary.total_visits?.toString()} />
        {card.visit_summary.last_visit_date && <StatRow label="آخر زيارة" value={new Date(card.visit_summary.last_visit_date).toLocaleDateString('ar-EG-u-nu-latn')} />}
        {card.visit_summary.days_since_last_visit != null && <StatRow label="أيام منذ آخر زيارة" value={`${card.visit_summary.days_since_last_visit} يوم`} />}
      </Section>

      <Section title="الوضع الائتماني">
        <StatRow label="الرصيد الحالي" value={card.credit_status.current_balance != null ? formatCurrencyShort(card.credit_status.current_balance) : ''} />
        <StatRow label="الحد الائتماني" value={card.credit_status.credit_limit != null ? formatCurrencyShort(card.credit_status.credit_limit) : ''} />
        <StatRow label="نسبة الاستخدام" value={`${card.credit_status.credit_utilization_pct?.toFixed(1)}%`} />
      </Section>

      <Section title="مؤشرات المخاطر">
        {card.risk_indicators.days_since_last_order != null && <StatRow label="أيام منذ آخر طلب" value={`${card.risk_indicators.days_since_last_order} يوم`} />}
        <div className="flex gap-2 mt-1">
          {card.risk_indicators.inactive_risk && <span className="text-[10px] px-2 py-1 rounded bg-warning/10 text-warning">⚠ خطر الخمول</span>}
          {card.risk_indicators.lost_customer_risk && <span className="text-[10px] px-2 py-1 rounded bg-danger/10 text-danger">⛔ خطر الفقدان</span>}
        </div>
      </Section>

      <Section title="مؤشرات السلوك">
        <StatRow label="متوسط فترة إعادة الطلب" value={card.behavior.avg_reorder_interval_days ? `${card.behavior.avg_reorder_interval_days.toFixed(0)} يوم` : 'غير متاح'} />
        <StatRow label="معدل النمو" value={`${card.behavior.growth_trend_pct?.toFixed(1)}%`} valueClass={card.behavior.growth_trend_pct >= 0 ? 'text-success' : 'text-danger'} />
        {card.expected_next_order_date && <StatRow label="تاريخ الطلب المتوقع" value={new Date(card.expected_next_order_date).toLocaleDateString('ar-EG-u-nu-latn')} />}
        <StatRow label="العائد المحتمل" value={card.potential_revenue_score != null ? formatCurrencyShort(card.potential_revenue_score) : ''} valueClass="text-primary font-bold" />
      </Section>

      <Section title="المنتجات الأكثر شراءً">
        {products && products.top_products?.length > 0 ? (
          <div className="space-y-1">
            {products.top_products.map((p, i) => (
              <div key={p.product_id} className="flex justify-between text-[11px] py-1 border-b border-border last:border-0">
                <span className="text-text-secondary">{i + 1}. </span>
                <span className="text-text flex-1 mr-1"><span className="text-primary cursor-pointer" onClick={() => navigate(`/products/${p.product_id}`)}>{p.product_name}</span></span>
                <span className="text-text-secondary text-[10px]">{p.total_spent != null ? formatCurrencyShort(p.total_spent) : ''}</span>
              </div>
            ))}
          </div>
        ) : <Placeholder />}
      </Section>

      <Section title="المنتجات المتكررة">
        {products && products.repeated_products?.length > 0 ? (
          <div className="space-y-1">
            {products.repeated_products.map((p, i) => (
              <div key={p.product_id} className="flex justify-between text-[11px] py-1 border-b border-border last:border-0">
                <span className="text-text-secondary">{i + 1}. </span>
                <span className="text-text flex-1 mr-1"><span className="text-primary cursor-pointer" onClick={() => navigate(`/products/${p.product_id}`)}>{p.product_name}</span></span>
                <span className="text-text-secondary text-[10px]">{p.times_ordered} مرات</span>
              </div>
            ))}
          </div>
        ) : <Placeholder />}
      </Section>

      <Section title="المنتجات المتوقفة">
        {products && products.stopped_products?.length > 0 ? (
          <div className="space-y-1">
            {products.stopped_products.map((p, i) => (
              <div key={p.product_id} className="flex justify-between text-[11px] py-1 border-b border-border last:border-0">
                <span className="text-text-secondary">{i + 1}. </span>
                <span className="text-text flex-1 mr-1"><span className="text-primary cursor-pointer" onClick={() => navigate(`/products/${p.product_id}`)}>{p.product_name}</span></span>
                <span className="text-text-secondary text-[10px]">{p.last_ordered_date ? new Date(p.last_ordered_date).toLocaleDateString('ar-EG-u-nu-latn') : ''}</span>
              </div>
            ))}
          </div>
        ) : <Placeholder />}
      </Section>

      <Section title="العلامات التجارية">
        {brands && brands.brands?.length > 0 ? (
          <div className="space-y-2">
            {brands.brands.map(b => (
              <div key={b.company_id}>
                <div className="flex justify-between text-[11px]">
                  <span className="text-text">{b.company_name}</span>
                  <span className="text-text-secondary">{b.share_pct?.toFixed(1)}%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2 mt-1">
                  <div className="bg-primary h-2 rounded-full" style={{ width: `${Math.min(b.share_pct, 100)}%` }} />
                </div>
                {b.trend_pct != null && (
                  <span className={`text-[10px] ${b.trend_pct >= 0 ? 'text-success' : 'text-danger'}`}>
                    {b.trend_pct >= 0 ? '↑' : '↓'} {Math.abs(b.trend_pct).toFixed(1)}%
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : <Placeholder />}
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-border p-3">
      <h2 className="text-sm font-bold text-text mb-2">{title}</h2>
      {children}
    </div>
  )
}

function StatRow({ label, value, valueClass }: { label: string; value?: string; valueClass?: string }) {
  if (!value) return null
  return (
    <div className="flex justify-between text-[11px] py-0.5">
      <span className="text-text-secondary">{label}</span>
      <span className={`text-text font-medium ${valueClass || ''}`}>{value}</span>
    </div>
  )
}

function Placeholder() {
  return <div className="text-center py-4 text-text-secondary text-[10px]">لا توجد بيانات</div>
}
