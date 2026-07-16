import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import { salesRepRange, type SalesRepPeriod } from '../../lib/dateRange'

function fmt(n: number | null | undefined): string {
  if (n == null) return '\u2014'
  if (Number.isInteger(n)) return n.toLocaleString('ar-EG-u-nu-latn')
  return n.toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function SalesRepActivity() {
  const nav = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [period, setPeriod] = useState<SalesRepPeriod>('day')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [data, setData] = useState<{ sales: number; orders: number; visits: number; customers: number } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const eid = user?.employee_id
    if (!eid) return
    const tok = getToken()
    if (!tok) return
    setLoading(true)
    const { from, to } = salesRepRange(period, customFrom || undefined, customTo || undefined)
    supabase
      .rpc('get_employee_detail_data', {
        p_token: tok,
        p_employee_id: eid,
        p_from: from,
        p_to: to,
      })
      .then(({ data: d, error }) => {
        if (error) console.error(error)
        else if (d) {
          const detail = d as any
          const orders = Array.isArray(detail.orders) ? detail.orders : []
          const visits = Array.isArray(detail.visits) ? detail.visits : []
          const customers = Array.isArray(detail.customers) ? detail.customers : []
          setData({
            sales: orders.reduce((sum: number, o: any) => sum + (Number(o.total_amount) || 0), 0),
            orders: orders.length,
            visits: visits.length,
            customers: customers.length,
          })
        }
      })
      .finally(() => setLoading(false))
  }, [period, customFrom, customTo, user?.employee_id])

  const items = data
    ? [
        { label: 'المبيعات المنشأة', value: data.sales, icon: '💰', isCurrency: true },
        { label: 'الطلبات المنشأة', value: data.orders, icon: '📋' },
        { label: 'الزيارات المكتملة', value: data.visits, icon: '📍' },
        { label: 'العملاء المسجلون', value: data.customers, icon: '👤' },
      ]
    : []

  const PERIODS: { key: SalesRepPeriod; label: string }[] = [
    { key: 'day', label: 'اليوم' },
    { key: 'yesterday', label: 'أمس' },
    { key: 'week', label: 'الأسبوع' },
    { key: 'month', label: 'الشهر' },
    { key: 'custom', label: 'فترة مخصصة' },
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50" dir="rtl">
      <div className="max-w-2xl mx-auto p-4 space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={() => nav(-1)} className="text-sm text-indigo-600 font-semibold hover:underline">
            → رجوع
          </button>
          <h1 className="text-xl font-bold text-gray-800">ماذا فعلت؟</h1>
        </div>

        <p className="text-sm text-gray-500">
          {user?.full_name || 'المندوب'} — نظرة على نشاطك خلال الفترة المختارة
        </p>

        {/* Period filter */}
        <div className="flex flex-wrap gap-2">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                period === p.key
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Custom date inputs */}
        {period === 'custom' && (
          <div className="flex gap-3 items-center">
            <div>
              <label className="text-xs text-gray-500">من</label>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="block border border-gray-200 rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">إلى</label>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="block border border-gray-200 rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="text-center py-12 text-gray-400 text-sm">جاري التحميل...</div>
        )}

        {/* KPI Cards */}
        {!loading && data && (
          <div className="grid grid-cols-2 gap-4">
            {items.map((item: any) => (
              <div
                key={item.label}
                className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="text-2xl mb-2">{item.icon}</div>
                <div className="text-3xl font-bold text-gray-800 tracking-tight">
                  {fmt(item.value)}
                </div>
                <div className="text-sm text-gray-500 mt-1">{item.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
