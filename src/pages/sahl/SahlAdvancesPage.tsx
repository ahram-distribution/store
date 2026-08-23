import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort, formatDate } from '../../utils/format'
import { useCapability } from '../../hooks/useCapability'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface EmployeeRow { id: string; full_name?: string; name?: string; code?: string }
interface AdvanceRow {
  id: string; employee_id: string; employee_name?: string
  amount?: number | null; outstanding_amount?: number | null; settled_amount?: number | null
  reason?: string | null; is_settled?: boolean; approved_at?: string | null
  settlement_count?: number | null; created_at?: string
}

export function SahlAdvancesPage() {
  const nav = useNavigate()
  const canManage = useCapability('sahl.advances.manage')

  const [employees, setEmployees] = useState<EmployeeRow[]>([])
  const [advances, setAdvances] = useState<AdvanceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [includeSettled, setIncludeSettled] = useState(false)

  const [empId, setEmpId] = useState('')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const [settleFor, setSettleFor] = useState<AdvanceRow | null>(null)
  const [settleAmount, setSettleAmount] = useState('')
  const [settleNotes, setSettleNotes] = useState('')
  const [settling, setSettling] = useState(false)

  async function loadData() {
    const token = getToken()
    if (!token) return
    setLoading(true)
    const [eRes, aRes] = await Promise.all([
      supabase.rpc('get_governed_employees', { p_token: token }),
      supabase.rpc('sahl_get_advances', { p_token: token, p_include_settled: includeSettled }),
    ])
    if (Array.isArray(eRes.data)) setEmployees(eRes.data as EmployeeRow[])
    if (aRes.error) toast.error(aRes.error.message)
    else {
      const data = aRes.data as any
      if (data?.error) toast.error(data.error)
      else setAdvances(Array.isArray(data) ? data : [])
    }
    setLoading(false)
  }

  useEffect(() => { loadData() }, [includeSettled])

  const totals = useMemo(() => ({
    outstanding: advances.reduce((s, a) => s + Number(a.outstanding_amount || 0), 0),
    active: advances.filter((a) => !a.is_settled).length,
  }), [advances])

  async function createAdvance() {
    if (!empId) { toast.error('اختر الموظف'); return }
    const amt = Number(amount)
    if (!amt || amt <= 0) { toast.error('أدخل مبلغاً صحيحاً'); return }
    const token = getToken()
    if (!token) return
    setSaving(true)
    const res = await supabase.rpc('sahl_create_advance', {
      p_token: token, p_employee_id: empId, p_amount: amt, p_reason: reason.trim() || null,
    })
    setSaving(false)
    if (res.error) { toast.error(res.error.message); return }
    const data = res.data as any
    if (data?.error) { toast.error(data.error); return }
    toast.success('تم إنشاء السلفة — صرفها من الخزينة يتطلب الاعتماد')
    setEmpId(''); setAmount(''); setReason('')
    await loadData()
  }

  async function approveAdvance(a: AdvanceRow) {
    const token = getToken()
    if (!token) return
    const res = await supabase.rpc('sahl_approve_advance', { p_token: token, p_advance_id: a.id })
    if (res.error) { toast.error(res.error.message); return }
    const data = res.data as any
    if (data?.error) { toast.error(data.error); return }
    toast.success(`تم اعتماد السلفة وصرف ${formatCurrencyShort(data.amount)} من الخزينة`, { duration: 3500 })
    await loadData()
  }

  function openSettle(a: AdvanceRow) {
    setSettleFor(a)
    setSettleAmount(String(Number(a.outstanding_amount || 0)))
    setSettleNotes('')
  }

  async function submitSettlement() {
    if (!settleFor) return
    const amt = Number(settleAmount)
    if (!amt || amt <= 0) { toast.error('أدخل مبلغاً صحيحاً'); return }
    if (amt > Number(settleFor.outstanding_amount || 0)) { toast.error('المبلغ أكبر من المتبقي'); return }
    const token = getToken()
    if (!token) return
    setSettling(true)
    const res = await supabase.rpc('sahl_settle_advance', {
      p_token: token, p_advance_id: settleFor.id, p_amount: amt, p_notes: settleNotes.trim() || null,
    })
    setSettling(false)
    if (res.error) { toast.error(res.error.message); return }
    const data = res.data as any
    if (data?.error) { toast.error(data.error); return }
    toast.success(`تم تسجيل التسوية — المتبقي: ${formatCurrencyShort(data.outstanding_after)}${data.outstanding_after === 0 ? ' (مُسوّاة بالكامل)' : ''}`, { duration: 4000 })
    setSettleFor(null)
    await loadData()
  }

  const empName = (id: string) => {
    const e = employees.find((x) => x.id === id)
    return e ? (e.full_name || e.name || '') : ''
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => nav('/sahl')} className="text-text-secondary text-lg">&rarr;</button>
          <div>
            <h1 className="text-lg font-bold text-text">سلف الموظفين</h1>
            <p className="text-[10px] text-text-secondary">صرف السلف من الخزينة وتسوية أرصدتها</p>
          </div>
        </div>
        <button onClick={loadData} className="text-[10px] text-primary border border-border rounded px-2 py-1">تحديث</button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="text-[10px] text-text-secondary">إجمالي أرصدة السلف</div>
          <div className="text-lg font-bold text-danger mt-1">{formatCurrencyShort(totals.outstanding)}</div>
        </div>
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="text-[10px] text-text-secondary">سلف غير مُسوّاة</div>
          <div className="text-lg font-bold text-text mt-1">{totals.active}</div>
        </div>
      </div>

      {canManage && (
        <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="bg-gradient-to-l from-cyan-700 to-cyan-600 px-5 py-3.5">
            <h2 className="text-sm font-bold text-white">🧾 سلفة جديدة</h2>
          </div>
          <div className="p-5 grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div>
              <label className="text-xs font-semibold text-text-secondary block mb-1.5">الموظف *</label>
              <select value={empId} onChange={(e) => setEmpId(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white">
                <option value="">— اختر الموظف —</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.full_name || e.name}{e.code ? ` (${e.code})` : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-text-secondary block mb-1.5">المبلغ *</label>
              <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
            </div>
            <div>
              <label className="text-xs font-semibold text-text-secondary block mb-1.5">السبب</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
            </div>
            <button onClick={createAdvance} disabled={saving}
              className="bg-gradient-to-l from-cyan-700 to-cyan-600 disabled:opacity-50 text-white rounded-xl py-2.5 text-sm font-bold active:opacity-80">
              {saving ? 'جاري الحفظ...' : 'حفظ السلفة'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="bg-surface px-5 py-3.5 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-bold text-text">📋 سجل السلف</h2>
          <label className="flex items-center gap-1.5 text-[10px] text-text-secondary cursor-pointer select-none">
            <input type="checkbox" checked={includeSettled} onChange={(e) => setIncludeSettled(e.target.checked)} />
            إظهار المُسوّاة
          </label>
        </div>
        {loading ? (
          <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
        ) : advances.length === 0 ? (
          <div className="text-center py-12 text-text-secondary text-sm">لا توجد سلف</div>
        ) : (
          <div className="divide-y divide-border/60 max-h-[520px] overflow-y-auto">
            {advances.map((a) => {
              const pendingApproval = !a.approved_at
              return (
                <div key={a.id} className="px-5 py-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-text truncate">{a.employee_name || empName(a.employee_id)}</span>
                      {!a.is_settled && pendingApproval && <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent/10 text-accent">بانتظار الاعتماد</span>}
                      {a.is_settled && <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-100 text-green-800">مُسوّاة</span>}
                    </div>
                    <div className="text-[10px] text-text-secondary">
                      {formatDate(a.created_at)}
                      {a.reason ? ` • ${a.reason}` : ''}
                      {Number(a.settled_amount) > 0 ? ` • سُدد ${formatCurrencyShort(a.settled_amount)}` : ''}
                      {(a.settlement_count || 0) > 0 ? ` (${a.settlement_count} تسوية)` : ''}
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    <div className="text-left">
                      <div className="text-[9px] text-text-secondary">القيمة</div>
                      <div className="text-xs font-semibold text-text">{formatCurrencyShort(a.amount)}</div>
                    </div>
                    {!a.is_settled && (
                      <>
                        <div className="text-left">
                          <div className="text-[9px] text-text-secondary">المتبقي</div>
                          <div className="text-xs font-bold text-danger">{formatCurrencyShort(a.outstanding_amount)}</div>
                        </div>
                        {canManage && !pendingApproval && (
                          <button onClick={() => openSettle(a)} className="text-[10px] bg-green-600 text-white rounded px-2 py-1.5">تسوية</button>
                        )}
                        {canManage && pendingApproval && (
                          <button onClick={() => approveAdvance(a)} className="text-[10px] bg-cyan-600 text-white rounded px-2 py-1.5">اعتماد وصرف</button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {settleFor && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setSettleFor(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="bg-gradient-to-l from-slate-700 to-slate-600 px-5 py-4">
              <h3 className="text-base font-bold text-white">تسوية سلفة — {settleFor.employee_name}</h3>
              <p className="text-[10px] text-white/70 mt-0.5">المتبقي: {formatCurrencyShort(settleFor.outstanding_amount)}</p>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-semibold text-text-secondary block mb-1.5">مبلغ التسوية *</label>
                <input type="number" min="0" step="0.01" value={settleAmount}
                  onChange={(e) => setSettleAmount(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
                <button onClick={() => setSettleAmount(String(Number(settleFor.outstanding_amount || 0)))}
                  className="text-[10px] text-primary mt-1">(تسوية كامل المتبقي)</button>
              </div>
              <div>
                <label className="text-xs font-semibold text-text-secondary block mb-1.5">ملاحظات</label>
                <input value={settleNotes} onChange={(e) => setSettleNotes(e.target.value)}
                  placeholder="مثال: خصم من الراتب / استلام نقدي"
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
              </div>
              <div className="text-[10px] text-text-secondary bg-surface/60 rounded-lg p-2.5">
                يُسجَّل مبلغ التسوية كداخل للخزينة تلقائياً.
              </div>
              <button onClick={submitSettlement} disabled={settling}
                className="w-full bg-gradient-to-l from-green-700 to-green-600 disabled:opacity-50 text-white rounded-xl py-2.5 text-sm font-bold">
                {settling ? 'جاري الحفظ...' : 'حفظ التسوية'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
