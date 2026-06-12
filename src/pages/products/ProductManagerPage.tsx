import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useCapability } from '../../hooks/useCapability'
import { UNIT_LABELS } from '../../types/order-display'
import toast from 'react-hot-toast'
import { formatCurrencyShort } from '../../utils/format'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function ProductManagerPage() {
  const nav = useNavigate()
  const canManage = useCapability('products.manage')
  const imageInputRef = useRef<HTMLInputElement>(null)

  const [products, setProducts] = useState<any[]>([])
  const [companies, setCompanies] = useState<any[]>([])
  const [allTiers, setAllTiers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [fullProduct, setFullProduct] = useState<any | null>(null)

  const [form, setForm] = useState({
    product_name: '',
    legacy_code: '',
    description: '',
    company_id: '',
    image_url: '',
    inventory_quantity: '',
    carton_quantity: '',
    carton_price: '',
    units: ['piece', 'dozen', 'carton'] as string[],
    is_active: true,
    is_visible: true,
  })

  const [tierDiscounts, setTierDiscounts] = useState<Record<string, string>>({})
  const [productExceptions, setProductExceptions] = useState<{ tier_id: string; id: string; discount_percent: number }[]>([])

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    Promise.all([
      supabase.rpc('get_governed_products', { p_token: token, p_active_only: false, p_visible_only: false }),
      supabase.rpc('get_governed_companies', { p_token: token }),
      supabase.rpc('get_governed_tiers', { p_token: token }),
    ]).then(([prodRes, compRes, tiersRes]) => {
      if (prodRes.data) setProducts(Array.isArray(prodRes.data) ? prodRes.data : [])
      if (compRes.data) setCompanies(Array.isArray(compRes.data) ? compRes.data : [])
      if (tiersRes.data) setAllTiers(Array.isArray(tiersRes.data) ? tiersRes.data : [])
      setLoading(false)
    })
  }, [])

  function extractProductExceptions(productId: string) {
    const exObjs: { tier_id: string; id: string; discount_percent: number }[] = []
    const discounts: Record<string, string> = {}
    for (const tier of allTiers) {
      const exs = (tier.product_exceptions || []).filter(
        (ex: any) => ex.product_id === productId && ex.applies_to_all_tiers === false
      )
      for (const ex of exs) {
        exObjs.push({ tier_id: tier.id, id: ex.id, discount_percent: ex.discount_percent })
        discounts[tier.id] = String(ex.discount_percent)
      }
    }
    setProductExceptions(exObjs)
    setTierDiscounts(discounts)
  }

  useEffect(() => {
    if (selectedId) extractProductExceptions(selectedId)
  }, [allTiers])

  function selectProduct(id: string) {
    const p = products.find((x: any) => x.id === id)
    if (!p) { setSelectedId(null); return }
    setSelectedId(id)
    setFullProduct(p)
    setForm({
      product_name: p.product_name || '',
      legacy_code: p.legacy_code || '',
      description: p.description || '',
      company_id: p.company_id || '',
      image_url: p.image_url || '',
      inventory_quantity: String(p.inventory?.quantity ?? ''),
      carton_quantity: String(p.carton_quantity ?? ''),
      carton_price: String(p.carton_price ?? ''),
      is_active: p.is_active !== false,
      is_visible: p.is_visible !== false,
      units: (p.product_units || []).filter((u: any) => u.is_active !== false).map((u: any) => u.unit_type),
    })
    extractProductExceptions(id)
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      setForm((prev) => ({ ...prev, image_url: ev.target?.result as string }))
    }
    reader.readAsDataURL(file)
  }

  function clearImage() {
    setForm((prev) => ({ ...prev, image_url: '' }))
  }

  function toggleUnit(u: string) {
    setForm((p) => ({
      ...p, units: p.units.includes(u) ? p.units.filter((x) => x !== u) : [...p.units, u],
    }))
  }

  const computedPiecePrice = form.carton_quantity && form.carton_price
    ? parseFloat(form.carton_price) / parseInt(form.carton_quantity)
    : null

  const computedDozenPrice = computedPiecePrice !== null ? computedPiecePrice * 12 : null

  async function handleSave() {
    if (!selectedId || !canManage) return
    const originalProduct = fullProduct || products.find((p: any) => p.id === selectedId)
    setSaving(true)
    const token = getToken()
    try {
      const { error: updateErr } = await supabase.rpc('governed_update_product', {
        p_token: token, p_id: selectedId,
        p_product_name: form.product_name || null,
        p_description: form.description || null,
        p_legacy_code: form.legacy_code || null,
      })
      if (updateErr) { toast.error(updateErr.message); setSaving(false); return }

      if (form.company_id && form.company_id !== originalProduct?.company_id) {
        const { error: compErr } = await supabase.rpc('governed_change_product_company', {
          p_token: token, p_product_id: selectedId, p_new_company_id: form.company_id,
        })
        if (compErr) { toast.error(compErr.message); setSaving(false); return }
      }

      const { error: pricingErr } = await supabase.rpc('governed_update_product_pricing', {
        p_token: token, p_id: selectedId,
        p_carton_price: form.carton_price ? parseFloat(form.carton_price) : null,
        p_carton_quantity: form.carton_quantity ? parseInt(form.carton_quantity) : null,
      })
      if (pricingErr) { toast.error(pricingErr.message); setSaving(false); return }

      const { error: unitsErr } = await supabase.rpc('governed_update_product_units', {
        p_token: token, p_id: selectedId,
        p_units: form.units.map((u) => ({ unit_type: u })),
      })
      if (unitsErr) { toast.error(unitsErr.message); setSaving(false); return }

      const { error: imgErr } = await supabase.from('products').update({
        image_url: form.image_url || null,
      }).eq('id', selectedId)
      if (imgErr) { toast.error('فشل تحديث الصورة: ' + imgErr.message); setSaving(false); return }

      const { error: visErr } = await supabase.from('products').update({
        is_visible: form.is_visible,
      }).eq('id', selectedId)
      if (visErr && visErr.code === 'PGRST204') {
        toast('خاصية الإظهار/الإخفاء تحتاج تحديث حتى تنعكس', { icon: 'ℹ️' })
      } else if (visErr) {
        toast.error('فشل تحديث حالة الظهور: ' + visErr.message)
        setSaving(false); return
      }

      if (form.inventory_quantity) {
        const { error: invErr } = await supabase.from('inventory').upsert({
          product_id: selectedId,
          quantity: parseInt(form.inventory_quantity),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'product_id' })
        if (invErr) { toast.error('فشل تحديث المخزون: ' + invErr.message); setSaving(false); return }
      }

      if (form.is_active !== originalProduct?.is_active) {
        const fn = form.is_active ? 'governed_activate_product' : 'governed_deactivate_product'
        const { error: actErr } = await supabase.rpc(fn, { p_token: token, p_id: selectedId })
        if (actErr) { toast.error(actErr.message); setSaving(false); return }
      }

      for (const tier of allTiers) {
        const newDiscount = tierDiscounts[tier.id]
        const existingEx = productExceptions.find((ex: any) => ex.tier_id === tier.id)
        if (newDiscount !== undefined && newDiscount !== '') {
          const parsed = parseFloat(newDiscount)
          if (isNaN(parsed) || parsed < 0 || parsed > 100) continue
          if (existingEx) {
            await supabase.rpc('governed_remove_tier_product_exception', {
              p_token: token, p_exception_id: existingEx.id,
            })
          }
          await supabase.rpc('governed_set_tier_product_exception', {
            p_token: token,
            p_product_id: selectedId,
            p_discount_percent: parsed,
            p_tier_id: tier.id,
            p_applies_to_all_tiers: false,
          })
        } else if (existingEx) {
          await supabase.rpc('governed_remove_tier_product_exception', {
            p_token: token, p_exception_id: existingEx.id,
          })
        }
      }

      toast.success('تم حفظ التغييرات')

      try { localStorage.removeItem('ahram_company_profile_cache') } catch {}

      const [refreshed, refreshedTiers] = await Promise.all([
        supabase.rpc('get_governed_products', { p_token: token, p_active_only: false, p_visible_only: false }),
        supabase.rpc('get_governed_tiers', { p_token: token }),
      ])
      if (refreshed.data) setProducts(Array.isArray(refreshed.data) ? refreshed.data : [])
      if (refreshedTiers.data) setAllTiers(Array.isArray(refreshedTiers.data) ? refreshedTiers.data : [])
      if (selectedId) selectProduct(selectedId)
    } catch (err: any) {
      toast.error(err.message || 'حدث خطأ')
    }
    setSaving(false)
  }

  const filtered = products.filter((p: any) => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return true
    return (p.product_name || '').toLowerCase().includes(q) ||
      (p.legacy_code || '').toLowerCase().includes(q) ||
      (p.company_name || '').toLowerCase().includes(q)
  })

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center gap-3">
        <button onClick={() => nav('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">إدارة المنتجات</h1>
        {!canManage && <span className="text-[10px] bg-warning/10 text-warning px-2 py-0.5 rounded">عرض فقط</span>}
      </div>

      <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="بحث باسم المنتج أو الكود أو الشركة..." className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />

      <select value={selectedId || ''} onChange={(e) => selectProduct(e.target.value)}
        className="w-full border border-border rounded-lg px-2 py-1.5 text-xs bg-white">
        <option value="">اختر منتج...</option>
        {filtered.map((p: any) => (
          <option key={p.id} value={p.id}>
            {p.product_name} ({p.legacy_code}) — {p.company_name} {!p.is_active ? '— موقوف' : ''}
          </option>
        ))}
      </select>

      {selectedId && (
        <div className="space-y-4">

          {/* ===== Identity ===== */}
          <div className="bg-white rounded-xl border border-border p-4 space-y-3">
            <h2 className="text-sm font-bold">بيانات المنتج</h2>
            <div>
              <label className="text-[10px] text-text-secondary block mb-0.5">المُعرّف (ID)</label>
              <input type="text" value={selectedId} readOnly
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface/50 text-text-secondary" dir="ltr" />
            </div>
            <div>
              <label className="text-[10px] text-text-secondary block mb-0.5">اسم المنتج</label>
              <input type="text" value={form.product_name}
                onChange={(e) => setForm((p) => ({ ...p, product_name: e.target.value }))}
                readOnly={!canManage} className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
            </div>
            <div>
              <label className="text-[10px] text-text-secondary block mb-0.5">الكود القديم</label>
              <input type="text" value={form.legacy_code}
                onChange={(e) => setForm((p) => ({ ...p, legacy_code: e.target.value }))}
                readOnly={!canManage} className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" dir="ltr" />
            </div>
            <div>
              <label className="text-[10px] text-text-secondary block mb-0.5">الوصف</label>
              <textarea value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                readOnly={!canManage} className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white resize-none" rows={3} />
            </div>
          </div>

          {/* ===== Company ===== */}
          <div className="bg-white rounded-xl border border-border p-4 space-y-3">
            <h2 className="text-sm font-bold">الشركة</h2>
            <select value={form.company_id}
              onChange={(e) => setForm((p) => ({ ...p, company_id: e.target.value }))}
              disabled={!canManage}
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white">
              <option value="">اختر شركة...</option>
              {companies.map((c: any) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </div>

          {/* ===== Media ===== */}
          <div className="bg-white rounded-xl border border-border p-4 space-y-3">
            <h2 className="text-sm font-bold">صورة المنتج</h2>
            {form.image_url ? (
              <div className="relative mb-2">
                <img src={form.image_url} alt="" className="w-full h-40 object-contain rounded-lg border border-border bg-surface" />
                {canManage && (
                  <button onClick={clearImage}
                    className="absolute top-2 left-2 bg-danger text-white text-[10px] px-2 py-1 rounded-lg">حذف</button>
                )}
              </div>
            ) : (
              <div className="w-full h-36 bg-surface rounded-lg border border-border flex items-center justify-center mb-2">
                <span className="text-text-secondary text-xs">لا توجد صورة</span>
              </div>
            )}
            {canManage && (
              <div className="flex gap-2">
                <button onClick={() => imageInputRef.current?.click()}
                  className="flex-1 bg-primary/10 text-primary text-[11px] py-2 rounded-lg font-semibold">رفع</button>
                <input ref={imageInputRef} type="file" accept="image/*" className="hidden"
                  onChange={handleFileSelect} />
                <input type="text" value={form.image_url}
                  onChange={(e) => setForm((p) => ({ ...p, image_url: e.target.value }))}
                  placeholder="أو الصق الرابط..." className="flex-[2] border border-border rounded-lg px-3 py-2 text-xs bg-white" dir="ltr" />
              </div>
            )}
          </div>

          {/* ===== Inventory ===== */}
          <div className="bg-white rounded-xl border border-border p-4 space-y-3">
            <h2 className="text-sm font-bold">المخزون</h2>
            <div>
              <label className="text-[10px] text-text-secondary block mb-0.5">الكمية (قطع)</label>
              <input type="number" value={form.inventory_quantity}
                onChange={(e) => setForm((p) => ({ ...p, inventory_quantity: e.target.value }))}
                readOnly={!canManage} className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
            </div>
          </div>

          {/* ===== Packaging ===== */}
          <div className="bg-white rounded-xl border border-border p-4 space-y-3">
            <h2 className="text-sm font-bold">التعبئة</h2>
            <div>
              <label className="text-[10px] text-text-secondary block mb-0.5">عدد القطع في الكرتونة</label>
              <input type="number" value={form.carton_quantity}
                onChange={(e) => setForm((p) => ({ ...p, carton_quantity: e.target.value }))}
                readOnly={!canManage} className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
            </div>
          </div>

          {/* ===== Units ===== */}
          <div className="bg-white rounded-xl border border-border p-4 space-y-3">
            <h2 className="text-sm font-bold">وحدات البيع النشطة</h2>
            <div className="flex gap-4">
              {['piece', 'dozen', 'carton'].map((u) => (
                <label key={u} className="flex items-center gap-2 text-xs cursor-pointer select-none">
                  <input type="checkbox" checked={form.units.includes(u)}
                    disabled={!canManage}
                    onChange={() => toggleUnit(u)} />
                  <span className={form.units.includes(u) ? 'text-text font-semibold' : 'text-text-secondary'}>
                    {UNIT_LABELS[u]}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* ===== Manual Pricing ===== */}
          <div className="bg-white rounded-xl border border-border p-4 space-y-3">
            <h2 className="text-sm font-bold">التسعير اليدوي</h2>
            <div>
              <label className="text-[10px] text-text-secondary block mb-0.5">سعر الكرتونة</label>
              <input type="number" step="0.01" value={form.carton_price}
                onChange={(e) => setForm((p) => ({ ...p, carton_price: e.target.value }))}
                readOnly={!canManage} className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
            </div>
            {computedPiecePrice !== null && (
              <div className="text-[11px] text-text-secondary space-y-0.5 bg-surface rounded-lg p-3">
                <div>سعر القطعة المحسوب: <span className="font-semibold text-text">{formatCurrencyShort(computedPiecePrice)}</span></div>
                <div>سعر الدستة المحسوب: <span className="font-semibold text-text">{formatCurrencyShort(computedDozenPrice!)}</span></div>
              </div>
            )}
          </div>

          {/* ===== Tier Pricing ===== */}
          <div className="bg-white rounded-xl border border-border p-4 space-y-3">
            <h2 className="text-sm font-bold">خصم الشرائح</h2>
            {allTiers.length === 0 && (
              <p className="text-xs text-text-secondary">لا توجد شرائح</p>
            )}
            {allTiers.map((tier: any) => {
              const exDiscount = tierDiscounts[tier.id]
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
                        onChange={(e) => setTierDiscounts((prev) => ({ ...prev, [tier.id]: e.target.value }))}
                        placeholder="نسبة"
                        className="w-16 border border-border rounded-md px-2 py-1 text-xs text-center bg-white" dir="ltr" />
                      <span className="text-[10px] text-text-secondary">%</span>
                    </div>
                  ) : (
                    <span className="text-xs font-semibold">{effectiveDiscount}%</span>
                  )}
                </div>
              )
            })}
          </div>

          {/* ===== Visibility ===== */}
          <div className="bg-white rounded-xl border border-border p-4 space-y-3">
            <h2 className="text-sm font-bold">حالة المنتج</h2>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                <input type="checkbox" checked={form.is_active}
                  disabled={!canManage}
                  onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))} />
                <span className={form.is_active ? 'text-success font-semibold' : 'text-text-secondary'}>
                  {form.is_active ? 'نشط' : 'غير نشط'}
                </span>
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                <input type="checkbox" checked={form.is_visible}
                  disabled={!canManage}
                  onChange={(e) => setForm((p) => ({ ...p, is_visible: e.target.checked }))} />
                <span className={form.is_visible ? 'text-success font-semibold' : 'text-text-secondary'}>
                  {form.is_visible ? 'ظاهر' : 'مخفي'}
                </span>
              </label>
            </div>
          </div>

          {canManage && (
            <button onClick={handleSave} disabled={saving}
              className="w-full bg-primary text-white rounded-xl py-3 text-sm font-semibold active:opacity-90 disabled:opacity-40">
              {saving ? 'جاري الحفظ...' : 'حفظ التغييرات'}
            </button>
          )}
        </div>
      )}

      {!selectedId && !loading && (
        <div className="text-center py-12 text-text-secondary text-sm">اختر منتج من القائمة أعلاه</div>
      )}
    </div>
  )
}
