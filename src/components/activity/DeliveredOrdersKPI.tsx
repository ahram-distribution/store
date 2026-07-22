import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { resolveDateRangeISO } from '../../lib/dateRange'
import { filterDelivered, deliveredTotalAmount, deliveredOrderCount } from '../../lib/deliveredOrders'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function getToken(): string | null {
  try {
    const t = localStorage.getItem('session_token')
    if (t && UUID_RE.test(t.trim())) return t.trim()
    return null
  } catch { return null }
}

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

function SkeletonCard() {
  return (
    <div className="rounded-xl p-4 text-center border border-border shadow-sm overflow-hidden bg-gradient-to-br from-gray-50 to-gray-100/60">
      <div className="text-2xl mb-1 opacity-0">_</div>
      <div className="h-6 bg-gray-200/60 rounded mx-auto w-16 animate-pulse" />
      <div className="text-[11px] h-3 bg-gray-200/60 rounded mx-auto w-20 mt-2 animate-pulse" />
    </div>
  )
}

interface DeliveredOrdersKPIProps {
  onKPIClick?: () => void
}

export function DeliveredOrdersKPI({ onKPIClick }: DeliveredOrdersKPIProps) {
  const [totals, setTotals] = useState({ amount: 0, count: 0, newCustomers: 0 })
  const [loading, setLoading] = useState(true)

  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()
  const label = MONTHS[currentMonth - 1] + ' ' + currentYear

  useEffect(() => {
    const tok = getToken()
    if (!tok) { setLoading(false); return }

    let cancelled = false

    const { from: dateFrom, to: dateTo } = resolveDateRangeISO('month')

    async function fetch() {
      if (!dateFrom || !dateTo || cancelled) return

      const rpcParams: Record<string, string> = { p_token: tok }
      rpcParams.p_date_from = dateFrom
      rpcParams.p_date_to = dateTo

      const [monthResult, firstDeliveriesResult] = await Promise.all([
        supabase.rpc('get_statistical_orders', rpcParams),
        supabase.rpc('get_customer_first_deliveries', { p_token: tok }),
      ])
      if (cancelled) return

      const { data, error } = monthResult
      if (error || !data || !Array.isArray(data)) {
        if (!cancelled) setLoading(false)
        return
      }

      const delivered = filterDelivered(data)
      const amount = deliveredTotalAmount(delivered)
      const count = deliveredOrderCount(delivered)

      // Compute new customers from lightweight first-deliveries data
      let newCustomers = 0
      const fd = firstDeliveriesResult.data
      if (firstDeliveriesResult.error) {
        console.error('get_customer_first_deliveries failed:', firstDeliveriesResult.error)
      } else if (fd && Array.isArray(fd)) {
        for (const row of fd) {
          const d = row.first_delivery_at as string
          if (d && d >= dateFrom && d < dateTo) newCustomers++
        }
      }

      if (!cancelled) {
        setTotals({ amount, count, newCustomers })
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
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {KPIS.map((kpi, idx) => {
              const formatted = formattedValues[idx]
              return (
                <button key={kpi.label} onClick={onKPIClick} disabled={!onKPIClick} className={
                  'rounded-xl p-4 text-center border shadow-sm overflow-hidden transition-all ' +
                  (onKPIClick ? 'cursor-pointer hover:shadow-md active:scale-[0.97] ' : '') +
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
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
