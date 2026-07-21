import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { computeDateRange } from '../../lib/dateRange'

const MONTHS = ['يناير', 'فبراير', 'مارس', 'إبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']

function fmt(n: number | null | undefined): string {
  if (n == null) return '\u2014'
  if (Number.isInteger(n)) return n.toLocaleString('ar-EG-u-nu-latn')
  return n.toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function kpiFontClass(formatted: string): string {
  if (formatted === '\u2014') return 'text-xl sm:text-2xl'
  const len = formatted.length
  if (len <= 8) return 'text-xl sm:text-2xl'
  if (len <= 10) return 'text-lg sm:text-xl'
  if (len <= 12) return 'text-base sm:text-lg'
  return 'text-sm sm:text-base'
}

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

function isDelivered(o: any): boolean {
  return o.status === 'delivered' && !!o.delivered_at
}

function isInRange(iso: string, from: string, to: string): boolean {
  return iso >= from && iso < to
}

export function DeliveredOrdersKPI() {
  const [totals, setTotals] = useState({ amount: 0, count: 0, newCustomers: 0 })
  const [loading, setLoading] = useState(true)

  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()
  const label = MONTHS[currentMonth - 1] + ' ' + currentYear

  useEffect(() => {
    const tok = getToken()
    if (!tok) { setLoading(false); return }

    setLoading(true)
    let cancelled = false

    const { dateFrom, dateTo } = computeDateRange('month')

    async function fetch() {
      const { data, error } = await supabase.rpc('get_unified_orders', { p_token: tok })
      if (cancelled) return
      if (error || !data || !Array.isArray(data)) { setLoading(false); return }

      const allDelivered = data.filter(isDelivered)

      let totalAmount = 0
      let orderCount = 0
      const customerFirstDelivery = new Map<string, string>()

      for (const o of allDelivered) {
        const deliveredAt = o.delivered_at as string
        const customerId = o.customer_id as string

        if (!customerFirstDelivery.has(customerId) || deliveredAt < customerFirstDelivery.get(customerId)!) {
          customerFirstDelivery.set(customerId, deliveredAt)
        }

        if (isInRange(deliveredAt, dateFrom, dateTo)) {
          totalAmount += Number(o.total_amount) || 0
          orderCount++
        }
      }

      let newCustomerCount = 0
      for (const firstDate of customerFirstDelivery.values()) {
        if (isInRange(firstDate, dateFrom, dateTo)) {
          newCustomerCount++
        }
      }

      if (!cancelled) {
        setTotals({ amount: totalAmount, count: orderCount, newCustomers: newCustomerCount })
        setLoading(false)
      }
    }

    fetch()
    return () => { cancelled = true }
  }, [])

  const formattedValues = [
    fmt(Math.round(totals.amount)),
    fmt(totals.count),
    fmt(totals.newCustomers),
  ]

  const KPIS = [
    { label: 'إجمالي المنفذ فعلي', icon: '💰' },
    { label: 'عدد الطلبات المنفذة', icon: '📦' },
    { label: 'العملاء الجدد المنفذ لهم', icon: '👥' },
  ]

  return (
    <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
      <div className="bg-gradient-to-l from-primary to-primary-dark px-5 py-3.5 flex items-center justify-between">
        <h2 className="text-sm font-bold text-white">المنفذ فعلي</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/70">📅</span>
          <span className="text-xs text-white/90 bg-white/15 rounded-lg px-2 py-1">{label}</span>
        </div>
      </div>
      <div className="p-5">
        {loading && <div className="text-center py-6 text-text-secondary text-sm">جاري التحميل...</div>}
        {!loading && (
          <div className="grid grid-cols-3 gap-4">
            {KPIS.map((kpi, idx) => {
              const formatted = formattedValues[idx]
              return (
                <div key={kpi.label} className={
                  'rounded-xl p-4 text-center border shadow-sm overflow-hidden ' +
                  (idx === 0 ? 'bg-gradient-to-br from-emerald-50 to-green-100/60 border-emerald-200/50' :
                   idx === 1 ? 'bg-gradient-to-br from-blue-50 to-indigo-100/60 border-blue-200/50' :
                   'bg-gradient-to-br from-violet-50 to-purple-100/60 border-violet-200/50')
                }>
                  <div className="text-2xl mb-1">{kpi.icon}</div>
                  <div className={
                    kpiFontClass(formatted) + ' font-bold whitespace-nowrap ' +
                    (idx === 0 ? 'text-success' : idx === 1 ? 'text-primary' : 'text-accent')
                  }>
                    {formatted}
                  </div>
                  <div className="text-[11px] text-text-secondary mt-1 font-medium">{kpi.label}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
