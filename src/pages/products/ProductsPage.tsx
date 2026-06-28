import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort } from '../../utils/format'
import { productService } from '../../services/products'
import { useCapability } from '../../hooks/useCapability'
import { UNIT_LABELS } from '../../types/order-display'
import type { ProductWithDetails } from '../../services/products'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}

export function ProductsPage() {
  const navigate = useNavigate()
  const canManage = useCapability('products.manage')
  const [products, setProducts] = useState<ProductWithDetails[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [companies, setCompanies] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'out_of_stock' | 'inactive'>('all')

  const [showAddForm, setShowAddForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCode, setNewCode] = useState('')
  const [newCompanyId, setNewCompanyId] = useState('')
  const [newCartonQty, setNewCartonQty] = useState('')
  const [newCartonPrice, setNewCartonPrice] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newUnits, setNewUnits] = useState<string[]>(['piece', 'dozen', 'carton'])
  const [submitting, setSubmitting] = useState(false)

  const [editTarget, setEditTarget] = useState<ProductWithDetails | null>(null)
  const [editName, setEditName] = useState('')
  const [editCode, setEditCode] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editCartonPrice, setEditCartonPrice] = useState('')
  const [editCartonQty, setEditCartonQty] = useState('')
  const [editCompanyId, setEditCompanyId] = useState('')

  const debouncedSearch = useDebounce(searchQuery, 300)

  const companyNames = useMemo(() => {
    return Array.from(new Set(products.map((p) => p.companyName))).sort()
  }, [products])

  const buildFilters = useCallback(() => {
    const filters: Record<string, any> = {}
    if (statusFilter !== 'all') filters.status = statusFilter
    if (companyFilter) filters.company_id = companyFilter
    return filters
  }, [statusFilter, companyFilter])

  const fetchProducts = useCallback(async (query: string) => {
    const token = getToken()
    if (!token) return
    const filters = buildFilters()
    const result = await productService.unifiedSearch(query || undefined, filters, 1, 500)
    setProducts(result.data)
    setTotalCount(result.total)
  }, [buildFilters])

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    setLoading(true)
    Promise.all([
      fetchProducts(debouncedSearch),
      supabase.rpc('get_governed_companies', { p_token: token }).then((comps) => {
        if (comps.data) setCompanies(Array.isArray(comps.data) ? comps.data : [])
      }),
    ]).finally(() => setLoading(false))
  }, [debouncedSearch, statusFilter, companyFilter, fetchProducts])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newName || !newCode || !newCompanyId) { toast.error('الاسم والكود والشركة مطلوبون'); return }
    setSubmitting(true)
    const token = getToken()
    const { data, error } = await supabase.rpc('governed_create_product', {
      p_token: token, p_company_id: newCompanyId, p_product_name: newName,
      p_legacy_code: newCode, p_description: newDesc || null,
      p_carton_quantity: newCartonQty ? parseInt(newCartonQty) : null,
      p_carton_price: newCartonPrice ? parseFloat(newCartonPrice) : null,
      p_units: newUnits,
    })
    if (error) { toast.error(error.message); setSubmitting(false); return }
    const result = data as any
    if (result.error) { toast.error(result.error); setSubmitting(false); return }
    toast.success('تم إضافة المنتج')
    setShowAddForm(false); setNewName(''); setNewCode(''); setNewCompanyId(''); setNewCartonQty(''); setNewCartonPrice(''); setNewDesc('')
    setSubmitting(false)
    await fetchProducts(debouncedSearch)
  }

  async function handleEdit() {
    if (!editTarget) return
    const token = getToken()
    const { data, error } = await supabase.rpc('governed_update_product', {
      p_token: token, p_id: editTarget.id, p_product_name: editName || null, p_legacy_code: editCode || null, p_description: editDesc || null,
    })
    if (error) { toast.error(error.message); return }
    const result = data as any
    if (result.error) { toast.error(result.error); return }
    if (editCompanyId && editCompanyId !== editTarget.id) {
      await supabase.rpc('governed_change_product_company', { p_token: token, p_product_id: editTarget.id, p_new_company_id: editCompanyId })
    }
    if (editCartonPrice || editCartonQty) {
      await supabase.rpc('governed_update_product_pricing', {
        p_token: token, p_id: editTarget.id,
        p_carton_price: editCartonPrice ? parseFloat(editCartonPrice) : null,
        p_carton_quantity: editCartonQty ? parseInt(editCartonQty) : null,
      })
    }
    toast.success('تم تحديث المنتج')
    setEditTarget(null)
    await fetchProducts(debouncedSearch)
  }

  async function handleToggleActive(product: ProductWithDetails) {
    const token = getToken()
    const fn = product.isActive ? 'governed_deactivate_product' : 'governed_activate_product'
    const { data, error } = await supabase.rpc(fn, { p_token: token, p_id: product.id })
    if (error) { toast.error(error.message); return }
    const result = data as any
    if (result.error) { toast.error(result.error); return }
    toast.success(product.isActive ? 'تم إيقاف المنتج' : 'تم تفعيل المنتج')
    await fetchProducts(debouncedSearch)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">المنتجات</h1>
        {canManage && (
          <button onClick={() => setShowAddForm(true)} className="mr-auto bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold">+ إضافة منتج</button>
        )}
      </div>

      <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="بحث باسم المنتج أو الكود..." className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />

      <div className="flex gap-2">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}
          className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white flex-1">
          <option value="all">الكل</option>
          <option value="active">نشط</option>
          <option value="out_of_stock">نفذت الكمية</option>
          <option value="inactive">غير نشط</option>
        </select>
        <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)}
          className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white flex-1">
          <option value="">كل الشركات</option>
          {companyNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      {showAddForm && (
        <form onSubmit={handleAdd} className="bg-white rounded-lg border border-border p-4 space-y-3">
          <h2 className="text-sm font-bold">إضافة منتج جديد</h2>
          <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="اسم المنتج *" className="w-full border border-border rounded-lg px-3 py-2 text-sm" required />
          <input type="text" value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="الكود القديم *" className="w-full border border-border rounded-lg px-3 py-2 text-sm" required />
          <textarea value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="الوصف" className="w-full border border-border rounded-lg px-3 py-2 text-sm" rows={2} />
          <select value={newCompanyId} onChange={(e) => setNewCompanyId(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white" required>
            <option value="">اختر الشركة *</option>
            {companies.map((c: any) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select>
          <input type="number" value={newCartonQty} onChange={(e) => setNewCartonQty(e.target.value)} placeholder="عدد القطع في الكرتونة" className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
          <input type="number" value={newCartonPrice} onChange={(e) => setNewCartonPrice(e.target.value)} placeholder="سعر الكرتونة" className="w-full border border-border rounded-lg px-3 py-2 text-sm" step="0.01" />
          <div>
            <p className="text-xs text-text-secondary mb-1">وحدات البيع:</p>
            <div className="flex gap-3">
              {['piece', 'dozen', 'carton'].map((u) => (
                <label key={u} className="flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={newUnits.includes(u)} onChange={() => setNewUnits((prev) => prev.includes(u) ? prev.filter((x) => x !== u) : [...prev, u])} />
                  {UNIT_LABELS[u]}
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={submitting} className="flex-1 bg-primary text-white text-xs py-2 rounded-lg font-semibold">
              {submitting ? 'جاري الإضافة...' : 'إضافة'}
            </button>
            <button type="button" onClick={() => setShowAddForm(false)} className="px-4 border border-border rounded-lg text-xs">إلغاء</button>
          </div>
        </form>
      )}

      <div className="text-[10px] text-text-secondary text-left">
        {!loading && `${totalCount} منتج`}
        {searchQuery && ` — بحث: "${searchQuery}"`}
      </div>

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : products.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">لا توجد منتجات</div>
      ) : (
        <div className="space-y-2">
          {products.map((p) => (
            <div key={p.id} className={`bg-white rounded-lg border p-3 ${!p.isActive && !p.isOutOfStock ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-primary cursor-pointer" onClick={() => navigate(`/products/${p.id}`)}>{p.productName}</span>
                    {p.isOutOfStock ? (
                      <span className="text-[10px] bg-warning/10 text-warning px-2 py-0.5 rounded">نفذت الكمية</span>
                    ) : !p.isActive ? (
                      <span className="text-[10px] bg-danger/10 text-danger px-2 py-0.5 rounded">غير نشط</span>
                    ) : null}
                  </div>
                  <p className="text-[10px] text-text-secondary">{p.companyName} | {p.productCode}</p>
                  {p.description && <p className="text-[10px] text-text-secondary mt-0.5">{p.description}</p>}
                  <div className="flex gap-3 mt-1 text-xs text-text-secondary">
                    {p.cartonPrice > 0 && p.cartonQuantity > 0 ? (
                      <>
                        <span>كرتونة: {formatCurrencyShort(p.cartonPrice)}</span>
                        <span>قطعة: {formatCurrencyShort(Math.round(p.cartonPrice / p.cartonQuantity * 100) / 100)}</span>
                        <span>دستة: {formatCurrencyShort(Math.round(p.cartonPrice / p.cartonQuantity * 12 * 100) / 100)}</span>
                      </>
                    ) : (
                      <span className="text-danger">السعر غير محدد</span>
                    )}
                  </div>
                  <span className="text-[10px] text-text-secondary mt-0.5 block">المخزون: {p.inventoryQuantity}</span>
                </div>
              </div>
              {canManage && (
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  <button onClick={() => { setEditTarget(p); setEditName(p.productName); setEditCode(p.productCode); setEditDesc(p.description || ''); setEditCartonPrice(String(p.cartonPrice)); setEditCartonQty(String(p.cartonQuantity)); setEditCompanyId('') }}
                    className="text-[10px] bg-primary/10 text-primary px-2 py-1 rounded">تعديل</button>
                  <button onClick={() => handleToggleActive(p)}
                    className={`text-[10px] px-2 py-1 rounded ${p.isActive ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'}`}>
                    {p.isActive ? 'إيقاف' : 'تفعيل'}
                  </button>
                </div>
              )}
              {editTarget?.id === p.id && (
                <div className="mt-3 border-t border-border pt-3 space-y-2">
                  <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full border border-border rounded-lg px-3 py-1.5 text-xs" />
                  <input type="text" value={editCode} onChange={(e) => setEditCode(e.target.value)} className="w-full border border-border rounded-lg px-3 py-1.5 text-xs" />
                  <textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} className="w-full border border-border rounded-lg px-3 py-1.5 text-xs" rows={2} />
                  <select value={editCompanyId} onChange={(e) => setEditCompanyId(e.target.value)} className="w-full border border-border rounded-lg px-3 py-1.5 text-xs bg-white">
                    <option value="">تغيير الشركة (اختياري)</option>
                    {companies.filter((c: any) => c.company_name !== p.companyName).map((c: any) => (
                      <option key={c.id} value={c.id}>{c.company_name}</option>
                    ))}
                  </select>
                  <input type="number" value={editCartonPrice} onChange={(e) => setEditCartonPrice(e.target.value)} placeholder="سعر الكرتونة" className="w-full border border-border rounded-lg px-3 py-1.5 text-xs" step="0.01" />
                  <input type="number" value={editCartonQty} onChange={(e) => setEditCartonQty(e.target.value)} placeholder="عدد القطع في الكرتونة" className="w-full border border-border rounded-lg px-3 py-1.5 text-xs" />
                  <div className="flex gap-2">
                    <button onClick={handleEdit} className="flex-1 bg-primary text-white text-xs py-1.5 rounded-lg">حفظ</button>
                    <button onClick={() => setEditTarget(null)} className="px-4 border border-border rounded-lg text-xs">إلغاء</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
