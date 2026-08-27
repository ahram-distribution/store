import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort, formatDate } from '../../utils/format'
import { useCapability } from '../../hooks/useCapability'
import { resolveDateRangeISO } from '../../lib/dateRange'
import SahlToolbar from '../../components/sahl/SahlToolbar'
import SahlKpiCard from '../../components/sahl/SahlKpiCard'
import SahlDetailPanel from '../../components/sahl/SahlDetailPanel'
import type { SahlDateFilterState } from '../../components/sahl/SahlDateFilter'
import { sahlExportExcel, sahlPrintReport, datePresetLabel } from './sahl-report'
import type { SahlReportColumn } from './sahl-report'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const typeLabels: Record<string, string> = {
  transportation: 'مواصلات', fuel: 'وقود', shipping: 'شحن', salaries: 'رواتب',
  bonuses: 'مكافآت', employee_advances: 'سلف موظفين', hospitality: 'ضيافة',
  maintenance: 'صيانة', rent: 'إيجار', utilities: 'مرافق', other: 'أخرى',
}

const statusLabels: Record<string, string> = {
  pending: 'معلق', treasury_posted: 'مرحّل للخزينة', cancelled: 'ملغى',
}

const statusStyles: Record<string, string> = {
  pending: 'bg-accent/10 text-accent',
  treasury_posted: 'bg-danger/10 text-danger',
  cancelled: 'bg-text-secondary/10 text-text-secondary line-through',
}

interface TreasuryRow { id: string; name: string; kind: 'cash' | 'bank'; is_active: boolean }

const EXPENSE_COLUMNS: SahlReportColumn[] = [
  { key: 'code', label: 'رقم السند' },
  { key: 'expense_type', label: 'النوع' },
  { key: 'amount', label: 'المبلغ', format: 'currency' },
  { key: 'status', label: 'الحالة' },
  { key: 'description', label: 'البيان' },
  { key: 'created_by_name', label: 'بواسطة' },
  { key: 'created_at', label: 'التاريخ' },
]

