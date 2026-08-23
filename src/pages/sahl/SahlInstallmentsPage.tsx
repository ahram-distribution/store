import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort, formatDate } from '../../utils/format'
import { useCapability } from '../../hooks/useCapability'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface CustomerRow { id: string; company_name?: string; name?: string }
interface TreasuryRow { id: string; name: string; kind: 'cash' | 'bank'; is_active: boolean }
interface PlanRow {
  id: string; code: string; customer_id: string; customer_name?: string
  order_id?: string | null; title?: string | null
  total_amount: number; paid_total: number; remaining: number
  parts_count: number; part_amount: number; last_part_amount?: number | null
  start_date?: string; status: 'active' | 'completed' | 'cancelled'
  notes?: string | null; created_at?: string
  settled_count?: number; next_due_date?: string | null
}
interface PartRow {
  id: string; part_number: number; due_date: string
  amount: number; paid_amount: number; unpaid: number
  settled_at?: string | null; state: 'settled' | 'partial' | 'overdue' | 'pending'
}

const PART_STATE_BADGE: Record<string, string> = {
  settled: 'bg-green-100 text-green-800',
  partial: 'bg-cyan-100 text-cyan-800',
  overdue: 'bg-red-100 text-red-700',
  pending: 'bg-surface text-text-secondary',
}
const PART_STATE_LABEL: Record<string, string> = {
  settled: 'مُسدد', partial: 'جزئي', overdue: 'متأخر', pending: 'قادم',
}
const METHODS: Record<string, string> = {
  cash: 'نقدي', bank_transfer: 'تحويل بنكي', cheque: 'شيك', deposit: 'إيداع',
}

