import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'

type Period = 'day' | 'yesterday' | 'week' | 'month' | 'custom'

function fmt(n: number | null | undefined): string {
  if (n == null) return '\u2014'
  if (Number.isInteger(n)) return n.toLocaleString('ar-EG-u-nu-latn')
  return n.toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function SalesRepActivity() {
  const nav = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [period, setPeriod] = useState<Period>('day')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  function getRange(): { from: string; to: string } {
    const now = new Date()
    switch (period) {
      case 'day':
        return {
          from: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(),
          to: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString(),
        }
      case 'yesterday': {
        const yes = new Date(now)
        yes.setDate(yes.getDate() - 1)
        yes.setHours(0, 0, 0, 0)
        const end = new Date(now)
        end.setDate(end.getDate())
        end.setHours(0, 0, 0, 0)
        return { from: yes.toISOString(), to: end.toISOString() }
      }
      case 'week': {
        const start = new Date(now)
        start.setDate(start.getDate() - start.getDay() + 1)
        start.setHours(0, 0, 0, 0)
        const end = new Date(start)
        end.setDate(end.getDate() + 7)
        return { from: start.toISOString(), to: end.toISOString() }
      }
      case 'month':
        return {
          from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
          to: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString(),
        }
      case 'custom':
        return { from: customFrom || new Date(0).toISOString(), to: customTo || now.toISOString() }
    }
  }

  useEffect(() => {
    const eid = user?.employee_id
    if (!eid) return
    setLoading(true)
    const { from, to } = getRange()
    supabase
      .rpc('get_runtime_activity', {
        p_employee_id: eid,
        p_date_from: from,
        p_date_to: to,
      })
      .then(({ data: d, error }) => {
        if (error) console.error(error)
        else setData(d)
      })
      .finally(() => setLoading(false))
  }, [period, customFrom, customTo, user?.employee_id])

  const d = data as any
  const items = d
    ? [
        { label: 'المبيعات المنشأة', value: d.created_sales, icon: '💰', isCurrency: true },
        { label: 'الطلبات المنشأة', value: d.created_orders, icon: '📋' },
        { label: 'الزيارات المكتملة', value: d.completed_visits, icon: '📍' },
        { label: 'العملاء المسجلون', value: d.registered_customers, icon: '👤' },
      ]
    : []

  const PERIODS: { key: Period; label: string }[] = [
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
        {!loading && d && (
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

        {/* Excluded events */}
        {!loading && d?.excluded_events && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-amber-600 text-lg">⚠️</span>
              <span className="font-semibold text-amber-800 text-sm">أحداث مستبعدة</span>
            </div>
            <div className="text-xs text-amber-700 space-y-1">
              {Object.entries(d.excluded_events)
                .filter(([_, v]) => (v as number) > 0)
                .map(([key, val]) => (
                  <div key={key} className="flex justify-between">
                    <span>{key === 'order_delivered' ? 'طلبات مسلمة بدون تاريخ' : key}</span>
                    <span className="font-bold">{fmt(val as number)}</span>
                  </div>
                ))}
              {Object.values(d.excluded_events as Record<string, number>).every((v) => v === 0) && (
                <span className="text-green-700">لا توجد أحداث مستبعدة ✅</span>
              )}
            </div>
          </div>
        )}

        {/* Source of truth note */}
        {!loading && d && (
          <div className="text-center text-[10px] text-gray-400">
            المصدر: Runtime V2 — {d.meta?.source} | {d.meta?.date_from?.slice(0, 10)} →{' '}
            {d.meta?.date_to?.slice(0, 10)}
          </div>
        )}
      </div>
    </div>
  )
}
