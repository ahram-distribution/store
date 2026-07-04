import { useEffect, useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { targetService } from '../../services/targets'
import toast from 'react-hot-toast'

interface EmpCardData {
  employee_id: string; employee_code: string; employee_name: string; role_type: string
  sales_target: number; orders_target: number; visits_target: number
  new_customers_target: number; collections_target: number
  sales_actual: number; orders_actual: number; visits_actual: number
  new_customers_actual: number; collections_actual: number
  sales_achievement_pct: number | null; orders_achievement_pct: number | null
  visits_achievement_pct: number | null; new_customers_achievement_pct: number | null
  collections_achievement_pct: number | null
}

interface EditForm {
  employee_id: string; employee_code: string; employee_name: string; role_type: string
  sales_target: string; orders_target: string; visits_target: string
  new_customers_target: string; collections_target: string
}

interface WeightOverrideForm {
  employee_id: string; employee_name: string
  sales_weight: string; collections_weight: string; visits_weight: string
  new_customers_weight: string; attendance_weight: string
  reason: string; existing_id: string | null
}

const MONTHS = ['يناير', 'فبراير', 'مارس', 'إبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
const ROLE_FILTERS = ['الكل', 'مدير البيع', 'سوبر فايزر', 'مندوب']
const TARGET_FILTERS = ['الكل', 'بدون أهداف', 'لديه أهداف']

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ar-EG-u-nu-latn')
}

function fmtPct(n: number | null): string {
  return n !== null ? n.toFixed(1) + '%' : 'غير متوفر'
}

function pctColor(pct: number | null): string {
  if (pct === null) return 'text-text-secondary'
  if (pct >= 100) return 'text-success'
  if (pct >= 50) return 'text-warning'
  return 'text-red-500'
}

export function TargetsWeightsTab() {
  const nav = useNavigate()
  const now = new Date()
  const [selMonth, setSelMonth] = useState(now.getMonth() + 1)
  const [selYear, setSelYear] = useState(now.getFullYear())
  const [loading, setLoading] = useState(true)
  const [cards, setCards] = useState<EmpCardData[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [roleFilter, setRoleFilter] = useState('الكل')
  const [targetFilter, setTargetFilter] = useState('الكل')
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState('')
  const [weightForm, setWeightForm] = useState<WeightOverrideForm | null>(null)
  const [savingWeight, setSavingWeight] = useState(false)
  const [weightOverrides, setWeightOverrides] = useState<any[]>([])
  const [showWeightOverrides, setShowWeightOverrides] = useState(false)

  async function loadData(month: number, year: number) {
    const token = getToken()
    if (!token) { setLoading(false); return }
    const [empListResult, empTargetResult, salesKpi, ordersKpi, visitsKpi, newCustKpi, collKpi, weightRes] = await Promise.all([
      targetService.getAllActiveEmployees(),
      targetService.getEmployeeTargets(month, year, token),
      targetService.getKpiContributors('sales', month, year, token),
      targetService.getKpiContributors('orders', month, year, token),
      targetService.getKpiContributors('visits', month, year, token),
      targetService.getKpiContributors('new_customers', month, year, token),
      targetService.getKpiContributors('collections', month, year, token),
      targetService.getWeightOverrides(month, year, token),
    ])
    const employeeList: any[] = !empListResult.error ? (empListResult.data || []) : []
    const existingTargets: any[] = !empTargetResult.error ? (empTargetResult.data as any[] || []) : []
    if (!weightRes.error) setWeightOverrides(Array.isArray(weightRes.data) ? weightRes.data : [])
    const buildActualMap = (data: any) => {
      const m: Record<string, { actual: number; target: number }> = {}
      if (!Array.isArray(data)) return m
      for (const c of data) m[c.employee_id] = { actual: c.actual || 0, target: c.target || 0 }
      return m
    }
    const salesMap = buildActualMap(!salesKpi.error ? salesKpi.data : [])
    const ordersMap = buildActualMap(!ordersKpi.error ? ordersKpi.data : [])
    const visitsMap = buildActualMap(!visitsKpi.error ? visitsKpi.data : [])
    const newCustMap = buildActualMap(!newCustKpi.error ? newCustKpi.data : [])
    const collMap = buildActualMap(!collKpi.error ? collKpi.data : [])
    const merged: EmpCardData[] = employeeList.map((emp: any) => {
      const existing = existingTargets.find((et: any) => et.employee_id === emp.employee_id)
      const st = existing?.sales_target || 0; const ot = existing?.orders_target || 0
      const vt = existing?.visits_target || 0; const nct = existing?.new_customers_target || 0
      const ct = existing?.collections_target || 0
      const sa = salesMap[emp.employee_id]?.actual || 0; const oa = ordersMap[emp.employee_id]?.actual || 0
      const va = visitsMap[emp.employee_id]?.actual || 0; const nca = newCustMap[emp.employee_id]?.actual || 0
      const ca = collMap[emp.employee_id]?.actual || 0
      return {
        employee_id: emp.employee_id, employee_code: emp.employee_code, employee_name: emp.employee_name, role_type: emp.role_type,
        sales_target: st, orders_target: ot, visits_target: vt, new_customers_target: nct, collections_target: ct,
        sales_actual: sa, orders_actual: oa, visits_actual: va, new_customers_actual: nca, collections_actual: ca,
        sales_achievement_pct: st > 0 ? (sa / st) * 100 : null,
        orders_achievement_pct: ot > 0 ? (oa / ot) * 100 : null,
        visits_achievement_pct: vt > 0 ? (va / vt) * 100 : null,
        new_customers_achievement_pct: nct > 0 ? (nca / nct) * 100 : null,
        collections_achievement_pct: ct > 0 ? (ca / ct) * 100 : null,
      }
    })
    setCards(merged)
    setLoading(false)
  }

  useEffect(() => { setLoading(true); loadData(selMonth, selYear) }, [selMonth, selYear])

  function goPrevMonth() {
    if (selMonth === 1) { setSelMonth(12); setSelYear(selYear - 1) }
    else setSelMonth(selMonth - 1)
  }
  function goNextMonth() {
    if (selMonth === 12) { setSelMonth(1); setSelYear(selYear + 1) }
    else setSelMonth(selMonth + 1)
  }

  const monthOptions = []
  for (let i = -6; i <= 6; i++) {
    const d = new Date(selYear, selMonth - 1 + i, 1)
    monthOptions.push({ month: d.getMonth() + 1, year: d.getFullYear(), label: MONTHS[d.getMonth()] + ' ' + d.getFullYear() })
  }

  const filteredCards = useMemo(() => {
    let result = cards
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      result = result.filter(c => c.employee_name.toLowerCase().includes(term) || c.employee_code.toLowerCase().includes(term))
    }
    if (roleFilter !== 'الكل') result = result.filter(c => c.role_type === roleFilter)
    if (targetFilter === 'بدون أهداف') result = result.filter(c =>
      c.sales_target === 0 && c.orders_target === 0 && c.visits_target === 0 &&
      c.new_customers_target === 0 && c.collections_target === 0)
    else if (targetFilter === 'لديه أهداف') result = result.filter(c =>
      c.sales_target > 0 || c.orders_target > 0 || c.visits_target > 0 ||
      c.new_customers_target > 0 || c.collections_target > 0)
    return result
  }, [cards, searchTerm, roleFilter, targetFilter])

  function openEdit(emp: EmpCardData) {
    setEditError('')
    setEditForm({
      employee_id: emp.employee_id, employee_code: emp.employee_code,
      employee_name: emp.employee_name, role_type: emp.role_type,
      sales_target: emp.sales_target.toString(),
      orders_target: emp.orders_target.toString(),
      visits_target: emp.visits_target.toString(),
      new_customers_target: emp.new_customers_target.toString(),
      collections_target: emp.collections_target.toString(),
    })
  }

  const handleEditSave = useCallback(async () => {
    if (savingEdit || !editForm) return
    setSavingEdit(true); setEditError('')
    const token = getToken()
    if (!token) { setSavingEdit(false); return }
    const { error } = await targetService.upsertEmployeeTarget(
      editForm.employee_id, selMonth, selYear,
      parseFloat(editForm.sales_target) || 0,
      parseFloat(editForm.visits_target) || 0,
      parseFloat(editForm.orders_target) || 0,
      parseFloat(editForm.new_customers_target) || 0,
      parseFloat(editForm.collections_target) || 0,
      token
    )
    setSavingEdit(false)
    if (error) { setEditError(error.message || 'حدث خطأ'); return }
    setCards(prev => prev.map(c =>
      c.employee_id === editForm.employee_id ? {
        ...c,
        sales_target: parseFloat(editForm.sales_target) || 0,
        orders_target: parseFloat(editForm.orders_target) || 0,
        visits_target: parseFloat(editForm.visits_target) || 0,
        new_customers_target: parseFloat(editForm.new_customers_target) || 0,
        collections_target: parseFloat(editForm.collections_target) || 0,
        sales_achievement_pct: c.sales_target > 0 ? (c.sales_actual / (parseFloat(editForm.sales_target) || 0)) * 100 : null,
        orders_achievement_pct: c.orders_target > 0 ? (c.orders_actual / (parseFloat(editForm.orders_target) || 0)) * 100 : null,
        visits_achievement_pct: c.visits_target > 0 ? (c.visits_actual / (parseFloat(editForm.visits_target) || 0)) * 100 : null,
        new_customers_achievement_pct: c.new_customers_target > 0 ? (c.new_customers_actual / (parseFloat(editForm.new_customers_target) || 0)) * 100 : null,
        collections_achievement_pct: c.collections_target > 0 ? (c.collections_actual / (parseFloat(editForm.collections_target) || 0)) * 100 : null,
      } : c
    ))
    setEditForm(null)
  }, [savingEdit, editForm, selMonth, selYear])

  function openWeightOverride(emp: EmpCardData) {
    const existing = weightOverrides.find((wo: any) => wo.employee_id === emp.employee_id && wo.is_active)
    setWeightForm({
      employee_id: emp.employee_id, employee_name: emp.employee_name,
      sales_weight: existing?.sales_weight_percent?.toString() || '',
      collections_weight: existing?.collections_weight_percent?.toString() || '',
      visits_weight: existing?.visits_weight_percent?.toString() || '',
      new_customers_weight: existing?.new_customers_weight_percent?.toString() || '',
      attendance_weight: existing?.attendance_weight_percent?.toString() || '',
      reason: existing?.override_reason || '',
      existing_id: existing?.id || null,
    })
  }

  const handleWeightSave = useCallback(async () => {
    if (!weightForm || savingWeight) return
    setSavingWeight(true)
    const token = getToken()
    if (!token) { setSavingWeight(false); return }
    const { error } = await targetService.upsertWeightOverride(
      weightForm.employee_id, selMonth, selYear,
      weightForm.sales_weight ? parseFloat(weightForm.sales_weight) : null,
      weightForm.collections_weight ? parseFloat(weightForm.collections_weight) : null,
      weightForm.visits_weight ? parseFloat(weightForm.visits_weight) : null,
      weightForm.new_customers_weight ? parseFloat(weightForm.new_customers_weight) : null,
      weightForm.attendance_weight ? parseFloat(weightForm.attendance_weight) : null,
      weightForm.reason || null,
      token
    )
    setSavingWeight(false)
    if (error) { toast.error(error.message); return }
    toast.success('تم حفظ تجاوز الأوزان')
    setWeightForm(null)
    const wr = await targetService.getWeightOverrides(selMonth, selYear, token)
    if (!wr.error) setWeightOverrides(Array.isArray(wr.data) ? wr.data : [])
  }, [weightForm, savingWeight, selMonth, selYear])

  function roleBadgeColor(role: string): string {
    switch (role) {
      case 'مدير البيع': return 'bg-purple-100 text-purple-700'
      case 'سوبر فايزر': return 'bg-amber-100 text-amber-700'
      default: return 'bg-blue-100 text-blue-700'
    }
  }

  if (loading) return <div className="text-center py-8 text-text-secondary text-sm">جاري التحميل...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={goPrevMonth} className="px-3 py-1.5 border border-border rounded-lg text-xs font-semibold text-text bg-white cursor-pointer">{'‹ السابق'}</button>
        <select value={`${selMonth}-${selYear}`} onChange={e => { const [m, y] = e.target.value.split('-').map(Number); setSelMonth(m); setSelYear(y) }}
          className="flex-1 border border-border rounded-lg px-3 py-1.5 text-sm font-semibold text-text bg-white cursor-pointer text-center">
          {monthOptions.map(opt => (
            <option key={`${opt.month}-${opt.year}`} value={`${opt.month}-${opt.year}`}>{opt.label}</option>
          ))}
        </select>
        <button onClick={goNextMonth} className="px-3 py-1.5 border border-border rounded-lg text-xs font-semibold text-text bg-white cursor-pointer">{'التالي ›'}</button>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-2 flex-1">
          <input type="text" placeholder="بحث..." value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="flex-1 border border-border rounded-lg p-2 text-xs bg-white" />
          <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}
            className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white cursor-pointer">
            {ROLE_FILTERS.map(r => <option key={r} value={r}>{r === 'الكل' ? 'الكل' : r}</option>)}
          </select>
          <select value={targetFilter} onChange={e => setTargetFilter(e.target.value)}
            className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white cursor-pointer">
            {TARGET_FILTERS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <button onClick={() => setShowWeightOverrides(!showWeightOverrides)}
          className={`text-[10px] px-3 py-1.5 rounded-lg font-semibold ${showWeightOverrides ? 'bg-primary text-white' : 'bg-surface text-text-secondary'}`}>
          تجاوز الأوزان
        </button>
      </div>

      {showWeightOverrides && weightOverrides.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
          <h4 className="text-xs font-bold text-amber-800">تجاوزات الأوزان النشطة</h4>
          {weightOverrides.map((wo: any) => (
            <div key={wo.id} className="flex items-center justify-between text-[10px]">
              <span className="font-semibold">{wo.employee_name}</span>
              <span className="text-text-secondary">{wo.override_reason || 'بدون سبب'}</span>
              <button onClick={async () => {
                const token = getToken()
                await targetService.deactivateWeightOverride(wo.id, token)
                const wr = await targetService.getWeightOverrides(selMonth, selYear, token)
                if (!wr.error) setWeightOverrides(Array.isArray(wr.data) ? wr.data : [])
                toast.success('تم إلغاء التجاوز')
              }} className="text-danger">إلغاء</button>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {filteredCards.map(emp => (
          <div key={emp.employee_id} className="bg-white rounded-xl border border-border p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-[10px] text-text-secondary font-mono">{emp.employee_code}</p>
                <p className="text-sm font-bold text-text">{emp.employee_name}</p>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${roleBadgeColor(emp.role_type)}`}>
                {emp.role_type}
              </span>
            </div>
            <div className="space-y-2">
              <KpiSummaryRow label="المبيعات" unit="جنيه" target={emp.sales_target} actual={emp.sales_actual} pct={emp.sales_achievement_pct} />
              <KpiSummaryRow label="الطلبات" unit="عدد" target={emp.orders_target} actual={emp.orders_actual} pct={emp.orders_achievement_pct} />
              <KpiSummaryRow label="الزيارات" unit="عدد" target={emp.visits_target} actual={emp.visits_actual} pct={emp.visits_achievement_pct} />
              <KpiSummaryRow label="العملاء الجدد" unit="عدد" target={emp.new_customers_target} actual={emp.new_customers_actual} pct={emp.new_customers_achievement_pct} />
              <KpiSummaryRow label="التحصيل" unit="جنيه" target={emp.collections_target} actual={emp.collections_actual} pct={emp.collections_achievement_pct} />
            </div>
            <div className="mt-3 pt-2 border-t border-border/50 flex gap-2">
              <button onClick={() => openEdit(emp)}
                className="flex-1 text-center text-[11px] text-primary font-semibold py-1.5 rounded-lg transition-colors cursor-pointer">
                تعديل الهدف
              </button>
              <button onClick={() => openWeightOverride(emp)}
                className="text-center text-[11px] text-accent font-semibold py-1.5 rounded-lg transition-colors cursor-pointer">
                تجاوز الأوزان
              </button>
            </div>
          </div>
        ))}
        {filteredCards.length === 0 && (
          <p className="text-center py-8 text-text-secondary text-xs">لا يوجد موظفون مطابقون</p>
        )}
      </div>

      {editForm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
          onClick={() => { if (!savingEdit) setEditForm(null) }}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto p-5 pb-8 space-y-4"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-center mb-2">
              <div className="w-10 h-1 bg-border rounded-full sm:hidden" />
            </div>
            <h3 className="text-sm font-bold text-text text-center">تعديل الهدف</h3>
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[10px] text-amber-800 leading-relaxed">
              يتم احتساب التقييم الإجمالي بناءً على أوزان التقييم السنوية. يمكن تخصيص أوزان مختلفة لهذا الموظف عبر خيار "تجاوز الأوزان".
            </div>
            <div className="bg-surface rounded-xl p-3.5 space-y-1.5 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-text-secondary shrink-0">الكود:</span>
                <span className="text-text font-semibold font-mono">{editForm.employee_code}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-text-secondary shrink-0">الاسم:</span>
                <span className="text-text font-semibold">{editForm.employee_name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-text-secondary shrink-0">النوع:</span>
                <span className="text-text">{editForm.role_type}</span>
              </div>
            </div>
            <div className="space-y-3">
              <div><label className="text-[10px] text-text-secondary block mb-1">المبيعات (جنيه)</label>
                <input type="number" value={editForm.sales_target}
                  onChange={e => setEditForm(f => ({ ...f, sales_target: e.target.value }))}
                  className="w-full border border-border rounded-lg p-2.5 text-sm text-text text-right bg-white" /></div>
              <div><label className="text-[10px] text-text-secondary block mb-1">الطلبات (عدد)</label>
                <input type="number" value={editForm.orders_target}
                  onChange={e => setEditForm(f => ({ ...f, orders_target: e.target.value }))}
                  className="w-full border border-border rounded-lg p-2.5 text-sm text-text text-right bg-white" /></div>
              <div><label className="text-[10px] text-text-secondary block mb-1">الزيارات (عدد)</label>
                <input type="number" value={editForm.visits_target}
                  onChange={e => setEditForm(f => ({ ...f, visits_target: e.target.value }))}
                  className="w-full border border-border rounded-lg p-2.5 text-sm text-text text-right bg-white" /></div>
              <div><label className="text-[10px] text-text-secondary block mb-1">العملاء الجدد (عدد)</label>
                <input type="number" value={editForm.new_customers_target}
                  onChange={e => setEditForm(f => ({ ...f, new_customers_target: e.target.value }))}
                  className="w-full border border-border rounded-lg p-2.5 text-sm text-text text-right bg-white" /></div>
              <div><label className="text-[10px] text-text-secondary block mb-1">التحصيل (جنيه)</label>
                <input type="number" value={editForm.collections_target}
                  onChange={e => setEditForm(f => ({ ...f, collections_target: e.target.value }))}
                  className="w-full border border-border rounded-lg p-2.5 text-sm text-text text-right bg-white" /></div>
            </div>
            {editError && <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-3">{editError}</div>}
            <div className="flex gap-3">
              <button onClick={handleEditSave} disabled={savingEdit}
                className="flex-1 py-3 bg-primary text-white rounded-xl text-xs font-semibold disabled:opacity-50 cursor-pointer">
                {savingEdit ? 'جاري الحفظ...' : 'حفظ'}
              </button>
              <button onClick={() => { if (!savingEdit) setEditForm(null) }}
                className="px-6 py-3 border border-border rounded-xl text-xs font-semibold text-text-secondary cursor-pointer">إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {weightForm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
          onClick={() => { if (!savingWeight) setWeightForm(null) }}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto p-5 pb-8 space-y-4"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-center mb-2">
              <div className="w-10 h-1 bg-border rounded-full sm:hidden" />
            </div>
            <h3 className="text-sm font-bold text-text text-center">تجاوز الأوزان - {weightForm.employee_name}</h3>
            <p className="text-[10px] text-text-secondary text-center">اترك القيم فارغة لاستخدام الأوزان الافتراضية للشركة</p>
            <div className="space-y-3">
              <div><label className="text-[10px] text-text-secondary block mb-1">وزن المبيعات (%)</label>
                <input type="number" value={weightForm.sales_weight}
                  onChange={e => setWeightForm(f => ({ ...f, sales_weight: e.target.value }))}
                  className="w-full border border-border rounded-lg p-2.5 text-sm text-text text-right bg-white" /></div>
              <div><label className="text-[10px] text-text-secondary block mb-1">وزن التحصيل (%)</label>
                <input type="number" value={weightForm.collections_weight}
                  onChange={e => setWeightForm(f => ({ ...f, collections_weight: e.target.value }))}
                  className="w-full border border-border rounded-lg p-2.5 text-sm text-text text-right bg-white" /></div>
              <div><label className="text-[10px] text-text-secondary block mb-1">وزن الزيارات (%)</label>
                <input type="number" value={weightForm.visits_weight}
                  onChange={e => setWeightForm(f => ({ ...f, visits_weight: e.target.value }))}
                  className="w-full border border-border rounded-lg p-2.5 text-sm text-text text-right bg-white" /></div>
              <div><label className="text-[10px] text-text-secondary block mb-1">وزن العملاء الجدد (%)</label>
                <input type="number" value={weightForm.new_customers_weight}
                  onChange={e => setWeightForm(f => ({ ...f, new_customers_weight: e.target.value }))}
                  className="w-full border border-border rounded-lg p-2.5 text-sm text-text text-right bg-white" /></div>
              <div><label className="text-[10px] text-text-secondary block mb-1">وزن الحضور (%)</label>
                <input type="number" value={weightForm.attendance_weight}
                  onChange={e => setWeightForm(f => ({ ...f, attendance_weight: e.target.value }))}
                  className="w-full border border-border rounded-lg p-2.5 text-sm text-text text-right bg-white" /></div>
              <div><label className="text-[10px] text-text-secondary block mb-1">سبب التجاوز</label>
                <textarea value={weightForm.reason}
                  onChange={e => setWeightForm(f => ({ ...f, reason: e.target.value }))}
                  className="w-full border border-border rounded-lg p-2.5 text-sm text-text bg-white resize-none" rows={2} /></div>
            </div>
            <div className="flex gap-3">
              <button onClick={handleWeightSave} disabled={savingWeight}
                className="flex-1 py-3 bg-accent text-white rounded-xl text-xs font-semibold disabled:opacity-50 cursor-pointer">
                {savingWeight ? 'جاري الحفظ...' : 'حفظ التجاوز'}
              </button>
              <button onClick={() => { if (!savingWeight) setWeightForm(null) }}
                className="px-6 py-3 border border-border rounded-xl text-xs font-semibold text-text-secondary cursor-pointer">إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function KpiSummaryRow({ label, unit, target, actual, pct }: {
  label: string; unit: string; target: number; actual: number; pct: number | null
}) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-[11px] text-text-secondary font-semibold shrink-0 ml-2" style={{ minWidth: '55px' }}>{label}</span>
      <span className="text-[11px] text-text-secondary" style={{ direction: 'ltr', unicodeBidi: 'embed' }}>
        {target > 0 ? `${fmt(actual)} / ${fmt(target)}` : 'غير متوفر'}
      </span>
      <span className={`text-[11px] font-bold shrink-0 mr-auto ${pctColor(pct)}`}>
        {pct !== null ? fmtPct(pct) : 'غير متوفر'}
      </span>
    </div>
  )
}
