import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useCapability } from '../../hooks/useCapability'
import { useCompaniesStore } from '../../store/companies'
import { usePersistentViewState } from '../../hooks/usePersistentViewState'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

type FilterMode = 'all' | 'visible' | 'hidden'

const EMPTY_FORM = {
  company_name: '',
  legacy_code: '',
  logo_url: '',
  is_visible: true,
}

export function CompanyManagerPage() {
  const nav = useNavigate()
  const canManage = useCapability('companies.manage')
  const canDelete = useCapability('data.deletion_center')
  const [companies, setCompanies] = useState<any[]>([])
  const [allTiers, setAllTiers] = useState<any[]>([])
  const [companyExceptions, setCompanyExceptions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [viewState, setViewState] = usePersistentViewState('companies-manage', {
    searchQuery: '',
  })
  const { searchQuery } = viewState

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [filter, setFilter] = useState<FilterMode>('all')

  const [form, setForm] = useState(EMPTY_FORM)
  const [tierDiscounts, setTierDiscounts] = useState<Record<string, string>>({})
  const [logoInputId, setLogoInputId] = useState('logo-create')

  const [deleteTarget, setDeleteTarget] = useState<any | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null)
      }
    }
    if (openMenuId) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [openMenuId])

  const loadCompanies = useCallback(async () => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    const [compRes, tiersRes] = await Promise.all([
      supabase.rpc('get_governed_companies', { p_token: token }),
      supabase.rpc('get_governed_tiers', { p_token: token }),
    ])
    const compData = Array.isArray(compRes.data) ? compRes.data : []
    const tiersData = Array.isArray(tiersRes.data) ? tiersRes.data : []
    setCompanies(compData)
    setAllTiers(tiersData)
    setLoading(false)
    return { compData, tiersData }
  }, [])

  useEffect(() => { loadCompanies() }, [loadCompanies])

  function extractExceptions(id: string, tiers?: any[]) {
    const tierList = tiers || allTiers
    const allExs: { tier_id: string; id: string; discount_percent: number }[] = []
    const discounts: Record<string, string> = {}
    for (const tier of tierList) {
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
  }, [allTiers, selectedId])

  function selectCompany(id: string) {
    if (isEditing || isCreating) return
    setSelectedId(id === selectedId ? null : id)
  }

  function handleStartEdit(id?: string) {
    const targetId = id || selectedId
    if (!targetId) return
    const c = companies.find((x: any) => x.id === targetId)
    if (!c) return
    setIsCreating(false)
    setIsEditing(true)
    setSelectedId(targetId)
    setForm({
      company_name: c.company_name ?? '',
      legacy_code: c.legacy_code ?? '',
      logo_url: c.logo_url ?? '',
      is_visible: c.is_visible ?? true,
    })
    extractExceptions(targetId)
  }

  function handleCancelEdit() {
    setIsEditing(false)
    setIsCreating(false)
    setForm(EMPTY_FORM)
  }

  function handleNewCompany() {
    setIsCreating(true)
    setIsEditing(false)
    setSelectedId(null)
    setForm(EMPTY_FORM)
    setCompanyExceptions([])
    setTierDiscounts({})
  }

  function handleLogoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setForm((p) => ({ ...p, logo_url: ev.target?.result as string }))
    reader.readAsDataURL(file)
  }

  async function refreshData() {
    const token = getToken()
    if (!token) return
    const [refreshed, refreshedTiers] = await Promise.all([
      supabase.rpc('get_governed_companies', { p_token: token }),
      supabase.rpc('get_governed_tiers', { p_token: token }),
    ])
    if (refreshed.data) setCompanies(Array.isArray(refreshed.data) ? refreshed.data : [])
    if (refreshedTiers.data) setAllTiers(Array.isArray(refreshedTiers.data) ? refreshedTiers.data : [])
  }

  async function handleToggleVisibility(c: any) {
    if (!canManage) return
    const token = getToken()
    if (!token) return
    const { error } = await supabase.rpc('governed_update_company', {
      p_token: token,
      p_id: c.id,
      p_is_visible: !c.is_visible,
    })
    if (error) { toast.error(error.message); return }
    toast.success(c.is_visible ? 'تم إخفاء الشركة' : 'تم إظهار الشركة')
    useCompaniesStore.getState().triggerRefresh()
    try { localStorage.removeItem('ahram_company_profile_cache') } catch {}
    await refreshData()
  }

  async function handleDeleteCompany() {
    if (!deleteTarget || !canManage) return
    const token = getToken()
    if (!token) return
    setDeleting(true)
    try {
      const { data, error } = await supabase.rpc('governed_deletion_execute_companies', {
        p_token: token,
        p_ids: [deleteTarget.id],
        p_dry_run: false,
      })
      if (error) { toast.error(error.message); setDeleting(false); return }
      if (data?.error) { toast.error(data.error); setDeleting(false); return }
      toast.success('تم حذف الشركة')
      if (selectedId === deleteTarget.id) {
        setSelectedId(null)
        setIsEditing(false)
      }
      setDeleteTarget(null)
      useCompaniesStore.getState().triggerRefresh()
      try { localStorage.removeItem('ahram_company_profile_cache') } catch {}
      await refreshData()
    } catch (err: any) {
      toast.error(err.message || 'حدث خطأ أثناء الحذف')
    }
    setDeleting(false)
  }

  async function handleSave() {
    if (!canManage) return
    const token = getToken()
    if (!token) return
    setSaving(true)

    try {
      let targetId = selectedId

      if (isCreating) {
        const { data, error } = await supabase.rpc('governed_create_company', {
          p_token: token,
          p_company_name: form.company_name,
          p_legacy_code: form.legacy_code,
        })
        if (error) { toast.error(error.message); setSaving(false); return }
        if (data?.error) { toast.error(data.error); setSaving(false); return }
        targetId = data?.id

        if (targetId && (form.logo_url || !form.is_visible)) {
          await supabase.rpc('governed_update_company', {
            p_token: token,
            p_id: targetId,
            p_logo_url: form.logo_url || null,
            p_is_visible: form.is_visible,
          })
        }

        if (targetId) {
          for (const tier of allTiers) {
            const newDiscount = tierDiscounts[tier.id]
            if (newDiscount !== undefined && newDiscount !== '') {
              const parsed = parseFloat(newDiscount)
              if (isNaN(parsed) || parsed < 0 || parsed > 100) continue
              await supabase.rpc('governed_set_tier_company_exception', {
                p_token: token, p_tier_id: tier.id, p_company_id: targetId, p_discount_percent: parsed,
              })
            }
          }
        }

        toast.success('تم إنشاء الشركة')
      } else {
        if (!targetId) { setSaving(false); return }

        const { error } = await supabase.rpc('governed_update_company', {
          p_token: token, p_id: targetId,
          p_company_name: form.company_name || null,
          p_legacy_code: form.legacy_code || null,
          p_logo_url: form.logo_url || null,
          p_is_visible: form.is_visible,
        })
        if (error) { toast.error(error.message); setSaving(false); return }

        for (const tier of allTiers) {
          const newDiscount = tierDiscounts[tier.id]
          const existingEx = companyExceptions.find((ex: any) => ex.tier_id === tier.id)
          if (newDiscount !== undefined && newDiscount !== '') {
            const parsed = parseFloat(newDiscount)
            if (isNaN(parsed) || parsed < 0 || parsed > 100) continue
            await supabase.rpc('governed_set_tier_company_exception', {
              p_token: token, p_tier_id: tier.id, p_company_id: targetId, p_discount_percent: parsed,
            })
          } else if (existingEx) {
            await supabase.rpc('governed_remove_tier_company_exception', {
              p_token: token, p_exception_id: existingEx.id,
            })
          }
        }

        toast.success('تم حفظ التغييرات')
      }

      useCompaniesStore.getState().triggerRefresh()
      try { localStorage.removeItem('ahram_company_profile_cache') } catch {}

      setIsEditing(false)
      setIsCreating(false)
      await refreshData()
      if (targetId) setSelectedId(targetId)
    } catch (err: any) {
      toast.error(err.message || 'حدث خطأ')
    }
    setSaving(false)
  }

  const filtered = companies.filter((c: any) => {
    if (filter === 'visible') return c.is_visible
    if (filter === 'hidden') return c.is_visible === false
    return true
  }).filter((c: any) => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return true
    return (c.company_name || '').toLowerCase().includes(q) ||
      (c.legacy_code || '').toLowerCase().includes(q)
  })

  const selectedCompany = selectedId ? companies.find((c: any) => c.id === selectedId) : null
  const showEditor = isCreating || isEditing
  const canSave = isCreating
    ? canManage && form.company_name.trim() !== '' && form.legacy_code.trim() !== ''
    : canManage && !!selectedId

  const visibleCount = companies.filter((c) => c.is_visible).length
  const hiddenCount = companies.filter((c) => c.is_visible === false).length

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-[1600px] mx-auto px-4 py-5 space-y-5">

        {/* ===== Header ===== */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => nav('/dashboard')}
              className="w-8 h-8 rounded-lg bg-white border border-border flex items-center justify-center text-text-secondary hover:text-text hover:border-primary/30 transition-all text-sm">
              &rarr;
            </button>
            <div>
              <h1 className="text-xl font-extrabold text-text tracking-tight">إدارة الشركات</h1>
              <p className="text-[11px] text-text-secondary mt-0.5">{companies.length} شركة &middot; {visibleCount} ظاهر &middot; {hiddenCount} مخفي</p>
            </div>
          </div>
          {canManage && !showEditor && (
            <button onClick={handleNewCompany}
              className="bg-primary text-white text-xs px-4 py-2.5 rounded-xl font-bold hover:bg-primary-dark transition-colors active:scale-[0.97] shadow-sm shadow-primary/20">
              + شركة جديدة
            </button>
          )}
        </div>

        {/* ===== Search & Filters ===== */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted text-sm">🔍</span>
            <input type="text" value={searchQuery}
              onChange={(e) => setViewState({ searchQuery: e.target.value })}
              placeholder="بحث بالاسم أو الكود..."
              className="w-full pr-9 pl-4 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all" />
          </div>
          <div className="flex gap-1.5 bg-white border border-border rounded-xl p-1">
            {([
              { key: 'all' as FilterMode, label: 'الكل', count: companies.length },
              { key: 'visible' as FilterMode, label: 'ظاهر', count: visibleCount },
              { key: 'hidden' as FilterMode, label: 'مخفي', count: hiddenCount },
            ]).map((f) => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={`px-4 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                  filter === f.key
                    ? 'bg-primary text-white shadow-sm shadow-primary/20'
                    : 'text-text-secondary hover:text-text hover:bg-surface'
                }`}>
                {f.label} <span className="opacity-60">{f.count}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ===== Company Cards Grid ===== */}
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-border overflow-hidden animate-pulse">
                <div className="p-4 flex gap-3 items-center">
                  <div className="w-14 h-14 rounded-xl bg-surface shrink-0" />
                  <div className="space-y-2 flex-1"><div className="h-4 bg-surface rounded w-3/4" /><div className="h-3 bg-surface rounded w-1/2" /></div>
                </div>
                <div className="px-4 py-2.5 border-t border-border bg-surface/30"><div className="h-5 bg-surface rounded-full w-24" /></div>
                <div className="flex border-t border-border"><div className="flex-1 h-10 bg-surface" /><div className="w-px bg-border" /><div className="flex-1 h-10 bg-surface" /><div className="w-px bg-border" /><div className="w-10 h-10 bg-surface" /></div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-border">
            <span className="text-4xl block mb-3">🏢</span>
            <p className="text-sm text-text-secondary font-semibold">
              {searchQuery ? 'لا توجد نتائج مطابقة للبحث' : 'لا توجد شركات'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {filtered.map((c: any) => {
              const isSelected = selectedId === c.id
              return (
                <div key={c.id}
                  onClick={() => selectCompany(c.id)}
                  className={`group bg-white rounded-2xl border-2 transition-all duration-200 cursor-pointer overflow-hidden flex flex-col ${
                    isSelected
                      ? 'border-primary shadow-lg shadow-primary/15 ring-1 ring-primary/10'
                      : 'border-border hover:border-primary/35 hover:shadow-lg hover:shadow-black/[0.06] hover:-translate-y-0.5'
                  }`}>

                  {/* SECTION 1: Header — Logo + Name + Count */}
                  <div className="flex items-center gap-3 p-3.5 pb-3">
                    <div className={`shrink-0 w-[62px] h-[62px] rounded-xl flex items-center justify-center overflow-hidden transition-all ${
                      isSelected ? 'bg-primary/10 ring-2 ring-primary/20' : 'bg-surface group-hover:bg-primary/[0.06]'
                    }`}>
                      {c.logo_url ? (
                        <img src={c.logo_url} alt="" className="w-full h-full object-contain p-1" />
                      ) : (
                        <span className="text-2xl opacity-30">🏢</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[24px] font-extrabold text-text leading-tight truncate tracking-tight">
                        {c.company_name}
                      </div>
                      <div className="text-[22px] font-semibold text-text-secondary mt-1">
                        {c.product_count ?? 0} منتج
                      </div>
                    </div>
                  </div>

                  {/* SECTION 2: Status — Visibility badge */}
                  <div className={`mx-3.5 px-3 py-2 rounded-lg flex items-center gap-2 ${
                    c.is_visible ? 'bg-emerald-50' : 'bg-amber-50'
                  }`}>
                    <span className={`w-2 h-2 rounded-full shrink-0 ${c.is_visible ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    <span className={`text-[22px] font-bold ${
                      c.is_visible ? 'text-emerald-700' : 'text-amber-700'
                    }`}>
                      {c.is_visible ? 'ظاهر للعملاء' : 'مخفي عن العملاء'}
                    </span>
                  </div>

                  {/* SECTION 3: Actions — Edit / Toggle / More */}
                  {canManage && (
                    <div className="flex items-stretch mt-3 border-t border-border/60">
                      <button onClick={(e) => { e.stopPropagation(); handleStartEdit(c.id) }}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[22px] font-bold text-primary hover:bg-primary/10 transition-all active:scale-[0.97]"
                        title="تعديل">
                        <span className="text-xl">✏️</span>
                        <span>تعديل</span>
                      </button>
                      <div className="w-px bg-border/60" />
                      <button onClick={(e) => { e.stopPropagation(); handleToggleVisibility(c) }}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[22px] font-bold transition-all active:scale-[0.97] ${
                          c.is_visible
                            ? 'text-amber-600 hover:bg-amber-50'
                            : 'text-emerald-600 hover:bg-emerald-50'
                        }`}
                        title={c.is_visible ? 'إخفاء' : 'إظهار'}>
                        <span className="text-xl">{c.is_visible ? '🙈' : '👁️'}</span>
                        <span>{c.is_visible ? 'إخفاء' : 'إظهار'}</span>
                      </button>
                      <div className="w-px bg-border/60" />
                      <div className="relative" ref={openMenuId === c.id ? menuRef : undefined}>
                        <button onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId(openMenuId === c.id ? null : c.id)
                        }}
                          className="w-10 flex items-center justify-center text-text-secondary hover:bg-surface transition-all active:scale-[0.97] text-sm font-bold"
                          title="المزيد">
                          ⋮
                        </button>
                        {openMenuId === c.id && (
                          <div className="absolute bottom-full left-0 mb-1.5 w-44 bg-white rounded-xl border border-border shadow-xl z-50 py-1 overflow-hidden">
                            {canDelete ? (
                              <button onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuId(null);
                                setDeleteTarget(c);
                              }}
                                className="w-full text-right px-3 py-2.5 text-[11px] font-semibold text-danger hover:bg-danger/5 transition-colors flex items-center gap-2">
                                <span>🗑️</span>
                                <span>حذف الشركة</span>
                              </button>
                            ) : (
                              <div className="px-3 py-2.5 text-[10px] text-text-muted">
                                لا توجد صلاحية حذف
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ===== Editor ===== */}
        {showEditor && (
          <div className="space-y-4 bg-white rounded-2xl border border-border p-5 mt-2">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <h2 className="text-sm font-bold text-text">
                {isCreating ? 'بيانات الشركة الجديدة' : `تعديل: ${selectedCompany?.company_name || ''}`}
              </h2>
              <button onClick={handleCancelEdit}
                className="text-text-secondary text-xs font-semibold hover:text-danger transition-colors px-3 py-1.5 rounded-lg hover:bg-danger/5">
                إلغاء
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] text-text-secondary font-bold block mb-1">اسم الشركة *</label>
                <input type="text" value={form.company_name}
                  onChange={(e) => setForm((p) => ({ ...p, company_name: e.target.value }))}
                  placeholder="اسم الشركة..."
                  className="w-full border border-border rounded-xl px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all" />
              </div>
              <div>
                <label className="text-[10px] text-text-secondary font-bold block mb-1">الكود القديم *</label>
                <input type="text" value={form.legacy_code}
                  onChange={(e) => setForm((p) => ({ ...p, legacy_code: e.target.value }))}
                  placeholder="الكود..."
                  className="w-full border border-border rounded-xl px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all" dir="ltr" />
              </div>
            </div>

            <div>
              <label className="text-[10px] text-text-secondary font-bold block mb-1">الشعار</label>
              {form.logo_url ? (
                <div className="relative inline-block">
                  <img src={form.logo_url} alt="logo" className="w-28 h-28 object-contain rounded-xl border border-border bg-surface" />
                  <button onClick={() => setForm((p) => ({ ...p, logo_url: '' }))}
                    className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-danger text-white text-[10px] flex items-center justify-center shadow-sm">×</button>
                </div>
              ) : (
                <div className="flex gap-2 items-center">
                  <button onClick={() => document.getElementById(logoInputId)?.click()}
                    className="bg-primary/10 text-primary text-[11px] px-4 py-2.5 rounded-xl font-bold hover:bg-primary/15 transition-colors">رفع صورة</button>
                  <input id={logoInputId} type="file" accept="image/*" className="hidden" onChange={handleLogoSelect} />
                  <input type="text" value={form.logo_url}
                    onChange={(e) => setForm((p) => ({ ...p, logo_url: e.target.value }))}
                    placeholder="أو الصق الرابط..."
                    className="flex-1 border border-border rounded-xl px-3.5 py-2.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all" dir="ltr" />
                </div>
              )}
            </div>

            <div>
              <label className="text-[10px] text-text-secondary font-bold block mb-1">الظهور</label>
              <label className="flex items-center gap-2.5 cursor-pointer select-none bg-surface/50 rounded-xl px-4 py-3 w-fit">
                <div className={`relative w-10 h-5 rounded-full transition-colors ${form.is_visible ? 'bg-success' : 'bg-border'}`}
                  onClick={() => setForm((p) => ({ ...p, is_visible: !p.is_visible }))}>
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${form.is_visible ? 'right-0.5' : 'left-0.5'}`} />
                </div>
                <span className="text-xs font-bold text-text">{form.is_visible ? 'ظاهر للعملاء' : 'مخفي عن العملاء'}</span>
              </label>
            </div>

            <div>
              <label className="text-[10px] text-text-secondary font-bold block mb-2">خصم الشرائح</label>
              {allTiers.length === 0 ? (
                <p className="text-xs text-text-secondary">لا توجد شرائح</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {allTiers.map((tier: any) => {
                    const exDiscount = tierDiscounts[tier.id]
                    const hasException = exDiscount !== undefined && exDiscount !== ''
                    const effectiveDiscount = hasException ? parseFloat(exDiscount) : tier.discount_percent
                    return (
                      <div key={tier.id} className="flex items-center gap-3 border border-border rounded-xl px-3 py-2.5 bg-surface/30">
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-bold text-text block truncate">{tier.name}</span>
                          <span className="text-[10px] text-text-secondary">الافتراضي: {tier.discount_percent}%</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <input type="number" min="0" max="100" step="0.01"
                            value={exDiscount ?? ''}
                            onChange={(e) => setTierDiscounts((prev) => ({ ...prev, [tier.id]: e.target.value }))}
                            placeholder="—"
                            className="w-14 border border-border rounded-lg px-2 py-1 text-[11px] text-center bg-white focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all" dir="ltr" />
                          <span className="text-[10px] text-text-secondary">%</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {canManage && (
              <div className="flex gap-3 pt-2">
                <button onClick={handleCancelEdit}
                  className="px-6 py-2.5 rounded-xl border border-border text-sm font-bold text-text-secondary hover:bg-surface transition-colors active:scale-[0.97]">
                  إلغاء
                </button>
                <button onClick={handleSave} disabled={!canSave || saving}
                  className="flex-1 sm:flex-none px-8 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition-colors active:scale-[0.97] disabled:opacity-40 shadow-sm shadow-primary/20">
                  {saving ? 'جاري الحفظ...' : isCreating ? 'إنشاء الشركة' : 'حفظ التغييرات'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ===== Delete Confirmation Dialog ===== */}
        {deleteTarget && (
          <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4"
            onClick={() => !deleting && setDeleteTarget(null)}>
            <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-danger/10 flex items-center justify-center shrink-0">
                    <span className="text-lg">⚠️</span>
                  </div>
                  <div>
                    <h3 className="font-bold text-text text-sm">حذف الشركة</h3>
                    <p className="text-xs text-text-secondary mt-0.5">{deleteTarget.company_name}</p>
                  </div>
                </div>

                <p className="text-xs text-danger/80 bg-danger/5 rounded-xl p-3">
                  هذا الإجراء لا يمكن التراجع عنه. سيتم حذف الشركة نهائياً من قاعدة البيانات.
                </p>

                <div className="flex gap-3">
                  <button onClick={() => setDeleteTarget(null)}
                    disabled={deleting}
                    className="flex-1 py-2.5 rounded-xl border border-border text-sm font-bold text-text-secondary hover:bg-surface transition-colors active:scale-[0.97] disabled:opacity-40">
                    إلغاء
                  </button>
                  <button onClick={handleDeleteCompany}
                    disabled={deleting}
                    className="flex-1 py-2.5 rounded-xl bg-danger text-white text-sm font-bold hover:bg-red-700 transition-colors active:scale-[0.97] disabled:opacity-40 shadow-sm shadow-danger/20">
                    {deleting ? 'جاري الحذف...' : 'حذف نهائياً'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
