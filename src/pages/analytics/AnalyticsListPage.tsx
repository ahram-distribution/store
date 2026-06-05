import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface AnalyticsRow {
  customer_id: string
  code: string
  company_name: string
  is_active: boolean
  total_purchases: number
  order_count: number
  avg_order_value: number
  last_order_date: string | null
  days_since_last_order: number | null
  inactive_risk: boolean
  lost_customer_risk: boolean
  expected_next_order_date: string | null
  potential_revenue_score: number
  ranking: number
}

interface RankingRow {
  customer_id: string
  code: string
  company_name: string
  total_purchases: number
  order_count: number
  customer_ranking: number
  rep_customer_ranking: number
  owner_id: string
  followup_priority_score: number
  potential_revenue_score: number
}

type Tab = 'all' | 'priority' | 'inactive' | 'lost'

export function AnalyticsListPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('all')
  const [analytics, setAnalytics] = useState<AnalyticsRow[]>([])
  const [rankings, setRankings] = useState<RankingRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) return
    Promise.all([
      supabase.rpc('get_customer_analytics_list', { p_token: token }),
      supabase.rpc('get_customer_sales_ranking', { p_token: token }),
    ]).then(([a, r]) => {
      if (a.data) setAnalytics(a.data as AnalyticsRow[])
      if (r.data) setRankings(r.data as RankingRow[])
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>

  const tabs: { key: Tab; label: string }[] = [
    { key: 'all', label: 'جميع العملاء' },
    { key: 'priority', label: 'أولوية المتابعة' },
    { key: 'inactive', label: 'خاملون' },
    { key: 'lost', label: 'مفقودون' },
  ]

  const filteredAnalytics = analytics.filter(a => {
    if (tab === 'inactive') return a.inactive_risk
    if (tab === 'lost') return a.lost_customer_risk
    return true
  })

  const prioritySorted = tab === 'priority'
    ? [...rankings].sort((a, b) => b.followup_priority_score - a.followup_priority_score)
    : []

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">تحليلات العملاء</h1>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${
              tab === t.key ? 'bg-primary text-white' : 'bg-white border border-border text-text-secondary'
            }`}
          >
            {t.label}
            {t.key === 'inactive' && <span className="mr-1 text-warning">({analytics.filter(a => a.inactive_risk).length})</span>}
            {t.key === 'lost' && <span className="mr-1 text-danger">({analytics.filter(a => a.lost_customer_risk).length})</span>}
          </button>
        ))}
      </div>

      {tab === 'priority' ? (
        <div className="space-y-2">
          {prioritySorted.slice(0, 20).map((r, i) => (
            <div key={r.customer_id} onClick={() => navigate(`/customers/${r.customer_id}/analytics`)}
              className="bg-white rounded-lg border border-border p-3 cursor-pointer active:bg-surface"
            >
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-sm font-semibold text-text">{r.company_name}</span>
                  <span className="text-[10px] text-text-secondary mr-1">({r.code})</span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-danger/10 text-danger font-bold">
                  #{i + 1}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2 text-[10px] text-text-secondary">
                <div>مشتريات: <span className="text-text font-medium">{r.total_purchases?.toLocaleString()}</span></div>
                <div>أولوية: <span className="text-text font-medium">{r.followup_priority_score?.toFixed(0)}</span></div>
                <div>العائد المحتمل: <span className="text-text font-medium">{r.potential_revenue_score?.toLocaleString()}</span></div>
              </div>
            </div>
          ))}
          {prioritySorted.length === 0 && <div className="text-center py-12 text-text-secondary text-sm">لا توجد نتائج</div>}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredAnalytics.map(a => {
            const rank = rankings.find(r => r.customer_id === a.customer_id)
            return (
              <div key={a.customer_id} onClick={() => navigate(`/customers/${a.customer_id}/analytics`)}
                className="bg-white rounded-lg border border-border p-3 cursor-pointer active:bg-surface"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-sm font-semibold text-text">{a.company_name}</span>
                    <span className="text-[10px] text-text-secondary mr-1">({a.code})</span>
                  </div>
                  <div className="flex gap-1">
                    {a.inactive_risk && <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/10 text-warning">خامل</span>}
                    {a.lost_customer_risk && <span className="text-[10px] px-1.5 py-0.5 rounded bg-danger/10 text-danger">مفقود</span>}
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 mt-2 text-[10px] text-text-secondary">
                  <div>الترتيب: <span className="text-text font-medium">{a.ranking}</span></div>
                  <div>المشتريات: <span className="text-text font-medium">{a.total_purchases?.toLocaleString()}</span></div>
                  <div>الطلبات: <span className="text-text font-medium">{a.order_count}</span></div>
                  <div>المتوسط: <span className="text-text font-medium">{a.avg_order_value?.toLocaleString()}</span></div>
                </div>
                {a.expected_next_order_date && (
                  <div className="mt-1 text-[10px] text-text-secondary">
                    الطلب المتوقع: <span className="text-text font-medium">{new Date(a.expected_next_order_date).toLocaleDateString('ar-EG')}</span>
                  </div>
                )}
                <div className="flex justify-between mt-1 text-[10px] text-text-secondary">
                  <span>العائد المحتمل: <span className="text-primary font-medium">{a.potential_revenue_score?.toLocaleString()}</span></span>
                  <span>آخر طلب: {a.days_since_last_order != null ? `منذ ${a.days_since_last_order} يوم` : 'لا يوجد'}</span>
                </div>
              </div>
            )
          })}
          {filteredAnalytics.length === 0 && <div className="text-center py-12 text-text-secondary text-sm">لا توجد نتائج</div>}
        </div>
      )}
    </div>
  )
}
