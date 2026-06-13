import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useCapability } from '../../hooks/useCapability'
import { useCompaniesStore } from '../../store/companies'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function CompanyManagerPage() {
  const nav = useNavigate()
  const canManage = useCapability('companies.manage')
  const logoInputRef = useRef<HTMLInputElement>(null)
  const [companies, setCompanies] = useState<any[]>([])
  const [allTiers, setAllTiers] = useState<any[]>([])
  const [companyExceptions, setCompanyExceptions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [fullCompany, setFullCompany] = useState<any | null>(null)

  const [form, setForm] = useState({
    company_name: '',
    legacy_code: '',
    logo_url: '',
    is_active: true,
    is_visible: true,
  })

  const [tierDiscounts, setTierDiscounts] = useState<Record<string, string>>({})

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    Promise.all([
      supabase.rpc('get_governed_companies', { p_token: token }),
      supabase.rpc('get_governed_tiers', { p_token: token }),
    ]).then(([compRes, tiersRes]) => {
      if (compRes.data) setCompanies(Array.isArray(compRes.data) ? compRes.data : [])
      if (tiersRes.data) setAllTiers(Array.isArray(tiersRes.data) ? tiersRes.data : [])
      setLoading(false)
    })
  }, [])

  function extractExceptions(id: string) {
    const allExs: { tier_id: string; id: string; discount_percent: number }[] = []
    const discounts: Record<string, string> = {}
    for (const tier of allTiers) {
      const exs = (tier.company_exceptions || []).filter((ex: any) => ex.company_id === id)
      for (const ex of exs) {
        allExs.push({ tier_id: tier.id, id: ex.id, discount_percent: ex.discount_percent })
        discounts[tier.id] = String(ex.discount_percent)
      }
    }
    setCompanyExceptions(allExs)
    setTierDiscounts(discounts)
  }

  useEffect(() => {
    if (selectedId) extractExceptions(selectedId)
  }, [allTiers])

  async function selectCompany(id: string) {
    const c = companies.find((x: any) => x.id === id)
    if (!c) { setSelectedId(null); return }
    setSelectedId(id)

    const { data: full } = await supabase.from('companies').select('*').eq('id', id).single()
    setFullCompany(full || c)
    setForm({
      company_name: (full?.company_name || c.company_name) ?? '',
      legacy_code: (full?.legacy_code || c.legacy_code) ?? '',
      logo_url: (full?.logo_url || c.logo_url) ?? '',
      is_active: full?.is_active ?? c.is_active ?? true,
      is_visible: full?.is_visible ?? c.is_visible ?? true,
    })

    extractExceptions(id)
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      setForm((prev) => ({ ...prev, logo_url: ev.target?.result as string }))
    }
    reader.readAsDataURL(file)
  }

  function clearLogo() {
    setForm((prev) => ({ ...prev, logo_url: '' }))
  }

  async function handleSave() {
    if (!selectedId || !canManage) return
    const originalCompany = fullCompany || companies.find((c: any) => c.id === selectedId)
    setSaving(true)
    const token = getToken()
    try {
      const { error } = await supabase.rpc('governed_update_company', {
        p_token: token,
        p_id: selectedId,
        p_company_name: form.company_name || null,
        p_legacy_code: form.legacy_code || null,
        p_logo_url: form.logo_url || null,
        p_is_visible: form.is_visible,
      })
      if (error) { toast.error(error.message); setSaving(false); return }

      if (form.is_active !== originalCompany?.is_active) {
        const fn = form.is_active ? 'governed_activate_company' : 'governed_deactivate_company'
        const { error: actErr } = await supabase.rpc(fn, { p_token: token, p_id: selectedId })
        if (actErr) { toast.error(actErr.message); setSaving(false); return }
      }

      for (const tier of allTiers) {
        const newDiscount = tierDiscounts[tier.id]
        const existingEx = companyExceptions.find((ex: any) => ex.tier_id === tier.id)
        if (newDiscount !== undefined && newDiscount !== '') {
          const parsed = parseFloat(newDiscount)
          if (isNaN(parsed) || parsed < 0 || parsed > 100) continue
          await supabase.rpc('governed_set_tier_company_exception', {
            p_token: token,
            p_tier_id: tier.id,
            p_company_id: selectedId,
            p_discount_percent: parsed,
          })
        } else if (existingEx) {
          await supabase.rpc('governed_remove_tier_company_exception', {
            p_token: token,
            p_exception_id: existingEx.id,
          })
        }
      }

      toast.success('تم حفظ التغييرات')
      useCompaniesStore.getState().triggerRefresh()
      try { localStorage.removeItem('ahram_company_profile_cache') } catch {}

      const [refreshed, refreshedTiers] = await Promise.all([
        supabase.rpc('get_governed_companies', { p_token: token }),
        supabase.rpc('get_governed_tiers', { p_token: token }),
      ])
      if (refreshed.data) setCompanies(Array.isArray(refreshed.data) ? refreshed.data : [])
      if (refreshedTiers.data) setAllTiers(Array.isArray(refreshedTiers.data) ? refreshedTiers.data : [])
      if (selectedId) selectCompany(selectedId)
    } catch (err: any) {
      toast.error(err.message || 'حدث خطأ')
    }
    setSaving(false)
  }

  const filtered = companies.filter((c: any) => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return true
    return (c.company_name || '').toLowerCase().includes(q) ||
      (c.legacy_code || '').toLowerCase().includes(q)
  })

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center gap-3">
        <button onClick={() => nav('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">إدارة الشركات</h1>
        {!canManage && <span className="text-[10px] bg-warning/10 text-warning px-2 py-0.5 rounded">عرض فقط</span>}
      </div>

      <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="بحث بالاسم أو الكود..." className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />

      <select value={selectedId || ''} onChange={(e) => selectCompany(e.target.value)}
        className="w-full border border-border rounded-lg px-2 py-1.5 text-xs bg-white">
        <option value="">اختر شركة...</option>
        {filtered.map((c: any) => (
          <option key={c.id} value={c.id}>
            {c.company_name} ({c.legacy_code}) {!c.is_active ? '— موقوف' : ''}
          </option>
        ))}
      </select>

      {selectedId && (
        <div className="space-y-4">

          {/* ===== Identity ===== */}
          <div className="bg-white rounded-xl border border-border p-4 space-y-3">
            <h2 className="text-sm font-bold">بيانات الشركة</h2>
            <div>
              <label className="text-[10px] text-text-secondary block mb-0.5">المُعرّف (ID)</label>
              <input type="text" value={selectedId} readOnly
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface/50 text-text-secondary" dir="ltr" />
            </div>
            <div>
              <label className="text-[10px] text-text-secondary block mb-0.5">اسم الشركة</label>
              <input type="text" value={form.company_name}
                onChange={(e) => setForm((p) => ({ ...p, company_name: e.target.value }))}
                readOnly={!canManage} className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
            </div>
            <div>
              <label className="text-[10px] text-text-secondary block mb-0.5">الكود القديم</label>
              <input type="text" value={form.legacy_code}
                onChange={(e) => setForm((p) => ({ ...p, legacy_code: e.target.value }))}
                readOnly={!canManage} className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" dir="ltr" />
            </div>
          </div>

          {/* ===== Media ===== */}
          <div className="bg-white rounded-xl border border-border p-4 space-y-3">
            <h2 className="text-sm font-bold">الشعار</h2>
            {form.logo_url ? (
              <div className="relative mb-2">
                <img src={form.logo_url} alt="logo" className="w-full h-36 object-contain rounded-lg border border-border bg-surface" />
                {canManage && (
                  <button onClick={clearLogo}
                    className="absolute top-2 left-2 bg-danger text-white text-[10px] px-2 py-1 rounded-lg">حذف</button>
                )}
              </div>
            ) : (
              <div className="w-full h-36 bg-surface rounded-lg border border-border flex items-center justify-center mb-2">
                <span className="text-text-secondary text-xs">لا يوجد شعار</span>
              </div>
            )}
            {canManage && (
              <div className="flex gap-2">
                <button onClick={() => logoInputRef.current?.click()}
                  className="flex-1 bg-primary/10 text-primary text-[11px] py-2 rounded-lg font-semibold">رفع</button>
                <input ref={logoInputRef} type="file" accept="image/*" className="hidden"
                  onChange={handleFileSelect} />
                <input type="text" value={form.logo_url}
                  onChange={(e) => setForm((p) => ({ ...p, logo_url: e.target.value }))}
                  placeholder="أو الصق الرابط..." className="flex-[2] border border-border rounded-lg px-3 py-2 text-xs bg-white" dir="ltr" />
              </div>
            )}
          </div>

          {/* ===== Status ===== */}
          <div className="bg-white rounded-xl border border-border p-4 space-y-3">
            <h2 className="text-sm font-bold">حالة الشركة</h2>
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

          {/* ===== Tier Pricing ===== */}
          <div className="bg-white rounded-xl border border-border p-4 space-y-3">
            <h2 className="text-sm font-bold">خصم الشرائح</h2>
            {allTiers.length === 0 && (
              <p className="text-xs text-text-secondary">لا توجد شرائح</p>
            )}
            {allTiers.map((tier: any) => {
              const exDiscount = tierDiscounts[tier.id]
              const hasException = exDiscount !== undefined && exDiscount !== ''
              const effectiveDiscount = hasException ? parseFloat(exDiscount) : tier.discount_percent
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

          {canManage && (
            <button onClick={handleSave} disabled={saving}
              className="w-full bg-primary text-white rounded-xl py-3 text-sm font-semibold active:opacity-90 disabled:opacity-40">
              {saving ? 'جاري الحفظ...' : 'حفظ التغييرات'}
            </button>
          )}
        </div>
      )}

      {!selectedId && !loading && (
        <div className="text-center py-12 text-text-secondary text-sm">اختر شركة من القائمة أعلاه</div>
      )}
    </div>
  )
}
