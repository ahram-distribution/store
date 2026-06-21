import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, X, Loader2, AlertTriangle, ChevronDown, Trash2, Power, Image, Upload } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useCapability } from '../../hooks/useCapability'
import { ProductCard } from '../../components/products/ProductCard'
import { formatCurrencyShort } from '../../utils/format'
import { UNIT_LABELS } from '../../types/order-display'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

function toDateInput(iso: string): string {
  if (!iso) return ''
  try { return new Date(iso).toISOString().slice(0, 10) } catch { return '' }
}

// =============================================================================
// ProductManagerPage — Full product management dashboard
// =============================================================================
export function ProductManagerPage() {
  const nav = useNavigate()
  const canManage = useCapability('products.manage')
  const imageInputRef = useRef<HTMLInputElement>(null)
  const editImageInputRef = useRef<HTMLInputElement>(null)

  // ── Data ──
  const [products, setProducts] = useState<any[]>([])
  const [companies, setCompanies] = useState<any[]>([])
  const [allTiers, setAllTiers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  // ── Filters ──
  const [searchQuery, setSearchQuery] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [showFilters, setShowFilters] = useState(false)

  // Derived company names (from products list)
  const companyNames = useMemo(() => {
    return Array.from(new Set(products.map((p: any) => p.company_name))).sort()
  }, [products])

  // Filtered products
  const filtered = useMemo(() => {
    let list = products
    if (statusFilter === 'active') list = list.filter((p: any) => p.is_active)
    if (statusFilter === 'inactive') list = list.filter((p: any) => !p.is_active)
    if (companyFilter) list = list.filter((p: any) => p.company_name === companyFilter)
    const q = searchQuery.trim().toLowerCase()
    if (q) {
      list = list.filter((p: any) =>
        (p.product_name || '').toLowerCase().includes(q) ||
        (p.legacy_code || '').toLowerCase().includes(q) ||
        (p.company_name || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [products, searchQuery, companyFilter, statusFilter])

  // ── Load data ──
  async function loadData() {
    const token = getToken()
    if (!token) { setLoading(false); return }
    const [prodRes, compRes, tiersRes] = await Promise.all([
      supabase.rpc('get_governed_products', { p_token: token, p_active_only: false, p_visible_only: false }),
      supabase.rpc('get_governed_companies', { p_token: token }),
      supabase.rpc('get_governed_tiers', { p_token: token }),
    ])
    if (prodRes.data) setProducts(Array.isArray(prodRes.data) ? prodRes.data : [])
    if (compRes.data) setCompanies(Array.isArray(compRes.data) ? compRes.data : [])
    if (tiersRes.data) setAllTiers(Array.isArray(tiersRes.data) ? tiersRes.data : [])
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  // ── Toggle active ──
  async function handleToggleActive(product: any) {
    const token = getToken()
    if (!token) return
    const fn = product.is_active ? 'governed_deactivate_product' : 'governed_activate_product'
    const { data, error } = await supabase.rpc(fn, { p_token: token, p_id: product.id })
    if (error) { toast.error(error.message); return }
    const result = data as any
    if (result?.error) { toast.error(result.error); return }
    toast.success(product.is_active ? 'تم إيقاف المنتج' : 'تم تفعيل المنتج')
    await loadData()
  }

  // ── Hard delete ──
  const [deleteTarget, setDeleteTarget] = useState<any>(null)
  const [deletePreview, setDeletePreview] = useState<any>(null)
  const [deleting, setDeleting] = useState(false)

  async function handleDeletePreview(product: any) {
    const token = getToken()
    if (!token) return
    setDeleteTarget(product)
    setDeletePreview(null)
    const { data, error } = await supabase.rpc('governed_deletion_execute_products', {
      p_token: token,
      p_ids: [product.id],
      p_dry_run: true,
    })
    if (error) { toast.error(error.message); setDeleteTarget(null); return }
    const result = data as any
    if (result?.error === 'FORBIDDEN') { toast.error('ليس لديك صلاحية حذف المنتجات'); setDeleteTarget(null); return }
    if (result?.error) { toast.error(result.error); setDeleteTarget(null); return }
    setDeletePreview(result as any)
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return
    setDeleting(true)
    const token = getToken()
    if (!token) { setDeleting(false); return }
    const { data, error } = await supabase.rpc('governed_deletion_execute_products', {
      p_token: token,
      p_ids: [deleteTarget.id],
      p_dry_run: false,
    })
    if (error) { toast.error(error.message); setDeleting(false); return }
    const result = data as any
    if (result?.error) { toast.error(result.error); setDeleting(false); return }
    toast.success('تم حذف المنتج نهائياً')
    setDeleteTarget(null)
    setDeletePreview(null)
    setDeleting(false)
    await loadData()
  }

  // ── Add product ──
  const [showAdd, setShowAdd] = useState(false)
  const [addName, setAddName] = useState('')
  const [addCode, setAddCode] = useState('')
  const [addDesc, setAddDesc] = useState('')
  const [addCompanyId, setAddCompanyId] = useState('')
  const [addCartonQty, setAddCartonQty] = useState('')
  const [addCartonPrice, setAddCartonPrice] = useState('')
  const [addUnits, setAddUnits] = useState<string[]>(['piece', 'dozen', 'carton'])
  const [addImageUrl, setAddImageUrl] = useState('')
  const [addSubmitting, setAddSubmitting] = useState(false)

  function resetAddForm() {
    setAddName(''); setAddCode(''); setAddDesc(''); setAddCompanyId('')
    setAddCartonQty(''); setAddCartonPrice(''); setAddUnits(['piece', 'dozen', 'carton'])
    setAddImageUrl('')
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!addName || !addCode || !addCompanyId) { toast.error('الاسم والكود والشركة مطلوبون'); return }
    setAddSubmitting(true)
    const token = getToken()
    const { data, error } = await supabase.rpc('governed_create_product', {
      p_token: token,
      p_company_id: addCompanyId,
      p_product_name: addName,
      p_legacy_code: addCode,
      p_description: addDesc || null,
      p_carton_quantity: addCartonQty ? parseInt(addCartonQty) : null,
      p_carton_price: addCartonPrice ? parseFloat(addCartonPrice) : null,
      p_units: addUnits,
    })
    if (error) { toast.error(error.message); setAddSubmitting(false); return }
    const result = data as any
    if (result?.error) { toast.error(result.error); setAddSubmitting(false); return }
    toast.success('تم إضافة المنتج')
    setShowAdd(false)
    resetAddForm()
    setAddSubmitting(false)
    await loadData()
  }

  function handleAddImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setAddImageUrl(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  // ── Edit product ──
  const [editTarget, setEditTarget] = useState<any>(null)
  const [editForm, setEditForm] = useState<any>({
    product_name: '', legacy_code: '', description: '', company_id: '',
    image_url: '', inventory_quantity: '', carton_quantity: '', carton_price: '',
    units: ['piece', 'dozen', 'carton'], is_active: true, is_visible: true,
  })
  const [editTierDiscounts, setEditTierDiscounts] = useState<Record<string, string>>({})
  const [editSaving, setEditSaving] = useState(false)

  function openEdit(product: any) {
    setEditTarget(product)
    setEditForm({
      product_name: product.product_name || '',
      legacy_code: product.legacy_code || '',
      description: product.description || '',
      company_id: product.company_id || '',
      image_url: product.image_url || '',
      inventory_quantity: String(product.inventory?.quantity ?? ''),
      carton_quantity: String(product.carton_quantity ?? ''),
      carton_price: String(product.carton_price ?? ''),
      units: (product.product_units || []).filter((u: any) => u.is_active !== false).map((u: any) => u.unit_type),
      is_active: product.is_active !== false,
      is_visible: product.is_visible !== false,
    })
    // Build tier discounts from product exceptions
    const discounts: Record<string, string> = {}
    for (const tier of allTiers) {
      const exs = (tier.product_exceptions || []).filter(
        (ex: any) => ex.product_id === product.id && ex.applies_to_all_tiers === false
      )
      if (exs.length > 0) discounts[tier.id] = String(exs[0].discount_percent)
    }
    setEditTierDiscounts(discounts)
  }

  const computedPiecePrice = editForm.carton_quantity && editForm.carton_price
    ? parseFloat(editForm.carton_price) / parseInt(editForm.carton_quantity)
    : null
  const computedDozenPrice = computedPiecePrice !== null ? computedPiecePrice * 12 : null

  function handleEditImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setEditForm((p: any) => ({ ...p, image_url: ev.target?.result as string }))
    reader.readAsDataURL(file)
  }

  async function handleEditSave() {
    if (!editTarget) return
    setEditSaving(true)
    const token = getToken()
    if (!token) { setEditSaving(false); return }
    try {
      // 1. Update basic fields
      const { error: updateErr } = await supabase.rpc('governed_update_product', {
        p_token: token, p_id: editTarget.id,
        p_product_name: editForm.product_name || null,
        p_legacy_code: editForm.legacy_code || null,
        p_description: editForm.description || null,
        p_image_url: editForm.image_url || null,
      })
      if (updateErr) { toast.error(updateErr.message); setEditSaving(false); return }

      // 2. Change company if different
      if (editForm.company_id && editForm.company_id !== editTarget.company_id) {
        const { error: compErr } = await supabase.rpc('governed_change_product_company', {
          p_token: token, p_product_id: editTarget.id, p_new_company_id: editForm.company_id,
        })
        if (compErr) { toast.error(compErr.message); setEditSaving(false); return }
      }

      // 3. Update pricing
      const { error: pricingErr } = await supabase.rpc('governed_update_product_pricing', {
        p_token: token, p_id: editTarget.id,
        p_carton_price: editForm.carton_price ? parseFloat(editForm.carton_price) : null,
        p_carton_quantity: editForm.carton_quantity ? parseInt(editForm.carton_quantity) : null,
      })
      if (pricingErr) { toast.error(pricingErr.message); setEditSaving(false); return }

      // 4. Update units
      const { error: unitsErr } = await supabase.rpc('governed_update_product_units', {
        p_token: token, p_id: editTarget.id,
        p_units: editForm.units.map((u: string) => ({ unit_type: u })),
      })
      if (unitsErr) { toast.error(unitsErr.message); setEditSaving(false); return }

      // 5. Update visibility
      const { error: visErr } = await supabase.rpc('governed_update_product_visibility', {
        p_token: token, p_id: editTarget.id, p_is_visible: editForm.is_visible,
      })
      if (visErr) { toast.error('فشل تحديث الظهور: ' + visErr.message); setEditSaving(false); return }

      // 6. Update inventory
      if (editForm.inventory_quantity) {
        const { error: invErr } = await supabase.rpc('governed_update_product_inventory', {
          p_token: token, p_id: editTarget.id,
          p_quantity: parseInt(editForm.inventory_quantity),
        })
        if (invErr) { toast.error('فشل تحديث المخزون: ' + invErr.message); setEditSaving(false); return }
      }

      // 7. Toggle active if changed
      if (editForm.is_active !== editTarget.is_active) {
        const fn = editForm.is_active ? 'governed_activate_product' : 'governed_deactivate_product'
        const { error: actErr } = await supabase.rpc(fn, { p_token: token, p_id: editTarget.id })
        if (actErr) { toast.error(actErr.message); setEditSaving(false); return }
      }

      // 8. Tier discounts
      for (const tier of allTiers) {
        const newDiscount = editTierDiscounts[tier.id]
        const existingEx = (tier.product_exceptions || []).find(
          (ex: any) => ex.product_id === editTarget.id && ex.applies_to_all_tiers === false
        )
        if (newDiscount !== undefined && newDiscount !== '') {
          const parsed = parseFloat(newDiscount)
          if (isNaN(parsed) || parsed < 0 || parsed > 100) continue
          if (existingEx) {
            await supabase.rpc('governed_remove_tier_product_exception', {
              p_token: token, p_exception_id: existingEx.id,
            })
          }
          await supabase.rpc('governed_set_tier_product_exception', {
            p_token: token, p_product_id: editTarget.id,
            p_discount_percent: parsed, p_tier_id: tier.id,
            p_applies_to_all_tiers: false,
          })
        } else if (existingEx) {
          await supabase.rpc('governed_remove_tier_product_exception', {
            p_token: token, p_exception_id: existingEx.id,
          })
        }
      }

      toast.success('تم حفظ التغييرات')
      setEditTarget(null)
      setEditSaving(false)
      await loadData()
    } catch (err: any) {
      toast.error(err.message || 'حدث خطأ')
      setEditSaving(false)
    }
  }

  // ── Render ──
  return (
    <div className="min-h-screen bg-surface pb-24" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-primary to-primary/80 text-white px-4 py-4 flex items-center gap-3">
        <button onClick={() => nav('/products')} className="text-white/80 hover:text-white">&larr;</button>
        <h1 className="text-lg font-bold flex-1">إدارة المنتجات</h1>
        {canManage && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 bg-white/20 text-white text-xs px-3 py-2 rounded-full font-semibold hover:bg-white/30 transition-colors"
          >
            <Plus className="w-4 h-4" />
            إضافة منتج
          </button>
        )}
      </div>

      <div className="px-3 py-4 space-y-4">
        {/* ── Filters ── */}
        <div className="bg-white rounded-xl border border-border p-3 space-y-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="بحث باسم المنتج أو الكود أو الشركة..."
                className="w-full pr-9 pl-3 py-2.5 rounded-lg border border-border text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`px-3 py-2 rounded-lg border text-sm font-semibold ${
                showFilters ? 'bg-primary/5 border-primary/30 text-primary' : 'border-border text-text-secondary'
              }`}
            >
              <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
            </button>
          </div>

          {showFilters && (
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="px-2 py-1.5 rounded-lg border border-border text-xs bg-surface"
              >
                <option value="all">كل الحالات</option>
                <option value="active">نشط</option>
                <option value="inactive">غير نشط</option>
              </select>
              <select
                value={companyFilter}
                onChange={(e) => setCompanyFilter(e.target.value)}
                className="px-2 py-1.5 rounded-lg border border-border text-xs bg-surface"
              >
                <option value="">كل الشركات</option>
                {companyNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          )}

          {!showFilters && (
            <div className="flex gap-2 text-[11px] text-text-secondary pt-0.5">
              <span>{filtered.length} من {products.length} منتج</span>
              {(searchQuery || companyFilter || statusFilter !== 'all') && (
                <button
                  onClick={() => { setSearchQuery(''); setCompanyFilter(''); setStatusFilter('all') }}
                  className="text-primary font-semibold"
                >
                  إعادة تعيين
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Product Cards Grid ── */}
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-sm text-text-secondary">لا توجد منتجات</p>
            {!searchQuery && !companyFilter && statusFilter === 'all' && (
              <button onClick={() => setShowAdd(true)} className="mt-3 text-xs text-primary font-semibold">
                + إضافة أول منتج
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtered.map((product: any) => (
              <ProductCard
                key={product.id}
                product={product}
                onEdit={() => openEdit(product)}
                onToggleActive={() => handleToggleActive(product)}
                onDelete={() => handleDeletePreview(product)}
                onViewDetails={() => nav(`/products/${product.id}`)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Add Product Modal ── */}
      {showAdd && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto shadow-xl">
            <div className="sticky top-0 bg-white border-b border-border px-5 py-3 flex items-center justify-between">
              <h3 className="font-bold text-text">إضافة منتج جديد</h3>
              <button onClick={() => { setShowAdd(false); resetAddForm() }} className="text-text-secondary">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAdd} className="p-5 space-y-3">
              <input
                type="text" value={addName} onChange={(e) => setAddName(e.target.value)}
                placeholder="اسم المنتج *" required
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-surface"
              />
              <input
                type="text" value={addCode} onChange={(e) => setAddCode(e.target.value)}
                placeholder="الكود القديم *" required dir="ltr"
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-surface"
              />
              <textarea
                value={addDesc} onChange={(e) => setAddDesc(e.target.value)}
                placeholder="الوصف" rows={2}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-surface resize-none"
              />
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[10px] text-text-secondary block mb-0.5">صورة المنتج</label>
                  <div className="flex gap-2">
                    <input
                      type="text" value={addImageUrl} onChange={(e) => setAddImageUrl(e.target.value)}
                      placeholder="رابط الصورة..."
                      className="flex-1 border border-border rounded-lg px-3 py-2 text-xs bg-surface" dir="ltr"
                    />
                    <button type="button" onClick={() => imageInputRef.current?.click()}
                      className="px-3 py-2 rounded-lg border border-border text-text-secondary hover:bg-surface">
                      <Upload className="w-4 h-4" />
                    </button>
                    <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleAddImageFile} />
                  </div>
                </div>
              </div>
              {addImageUrl && (
                <div className="relative w-full h-28 rounded-lg overflow-hidden border border-border bg-surface">
                  <img src={addImageUrl} alt="" className="w-full h-full object-contain" />
                  <button type="button" onClick={() => setAddImageUrl('')}
                    className="absolute top-1 left-1 bg-black/50 text-white rounded-full p-0.5">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <select
                value={addCompanyId} onChange={(e) => setAddCompanyId(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-surface" required
              >
                <option value="">اختر الشركة *</option>
                {companies.map((c: any) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number" value={addCartonQty} onChange={(e) => setAddCartonQty(e.target.value)}
                  placeholder="قطع في الكرتونة"
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-surface"
                />
                <input
                  type="number" step="0.01" value={addCartonPrice} onChange={(e) => setAddCartonPrice(e.target.value)}
                  placeholder="سعر الكرتونة"
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-surface"
                />
              </div>
              <div>
                <p className="text-xs text-text-secondary mb-1.5">وحدات البيع:</p>
                <div className="flex gap-4">
                  {['piece', 'dozen', 'carton'].map((u) => (
                    <label key={u} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                      <input
                        type="checkbox" checked={addUnits.includes(u)}
                        onChange={() => setAddUnits((prev) => prev.includes(u) ? prev.filter((x) => x !== u) : [...prev, u])}
                        className="accent-primary"
                      />
                      <span className={addUnits.includes(u) ? 'font-semibold text-text' : 'text-text-secondary'}>
                        {UNIT_LABELS[u]}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={addSubmitting}
                  className="flex-1 bg-primary text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {addSubmitting ? <><Loader2 className="w-4 h-4 animate-spin inline" /> جاري...</> : 'إضافة المنتج'}
                </button>
                <button type="button" onClick={() => { setShowAdd(false); resetAddForm() }}
                  className="px-6 border border-border rounded-lg text-sm text-text-secondary"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Edit Product Modal ── */}
      {editTarget && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-xl max-h-[90vh] overflow-y-auto shadow-xl">
            <div className="sticky top-0 bg-white border-b border-border px-5 py-3 flex items-center justify-between z-10">
              <h3 className="font-bold text-text">تعديل: {editTarget.product_name}</h3>
              <button onClick={() => setEditTarget(null)} className="text-text-secondary">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {/* Identity */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-text-secondary">بيانات المنتج</h4>
                <input type="text" value={editForm.product_name}
                  onChange={(e) => setEditForm((p: any) => ({ ...p, product_name: e.target.value }))}
                  readOnly={!canManage} className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-surface" />
                <input type="text" value={editForm.legacy_code}
                  onChange={(e) => setEditForm((p: any) => ({ ...p, legacy_code: e.target.value }))}
                  readOnly={!canManage} className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-surface" dir="ltr" />
                <textarea value={editForm.description}
                  onChange={(e) => setEditForm((p: any) => ({ ...p, description: e.target.value }))}
                  readOnly={!canManage} className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-surface resize-none" rows={2} />
              </div>

              {/* Company */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-text-secondary">الشركة</h4>
                <select value={editForm.company_id}
                  onChange={(e) => setEditForm((p: any) => ({ ...p, company_id: e.target.value }))}
                  disabled={!canManage} className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-surface">
                  <option value="">اختر شركة...</option>
                  {companies.map((c: any) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                </select>
              </div>

              {/* Image */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-text-secondary">صورة المنتج</h4>
                {editForm.image_url ? (
                  <div className="relative w-full h-32 rounded-lg overflow-hidden border border-border bg-surface mb-2">
                    <img src={editForm.image_url} alt="" className="w-full h-full object-contain" />
                    {canManage && (
                      <button onClick={() => setEditForm((p: any) => ({ ...p, image_url: '' }))}
                        className="absolute top-1 left-1 bg-black/50 text-white rounded-full p-0.5">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="w-full h-28 bg-surface rounded-lg border border-border flex items-center justify-center mb-2">
                    <Image className="w-8 h-8 text-text-secondary/30" />
                  </div>
                )}
                {canManage && (
                  <div className="flex gap-2">
                    <input type="text" value={editForm.image_url}
                      onChange={(e) => setEditForm((p: any) => ({ ...p, image_url: e.target.value }))}
                      placeholder="رابط الصورة..." className="flex-1 border border-border rounded-lg px-3 py-2 text-xs bg-surface" dir="ltr" />
                    <button type="button" onClick={() => editImageInputRef.current?.click()}
                      className="px-3 py-2 rounded-lg border border-border text-text-secondary hover:bg-surface">
                      <Upload className="w-4 h-4" />
                    </button>
                    <input ref={editImageInputRef} type="file" accept="image/*" className="hidden" onChange={handleEditImageFile} />
                  </div>
                )}
              </div>

              {/* Inventory */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-text-secondary">المخزون</h4>
                <input type="number" value={editForm.inventory_quantity}
                  onChange={(e) => setEditForm((p: any) => ({ ...p, inventory_quantity: e.target.value }))}
                  readOnly={!canManage} className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-surface" />
              </div>

              {/* Packaging & Pricing */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-text-secondary">التعبئة والتسعير</h4>
                <div className="grid grid-cols-2 gap-2">
                  <input type="number" value={editForm.carton_quantity}
                    onChange={(e) => setEditForm((p: any) => ({ ...p, carton_quantity: e.target.value }))}
                    readOnly={!canManage} placeholder="قطع في الكرتونة"
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-surface" />
                  <input type="number" step="0.01" value={editForm.carton_price}
                    onChange={(e) => setEditForm((p: any) => ({ ...p, carton_price: e.target.value }))}
                    readOnly={!canManage} placeholder="سعر الكرتونة"
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-surface" />
                </div>
                {computedPiecePrice !== null && (
                  <div className="text-[11px] text-text-secondary space-y-0.5 bg-surface rounded-lg p-3">
                    <div>سعر القطعة: <span className="font-semibold text-text">{formatCurrencyShort(computedPiecePrice)}</span></div>
                    <div>سعر الدستة: <span className="font-semibold text-text">{formatCurrencyShort(computedDozenPrice!)}</span></div>
                  </div>
                )}
              </div>

              {/* Units */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-text-secondary">وحدات البيع النشطة</h4>
                <div className="flex gap-4">
                  {['piece', 'dozen', 'carton'].map((u) => (
                    <label key={u} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                      <input type="checkbox" checked={editForm.units.includes(u)}
                        disabled={!canManage}
                        onChange={() => setEditForm((p: any) => ({
                          ...p, units: p.units.includes(u) ? p.units.filter((x: string) => x !== u) : [...p.units, u]
                        }))}
                        className="accent-primary" />
                      <span className={editForm.units.includes(u) ? 'font-semibold text-text' : 'text-text-secondary'}>
                        {UNIT_LABELS[u]}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Status */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-text-secondary">حالة المنتج</h4>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                    <input type="checkbox" checked={editForm.is_active}
                      disabled={!canManage}
                      onChange={(e) => setEditForm((p: any) => ({ ...p, is_active: e.target.checked }))}
                      className="accent-primary" />
                    <span className={editForm.is_active ? 'text-success font-semibold' : 'text-text-secondary'}>
                      {editForm.is_active ? 'نشط' : 'غير نشط'}
                    </span>
                  </label>
                  <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                    <input type="checkbox" checked={editForm.is_visible}
                      disabled={!canManage}
                      onChange={(e) => setEditForm((p: any) => ({ ...p, is_visible: e.target.checked }))}
                      className="accent-primary" />
                    <span className={editForm.is_visible ? 'text-success font-semibold' : 'text-text-secondary'}>
                      {editForm.is_visible ? 'ظاهر' : 'مخفي'}
                    </span>
                  </label>
                </div>
              </div>

              {/* Tier Discounts */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-text-secondary">خصم الشرائح</h4>
                {allTiers.length === 0 ? (
                  <p className="text-xs text-text-secondary">لا توجد شرائح</p>
                ) : (
                  allTiers.map((tier: any) => {
                    const exDiscount = editTierDiscounts[tier.id]
                    const hasException = exDiscount !== undefined && exDiscount !== ''
                    const effectiveDiscount = hasException ? parseFloat(exDiscount) : (tier.discount_percent ?? 0)
                    return (
                      <div key={tier.id} className="flex items-center gap-3 border border-border rounded-lg px-3 py-2.5">
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-semibold text-text block truncate">{tier.name}</span>
                          <span className="text-[10px] text-text-secondary">الافتراضي: {tier.discount_percent}%</span>
                        </div>
                        {canManage ? (
                          <div className="flex items-center gap-1.5">
                            <input type="number" min="0" max="100" step="0.01"
                              value={exDiscount ?? ''}
                              onChange={(e) => setEditTierDiscounts((prev) => ({ ...prev, [tier.id]: e.target.value }))}
                              placeholder="نسبة" className="w-16 border border-border rounded-md px-2 py-1 text-xs text-center bg-surface" dir="ltr" />
                            <span className="text-[10px] text-text-secondary">%</span>
                          </div>
                        ) : (
                          <span className="text-xs font-semibold">{effectiveDiscount}%</span>
                        )}
                      </div>
                    )
                  })
                )}
              </div>

              {/* Save */}
              {canManage && (
                <button onClick={handleEditSave} disabled={editSaving}
                  className="w-full bg-primary text-white rounded-xl py-3 text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                  {editSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> جاري الحفظ...</> : 'حفظ التغييرات'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal ── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center">
          <div className="bg-white rounded-2xl w-full max-w-sm mx-3 shadow-xl">
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-danger/10 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5 text-danger" />
                </div>
                <div>
                  <h3 className="font-bold text-text">حذف المنتج</h3>
                  <p className="text-xs text-text-secondary">{deleteTarget.product_name}</p>
                </div>
              </div>

              {deletePreview && (
                <div className="bg-surface rounded-lg p-3 text-xs space-y-1">
                  <p className="text-text-secondary">
                    سيتم حذف <span className="font-bold text-danger">{deletePreview.direct_count}</span> منتج
                    {deletePreview.related && Object.keys(deletePreview.related).filter((k) => deletePreview.related[k] > 0).length > 0 && (
                      <> و <span className="font-bold text-danger">
                        {Object.values(deletePreview.related as Record<string, number>).reduce((a, b) => a + b, 0)}
                      </span> سجل مرتبط</>
                    )}
                  </p>
                  {deletePreview.related && Object.entries(deletePreview.related as Record<string, number>)
                    .filter(([, v]) => v > 0).length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {Object.entries(deletePreview.related as Record<string, number>)
                        .filter(([, v]) => v > 0)
                        .slice(0, 5)
                        .map(([k, v]) => (
                          <div key={k} className="flex justify-between text-text-secondary">
                            <span>{k}</span>
                            <span className="font-semibold text-danger">{v}</span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}

              <p className="text-xs text-danger/80 bg-danger/5 rounded-lg p-3">
                هذا الإجراء لا يمكن التراجع عنه. سيتم حذف المنتج نهائياً من قاعدة البيانات.
              </p>

              <div className="flex gap-3">
                <button onClick={() => { setDeleteTarget(null); setDeletePreview(null) }}
                  className="flex-1 py-2.5 rounded-lg border border-border text-sm font-semibold text-text-secondary">
                  إلغاء
                </button>
                <button onClick={handleDeleteConfirm} disabled={deleting}
                  className="flex-1 py-2.5 rounded-lg bg-danger text-white text-sm font-semibold hover:bg-danger/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                  {deleting ? <><Loader2 className="w-4 h-4 animate-spin" /> جاري...</> : <><Trash2 className="w-4 h-4" /> حذف</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
