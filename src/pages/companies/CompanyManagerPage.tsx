import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCapability } from '../../hooks/useCapability'
import { fetchGovernedData, deleteCompany, toggleVisibility } from '../../hooks/useCompanyMutations'
import { usePersistentViewState } from '../../hooks/usePersistentViewState'
import toast from 'react-hot-toast'

type FilterMode = 'all' | 'visible' | 'hidden'

export function CompanyManagerPage() {
  const nav = useNavigate()
  const canManage = useCapability('companies.manage')
  const canDelete = useCapability('data.deletion_center')
  const [companies, setCompanies] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [viewState, setViewState] = usePersistentViewState('companies-manage', {
    searchQuery: '',
    filter: 'all' as FilterMode,
  })
  const { searchQuery, filter } = viewState

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

  // Scroll preservation
  useEffect(() => {
    return () => {
      sessionStorage.setItem('companies-manage-scroll', String(window.scrollY))
    }
  }, [])

  useEffect(() => {
    const saved = sessionStorage.getItem('companies-manage-scroll')
    if (saved) {
      requestAnimationFrame(() => {
        window.scrollTo(0, parseInt(saved, 10))
        sessionStorage.removeItem('companies-manage-scroll')
      })
    }
  }, [])

  const loadCompanies = async () => {
    const { companies: data } = await fetchGovernedData()
    setCompanies(data)
    setLoading(false)
  }

  useEffect(() => { loadCompanies() }, [])

  async function handleToggleVisibility(c: any) {
    if (!canManage) return
    const result = await toggleVisibility(c.id, c.is_visible)
    if (result.error) { toast.error(result.error); return }
    toast.success(c.is_visible ? 'تم إخفاء الشركة' : 'تم إظهار الشركة')
    await loadCompanies()
  }

  async function handleDeleteCompany() {
    if (!deleteTarget || !canManage) return
    setDeleting(true)
    try {
      const result = await deleteCompany(deleteTarget.id)
      if (result.error) { toast.error(result.error); return }
      toast.success('تم حذف الشركة')
      setDeleteTarget(null)
      await loadCompanies()
    } catch (err: any) {
      toast.error(err.message || 'حدث خطأ أثناء الحذف')
    }
    setDeleting(false)
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

  const visibleCount = companies.filter((c) => c.is_visible).length
  const hiddenCount = companies.filter((c) => c.is_visible === false).length

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-[1600px] mx-auto px-4 py-5 space-y-5">

        {/* Header */}
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
          {canManage && (
            <button onClick={() => nav('/companies/manage/new')}
              className="bg-primary text-white text-xs px-4 py-2.5 rounded-xl font-bold hover:bg-primary-dark transition-colors active:scale-[0.97] shadow-sm shadow-primary/20">
              + شركة جديدة
            </button>
          )}
        </div>

        {/* Search & Filters */}
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
              <button key={f.key} onClick={() => setViewState({ filter: f.key })}
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

        {/* Company Cards Grid */}
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
            {filtered.map((c: any) => (
              <div key={c.id}
                className="group bg-white rounded-2xl border-2 border-border transition-all duration-200 overflow-hidden flex flex-col hover:border-primary/35 hover:shadow-lg hover:shadow-black/[0.06] hover:-translate-y-0.5">

                {/* Section 1: Header */}
                <div className="flex items-center gap-3 p-3.5 pb-3">
                  <div className="shrink-0 w-[62px] h-[62px] rounded-xl flex items-center justify-center overflow-hidden bg-surface group-hover:bg-primary/[0.06] transition-all">
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

                {/* Section 2: Visibility badge */}
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

                {/* Section 3: Actions */}
                {canManage && (
                  <div className="flex items-stretch mt-3 border-t border-border/60">
                    <button onClick={() => nav(`/companies/manage/${c.id}/edit`)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[22px] font-bold text-primary hover:bg-primary/10 transition-all active:scale-[0.97]"
                      title="تعديل">
                      <span className="text-xl">✏️</span>
                      <span>تعديل</span>
                    </button>
                    <div className="w-px bg-border/60" />
                    <button onClick={() => handleToggleVisibility(c)}
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
                      <button onClick={() => setOpenMenuId(openMenuId === c.id ? null : c.id)}
                        className="w-10 flex items-center justify-center text-text-secondary hover:bg-surface transition-all active:scale-[0.97] text-sm font-bold"
                        title="المزيد">
                        ⋮
                      </button>
                      {openMenuId === c.id && (
                        <div className="absolute bottom-full left-0 mb-1.5 w-44 bg-white rounded-xl border border-border shadow-xl z-50 py-1 overflow-hidden">
                          {canDelete ? (
                            <button onClick={() => { setOpenMenuId(null); setDeleteTarget(c) }}
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
            ))}
          </div>
        )}

        {/* Delete Confirmation Dialog */}
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
