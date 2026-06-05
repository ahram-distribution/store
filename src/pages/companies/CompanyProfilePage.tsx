import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort, formatDateTime } from '../../utils/format'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function CompanyProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [company, setCompany] = useState<any>(null)
  const [products, setProducts] = useState<any[]>([])
  const [analytics, setAnalytics] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    const token = getToken()
    if (!token) return

    Promise.all([
      supabase.rpc('get_governed_companies', { p_token: token }),
      supabase.rpc('get_company_products', { p_token: token, p_company_id: id }),
      supabase.rpc('get_company_analytics', { p_token: token, p_company_id: id }),
    ]).then(([compRes, prodRes, analRes]) => {
      if (compRes.data) {
        const list = Array.isArray(compRes.data) ? compRes.data : []
        setCompany(list.find((c: any) => c.id === id) || null)
      }
      if (prodRes.data) setProducts(Array.isArray(prodRes.data) ? prodRes.data : [])
      if (analRes.data) setAnalytics(analRes.data)
      setLoading(false)
    })
  }, [id])

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  if (!company) return <div className="text-center py-12 text-text-secondary text-sm">الشركة غير موجودة</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/companies')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">{company.company_name}</h1>
        {!company.is_active && <span className="text-[10px] bg-danger/10 text-danger px-2 py-0.5 rounded">غير نشط</span>}
      </div>

      {analytics && (
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-white rounded-xl border border-border p-3 text-center">
            <div className="text-lg font-bold text-primary">{analytics.total_products || 0}</div>
            <div className="text-[10px] text-text-secondary">إجمالي المنتجات</div>
          </div>
          <div className="bg-white rounded-xl border border-border p-3 text-center">
            <div className="text-lg font-bold text-success">{analytics.active_products || 0}</div>
            <div className="text-[10px] text-text-secondary">المنتجات النشطة</div>
          </div>
          <div className="bg-white rounded-xl border border-border p-3 text-center">
            <div className="text-lg font-bold text-accent">{analytics.total_order_items || 0}</div>
            <div className="text-[10px] text-text-secondary">إجمالي الطلبات</div>
          </div>
          <div className="bg-white rounded-xl border border-border p-3 text-center">
            <div className="text-lg font-bold text-success">{formatCurrencyShort(analytics.total_revenue || 0)}</div>
            <div className="text-[10px] text-text-secondary">إجمالي الإيرادات</div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold">المنتجات ({products.length})</h2>
          <button onClick={() => navigate(`/products?company=${id}`)} className="text-[10px] bg-primary/10 text-primary px-2 py-1 rounded">عرض الكل</button>
        </div>
        {products.length === 0 ? (
          <p className="text-xs text-text-secondary text-center py-4">لا توجد منتجات</p>
        ) : (
          <div className="space-y-1">
            {products.slice(0, 20).map((p: any) => (
              <div key={p.id} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-primary cursor-pointer" onClick={() => navigate(`/products/${p.id}`)}>{p.product_name}</span>
                  {!p.is_active && <span className="text-[9px] bg-danger/10 text-danger px-1.5 py-0.5 rounded">غير نشط</span>}
                </div>
                <span className="text-[10px] text-text-secondary">{p.legacy_code}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
