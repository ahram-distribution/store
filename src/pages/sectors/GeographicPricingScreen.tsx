import { useState, useEffect, useMemo } from 'react'
import { sectorsService } from '../../services/sectors'
import { SearchableSelect } from '../../components/shared/SearchableSelect'
import { MultiSearchableSelect } from '../../components/shared/MultiSearchableSelect'
import { useCapability } from '../../hooks/useCapability'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import type { Sector, GeographicPriceRule, GeographicCustomerCount } from '../../types/sectors'

const SCOPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'sector', label: 'القطاع بالكامل' },
  { value: 'governorate', label: 'محافظة بالكامل' },
  { value: 'company_sector', label: 'شركات محددة داخل القطاع' },
  { value: 'company_governorate', label: 'شركات محددة داخل المحافظة' },
  { value: 'product_sector', label: 'أصناف محددة داخل القطاع' },
  { value: 'product_governorate', label: 'أصناف محددة داخل المحافظة' },
]

const SCOPE_LABELS: Record<string, string> = Object.fromEntries(
  SCOPE_OPTIONS.map(o => [o.value, o.label])
)

const PRIORITY_LEVELS = ['صنف+شركة+محافظة', 'صنف+محافظة', 'شركة+محافظة', 'محافظة', 'قطاع', 'السعر الأصلي']

