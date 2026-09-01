import { useState, useEffect } from 'react'
import { sectorsService } from '../../services/sectors'
import { SearchableSelect } from '../../components/shared/SearchableSelect'
import { MultiSearchableSelect } from '../../components/shared/MultiSearchableSelect'
import { useCapability } from '../../hooks/useCapability'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import type { Sector, GeographicVisibilityRule } from '../../types/sectors'

const SCOPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'جميع القطاعات' },
  { value: 'governorates', label: 'محافظات محددة' },
  { value: 'sectors', label: 'قطاعات محددة' },
]

const SCOPE_LABELS: Record<string, string> = Object.fromEntries(
  SCOPE_OPTIONS.map((o) => [o.value, o.label])
)

const SCOPE_HINTS: Record<string, string> = {
  all: 'تُطبق على جميع القطاعات والمحافظات',
  governorates: 'تُطبق على المحافظات المختارة فقط',
  sectors: 'تُطبق على القطاعات المختارة وجميع محافظاتها',
}

export function GeographicVisibilityScreen() {
  const canManage = useCapability('geographic_visibility.manage')
  const authToken = useAuthStore((s) => s.token)

  const [rules, setRules] = useState<GeographicVisibilityRule[]>([])
  const [sectors, setSectors] = useState<Sector[]>([])
  const [governorates, setGovernorates] = useState<any[]>([])
  const [companies, setCompanies] = useState<any[]>([])
  const [allProducts, setAllProducts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [showForm, setShowForm] = useState(false)
  const [editingRule, setEditingRule] = useState<GeographicVisibilityRule | null>(null)
  const [ruleName, setRuleName] = useState('')
  const [ruleScope, setRuleScope] = useState<string>('')
  const [ruleSectorIds, setRuleSectorIds] = useState<string[]>([])
  const [ruleGovIds, setRuleGovIds] = useState<string[]>([])
  const [ruleCompanyIds, setRuleCompanyIds] = useState<string[]>([])
  const [ruleProductIds, setRuleProductIds] = useState<string[]>([])

  async function loadData() {
    setLoading(true)
    try {
      const [rulesData, sectorsData, govData] = await Promise.all([
        sectorsService.getGeographicVisibilityRules(),
        sectorsService.getSectors(),
        supabase.from('reference_governorates').select('id, name_ar').order('name_ar'),
      ])
      setRules(Array.isArray(rulesData) ? rulesData : [])
      setSectors(sectorsData)
      if (govData.data) setGovernorates(govData.data)
    } catch (e: any) {
      toast.error(e?.message || 'فشل تحميل البيانات')
    }
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  async function loadCompanyOptions() {
    if (!authToken) return
    try {
      const { data, error } = await supabase
        .from('companies')
        .select('id, company_name, legacy_code')
        .eq('is_active', true)
        .order('company_name')
      if (!error && data) setCompanies(data)
    } catch {
      /* نكتفي بالصمت - اختياري */
    }
  }

  async function loadProductOptions() {
    if (!authToken) return
    try {
      const { data, error } = await supabase.rpc('get_governed_products', {
        p_token: authToken,
        p_active_only: true,
        p_visible_only: true,
        p_company_id: null,
      })
      if (!error && Array.isArray(data)) setAllProducts(data)
    } catch {
      /* نكتفي بالصمت - اختياري */
    }
  }

  useEffect(() => {
    if (!canManage) return
    loadCompanyOptions()
    loadProductOptions()
  }, [canManage])

  const showSectorField = ruleScope === 'sectors'
  const showGovField = ruleScope === 'governorates'

  const activeRules = rules.filter((r) => r.is_active).length
  const activeSectors = sectors.filter((s) => s.is_active)

  async function handleSave() {
    if (!ruleName.trim()) { toast.error('اسم القاعدة مطلوب'); return }
    if (!ruleScope) { toast.error('اختر نطاق القاعدة'); return }
    if (showSectorField && ruleSectorIds.length === 0) { toast.error('اختر قطاعاً واحداً على الأقل'); return }
    if (showGovField && ruleGovIds.length === 0) { toast.error('اختر محافظة واحدة على الأقل'); return }
    if (ruleCompanyIds.length === 0 && ruleProductIds.length === 0) {
      toast.error('اختر شركة أو صنفاً واحداً على الأقل (أو الاثنين معاً)')
      return
    }

    setSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        rule_name: ruleName.trim(),
        scope: ruleScope,
        sector_ids: showSectorField ? ruleSectorIds : [],
        governorate_ids: showGovField ? ruleGovIds : [],
        company_ids: ruleCompanyIds,
        product_ids: ruleProductIds,
      }

      if (editingRule) {
        await sectorsService.updateGeographicVisibilityRule(editingRule.id, payload as any)
        toast.success('تم تعديل القاعدة')
      } else {
        await sectorsService.createGeographicVisibilityRule(payload as any)
        toast.success('تم إنشاء القاعدة')
      }
      setShowForm(false)
      setEditingRule(null)
      resetForm()
      await loadData()
    } catch (e: any) {
      toast.error(e?.message || 'فشل الحفظ')
    }
    setSubmitting(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('هل أنت متأكد من حذف هذه القاعدة؟')) return
    try {
      await sectorsService.deleteGeographicVisibilityRule(id)
      toast.success('تم الحذف')
      await loadData()
    } catch (e: any) {
      toast.error(e?.message)
    }
  }

  async function handleToggleActive(rule: GeographicVisibilityRule) {
    try {
      await sectorsService.updateGeographicVisibilityRule(rule.id, { is_active: !rule.is_active })
      toast.success(rule.is_active ? 'تم تعطيل القاعدة' : 'تم تفعيل القاعدة')
      await loadData()
    } catch (e: any) {
      toast.error(e?.message)
    }
  }

  function resetForm() {
    setRuleName(''); setRuleScope('')
    setRuleSectorIds([]); setRuleGovIds([])
    setRuleCompanyIds([]); setRuleProductIds([])
  }

  function handleEdit(rule: GeographicVisibilityRule) {
    setEditingRule(rule)
    setRuleName(rule.rule_name)
    setRuleScope(rule.scope)
    setRuleSectorIds(rule.sector_ids || [])
    setRuleGovIds(rule.governorate_ids || [])
    setRuleCompanyIds(rule.company_ids || [])
    setRuleProductIds(rule.product_ids || [])
    setShowForm(true)
  }

  function handleCancelEdit() {
    setShowForm(false)
    setEditingRule(null)
    resetForm()
  }

  function handleScopeChange(newScope: string) {
    setRuleScope(newScope)
    setRuleSectorIds([])
    setRuleGovIds([])
    setRuleCompanyIds([])
    setRuleProductIds([])
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-text">ظهور الشركات والمنتجات</h1>

      <div className="bg-white rounded-xl border border-border p-3 space-y-1">
        <div className="text-[11px] font-bold text-text">طبيعة القاعدة</div>
        <p className="text-[10px] text-text-secondary leading-relaxed">
          قاعدة الظهور الجغرافي تُخفي الشركات/الأصناف المختارة من <span className="font-bold text-danger">المتجر</span> و
          <span className="font-bold text-danger">ليستة البيع</span> معاً داخل النطاق الجغرافي المختار، دون تغيير الحالة
          العالمية للصنف (نشط / مخفي / نفذت الكمية) ولا أسعاره ولا مخزونه.
        </p>
      </div>

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white rounded-xl border border-border p-3 text-center">
              <div className="text-2xl font-bold text-primary">{rules.length}</div>
              <div className="text-[10px] text-text-secondary">قاعدة إجمالاً</div>
            </div>
            <div className="bg-white rounded-xl border border-border p-3 text-center">
              <div className="text-2xl font-bold text-primary">{activeRules}</div>
              <div className="text-[10px] text-text-secondary">قاعدة نشطة</div>
            </div>
          </div>

          {canManage && (
            <button onClick={() => { setShowForm(true); setEditingRule(null); resetForm() }}
              className="bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold">
              + إضافة قاعدة ظهور
            </button>
          )}

          {showForm && (
            <div className="bg-white rounded-lg border border-border p-4 space-y-3">
              <h2 className="text-sm font-bold text-text">{editingRule ? 'تعديل القاعدة' : 'قاعدة ظهور جديدة'}</h2>

              <div>
                <label className="text-[11px] font-bold text-text-secondary block mb-1">اسم القاعدة *</label>
                <input type="text" value={ruleName} onChange={e => setRuleName(e.target.value)} placeholder="مثال: إخفاء منتجات شركة ABC في الجيزة" className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
              </div>

              <div>
                <label className="text-[11px] font-bold text-text-secondary block mb-1">نطاق القاعدة *</label>
                <select value={ruleScope} onChange={e => handleScopeChange(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="">اختر النطاق</option>
                  {SCOPE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
                {ruleScope && <div className="text-[10px] text-text-secondary mt-1">{SCOPE_HINTS[ruleScope]}</div>}
              </div>

              {showSectorField && (
                <div>
                  <label className="text-[11px] font-bold text-text-secondary block mb-1">القطاعات *</label>
                  <MultiSearchableSelect
                    items={activeSectors.map(s => ({ id: s.id, name: s.name_ar || s.name }))}
                    values={ruleSectorIds}
                    onChange={setRuleSectorIds}
                    placeholder="اختر القطاعات"
                  />
                </div>
              )}

              {showGovField && (
                <div>
                  <label className="text-[11px] font-bold text-text-secondary block mb-1">المحافظات *</label>
                  <MultiSearchableSelect
                    items={governorates.map(g => ({ id: g.id, name: g.name_ar }))}
                    values={ruleGovIds}
                    onChange={setRuleGovIds}
                    placeholder="اختر المحافظات"
                  />
                </div>
              )}

              <div>
                <label className="text-[11px] font-bold text-text-secondary block mb-1">الشركات</label>
                <MultiSearchableSelect
                  items={companies.map(c => ({ id: c.id, name: c.company_name, keywords: c.legacy_code ? [c.legacy_code] : [] }))}
                  values={ruleCompanyIds}
                  onChange={setRuleCompanyIds}
                  placeholder="اختر الشركات (تخفي جميع منتجات الشركة)"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-text-secondary block mb-1">الأصناف</label>
                <MultiSearchableSelect
                  items={allProducts.map(p => ({ id: p.id, name: p.product_name, keywords: [p.legacy_code, p.company_name].filter(Boolean) }))}
                  values={ruleProductIds}
                  onChange={setRuleProductIds}
                  placeholder="اختر الأصناف"
                />
              </div>

              <div className="flex gap-2">
                <button onClick={handleSave} disabled={submitting} className="flex-1 bg-primary text-white text-xs py-2 rounded-lg font-semibold">
                  {submitting ? 'جاري الحفظ...' : 'حفظ القاعدة'}
                </button>
                <button onClick={handleCancelEdit} className="px-4 border border-border rounded-lg text-xs text-text-secondary">إلغاء</button>
              </div>
            </div>
          )}

          {rules.length === 0 ? (
            <div className="text-center py-8 text-text-secondary text-sm">لا توجد قواعد ظهور جغرافي</div>
          ) : (
            <div className="space-y-2">
              {rules.map(rule => (
                <div key={rule.id} className="bg-white rounded-xl border border-border p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-text">{rule.rule_name}</div>
                      <div className="text-[10px] text-text-secondary mt-0.5">{SCOPE_LABELS[rule.scope] || rule.scope}</div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {(rule.sector_names || []).length > 0 && (
                          <span className="text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                            قطاعات: {rule.sector_names.join(', ')}
                          </span>
                        )}
                        {(rule.governorate_names || []).length > 0 && (
                          <span className="text-[9px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">
                            محافظات: {rule.governorate_names.join(', ')}
                          </span>
                        )}
                        {(rule.company_names || []).length > 0 && (
                          <span className="text-[9px] bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded">
                            شركات: {rule.company_names.join(', ')}
                          </span>
                        )}
                        {(rule.product_names || []).length > 0 && (
                          <span className="text-[9px] bg-green-50 text-green-600 px-1.5 py-0.5 rounded">
                            أصناف: {rule.product_names.join(', ')}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-left shrink-0">
                      {rule.is_active ? (
                        <span className="text-[9px] bg-success/10 text-success px-1.5 py-0.5 rounded">نشطة</span>
                      ) : (
                        <span className="text-[9px] bg-danger/10 text-danger px-1.5 py-0.5 rounded">معطّلة</span>
                      )}
                    </div>
                  </div>
                  {canManage && (
                    <div className="flex gap-1.5 mt-2">
                      <button onClick={() => handleEdit(rule)} className="text-[10px] bg-primary/10 text-primary px-2 py-1 rounded">تعديل</button>
                      <button onClick={() => handleToggleActive(rule)} className="text-[10px] bg-surface px-2 py-1 rounded text-text-secondary">
                        {rule.is_active ? 'تعطيل' : 'تفعيل'}
                      </button>
                      <button onClick={() => handleDelete(rule.id)} className="text-[10px] bg-danger/10 text-danger px-2 py-1 rounded">حذف</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}