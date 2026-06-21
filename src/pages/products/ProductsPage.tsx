import { useState, useEffect, useMemo } from 'react'
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

export function ProductsPage() {
  const navigate = useNavigate()
  const canManage = useCapability('products.manage')
  const [products, setProducts] = useState<ProductWithDetails[]>([])
  const [companies, setCompanies] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')

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

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    Promise.all([
      productService.getAll(),
      supabase.rpc('get_governed_companies', { p_token: token }),
    ]).then(([prods, comps]) => {
      setProducts(prods)
      if (comps.data) setCompanies(Array.isArray(comps.data) ? comps.data : [])
      setLoading(false)
    })
  }, [])

  const filtered = useMemo(() => {
    let list = products
    if (statusFilter === 'active') list = list.filter((p) => p.isActive)
    if (statusFilter === 'inactive') list = list.filter((p) => !p.isActive)
    if (companyFilter) list = list.filter((p) => p.companyName === companyFilter)
    const q = searchQuery.trim().toLowerCase()
    if (q) {
      list = list.filter((p) =>
        p.productName.toLowerCase().includes(q) ||
        p.productCode.toLowerCase().includes(q) ||
        p.companyName.toLowerCase().includes(q)
      )
    }
    return list
  }, [products, searchQuery, companyFilter, statusFilter])

  const companyNames = useMemo(() => {
    return Array.from(new Set(products.map((p) => p.companyName))).sort()
  }, [products])

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
    setProducts(await productService.getAll())
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
    setProducts(await productService.getAll())
  }

  async function handleToggleActive(product: ProductWithDetails) {
    const token = getToken()
    const fn = product.isActive ? 'governed_deactivate_product' : 'governed_activate_product'
    const { data, error } = await supabase.rpc(fn, { p_token: token, p_id: product.id })
    if (error) { toast.error(error.message); return }
    const result = data as any
    if (result.error) { toast.error(result.error); return }
    toast.success(product.isActive ? 'تم إيقاف المنتج' : 'تم تفعيل المنتج')
    setProducts(await productService.getAll())
  }

  return (
    <div className="ds-gap-lg flex flex-col">
      <div className="flex items-center ds-gap-md">
        <button onClick={() => navigate('/dashboard')} className="text-text-secondary text-xl leading-none">&larr;</button>
        <h1 className="ds-title">المنتجات</h1>
        {canManage && (
          <button onClick={() => setShowAddForm(true)} className="ds-btn ds-btn-primary mr-auto">+ إضافة منتج</button>
        )}
      </div>

      <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="بحث باسم المنتج أو الكود..." className="ds-input" />

      <div className="flex ds-gap-sm">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}
          className="ds-select flex-1">
          <option value="all">الكل</option>
          <option value="active">نشط</option>
          <option value="inactive">غير نشط</option>
        </select>
        <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)}
          className="ds-select flex-1">
          <option value="">كل الشركات</option>
          {companyNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      {showAddForm && (
        <form onSubmit={handleAdd} className="ds-card ds-gap-md flex flex-col">
          <h2 className="ds-subtitle">إضافة منتج جديد</h2>
          <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="اسم المنتج *" className="ds-input" required />
          <input type="text" value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="الكود القديم *" className="ds-input" required />
          <textarea value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="الوصف" className="ds-input pt-2" rows={2} style={{ height: 'auto', minHeight: 48 }} />
          <select value={newCompanyId} onChange={(e) => setNewCompanyId(e.target.value)} className="ds-select" required>
            <option value="">اختر الشركة *</option>
            {companies.map((c: any) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select>
          <input type="number" value={newCartonQty} onChange={(e) => setNewCartonQty(e.target.value)} placeholder="عدد القطع في الكرتونة" className="ds-input" />
          <input type="number" value={newCartonPrice} onChange={(e) => setNewCartonPrice(e.target.value)} placeholder="سعر الكرتونة" className="ds-input" step="0.01" />
          <div>
            <p className="ds-small mb-1">وحدات البيع:</p>
            <div className="flex ds-gap-md">
              {['piece', 'dozen', 'carton'].map((u) => (
                <label key={u} className="flex items-center ds-gap-xs ds-small">
                  <input type="checkbox" checked={newUnits.includes(u)} onChange={() => setNewUnits((prev) => prev.includes(u) ? prev.filter((x) => x !== u) : [...prev, u])} />
                  {UNIT_LABELS[u]}
                </label>
              ))}
            </div>
          </div>
          <div className="flex ds-gap-sm">
            <button type="submit" disabled={submitting} className="ds-btn ds-btn-primary flex-1">
              {submitting ? 'جاري الإضافة...' : 'إضافة'}
            </button>
            <button type="button" onClick={() => setShowAddForm(false)} className="ds-btn ds-btn-ghost">إلغاء</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-center py-12 ds-small">جاري التحميل...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 ds-small">لا توجد منتجات</div>
      ) : (
        <div className="ds-gap-sm flex flex-col">
          {filtered.map((p) => (
            <div key={p.id} className={`ds-card ${!p.isActive ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center ds-gap-sm">
                    <span className="ds-body font-semibold text-primary cursor-pointer" onClick={() => navigate(`/products/${p.id}`)}>{p.productName}</span>
                    {!p.isActive && <span className="ds-badge bg-danger/10 text-danger">غير نشط</span>}
                  </div>
                  <p className="ds-xs">{p.companyName} | {p.productCode}</p>
                  {p.description && <p className="ds-xs mt-0.5">{p.description}</p>}
                  <div className="flex ds-gap-md mt-1 ds-xs">
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
                  <span className="ds-xs mt-0.5 block">المخزون: {p.inventoryQuantity}</span>
                </div>
              </div>
              {canManage && (
                <div className="flex ds-gap-xs mt-2 flex-wrap">
                  <button onClick={() => { setEditTarget(p); setEditName(p.productName); setEditCode(p.productCode); setEditDesc(p.description || ''); setEditCartonPrice(String(p.cartonPrice)); setEditCartonQty(String(p.cartonQuantity)); setEditCompanyId('') }}
                    className="ds-badge bg-primary/10 text-primary cursor-pointer">تعديل</button>
                  <button onClick={() => handleToggleActive(p)}
                    className={`ds-badge cursor-pointer ${p.isActive ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'}`}>
                    {p.isActive ? 'إيقاف' : 'تفعيل'}
                  </button>
                </div>
              )}
              {editTarget?.id === p.id && (
                <div className="mt-3 border-t border-border pt-3 ds-gap-sm flex flex-col">
                  <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className="ds-input" />
                  <input type="text" value={editCode} onChange={(e) => setEditCode(e.target.value)} className="ds-input" />
                  <textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} className="ds-input pt-2" rows={2} style={{ height: 'auto', minHeight: 48 }} />
                  <select value={editCompanyId} onChange={(e) => setEditCompanyId(e.target.value)} className="ds-select">
                    <option value="">تغيير الشركة (اختياري)</option>
                    {companies.filter((c: any) => c.company_name !== p.companyName).map((c: any) => (
                      <option key={c.id} value={c.id}>{c.company_name}</option>
                    ))}
                  </select>
                  <input type="number" value={editCartonPrice} onChange={(e) => setEditCartonPrice(e.target.value)} placeholder="سعر الكرتونة" className="ds-input" step="0.01" />
                  <input type="number" value={editCartonQty} onChange={(e) => setEditCartonQty(e.target.value)} placeholder="عدد القطع في الكرتونة" className="ds-input" />
                  <div className="flex ds-gap-sm">
                    <button onClick={handleEdit} className="ds-btn ds-btn-primary flex-1">حفظ</button>
                    <button onClick={() => setEditTarget(null)} className="ds-btn ds-btn-ghost">إلغاء</button>
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