export function GeographicPricingScreen() {
  const canManage = useCapability('geographic_pricing.manage')
  const authToken = useAuthStore((s) => s.token)

  const [rules, setRules] = useState<GeographicPriceRule[]>([])
  const [sectors, setSectors] = useState<Sector[]>([])
  const [governorates, setGovernorates] = useState<any[]>([])
  const [companies, setCompanies] = useState<any[]>([])
  const [allProducts, setAllProducts] = useState<any[]>([])
  const [customerCounts, setCustomerCounts] = useState<GeographicCustomerCount[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [showForm, setShowForm] = useState(false)
  const [editingRule, setEditingRule] = useState<GeographicPriceRule | null>(null)
  const [ruleName, setRuleName] = useState('')
  const [ruleAdj, setRuleAdj] = useState('')
  const [ruleScope, setRuleScope] = useState<string>('')
  const [ruleSectorId, setRuleSectorId] = useState('')
  const [ruleGovId, setRuleGovId] = useState('')
  const [ruleCompanyIds, setRuleCompanyIds] = useState<string[]>([])
  const [ruleProductIds, setRuleProductIds] = useState<string[]>([])

  async function loadData() {
    setLoading(true)
    try {
      const [rulesData, sectorsData, govData, countsData] = await Promise.all([
        sectorsService.getGeographicPriceRules(),
        sectorsService.getSectors(),
        supabase.from('reference_governorates').select('id, name_ar').order('name_ar'),
        sectorsService.getCustomerCounts(),
      ])
      setRules(Array.isArray(rulesData) ? rulesData : [])
      setSectors(sectorsData)
      if (govData.data) setGovernorates(govData.data)
      setCustomerCounts(Array.isArray(countsData) ? countsData : [])
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

  const showSectorField = ['sector', 'company_sector', 'product_sector'].includes(ruleScope)
  const showGovField = ['governorate', 'company_governorate', 'product_governorate'].includes(ruleScope)
  const showCompanyField = ['company_sector', 'company_governorate'].includes(ruleScope)
  const showProductField = ['product_sector', 'product_governorate'].includes(ruleScope)

  const activeRules = rules.filter(r => r.is_active)
  const govWithCustomers = useMemo(() => {
    const ids = new Set(customerCounts.map(c => c.governorate_id))
    return ids.size
  }, [customerCounts])

  const activeSectors = sectors.filter(s => s.is_active)

  async function handleSave() {
    if (!ruleName.trim()) { toast.error('اسم القاعدة مطلوب'); return }
    if (!ruleAdj && ruleAdj !== '0') { toast.error('نسبة التغير مطلوبة'); return }
    if (!ruleScope) { toast.error('اختر نطاق القاعدة'); return }
    if (showSectorField && !ruleSectorId) { toast.error('اختر القطاع'); return }
    if (showGovField && !ruleGovId) { toast.error('اختر المحافظة'); return }
    if (showCompanyField && ruleCompanyIds.length === 0) { toast.error('اختر شركة واحدة على الأقل'); return }
    if (showProductField && ruleProductIds.length === 0) { toast.error('اختر صنف واحد على الأقل'); return }

    setSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        rule_name: ruleName,
        adjustment_percent: parseFloat(ruleAdj),
        scope: ruleScope,
        sector_id: showSectorField ? ruleSectorId : null,
        governorate_id: showGovField ? ruleGovId : null,
        company_ids: showCompanyField ? ruleCompanyIds : [],
        product_ids: showProductField ? ruleProductIds : [],
      }

      if (editingRule) {
        await sectorsService.updateGeographicPriceRule(editingRule.id, payload as any)
        toast.success('تم تعديل القاعدة')
      } else {
        await sectorsService.createGeographicPriceRule(payload as any)
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
      await sectorsService.deleteGeographicPriceRule(id)
      toast.success('تم الحذف')
      await loadData()
    } catch (e: any) {
      toast.error(e?.message)
    }
  }

  function resetForm() {
    setRuleName(''); setRuleAdj(''); setRuleScope('')
    setRuleSectorId(''); setRuleGovId(''); setRuleCompanyIds([]); setRuleProductIds([])
  }

  function handleEdit(rule: GeographicPriceRule) {
    setEditingRule(rule)
    setRuleName(rule.rule_name)
    setRuleAdj(String(rule.adjustment_percent))
    setRuleScope(rule.scope)
    setRuleSectorId(rule.sector_id || '')
    setRuleGovId(rule.governorate_id || '')
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
    setRuleSectorId('')
    setRuleGovId('')
    setRuleCompanyIds([])
    setRuleProductIds([])
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-text">التسعير الجغرافي</h1>

      <div className="bg-white rounded-xl border border-border p-3">
        <div className="text-[11px] font-bold text-text mb-1">أولوية الحل</div>
        <div className="flex flex-wrap items-center gap-1 text-[10px] text-text-secondary">
          {PRIORITY_LEVELS.map((level, i) => (
            <span key={level} className="flex items-center gap-1">
              <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded font-semibold">{level}</span>
              {i < PRIORITY_LEVELS.length - 1 && <span className="text-text-secondary">←</span>}
            </span>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white rounded-xl border border-border p-3 text-center">
              <div className="text-2xl font-bold text-primary">{activeRules.length}</div>
              <div className="text-[10px] text-text-secondary">قاعدة نشطة</div>
            </div>
            <div className="bg-white rounded-xl border border-border p-3 text-center">
              <div className="text-2xl font-bold text-primary">{govWithCustomers}</div>
              <div className="text-[10px] text-text-secondary">محافظة بها عملاء</div>
            </div>
          </div>

          {canManage && (
            <button onClick={() => { setShowForm(true); setEditingRule(null); resetForm() }}
              className="bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold">+ إضافة قاعدة تسعير</button>
          )}

          {showForm && (
            <div className="bg-white rounded-lg border border-border p-4 space-y-3">
              <h2 className="text-sm font-bold text-text">{editingRule ? 'تعديل القاعدة' : 'قاعدة تسعير جديدة'}</h2>

              <div>
                <label className="text-[11px] font-bold text-text-secondary block mb-1">اسم القاعدة *</label>
                <input type="text" value={ruleName} onChange={e => setRuleName(e.target.value)} placeholder="اسم القاعدة" className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
              </div>

              <div>
                <label className="text-[11px] font-bold text-text-secondary block mb-1">نسبة التغير (%) *</label>
                <input type="number" step="0.01" value={ruleAdj} onChange={e => setRuleAdj(e.target.value)} placeholder="2 أو -2 أو 0" className="w-full border border-border rounded-lg px-3 py-2 text-sm" dir="ltr" />
              </div>

              <div>
                <label className="text-[11px] font-bold text-text-secondary block mb-1">نطاق القاعدة *</label>
                <select value={ruleScope} onChange={e => handleScopeChange(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="">اختر النطاق</option>
                  {SCOPE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              </div>

              {showSectorField && (
                <div>
                  <label className="text-[11px] font-bold text-text-secondary block mb-1">القطاع</label>
                  <SearchableSelect items={activeSectors.map(s => ({ id: s.id, name: s.name_ar || s.name }))} value={ruleSectorId} onChange={setRuleSectorId} placeholder="اختر القطاع" />
                </div>
              )}

              {showGovField && (
                <div>
                  <label className="text-[11px] font-bold text-text-secondary block mb-1">المحافظة</label>
                  <SearchableSelect items={governorates.map(g => ({ id: g.id, name: g.name_ar }))} value={ruleGovId} onChange={setRuleGovId} placeholder="اختر المحافظة" />
                </div>
              )}

              {showCompanyField && (
                <div>
                  <label className="text-[11px] font-bold text-text-secondary block mb-1">الشركات</label>
                  <MultiSearchableSelect
                    items={companies.map(c => ({ id: c.id, name: c.company_name, keywords: c.legacy_code ? [c.legacy_code] : [] }))}
                    values={ruleCompanyIds}
                    onChange={setRuleCompanyIds}
                    placeholder="اختر الشركات"
                  />
                </div>
              )}

              {showProductField && (
                <div>
                  <label className="text-[11px] font-bold text-text-secondary block mb-1">الأصناف</label>
                  <MultiSearchableSelect
                    items={allProducts.map(p => ({ id: p.id, name: p.product_name, keywords: [p.legacy_code, p.company_name].filter(Boolean) }))}
                    values={ruleProductIds}
                    onChange={setRuleProductIds}
                    placeholder="اختر الأصناف"
                  />
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={handleSave} disabled={submitting} className="flex-1 bg-primary text-white text-xs py-2 rounded-lg font-semibold">
                  {submitting ? 'جاري الحفظ...' : 'حفظ القاعدة'}
                </button>
                <button onClick={handleCancelEdit} className="px-4 border border-border rounded-lg text-xs text-text-secondary">إلغاء</button>
              </div>
            </div>
          )}

          {rules.length === 0 ? (
            <div className="text-center py-8 text-text-secondary text-sm">لا توجد قواعد تسعير جغرافي</div>
          ) : (
            <div className="space-y-2">
              {rules.map(rule => (
                <div key={rule.id} className="bg-white rounded-xl border border-border p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-text">
                        {rule.rule_name}
                      </div>
                      <div className="text-[10px] text-text-secondary mt-0.5">{SCOPE_LABELS[rule.scope] || rule.scope}</div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {rule.sector_name && <span className="text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">قطاع: {rule.sector_name}</span>}
                        {rule.governorate_name && <span className="text-[9px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">محافظة: {rule.governorate_name}</span>}
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
                      <div className={`text-lg font-bold ${rule.adjustment_percent >= 0 ? 'text-success' : 'text-danger'}`}>
                        {rule.adjustment_percent > 0 ? '+' : ''}{rule.adjustment_percent}%
                      </div>
                      {!rule.is_active && <span className="text-[9px] bg-danger/10 text-danger px-1.5 py-0.5 rounded">معطّل</span>}
                    </div>
                  </div>
                  {canManage && (
                    <div className="flex gap-1.5 mt-2">
                      <button onClick={() => handleEdit(rule)} className="text-[10px] bg-primary/10 text-primary px-2 py-1 rounded">تعديل</button>
                      <button onClick={() => handleDelete(rule.id)} className="text-[10px] bg-danger/10 text-danger px-2 py-1 rounded">حذف</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="bg-white rounded-xl border border-border p-3">
            <h3 className="text-sm font-bold text-text mb-2">توزيع العملاء حسب المحافظة</h3>
            {customerCounts.length === 0 ? (
              <div className="text-xs text-text-secondary py-2">لا توجد بيانات</div>
            ) : (
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {customerCounts.map((cc, i) => (
                  <div key={`${cc.governorate_id}-${cc.sector_id}-${i}`} className="flex items-center justify-between text-xs py-1 border-b border-border/50 last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="text-text">{cc.governorate_name}</span>
                      {cc.sector_name && <span className="text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">{cc.sector_name}</span>}
                    </div>
                    <span className="font-bold text-primary">{cc.customer_count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
