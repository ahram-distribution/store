import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'

function fmt(n: number | null | undefined): string {
  if (n == null) return '\u2014'
  return Math.round(n).toLocaleString('ar-EG-u-nu-latn')
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null || n === 0) return '0'
  return Math.round(n).toLocaleString('ar-EG-u-nu-latn')
}

function ProgressBar({ pct }: { pct: number }) {
  const clamped = Math.min(Math.max(pct, 0), 100)
  const color = clamped >= 80 ? 'bg-emerald-500' : clamped >= 40 ? 'bg-amber-400' : 'bg-rose-400'
  return (
    <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
      <div
        className={`h-2.5 ${color} rounded-full transition-all duration-500`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

function KpiCard({
  title,
  icon,
  achieved,
  target,
  remaining,
  percentage,
  isMoney,
}: {
  title: string
  icon: string
  achieved: number
  target: number
  remaining: number
  percentage: number
  isMoney?: boolean
}) {
  const fmtVal = isMoney ? fmtMoney : fmt
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">{icon}</span>
          <span className="font-semibold text-gray-700 text-sm">{title}</span>
        </div>
        <span
          className={`text-sm font-bold ${
            percentage >= 80 ? 'text-emerald-600' : percentage >= 40 ? 'text-amber-600' : 'text-rose-600'
          }`}
        >
          {percentage}%
        </span>
      </div>

      <ProgressBar pct={percentage} />

      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-lg font-bold text-gray-800">{fmtVal(achieved)}</div>
          <div className="text-[10px] text-gray-400">المنجز</div>
        </div>
        <div>
          <div className="text-lg font-bold text-gray-800">{fmtVal(target)}</div>
          <div className="text-[10px] text-gray-400">الهدف</div>
        </div>
        <div>
          <div className="text-lg font-bold text-gray-800">
            {remaining > 0 ? fmtVal(remaining) : '0'}
          </div>
          <div className="text-[10px] text-gray-400">المتبقي</div>
        </div>
      </div>
    </div>
  )
}

type Period = 'day' | 'yesterday' | 'week' | 'month' | 'custom'

export function SalesRepAchievement() {
  const nav = useNavigate()
  const user = useAuthStore((s) => s.user)
  const now = new Date()
  const [period, setPeriod] = useState<Period>('month')
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const eid = user?.employee_id
    if (!eid) return
    let m = month
    let y = year
    if (period === 'day' || period === 'yesterday' || period === 'week') {
      m = now.getMonth() + 1
      y = now.getFullYear()
    }
    setLoading(true)
    supabase
      .rpc('get_runtime_achievement', {
        p_employee_id: eid,
        p_month: m,
        p_year: y,
      })
      .then(({ data: d, error }) => {
        if (error) console.error(error)
        else setData(d)
      })
      .finally(() => setLoading(false))
  }, [period, month, year, user?.employee_id])

  const d = data as any
  const months = [
    { n: 1, label: 'يناير' }, { n: 2, label: 'فبراير' }, { n: 3, label: 'مارس' },
    { n: 4, label: 'أبريل' }, { n: 5, label: 'مايو' }, { n: 6, label: 'يونيو' },
    { n: 7, label: 'يوليو' }, { n: 8, label: 'أغسطس' }, { n: 9, label: 'سبتمبر' },
    { n: 10, label: 'أكتوبر' }, { n: 11, label: 'نوفمبر' }, { n: 12, label: 'ديسمبر' },
  ]

  const PERIODS: { key: Period; label: string }[] = [
    { key: 'day', label: 'اليوم' },
    { key: 'yesterday', label: 'أمس' },
    { key: 'week', label: 'الأسبوع' },
    { key: 'month', label: 'الشهر' },
    { key: 'custom', label: 'فترة مخصصة' },
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-teal-50" dir="rtl">
      <div className="max-w-2xl mx-auto p-4 space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={() => nav(-1)} className="text-sm text-emerald-600 font-semibold hover:underline">
            → رجوع
          </button>
          <h1 className="text-xl font-bold text-gray-800">ماذا حققت؟</h1>
        </div>

        <p className="text-sm text-gray-500">
          {user?.full_name || 'المندوب'} — الإنجاز مع الأهداف
        </p>

        {/* Period filter */}
        <div className="flex flex-wrap gap-2">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                period === p.key
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Month/year selectors (only for month/custom) */}
        {(period === 'month' || period === 'custom') && (
          <div className="flex gap-2 flex-wrap">
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="border border-gray-200 rounded-xl px-4 py-2 text-sm bg-white"
            >
              {months.map((m) => (
                <option key={m.n} value={m.n}>
                  {m.label}
                </option>
              ))}
            </select>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="border border-gray-200 rounded-xl px-4 py-2 text-sm bg-white"
            >
              {[2025, 2026, 2027].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        )}

        {loading && (
          <div className="text-center py-12 text-gray-400 text-sm">جاري التحميل...</div>
        )}

        {!loading && d && (
          <div className="space-y-4">
            <KpiCard
              title="المبيعات المسلمة"
              icon="💰"
              achieved={d.sales?.achieved ?? 0}
              target={d.sales?.target ?? 0}
              remaining={d.sales?.remaining ?? 0}
              percentage={d.sales?.percentage ?? 0}
              isMoney
            />
            <KpiCard
              title="الطلبات المسلمة"
              icon="📦"
              achieved={d.orders?.achieved ?? 0}
              target={d.orders?.target ?? 0}
              remaining={d.orders?.remaining ?? 0}
              percentage={d.orders?.percentage ?? 0}
            />
            <KpiCard
              title="الزيارات المكتملة"
              icon="📍"
              achieved={d.visits?.achieved ?? 0}
              target={d.visits?.target ?? 0}
              remaining={d.visits?.remaining ?? 0}
              percentage={d.visits?.percentage ?? 0}
            />
            <KpiCard
              title="العملاء المستلمين أول طلب"
              icon="👤"
              achieved={d.first_order_customers?.achieved ?? 0}
              target={d.first_order_customers?.target ?? 0}
              remaining={d.first_order_customers?.remaining ?? 0}
              percentage={d.first_order_customers?.percentage ?? 0}
            />
          </div>
        )}

        {/* ── RECONCILIATION CARD ── */}
        {!loading && d && (
          <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">🔍</span>
              <span className="font-semibold text-gray-700 text-sm">مطابقة البيانات</span>
            </div>
            {(() => {
              const ex = d.excluded_events || {}
              const items = [
                { label: 'المبيعات', achieved: d.sales?.achieved ?? 0, excluded: ex.order_delivered ?? 0, isMoney: true },
                { label: 'الطلبات', achieved: d.orders?.achieved ?? 0, excluded: ex.order_delivered ?? 0 },
                { label: 'الزيارات', achieved: d.visits?.achieved ?? 0, excluded: ex.completed_visits ?? 0 },
                { label: 'العملاء', achieved: d.first_order_customers?.achieved ?? 0, excluded: 0 },
              ]
              const hasIssues = Object.values(ex).some((v: any) => (v as number) > 0)
              const totalSalesEx = 0 // excluded sales value not available from RPC
              return (
                <div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="text-right py-1.5 text-gray-400 font-medium">المقياس</th>
                          <th className="text-center py-1.5 text-gray-400 font-medium">الإنجاز</th>
                          <th className="text-center py-1.5 text-gray-400 font-medium">المستبعد</th>
                          <th className="text-center py-1.5 text-gray-400 font-medium">الإجمالي</th>
                          <th className="text-center py-1.5 text-gray-400 font-medium">الحالة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item) => {
                          const total = item.label === 'المبيعات'
                            ? item.achieved
                            : item.achieved + item.excluded
                          const clean = item.excluded === 0
                          const fmtV = item.isMoney ? fmtMoney : fmt
                          return (
                            <tr key={item.label} className="border-b border-gray-50">
                              <td className="py-2 text-gray-700 font-medium">{item.label}</td>
                              <td className="text-center py-2 font-semibold text-gray-800">{fmtV(item.achieved)}</td>
                              <td className={`text-center py-2 font-semibold ${clean ? 'text-green-600' : 'text-red-500'}`}>
                                {item.isMoney ? fmtV(0) : fmt(item.excluded)}
                              </td>
                              <td className="text-center py-2 font-semibold text-gray-800">{fmtV(total)}</td>
                              <td className="text-center py-2">{clean ? '✅' : '🔴'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className={`mt-2 text-center text-xs font-semibold ${hasIssues ? 'text-red-500' : 'text-green-600'}`}>
                    {hasIssues ? '🔴 يوجد كسر في البيانات — يجب مراجعة السجلات المستبعدة' : '✅ البيانات سليمة — Activity = Achievement + Excluded'}
                  </div>
                </div>
              )
            })()}
          </div>
        )}

        {/* Excluded events detail */}
        {!loading && d?.excluded_events && Object.values(d.excluded_events as Record<string, number>).some((v) => v > 0) && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-amber-600 text-lg">⚠️</span>
              <span className="font-semibold text-amber-800 text-sm">تفاصيل الأحداث المستبعدة</span>
            </div>
            <div className="text-xs text-amber-700 space-y-1">
              {Object.entries(d.excluded_events)
                .filter(([_, v]) => (v as number) > 0)
                .map(([key, val]) => (
                  <div key={key} className="flex justify-between">
                    <span>{key === 'order_delivered' ? 'طلبات مسلمة بدون تاريخ تسليم' : key}</span>
                    <span className="font-bold">{fmt(val as number)}</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Source note */}
        {!loading && d && (
          <div className="text-center text-[10px] text-gray-400">
            المصدر: Runtime V2 | {d.meta?.source} | {d.meta?.month}/{d.meta?.year}
          </div>
        )}
      </div>
    </div>
  )
}
