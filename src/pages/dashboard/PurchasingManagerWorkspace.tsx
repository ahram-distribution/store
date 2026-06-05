import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function PurchasingManagerWorkspace() {
  const navigate = useNavigate()
  const [products, setProducts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    supabase.rpc('get_governed_products', { p_token: token }).then(({ data }) => {
      if (data) setProducts(Array.isArray(data) ? data : [])
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>

  const inactiveCount = products.filter(p => !p.is_active).length
  const noPrice = products.filter(p => !p.carton_price || p.carton_price <= 0).length
  const active = products.filter(p => p.is_active)

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-cyan-700 to-cyan-900 text-white rounded-xl p-5">
        <p className="text-sm opacity-90">لوحة التحكم</p>
        <h2 className="text-xl font-bold mt-1">مدير المشتريات</h2>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-xl border border-border p-4 text-right">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{active.length}</span></div>
          <span className="text-sm font-semibold text-text">منتجات نشطة</span>
        </div>
        <button onClick={() => navigate('/products?filter=inactive')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{inactiveCount}</span></div>
          <span className="text-sm font-semibold text-text">غير نشطة</span>
        </button>
        <button onClick={() => navigate('/products?filter=noprice')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-warning flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{noPrice}</span></div>
          <span className="text-sm font-semibold text-text">بلا سعر</span>
        </button>
        <div className="bg-white rounded-xl border border-border p-4 text-right">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{products.length}</span></div>
          <span className="text-sm font-semibold text-text">إجمالي المنتجات</span>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold text-text mb-3">منتجات غير نشطة ({inactiveCount})</h3>
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {products.filter(p => !p.is_active).slice(0, 5).map(p => (
            <div key={p.id} className="flex justify-between text-xs py-1 border-b border-border last:border-0">
              <span className="text-text">{p.product_name}</span>
              <span className="text-text-secondary">غير نشط</span>
            </div>
          ))}
          {inactiveCount === 0 && <p className="text-xs text-text-secondary">لا توجد منتجات غير نشطة</p>}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold text-text mb-3">إجراءات سريعة</h3>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => navigate('/products')} className="bg-primary text-white text-xs py-2.5 rounded-lg">المنتجات</button>
          <button onClick={() => navigate('/deals')} className="bg-surface text-text text-xs py-2.5 rounded-lg border border-border">العروض</button>
        </div>
      </div>
    </div>
  )
}
