import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort } from '../../utils/format'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const fmt = (n: number) => Number.isFinite(n) ? n.toLocaleString('en-EG') : '0'

function safeNum(v: unknown, fallback = 0): number {
  return typeof v === 'number' && !isNaN(v) ? v : fallback
}

function safeDate(v: unknown): string {
  if (!v) return 'غير متوفر'
  const d = new Date(v as string)
  return isNaN(d.getTime()) ? 'غير متوفر' : d.toLocaleDateString('ar-EG-u-nu-latn')
}

interface GeneralStats {
  customer_count: number
  order_count: number
  total_sales: number
  companies_count: number
  products_count: number
  total_pieces: number
  total_dozens: number
  total_cartons: number
}

export default function CustomerIntelligenceOverviewPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const today = new Date()
  const yearAgo = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000)
  const [from, setFrom] = useState(yearAgo.toISOString().split('T')[0])
  const [to, setTo] = useState(today.toISOString().split('T')[0])

  const fetchData = async () => {
    setLoading(true)
    const token = getToken()
    if (!token) { setLoading(false); return }
    const { data: result, error } = await supabase.rpc('get_customer_intelligence_overview', {
      p_token: token, p_from: from, p_to: to, p_search: search || null,
    })
    if (result && !error && !(result as any).error) {
      setData(result as unknown as Record<string, unknown>)
    }
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [])

  const stats = (data?.general_stats || {}) as GeneralStats
  const topCustomers = (data?.top_customers || []) as Record<string, unknown>[]
  const mostDiverse = (data?.most_diverse || []) as Record<string, unknown>[]
  const mostFrequent = (data?.most_frequent || []) as Record<string, unknown>[]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">نظرة عامة على العملاء</h1>
      </div>

      <div className="flex gap-2">
        <input type="date" value={from} onChange={e => setFrom(e.target.value)}
          className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white" />
        <input type="date" value={to} onChange={e => setTo(e.target.value)}
          className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="بحث..."
          className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white" />
        <button onClick={fetchData} disabled={loading}
          className="bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50">
          {loading ? '...' : 'تحديث'}
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : !data ? (
        <div className="text-center py-12 text-text-secondary text-sm">لا توجد بيانات</div>
      ) : (
        <>
          {/* General Stats */}
          <div className="grid grid-cols-4 gap-2">
            <div className="bg-white rounded-xl border border-border p-2.5 text-center">
              <div className="text-lg font-bold text-primary">{fmt(safeNum(stats.customer_count))}</div>
              <div className="text-[8px] text-text-secondary">عملاء</div>
            </div>
            <div className="bg-white rounded-xl border border-border p-2.5 text-center">
              <div className="text-lg font-bold text-success">{fmt(safeNum(stats.order_count))}</div>
              <div className="text-[8px] text-text-secondary">طلبات</div>
            </div>
            <div className="bg-white rounded-xl border border-border p-2.5 text-center">
              <div className="text-lg font-bold text-accent">{fmt(safeNum(stats.companies_count))}</div>
              <div className="text-[8px] text-text-secondary">شركات</div>
            </div>
            <div className="bg-white rounded-xl border border-border p-2.5 text-center">
              <div className="text-lg font-bold text-blue-600">{fmt(safeNum(stats.products_count))}</div>
              <div className="text-[8px] text-text-secondary">أصناف</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="bg-surface rounded-lg p-2 text-center">
              <div className="text-sm font-bold text-text">{fmt(safeNum(stats.total_pieces))}</div>
              <div className="text-[8px] text-text-secondary">قطعة</div>
            </div>
            <div className="bg-surface rounded-lg p-2 text-center">
              <div className="text-sm font-bold text-text">{fmt(safeNum(stats.total_dozens))}</div>
              <div className="text-[8px] text-text-secondary">دستة</div>
            </div>
            <div className="bg-surface rounded-lg p-2 text-center">
              <div className="text-sm font-bold text-text">{fmt(safeNum(stats.total_cartons))}</div>
              <div className="text-[8px] text-text-secondary">كرتونة</div>
            </div>
          </div>

          {/* Top Customers */}
          {topCustomers.length > 0 && (
            <div className="bg-white rounded-xl border border-border p-3">
              <h3 className="text-sm font-bold text-text mb-2">أعلى العملاء شراءً</h3>
              <div className="space-y-1.5">
                {topCustomers.map((c, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] font-bold text-text-secondary w-5">{i + 1}</span>
                      <button onClick={() => navigate(`/customers/${c.customer_id}`)}
                        className="text-xs font-semibold text-primary hover:underline truncate">
                        {String(c.company_name || 'غير متوفر')}
                      </button>
                    </div>
                    <div className="text-right shrink-0 mr-2">
                      <div className="text-xs font-bold">{formatCurrencyShort(safeNum(c.total_spent))}</div>
                      <div className="text-[9px] text-text-secondary">{fmt(safeNum(c.order_count))} طلبات</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Most Diverse */}
          {mostDiverse.length > 0 && (
            <div className="bg-white rounded-xl border border-border p-3">
              <h3 className="text-sm font-bold text-text mb-2">الأكثر تنوعاً في الأصناف</h3>
              <div className="space-y-1.5">
                {mostDiverse.map((c, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] font-bold text-text-secondary w-5">{i + 1}</span>
                      <button onClick={() => navigate(`/customers/${c.customer_id}`)}
                        className="text-xs font-semibold text-primary hover:underline truncate">
                        {String(c.company_name || 'غير متوفر')}
                      </button>
                    </div>
                    <div className="text-right shrink-0 mr-2 text-[10px] text-text-secondary">
                      <span className="font-bold text-text">{fmt(safeNum(c.unique_products))}</span> أصناف | {fmt(safeNum(c.unique_brands))} شركات
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Most Frequent */}
          {mostFrequent.length > 0 && (
            <div className="bg-white rounded-xl border border-border p-3">
              <h3 className="text-sm font-bold text-text mb-2">الأكثر تكراراً للشراء</h3>
              <div className="space-y-1.5">
                {mostFrequent.map((c, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] font-bold text-text-secondary w-5">{i + 1}</span>
                      <button onClick={() => navigate(`/customers/${c.customer_id}`)}
                        className="text-xs font-semibold text-primary hover:underline truncate">
                        {String(c.company_name || 'غير متوفر')}
                      </button>
                    </div>
                    <div className="text-right shrink-0 mr-2 text-[10px] text-text-secondary">
                      <span className="font-bold text-text">{fmt(safeNum(c.order_count))}</span> طلب
                      {c.avg_days_between != null && <span> | كل {fmt(safeNum(c.avg_days_between))} يوم</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
