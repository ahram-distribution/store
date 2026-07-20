import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort, formatDateTime } from '../../utils/format'
import { UNIT_LABELS } from '../../types/order-display'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function ProductProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [product, setProduct] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    const token = getToken()
    if (!token) { setLoading(false); return }

    supabase.rpc('get_governed_products', { p_token: token, p_active_only: false, p_visible_only: false })
      .then(({ data, error }) => {
        if (error || !data) { setLoading(false); return }
        const arr = Array.isArray(data) ? data : []
        const found = arr.find((p: any) => p.id === id) || null
        setProduct(found)
        setLoading(false)
      })
  }, [id])

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  if (!product) return <div className="text-center py-12 text-text-secondary text-sm">المنتج غير موجود</div>

  const units: any[] = product.product_units || []
  const inv = product.inventory

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/products/manage')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">{product.product_name}</h1>
        {(!product.is_active || !product.is_visible) && (!product.carton_price || Number(product.carton_price) <= 0) ? (
          <span className="text-[10px] bg-accent/10 text-accent px-2 py-0.5 rounded font-semibold">موقوف - السعر غير محدد</span>
        ) : !product.is_active ? (
          <span className="text-[10px] bg-danger/10 text-danger px-2 py-0.5 rounded font-semibold">غير نشط</span>
        ) : null}
      </div>

      {(!product.is_active || !product.is_visible) && (!product.carton_price || Number(product.carton_price) <= 0) && (
        <div className="bg-warning/10 border border-warning/30 text-warning text-xs px-4 py-3 rounded-lg font-semibold">
          هذا الصنف موقوف ومخفي عن العملاء لعدم تحديد سعر البيع
        </div>
      )}

      <div className="bg-white rounded-xl border border-border p-4 space-y-3">
        <div className="flex justify-between">
          <span className="text-xs text-text-secondary">كود المنتج</span>
          <span className="text-sm font-semibold text-text" dir="ltr">{product.legacy_code}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-xs text-text-secondary">الشركة</span>
          <span className="text-sm font-semibold text-primary cursor-pointer" onClick={() => product.company_id && navigate(`/companies/${product.company_id}`)}>{product.company_name}</span>
        </div>
        {product.description && (
          <div className="flex justify-between">
            <span className="text-xs text-text-secondary">الوصف</span>
            <span className="text-sm text-text">{product.description}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-xs text-text-secondary">حالة المنتج</span>
          {product.is_out_of_stock && product.is_active ? (
            <span className="text-xs px-2 py-0.5 rounded bg-warning/10 text-warning font-semibold">نفذت الكمية</span>
          ) : product.is_active ? (
            <span className="text-xs px-2 py-0.5 rounded bg-success/10 text-success font-semibold">نشط</span>
          ) : (
            <span className="text-xs px-2 py-0.5 rounded bg-danger/10 text-danger font-semibold">مخفي</span>
          )}
        </div>
      </div>

      {units.length > 0 && (
        <div className="bg-white rounded-xl border border-border p-4">
          <h2 className="text-sm font-bold mb-3">الوحدات المتاحة</h2>
          <div className="space-y-2">
            {units.filter((u: any) => u.is_active !== false).map((u: any) => {
              const isCarton = u.unit_type === 'carton'
              return (
                <div key={u.id} className="flex items-center justify-between py-2 px-3 bg-surface rounded-lg">
                  <span className="text-xs font-semibold">{UNIT_LABELS[u.unit_type] || u.unit_type}</span>
                  <div className="flex items-center gap-3">
                    {isCarton && product.carton_price > 0 && (
                      <span className="text-xs text-text-secondary">السعر: {formatCurrencyShort(product.carton_price)}</span>
                    )}
                    {!isCarton && (
                      <span className="text-xs text-text-secondary">
                        السعر: {formatCurrencyShort(u.unit_type === 'dozen' ? (product.dozen_price || 0) : (product.piece_price || 0))}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {product.carton_price > 0 && product.carton_quantity > 0 && (
        <div className="bg-white rounded-xl border border-border p-4">
          <h2 className="text-sm font-bold mb-3">أسعار الوحدات</h2>
          <div className="space-y-2">
            <div className="flex justify-between py-1.5">
              <span className="text-xs text-text-secondary">سعر الكرتونة</span>
              <span className="text-sm font-semibold">{formatCurrencyShort(product.carton_price)}</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-xs text-text-secondary">عدد القطع في الكرتونة</span>
              <span className="text-sm font-semibold">{product.carton_quantity}</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-xs text-text-secondary">سعر القطعة</span>
              <span className="text-sm font-semibold">{formatCurrencyShort(product.piece_price || 0)}</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-xs text-text-secondary">سعر الدستة</span>
              <span className="text-sm font-semibold">{formatCurrencyShort(product.dozen_price || 0)}</span>
            </div>
          </div>
        </div>
      )}

      {inv && (
        <div className="bg-white rounded-xl border border-border p-4">
          <h2 className="text-sm font-bold mb-3">المخزون</h2>
          <div className="flex justify-between py-1.5">
            <span className="text-xs text-text-secondary">الكمية المتاحة</span>
            <span className="text-sm font-semibold">{Number(inv.quantity ?? 0).toLocaleString('ar-EG-u-nu-latn')}</span>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-border p-4">
        <h2 className="text-sm font-bold mb-3">التواريخ</h2>
        <div className="space-y-2">
          <div className="flex justify-between py-1.5">
            <span className="text-xs text-text-secondary">تاريخ الإنشاء</span>
            <span className="text-xs text-text-secondary">{product.created_at ? formatDateTime(product.created_at) : 'غير متوفر'}</span>
          </div>
          <div className="flex justify-between py-1.5">
            <span className="text-xs text-text-secondary">آخر تعديل</span>
            <span className="text-xs text-text-secondary">{product.updated_at ? formatDateTime(product.updated_at) : 'غير متوفر'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
