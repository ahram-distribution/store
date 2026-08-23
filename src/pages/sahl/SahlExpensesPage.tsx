import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort, formatDate } from '../../utils/format'
import { useCapability } from '../../hooks/useCapability'
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
  pending: 'معلق', treasury_posted: 'مرحّل للخزينة',
}

const statusStyles: Record<string, string> = {
  pending: 'bg-accent/10 text-accent',
  treasury_posted: 'bg-danger/10 text-danger',
}

interface TreasuryRow { id: string; name: string; kind: 'cash' | 'bank'; is_active: boolean }

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

  const todayPostedTotal = useMemo(() =>
    expenses.filter((e) => e.status === 'treasury_posted' && isToday(new Date(e.approved_at ?? e.created_at)))
      .reduce((s, e) => s + Number(e.amount || 0), 0)
  , [expenses])

  const unposted = useMemo(() => expenses.filter((e) => e.status !== 'treasury_posted'), [expenses])

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

  async function postExisting(id: string) {
    const token = getToken()
    if (!token) return
    const res = await supabase.rpc('sahl_post_expense', { p_token: token, p_expense_id: id, p_treasury_id: drawerId || null })
    if (res.error) { toast.error(res.error.message); return }
    const posted = res.data as any
    if (posted?.error) { toast.error(posted.error); return }
    toast.success(`تم ترحيل السند ${posted.code} إلى الخزينة`)
    await loadData()
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => nav('/sahl')} className="text-text-secondary text-lg">&rarr;</button>
          <div>
            <h1 className="text-lg font-bold text-text">المصروفات</h1>
            <p className="text-[10px] text-text-secondary">سندات صرف — ترحيل مباشر للخزينة</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="text-[10px] text-text-secondary">مصروف اليوم (مرحّل)</div>
          <div className="text-lg font-bold text-danger mt-1">{formatCurrencyShort(todayPostedTotal)}</div>
        </div>
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="text-[10px] text-text-secondary">بانتظار الترحيل</div>
          <div className="text-lg font-bold text-warning mt-1">{unposted.length}</div>
        </div>
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="text-[10px] text-text-secondary">معلق (قيمة)</div>
          <div className="text-lg font-bold text-text mt-1">{formatCurrencyShort(unposted.reduce((s, e) => s + Number(e.amount || 0), 0))}</div>
        </div>
      </div>

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
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white">
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
            <h2 className="text-sm font-bold text-text">📄 آخر السندات</h2>
            <button onClick={loadData} className="text-[10px] text-primary">تحديث</button>
          </div>
          {loading ? (
            <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
          ) : expenses.length === 0 ? (
            <div className="text-center py-12 text-text-secondary text-sm">لا توجد سندات مصروف بعد</div>
          ) : (
            <div className="divide-y divide-border/60 max-h-[560px] overflow-y-auto">
              {expenses.map((exp: any) => {
                const isPosted = exp.status === 'treasury_posted'
                return (
                  <div key={exp.id} className="px-5 py-3 hover:bg-surface/60 transition-colors">
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
                        <span className="text-sm font-bold text-danger">{formatCurrencyShort(exp.amount)}</span>
                        {!isPosted && canPost && (
                          <button onClick={() => postExisting(exp.id)}
                            className="text-[10px] bg-rose-700 text-white px-2 py-1 rounded">ترحيل</button>
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
    </div>
  )
}