export function SahlInstallmentsPage() {
  const nav = useNavigate()
  const canManage = useCapability('sahl.installments.manage')

  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [plans, setPlans] = useState<PlanRow[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'active' | 'all'>('active')

  const [custId, setCustId] = useState('')
  const [total, setTotal] = useState('')
  const [partsCount, setPartsCount] = useState('3')
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)

  const [openPlan, setOpenPlan] = useState<PlanRow | null>(null)
  const [planParts, setPlanParts] = useState<PartRow[]>([])
  const [recvAmount, setRecvAmount] = useState('')
  const [recvMethod, setRecvMethod] = useState('cash')
  const [recvRef, setRecvRef] = useState('')
  const [recvNotes, setRecvNotes] = useState('')
  const [receiving, setReceiving] = useState(false)
  const [treasuries, setTreasuries] = useState<TreasuryRow[]>([])
  const [recvDrawerId, setRecvDrawerId] = useState('')
  const [recvBank, setRecvBank] = useState('')
  const [recvDueDate, setRecvDueDate] = useState('')

  async function loadData() {
    const token = getToken()
    if (!token) return
    setLoading(true)
    const [cRes, pRes, tRes] = await Promise.all([
      supabase.rpc('get_governed_customers', { p_token: token }),
      supabase.rpc('sahl_get_installment_plans', { p_token: token }),
      supabase.rpc('sahl_get_treasuries', { p_token: token }),
    ])
    if (Array.isArray(cRes.data)) setCustomers(cRes.data as CustomerRow[])
    if (!tRes.error && Array.isArray(tRes.data))
      setTreasuries((tRes.data as TreasuryRow[]).filter(t => t.is_active))
    if (pRes.error) toast.error(pRes.error.message)
    else {
      const data = pRes.data as any
      if (data?.error) toast.error(data.error)
      else setPlans(Array.isArray(data) ? data : [])
    }
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  const visiblePlans = useMemo(
    () => statusFilter === 'active' ? plans.filter((p) => p.status === 'active') : plans,
    [plans, statusFilter]
  )

  const totals = useMemo(() => ({
    active: plans.filter((p) => p.status === 'active').length,
    outstanding: plans.filter((p) => p.status === 'active').reduce((s, p) => s + Number(p.remaining || 0), 0),
    overdue: plans.filter((p) => p.status === 'active' && p.next_due_date && new Date(p.next_due_date) < new Date(new Date().toDateString())).length,
  }), [plans])

  async function createPlan() {
    if (!custId) { toast.error('اختر العميل'); return }
    const t = Number(total)
    const n = Number(partsCount)
    if (!t || t <= 0) { toast.error('أدخل إجمالي صحيح'); return }
    if (!Number.isInteger(n) || n < 1 || n > 120) { toast.error('عدد أقساط غير صحيح'); return }
    if (!startDate) { toast.error('حدد تاريخ البداية'); return }
    const token = getToken()
    if (!token) return
    setSaving(true)
    const res = await supabase.rpc('sahl_create_installment_plan', {
      p_token: token, p_customer_id: custId, p_total: t, p_parts: n,
      p_start_date: startDate, p_title: title.trim() || null,
      p_order_id: null, p_notes: null,
    })
    setSaving(false)
    if (res.error) { toast.error(res.error.message); return }
    const data = res.data as any
    if (data?.error) { toast.error(data.error); return }
    toast.success(`تم إنشاء خطة ${data.code} — ${n} أقساط × ${formatCurrencyShort(data.part_amount)}`, { duration: 4000 })
    setCustId(''); setTotal(''); setPartsCount('3'); setTitle('')
    await loadData()
  }

  async function openParts(p: PlanRow) {
    setOpenPlan(p)
    setRecvAmount(String(Number(p.remaining)))
    setRecvMethod('cash'); setRecvRef(''); setRecvNotes('')
    setRecvDrawerId(''); setRecvBank(''); setRecvDueDate('')
    const token = getToken()
    if (!token) return
    const res = await supabase.rpc('sahl_get_installment_parts', { p_token: token, p_plan_id: p.id })
    if (res.error) { toast.error(res.error.message); return }
    const data = res.data as any
    if (data?.error) { toast.error(data.error); return }
    setPlanParts(Array.isArray(data) ? data : [])
  }

  async function receivePayment() {
    if (!openPlan) return
    const amt = Number(recvAmount)
    if (!amt || amt <= 0) { toast.error('أدخل مبلغاً صحيحاً'); return }
    if (amt > Number(openPlan.remaining)) { toast.error('المبلغ يتجاوز المتبقي على الخطة'); return }
    const isCheque = recvMethod === 'cheque'
    if (isCheque) {
      if (!recvRef.trim()) { toast.error('أدخل رقم الشيك'); return }
      if (!recvBank.trim()) { toast.error('أدخل اسم البنك'); return }
      if (!recvDueDate) { toast.error('حدد تاريخ استحقاق الشيك'); return }
    }
    const token = getToken()
    if (!token) return
    setReceiving(true)
    const res = await supabase.rpc('sahl_receive_installment', {
      p_token: token, p_plan_id: openPlan.id, p_amount: amt,
      p_method: recvMethod, p_reference_number: recvRef.trim() || null,
      p_notes: recvNotes.trim() || null,
      p_treasury_id: recvDrawerId || null,
      p_cheque_bank_name: isCheque ? recvBank.trim() : null,
      p_cheque_due_date: isCheque ? recvDueDate : null,
    })
    setReceiving(false)
    if (res.error) { toast.error(res.error.message); return }
    const data = res.data as any
    if (data?.error) {
      if (data.error === 'EXCEEDS_REMAINING') toast.error(`يتجاوز المتبقي: ${formatCurrencyShort(data.remaining)}`)
      else toast.error(data.error)
      return
    }
    const allocText = (data.allocations || [])
      .map((a: any) => `قسط ${a.part_number}${a.fully_settled ? ' ✓' : ''}`)
      .join('، ')
    if (data.cheque_code) {
      toast.success(`تم القبض بشيك ${data.cheque_code} (${allocText}) — تُقيَّد الخزينة عند تحصيل الشيك`, { duration: 5500 })
    } else {
      toast.success(`تم قبض ${formatCurrencyShort(amt)} (${allocText}) — سند ${data.collection_code}`, { duration: 5000 })
    }
    setOpenPlan(null)
    await loadData()
  }

  async function cancelPlan(p: PlanRow) {
    const token = getToken()
    if (!token) return
    const res = await supabase.rpc('sahl_cancel_installment_plan', { p_token: token, p_plan_id: p.id })
    if (res.error) { toast.error(res.error.message); return }
    const data = res.data as any
    if (data?.error) {
      if (data.error === 'HAS_PAYMENTS') toast.error('لا يمكن إلغاء خطة عليها مدفوعات')
      else toast.error(data.error)
      return
    }
    toast('تم إلغاء الخطة')
    await loadData()
  }

  const custName = (id: string) => {
    const c = customers.find((x) => x.id === id)
    return c ? (c.company_name || c.name || '') : ''
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => nav('/sahl')} className="text-text-secondary text-lg">&rarr;</button>
          <div>
            <h1 className="text-lg font-bold text-text">الأقساط</h1>
            <p className="text-[10px] text-text-secondary">خطط سداد مجدولة للعملاء وتحصيل أقساطها</p>
          </div>
        </div>
        <button onClick={loadData} className="text-[10px] text-primary border border-border rounded px-2 py-1">تحديث</button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="text-[10px] text-text-secondary">خطط نشطة</div>
          <div className="text-lg font-bold text-text mt-1">{totals.active}</div>
        </div>
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="text-[10px] text-text-secondary">متبقٍ على الخطط</div>
          <div className="text-lg font-bold text-danger mt-1">{formatCurrencyShort(totals.outstanding)}</div>
        </div>
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="text-[10px] text-text-secondary">عليها قسط متأخر</div>
          <div className="text-lg font-bold text-accent mt-1">{totals.overdue}</div>
        </div>
      </div>

      {canManage && (
        <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="bg-gradient-to-l from-violet-700 to-violet-600 px-5 py-3.5">
            <h2 className="text-sm font-bold text-white">🗓️ خطة أقساط جديدة</h2>
          </div>
          <div className="p-5 grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
            <div className="col-span-2">
              <label className="text-xs font-semibold text-text-secondary block mb-1.5">العميل *</label>
              <select value={custId} onChange={(e) => setCustId(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white">
                <option value="">— اختر العميل —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.company_name || c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-text-secondary block mb-1.5">الإجمالي *</label>
              <input type="number" min="0" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
            </div>
            <div>
              <label className="text-xs font-semibold text-text-secondary block mb-1.5">عدد الأقساط *</label>
              <input type="number" min="1" max="120" step="1" value={partsCount} onChange={(e) => setPartsCount(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
            </div>
            <div>
              <label className="text-xs font-semibold text-text-secondary block mb-1.5">بداية السداد *</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
            </div>
            <button onClick={createPlan} disabled={saving}
              className="bg-gradient-to-l from-violet-700 to-violet-600 disabled:opacity-50 text-white rounded-xl py-2.5 text-sm font-bold active:opacity-80">
              {saving ? 'جاري الحفظ...' : 'حفظ الخطة'}
            </button>
          </div>
          {Number(total) > 0 && Number(partsCount) >= 1 && (
            <div className="px-5 pb-4 -mt-1 text-[11px] text-text-secondary">
              القسط الشهري ≈ <span className="font-bold text-text">{formatCurrencyShort(Number(total) / Number(partsCount))}</span>
              {' '}• القسط الأخير يستوعب فرق التقريب • تواريخ الاستحقاق شهرية من تاريخ البداية
            </div>
          )}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="bg-surface px-5 py-3.5 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-bold text-text">📋 خطط الأقساط</h2>
          <label className="flex items-center gap-1.5 text-[10px] text-text-secondary cursor-pointer select-none">
            <input type="checkbox" checked={statusFilter === 'all'} onChange={(e) => setStatusFilter(e.target.checked ? 'all' : 'active')} />
            إظهار المكتملة والملغاة
          </label>
        </div>
        {loading ? (
          <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
        ) : visiblePlans.length === 0 ? (
          <div className="text-center py-12 text-text-secondary text-sm">لا توجد خطط</div>
        ) : (
          <div className="divide-y divide-border/60 max-h-[520px] overflow-y-auto">
            {visiblePlans.map((p) => {
              const pct = Math.min(100, Math.round((Number(p.paid_total) / Number(p.total_amount)) * 100))
              const overdue = p.status === 'active' && p.next_due_date && new Date(p.next_due_date) < new Date(new Date().toDateString())
              return (
                <div key={p.id} className="px-5 py-3 flex items-center justify-between gap-2">
                  <button onClick={() => openParts(p)} className="min-w-0 text-right flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-text truncate">{p.customer_name || custName(p.customer_id)}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                        p.status === 'completed' ? 'bg-green-100 text-green-800'
                        : p.status === 'cancelled' ? 'bg-red-100 text-red-700'
                        : 'bg-violet-100 text-violet-800'}`}>
                        {p.status === 'completed' ? 'مكتملة' : p.status === 'cancelled' ? 'ملغاة' : `${p.settled_count}/${p.parts_count} أقساط`}
                      </span>
                      {overdue && <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-100 text-red-700">متأخر</span>}
                    </div>
                    <div className="text-[10px] text-text-secondary mt-0.5">
                      {p.code}{p.title ? ` • ${p.title}` : ''} • استحقاق القادم: {p.next_due_date ? formatDate(p.next_due_date) : '—'}
                    </div>
                    <div className="mt-1.5 h-1.5 w-full max-w-[240px] bg-surface rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-green-500' : 'bg-violet-500'}`} style={{ width: `${pct}%` }} />
                    </div>
                  </button>
                  <div className="shrink-0 text-left flex items-center gap-3">
                    <div>
                      <div className="text-[9px] text-text-secondary">المتبقي</div>
                      <div className="text-xs font-bold text-danger">{formatCurrencyShort(p.remaining)}</div>
                    </div>
                    {canManage && p.status === 'active' && (
                      <>
                        <button onClick={() => openParts(p)} className="text-[10px] bg-green-600 text-white rounded px-2 py-1.5">تحصيل قسط</button>
                        {Number(p.paid_total) === 0 && (
                          <button onClick={() => cancelPlan(p)} className="text-[10px] border border-red-300 text-red-600 rounded px-2 py-1.5">إلغاء</button>
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

      {openPlan && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setOpenPlan(null)}>
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="bg-gradient-to-l from-violet-700 to-violet-600 px-5 py-4 sticky top-0">
              <h3 className="text-base font-bold text-white">خطة {openPlan.code}</h3>
              <p className="text-[10px] text-white/70 mt-0.5">
                {openPlan.customer_name} • متبقٍ: {formatCurrencyShort(openPlan.remaining)} من {formatCurrencyShort(openPlan.total_amount)}
              </p>
            </div>

            <div className="px-5 pt-4 pb-2">
              <h4 className="text-xs font-bold text-text-secondary mb-2">جدول الأقساط</h4>
              <div className="divide-y divide-border/60 border border-border rounded-lg overflow-hidden">
                {planParts.map((pt) => (
                  <div key={pt.id} className="flex items-center justify-between px-3 py-2 text-xs bg-white">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-text">#{pt.part_number}</span>
                      <span className="text-text-secondary">{formatDate(pt.due_date)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-text-secondary">
                        {formatCurrencyShort(pt.paid_amount)} / {formatCurrencyShort(pt.amount)}
                      </span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded ${PART_STATE_BADGE[pt.state]}`}>
                        {PART_STATE_LABEL[pt.state]}
                      </span>
                    </div>
                  </div>
                ))}
                {planParts.length === 0 && (
                  <div className="px-3 py-4 text-center text-xs text-text-secondary">—</div>
                )}
              </div>
            </div>

            {canManage && openPlan.status === 'active' && (
              <div className="p-5 space-y-3">
                <h4 className="text-xs font-bold text-text-secondary">تحصيل دفعة</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-text-secondary block mb-1.5">المبلغ *</label>
                    <input type="number" min="0" step="0.01" value={recvAmount}
                      onChange={(e) => setRecvAmount(e.target.value)}
                      className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
                    <button onClick={() => setRecvAmount(String(Number(openPlan.remaining)))}
                      className="text-[10px] text-primary mt-1">(كامل المتبقي)</button>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-text-secondary block mb-1.5">طريقة الدفع</label>
                    <select value={recvMethod} onChange={(e) => setRecvMethod(e.target.value)}
                      className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white">
                      {Object.entries(METHODS).map(([k, label]) => (
                        <option key={k} value={k}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <input value={recvRef} onChange={(e) => setRecvRef(e.target.value)}
                  placeholder={recvMethod === 'cheque' ? 'رقم الشيك *' : 'مرجع (رقم شيك / تحويل)'}
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
                {recvMethod === 'cheque' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-text-secondary block mb-1.5">بنك السحب *</label>
                      <input value={recvBank} onChange={(e) => setRecvBank(e.target.value)}
                        placeholder="اسم البنك"
                        className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-text-secondary block mb-1.5">تاريخ الاستحقاق *</label>
                      <input type="date" value={recvDueDate} onChange={(e) => setRecvDueDate(e.target.value)}
                        className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
                    </div>
                  </div>
                )}
                {recvMethod !== 'cheque' && (
                  <div>
                    <label className="text-xs font-semibold text-text-secondary block mb-1.5">درج الاستلام</label>
                    <select value={recvDrawerId} onChange={(e) => setRecvDrawerId(e.target.value)}
                      className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white">
                      <option value="">افتراضي (الدرج الرئيسي)</option>
                      {treasuries.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}{t.kind === 'bank' ? ' (بنك)' : ''}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="text-[10px] text-text-secondary bg-surface/60 rounded-lg p-2.5">
                  {recvMethod === 'cheque'
                    ? 'يُخصم من رصيد العميل فوراً ويُسجَّل شيك مرتبط — تُقيَّد الخزينة عند التحصيل، والارتداد يعكس القسط تلقائياً.'
                    : 'يُوزَّع المبلغ على الأقساط بالترتيب (الأقدم أولاً) ويُرحَّل للخزينة ويُخصم من رصيد العميل تلقائياً.'}
                </div>
                <button onClick={receivePayment} disabled={receiving}
                  className="w-full bg-gradient-to-l from-green-700 to-green-600 disabled:opacity-50 text-white rounded-xl py-2.5 text-sm font-bold">
                  {receiving ? 'جاري الحفظ...' : `قبض ${formatCurrencyShort(Number(recvAmount) || 0)}`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
