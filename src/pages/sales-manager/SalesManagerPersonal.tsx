import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort } from '../../utils/format'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const fmt = (n: number) => Number.isFinite(n) ? Math.round(n).toLocaleString('ar-EG-u-nu-latn') : '0'

interface PersonalSummary {
  customer_count: number; month_orders: number; month_sales: number
  today_orders: number; active_visits: number; today_visits: number
  month_visits: number; pending_collections: number
}

export default function SalesManagerPersonal() {
  const nav = useNavigate()
  const [ps, setPs] = useState<PersonalSummary | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    const token = getToken()
    if (!token) return
    const { data: result, error } = await supabase.rpc('get_sales_manager_cc', { p_token: token.trim() })
    if (error || (result && typeof result === 'object' && (result as Record<string, unknown>).error)) {
      setLoading(false); return
    }
    if (result && typeof result === 'object') {
      setPs((result as any).personal_summary ?? null)
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  if (!ps) return <div className="text-center py-12 text-text-secondary text-sm">لا توجد بيانات</div>

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-border pb-2 pt-2">
        <div className="flex items-center gap-2">
          <button onClick={() => nav('/sales-manager-cc')} className="text-xs text-primary font-semibold">→ رجوع</button>
          <h1 className="text-lg font-bold text-text">بياناتي</h1>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold text-text mb-3">ملخصي الشخصي</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card label="عملائي" value={fmt(ps.customer_count)} icon="👥" onClick={() => nav('/customers?my=1')} />
          <Card label="طلباتي (شهر)" value={fmt(ps.month_orders)} icon="📋" onClick={() => nav('/orders?my=1')} />
          <Card label="مبيعاتي (شهر)" value={formatCurrencyShort(ps.month_sales)} icon="💰" />
          <Card label="طلبات اليوم" value={fmt(ps.today_orders)} icon="📅" />
          <Card label="زياراتي (شهر)" value={fmt(ps.month_visits)} icon="📍" />
          <Card label="زيارات اليوم" value={fmt(ps.today_visits)} icon="📌" />
          <Card label="زيارات نشطة" value={fmt(ps.active_visits)} icon="🔴" onClick={() => nav('/visits?filter=active')} />
          <Card label="تحصيلات معلقة" value={formatCurrencyShort(ps.pending_collections)} icon="⏳" onClick={() => nav('/collections?filter=pending')} />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold text-text mb-3">إجراءات سريعة</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <QuickBtn label="كل العملاء" onClick={() => nav('/customers')} color="bg-primary text-white" />
          <QuickBtn label="كل الطلبات" onClick={() => nav('/orders')} color="bg-accent text-white" />
          <QuickBtn label="الزيارات" onClick={() => nav('/visits')} color="bg-surface text-text" />
          <QuickBtn label="التحصيلات" onClick={() => nav('/collections')} color="bg-surface text-text" />
          <QuickBtn label="الموظفون" onClick={() => nav('/employees')} color="bg-surface text-text" />
          <QuickBtn label="اعتماد الطلبات" onClick={() => nav('/orders/approval-queue')} color="bg-accent text-white" />
          <QuickBtn label="التقارير" onClick={() => nav('/reports')} color="bg-surface text-text" />
          <QuickBtn label="تسجيل الحضور" onClick={() => nav('/attendance/runtime')} color="bg-gradient-to-l from-blue-600 to-indigo-700 text-white" />
        </div>
      </div>
    </div>
  )
}

function Card({ label, value, icon, onClick }: { label: string; value: string; icon: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="bg-white rounded-xl border border-border p-3 text-right active:bg-surface transition-colors w-full">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">{icon}</span>
        <span className="text-[10px] text-text-secondary">{label}</span>
      </div>
      <p className="text-lg font-bold text-text">{value}</p>
    </button>
  )
}

function QuickBtn({ label, onClick, color }: { label: string; onClick: () => void; color: string }) {
  return (
    <button onClick={onClick}
      className={`${color} text-xs py-2.5 rounded-lg font-semibold border border-border/50 active:opacity-80 transition-opacity`}>
      {label}
    </button>
  )
}