export function SahlExpensesPage() {
  const nav = useNavigate()
  const canCreate = useCapability('sahl.expenses.create')
  const canPost = useCapability('sahl.expenses.post')

  const [expenses, setExpenses] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [expenseType, setExpenseType] = useState('transportation')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [treasuries, setTreasuries] = useState<TreasuryRow[]>([])
  const [drawerId, setDrawerId] = useState('')
  const [kpiFilter, setKpiFilter] = useState<'all' | 'today_posted' | 'unposted'>('all')
  const [detailExpense, setDetailExpense] = useState<any | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ type: 'post' | 'cancel'; expense: any } | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [search, setSearch] = useState('')
  const [dateFilter, setDateFilter] = useState<SahlDateFilterState>({ preset: 'month', customFrom: '', customTo: '' })

  async function loadData() {
    const token = getToken()
    if (!token) return
    setLoading(true)
    const [res, trRes] = await Promise.all([
      supabase.rpc('sahl_get_expenses', { p_token: token }),
      supabase.rpc('sahl_get_treasuries', { p_token: token }),
    ])
    if (res.error) toast.error(res.error.message)
    else {
      const data = res.data as any
      if (data?.error) toast.error(data.error)
      else setExpenses(Array.isArray(data) ? data : [])
    }
    if (!trRes.error && Array.isArray(trRes.data))
      setTreasuries((trRes.data as TreasuryRow[]).filter(t => t.is_active))
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  const isToday = (d: Date) => { const n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate() }

  const { from: dateFrom, to: dateTo } = resolveDateRangeISO(dateFilter.preset, dateFilter.customFrom, dateFilter.customTo)

  const dateFiltered = useMemo(() => {
    let list = expenses
    if (dateFrom || dateTo) {
      list = list.filter((e: any) => {
        const d = new Date(e.created_at).getTime()
        if (dateFrom && d < new Date(dateFrom).getTime()) return false
        if (dateTo && d >= new Date(dateTo).getTime()) return false
        return true
      })
    }
    return list
  }, [expenses, dateFrom, dateTo])

  const todayPostedTotal = useMemo(() =>
    dateFiltered.filter((e) => e.status === 'treasury_posted' && isToday(new Date(e.approved_at ?? e.created_at)))
      .reduce((s, e) => s + Number(e.amount || 0), 0)
  , [dateFiltered])

  const unposted = useMemo(() => dateFiltered.filter((e) => e.status !== 'treasury_posted'), [dateFiltered])
  const filteredExpenses = useMemo(() => {
    const list = kpiFilter === 'today_posted'
      ? dateFiltered.filter((e) => e.status === 'treasury_posted' && isToday(new Date(e.approved_at ?? e.created_at)))
      : kpiFilter === 'unposted' ? unposted : dateFiltered
    return list.slice(0, 50)
  }, [dateFiltered, kpiFilter, unposted])

  function handleExportExcel() {
    const rows = filteredExpenses.map((e: any) => ({
      code: e.code,
      expense_type: typeLabels[e.expense_type] || e.expense_type,
      amount: Number(e.amount || 0),
      status: statusLabels[e.status] || e.status,
      description: e.description || '',
      created_by_name: e.created_by_name || '',
      created_at: formatDate(e.created_at),
    }))
    sahlExportExcel({
      title: 'تقرير المصروفات',
      subtitle: 'سندات صرف — ترحيل مباشر للخزينة',
      fileName: 'المصروفات',
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      filters: [datePresetLabel(dateFilter.preset)],
      summary: [
        { label: 'إجمالي المصروفات', value: dateFiltered.reduce((s: number, e: any) => s + Number(e.amount || 0), 0), format: 'currency' },
        { label: 'عدد السندات', value: dateFiltered.length, format: 'number' },
      ],
    }, EXPENSE_COLUMNS, rows)
  }

  function handlePrint() {
    const rows = filteredExpenses.map((e: any) => ({
      code: e.code,
      expense_type: typeLabels[e.expense_type] || e.expense_type,
      amount: Number(e.amount || 0),
      status: statusLabels[e.status] || e.status,
      description: e.description || '',
      created_by_name: e.created_by_name || '',
      created_at: formatDate(e.created_at),
    }))
    sahlPrintReport({
      title: 'المصروفات',
      subtitle: 'سندات صرف — ترحيل مباشر للخزينة',
      fileName: 'المصروفات',
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      filters: [datePresetLabel(dateFilter.preset)],
      summary: [
        { label: 'إجمالي المصروفات', value: dateFiltered.reduce((s: number, e: any) => s + Number(e.amount || 0), 0), format: 'currency' },
      ],
    }, EXPENSE_COLUMNS, rows)
  }

  async function submitExpense(post: boolean) {
    const amt = Number(amount)
    if (!amt || amt <= 0) { toast.error('أدخل مبلغاً صحيحاً'); return }
    const token = getToken()
    if (!token) { toast.error('انتهت الجلسة'); return }
    setSaving(true)

    const createRes = await supabase.rpc('sahl_create_expense', {
      p_token: token,
      p_expense_type: expenseType,
      p_amount: amt,
      p_description: description.trim() || null,
    })
    if (createRes.error) { toast.error(createRes.error.message); setSaving(false); return }
    const created = createRes.data as any
    if (created?.error) { toast.error(created.error); setSaving(false); return }

    if (post) {
      const postRes = await supabase.rpc('sahl_post_expense', { p_token: token, p_expense_id: created.id, p_treasury_id: drawerId || null })
      if (postRes.error) { toast.error(`تم إنشاء السند ${created.code} لكن فشل الترحيل: ${postRes.error.message}`); setSaving(false); await loadData(); return }
      const posted = postRes.data as any
      if (posted?.error) { toast.error(`تم إنشاء السند ${created.code} لكن فشل الترحيل: ${posted.error}`); setSaving(false); await loadData(); return }
      toast.success(`تم الصرف والترحيل للخزينة ${created.code}`)
    } else {
      toast.success(`تم حفظ سند معلق ${created.code}`)
    }

    setAmount(''); setDescription('')
    setSaving(false)
    await loadData()
  }

  return (
    <div className="space-y-4" dir="rtl">
      <SahlToolbar
        title="المصروفات"
        subtitle="سندات صرف — ترحيل مباشر للخزينة"
        dateFilter={dateFilter}
        onDateFilterChange={setDateFilter}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث بالبيان / النوع..."
        onExportExcel={handleExportExcel}
        onPrint={handlePrint}
        onRefresh={loadData}
      />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <SahlKpiCard
          label="مصروف اليوم (مرحّل)" value={todayPostedTotal} format="currency" color="danger"
          icon="💸" active={kpiFilter === 'today_posted'} onClick={() => setKpiFilter(kpiFilter === 'today_posted' ? 'all' : 'today_posted')}
          traceLabel="عرض التفاصيل" />
        <SahlKpiCard
          label="بانتظار الترحيل" value={unposted.length} format="count" color="warning"
          icon="⏳" active={kpiFilter === 'unposted'} onClick={() => setKpiFilter(kpiFilter === 'unposted' ? 'all' : 'unposted')}
          subtitle={formatCurrencyShort(unposted.reduce((s: number, e: any) => s + Number(e.amount || 0), 0))} traceLabel="عرض القائمة" />
        <SahlKpiCard
          label="إجمالي المصروفات" value={dateFiltered.reduce((s: number, e: any) => s + Number(e.amount || 0), 0)}
          format="currency" color="text" icon="📊" />
      </div>

      {kpiFilter !== 'all' && (
        <div className="flex items-center justify-between bg-danger/5 border border-danger/20 rounded-lg px-4 py-2">
          <span className="text-xs text-danger font-semibold">
            🔍 عرض: {kpiFilter === 'today_posted' ? 'مصروفات اليوم فقط' : 'بانتظار الترحيل فقط'} — {filteredExpenses.length} سند
          </span>
          <button onClick={() => setKpiFilter('all')} className="text-[10px] text-danger underline">إزالة التصفية</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="bg-gradient-to-l from-rose-700 to-rose-600 px-5 py-3.5">
            <h2 className="text-sm font-bold text-white">💸 سند صرف جديد</h2>
          </div>
          <div className="p-5 space-y-4">
            <div>
              <label className="text-xs font-semibold text-text-secondary block mb-1.5">نوع المصروف</label>
              <select value={expenseType} onChange={(e) => setExpenseType(e.target.value)}
                className="w-full border border-border rounded-lg px-2 py-2.5 text-sm bg-white">
                {Object.entries(typeLabels).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-text-secondary block mb-1.5">المبلغ</label>
              <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
            </div>
            <div>
              <label className="text-xs font-semibold text-text-secondary block mb-1.5">البيان</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
                placeholder="وصف المصروف (اختياري)"
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white resize-none" />
            </div>
            <div>
              <label className="text-xs font-semibold text-text-secondary block mb-1.5">درج الصرف (عند الترحيل)</label>
              <select value={drawerId} onChange={(e) => setDrawerId(e.target.value)}
                className="w-full border border-border rounded-lg px-2 py-2.5 text-sm bg-white">
                <option value="">افتراضي (الدرج الرئيسي)</option>
                {treasuries.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}{t.kind === 'bank' ? ' (بنك)' : ''}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => submitExpense(true)} disabled={saving || !canPost}
                className="flex-1 bg-gradient-to-l from-rose-700 to-rose-600 disabled:opacity-50 text-white rounded-xl py-3 text-sm font-bold active:opacity-80">
                {saving ? 'جاري الحفظ...' : 'صرف وترحيل للخزينة'}
              </button>
              <button onClick={() => submitExpense(false)} disabled={saving || !canCreate}
                className="border border-border text-text rounded-xl px-4 py-3 text-sm font-semibold active:bg-surface disabled:opacity-50">
                حفظ كمعلق
              </button>
            </div>
            {!canPost && (
              <p className="text-[10px] text-text-secondary">ليست لديك صلاحية الترحيل للخزينة — يمكنك حفظ السندات كمعلق فقط</p>
            )}
          </div>
        </div>

        <div className="lg:col-span-3 bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 bg-surface border-b border-border">
            <h2 className="text-sm font-bold text-text">📄 آخر السندات ({filteredExpenses.length})</h2>
          </div>
          {loading ? (
            <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
          ) : filteredExpenses.length === 0 ? (
            <div className="text-center py-12 text-text-secondary text-sm">{kpiFilter !== 'all' ? 'لا توجد سندات تطابق التصفية' : 'لا توجد سندات مصروف بعد'}</div>
          ) : (
            <div className="divide-y divide-border/60 max-h-[560px] overflow-y-auto">
              {filteredExpenses.map((exp: any) => {
                const isPosted = exp.status === 'treasury_posted'
                const isCancelled = exp.status === 'cancelled'
                const canCancel = !isPosted && !isCancelled && canCreate
                return (
                  <div key={exp.id}
                    onClick={() => !isCancelled && setDetailExpense(exp)}
                    className={`px-5 py-3 transition-colors ${isCancelled ? 'opacity-50' : 'hover:bg-surface/60 cursor-pointer'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-text">{typeLabels[exp.expense_type] || exp.expense_type}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded ${statusStyles[exp.status] || 'bg-surface text-text-secondary'}`}>
                            {statusLabels[exp.status] || exp.status}
                          </span>
                        </div>
                        <div className="text-[10px] text-text-secondary mt-0.5 truncate">
                          {exp.code} • {formatDate(exp.created_at)}
                          {exp.description ? ` • ${exp.description}` : ''}
                          {exp.created_by_name ? ` • بواسطة: ${exp.created_by_name}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-sm font-bold ${isCancelled ? 'text-text-secondary line-through' : 'text-danger'}`}>{formatCurrencyShort(exp.amount)}</span>
                        {!isPosted && !isCancelled && canPost && (
                          <button onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'post', expense: exp }) }}
                            className="text-[10px] bg-rose-700 text-white px-2 py-1 rounded">ترحيل</button>
                        )}
                        {canCancel && (
                          <button onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'cancel', expense: exp }) }}
                            className="text-[10px] bg-danger/10 text-danger px-2 py-1 rounded">إلغاء</button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {confirmAction && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => { setConfirmAction(null); setCancelReason('') }}>
          <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className={`px-5 py-4 ${confirmAction.type === 'post' ? 'bg-gradient-to-l from-rose-700 to-rose-600' : 'bg-gradient-to-l from-red-700 to-red-600'}`}>
              <h3 className="text-sm font-bold text-white">
                {confirmAction.type === 'post' ? 'تأكيد الترحيل للخزينة' : 'تأكيد إلغاء السند'}
              </h3>
            </div>
            <div className="p-5 space-y-3">
              <div className="text-center">
                <div className="text-xs text-text-secondary">{confirmAction.expense.code}</div>
                <div className="text-sm text-text">{typeLabels[confirmAction.expense.expense_type] || confirmAction.expense.expense_type}</div>
                <div className="text-lg font-bold text-text mt-1">{formatCurrencyShort(confirmAction.expense.amount)}</div>
                {confirmAction.expense.description && <div className="text-xs text-text-secondary mt-1">{confirmAction.expense.description}</div>}
              </div>
              {confirmAction.type === 'post' ? (
                <p className="text-xs text-text-secondary text-center">
                  سيتم تسجيل هذا المبلغ كمصروف صادم من الخزينة. لا يمكن التراجع بعد الترحيل.
                </p>
              ) : (
                <div>
                  <label className="text-xs text-text-secondary block mb-1">سبب الإلغاء (اختياري)</label>
                  <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="مثال: تم الإلغاء..."
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => { setConfirmAction(null); setCancelReason('') }}
                  className="flex-1 border border-border rounded-xl py-2.5 text-sm font-semibold">تراجع</button>
                <button disabled={actionLoading}
                  onClick={async () => {
                    const token = getToken()
                    if (!token) { toast.error('انتهت الجلسة'); return }
                    setActionLoading(true)
                    if (confirmAction.type === 'post') {
                      const res = await supabase.rpc('sahl_post_expense', { p_token: token, p_expense_id: confirmAction.expense.id, p_treasury_id: drawerId || null })
                      if (res.error) toast.error(res.error.message)
                      else if ((res.data as any)?.error) toast.error((res.data as any).error)
                      else { toast.success(`تم ترحيل ${confirmAction.expense.code} للخزينة`); await loadData() }
                    } else {
                      const res = await supabase.rpc('sahl_cancel_expense', { p_token: token, p_expense_id: confirmAction.expense.id })
                      if (res.error) toast.error(res.error.message)
                      else if ((res.data as any)?.error) toast.error((res.data as any).error)
                      else { toast.success(`تم إلغاء ${confirmAction.expense.code}`); await loadData() }
                    }
                    setActionLoading(false); setConfirmAction(null); setCancelReason('')
                  }}
                  className={`flex-1 text-white rounded-xl py-2.5 text-sm font-bold ${confirmAction.type === 'post' ? 'bg-rose-700' : 'bg-danger'}`}>
                  {actionLoading ? 'جاري...' : confirmAction.type === 'post' ? 'تأكيد الترحيل' : 'تأكيد الإلغاء'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {detailExpense && (
        <SahlDetailPanel
          title={`سند صرف — ${detailExpense.code}`}
          subtitle={detailExpense.code}
          statusBadge={{ label: statusLabels[detailExpense.status] || detailExpense.status, className: statusStyles[detailExpense.status] || 'bg-surface text-text-secondary' }}
          sections={[
            {
              title: 'بيانات السند',
              fields: [
                { label: 'النوع', value: typeLabels[detailExpense.expense_type] || detailExpense.expense_type },
                { label: 'المبلغ', value: formatCurrencyShort(detailExpense.amount), bold: true, color: 'text-danger' },
                { label: 'البيان', value: detailExpense.description || '—' },
                { label: 'أنشأه', value: detailExpense.created_by_name || '—' },
                { label: 'التاريخ', value: formatDate(detailExpense.created_at) },
              ],
            },
          ]}
          onClose={() => setDetailExpense(null)}
        />
      )}
    </div>
  )
}
