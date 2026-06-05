import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function DataEntryWorkspace() {
  const navigate = useNavigate()
  const [customers, setCustomers] = useState<any[]>([])
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    Promise.all([
      supabase.rpc('get_governed_customers', { p_token: token }),
      supabase.rpc('get_governed_orders', { p_token: token }),
    ]).then(([cust, ord]) => {
      if (cust.data) setCustomers(Array.isArray(cust.data) ? cust.data : [])
      if (ord.data) setOrders(Array.isArray(ord.data) ? ord.data : [])
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>

  const todayOrders = orders.filter((o: any) => o.created_at && new Date(o.created_at).toDateString() === new Date().toDateString())
  const todayCustomers = customers.filter((c: any) => c.created_at && new Date(c.created_at).toDateString() === new Date().toDateString())

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-sky-700 to-sky-900 text-white rounded-xl p-5">
        <p className="text-sm opacity-90">لوحة التحكم</p>
        <h2 className="text-xl font-bold mt-1">إدخال بيانات</h2>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => navigate('/customers')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{todayCustomers.length}</span></div>
          <span className="text-sm font-semibold text-text">عملاء جدد اليوم</span>
        </button>
        <button onClick={() => navigate('/orders')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{todayOrders.length}</span></div>
          <span className="text-sm font-semibold text-text">طلبات اليوم</span>
        </button>
        <div className="bg-white rounded-xl border border-border p-4 text-right">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{customers.length}</span></div>
          <span className="text-sm font-semibold text-text">إجمالي العملاء</span>
        </div>
        <div className="bg-white rounded-xl border border-border p-4 text-right">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{orders.length}</span></div>
          <span className="text-sm font-semibold text-text">إجمالي الطلبات</span>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold text-text mb-3">إجراءات سريعة</h3>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => navigate('/customers/new')} className="bg-primary text-white text-xs py-2.5 rounded-lg">إضافة عميل</button>
          <button onClick={() => navigate('/orders/new')} className="bg-primary text-white text-xs py-2.5 rounded-lg">طلب جديد</button>
          <button onClick={() => navigate('/customers')} className="bg-surface text-text text-xs py-2.5 rounded-lg border border-border">العملاء</button>
          <button onClick={() => navigate('/orders')} className="bg-surface text-text text-xs py-2.5 rounded-lg border border-border">الطلبات</button>
        </div>
      </div>
    </div>
  )
}
