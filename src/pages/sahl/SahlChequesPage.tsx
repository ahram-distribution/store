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
interface SupplierRow { id: string; supplier_name?: string }
interface TreasuryRow { id: string; name: string; kind: 'cash' | 'bank'; is_active: boolean }
interface ChequeRow {
  id: string; code: string; direction: 'incoming' | 'outgoing'
  party_type: 'customer' | 'supplier'; party_id: string; party_name?: string
  amount: number; applied_amount?: number; bank_name: string; cheque_number: string
  due_date: string; status: 'pending' | 'deposited' | 'cleared' | 'bounced' | 'cancelled'
  deposited_at?: string | null; cleared_at?: string | null; closed_at?: string | null
  notes?: string | null; created_at?: string; overdue?: boolean
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-surface text-text-secondary',
  deposited: 'bg-cyan-100 text-cyan-800',
  cleared: 'bg-green-100 text-green-800',
  bounced: 'bg-red-100 text-red-700',
  cancelled: 'bg-red-50 text-red-400',
}
const STATUS_LABEL: Record<string, string> = {
  pending: 'قيد التحصيل', deposited: 'مودع بالبنك', cleared: 'مُحصّل', bounced: 'مرتد', cancelled: 'ملغي',
}

export function SahlChequesPage() {
  const nav = useNavigate()
  const canManage = useCapability('sahl.cheques.manage')

  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([])
  const [cheques, setCheques] = useState<ChequeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'open' | 'all'>('open')

  const [direction, setDirection] = useState<'incoming' | 'outgoing'>('incoming')
  const [partyId, setPartyId] = useState('')
  const [amount, setAmount] = useState('')
  const [bankName, setBankName] = useState('')
  const [chqNumber, setChqNumber] = useState('')
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 30)
    return d.toISOString().slice(0, 10)
  })
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [treasuries, setTreasuries] = useState<TreasuryRow[]>([])
  const [settleTrId, setSettleTrId] = useState('')

  async function loadData() {
    const token = getToken()
    if (!token) return
    setLoading(true)
    const [cRes, sRes, qRes, tRes] = await Promise.all([
      supabase.rpc('get_governed_customers', { p_token: token }),
      supabase.rpc('sahl_get_suppliers', { p_token: token }),
      supabase.rpc('sahl_get_cheques', { p_token: token }),
      supabase.rpc('sahl_get_treasuries', { p_token: token }),
    ])
    if (Array.isArray(cRes.data)) setCustomers(cRes.data as CustomerRow[])
    if (Array.isArray(sRes.data)) setSuppliers(sRes.data as SupplierRow[])
    if (!tRes.error && Array.isArray(tRes.data))
      setTreasuries((tRes.data as TreasuryRow[]).filter(t => t.is_active))
    if (qRes.error) toast.error(qRes.error.message)
    else {
      const data = qRes.data as any
      if (data?.error) toast.error(data.error)
      else setCheques(Array.isArray(data) ? data : [])
    }
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  const visible = useMemo(
    () => filter === 'open' ? cheques.filter((c) => c.status === 'pending' || c.status === 'deposited') : cheques,
    [cheques, filter]
  )

  const totals = useMemo(() => ({
    incoming: cheques.filter((c) => c.direction === 'incoming' && ['pending', 'deposited'].includes(c.status))
      .reduce((s, c) => s + Number(c.amount || 0), 0),
    outgoing: cheques.filter((c) => c.direction === 'outgoing' && ['pending', 'deposited'].includes(c.status))
      .reduce((s, c) => s + Number(c.amount || 0), 0),
    overdue: cheques.filter((c) => c.overdue).length,
  }), [cheques])

  async function registerCheque() {
    if (!partyId) { toast.error(direction === 'incoming' ? 'اختر العميل' : 'اختر المورد'); return }
    const amt = Number(amount)
    if (!amt || amt <= 0) { toast.error('أدخل مبلغاً صحيحاً'); return }
    if (!bankName.trim()) { toast.error('أدخل اسم البنك'); return }
    if (!chqNumber.trim()) { toast.error('أدخل رقم الشيك'); return }
    if (!dueDate) { toast.error('حدد تاريخ الاستحقاق'); return }
    const token = getToken()
    if (!token) return
    setSaving(true)
    const res = await supabase.rpc('sahl_register_cheque', {
      p_token: token, p_direction: direction, p_party_id: partyId,
      p_amount: amt, p_bank_name: bankName.trim(), p_cheque_number: chqNumber.trim(),
      p_due_date: dueDate, p_notes: notes.trim() || null,
    })
    setSaving(false)
    if (res.error) { toast.error(res.error.message); return }
    const data = res.data as any
    if (data?.error) {
      toast.error(
        data.error === 'CUSTOMER_NOT_FOUND' ? 'العميل غير موجود'
        : data.error === 'SUPPLIER_NOT_FOUND' ? 'المورد غير موجود'
        : data.error)
      return
    }
    toast.success(`تم تسجيل الشيك ${data.code}${Number(data.applied_amount) > 0 ? ` — خُصم ${formatCurrencyShort(data.applied_amount)} من الحساب` : ''}`, { duration: 4500 })
    setPartyId(''); setAmount(''); setChqNumber(''); setNotes('')
    await loadData()
  }

  async function doAction(c: ChequeRow, action: 'deposited' | 'clear' | 'bounce' | 'cancel') {
    const confirmMsgs: Record<string, string> = {
      bounce: `ارتداد الشيك ${c.code}؟ سيُعاد المبلغ المخصوم إلى حساب الطرف.`,
      cancel: `إلغاء الشيك ${c.code}؟ سيُعاد المبلغ المخصوم إلى حساب الطرف.`,
      clear: c.direction === 'incoming'
        ? `تحصيل الشيك ${c.code}؟ سيُضاف ${formatCurrencyShort(c.amount)} إلى الخزينة.`
        : `صرف الشيك ${c.code}؟ سيُخصم ${formatCurrencyShort(c.amount)} من الخزينة.`,
      deposited: '',
    }
    if (confirmMsgs[action] && !window.confirm(confirmMsgs[action])) return
    const token = getToken()
    if (!token) return
    setBusyId(c.id)
    const res = await supabase.rpc('sahl_cheque_action', {
      p_token: token, p_cheque_id: c.id, p_action: action,
      p_treasury_id: action === 'clear' ? (settleTrId || null) : null,
    })
    setBusyId(null)
    if (res.error) { toast.error(res.error.message); return }
    const data = res.data as any
    if (data?.error) {
      toast.error(
        data.error === 'ALREADY_CLOSED' ? 'الشيك مُغلق بالفعل'
        : data.error === 'INVALID_STATE' ? 'حالة الشيك لا تسمح بهذا الإجراء'
        : data.error)
      return
    }
    if (action === 'clear') {
      toast.success(`${c.direction === 'incoming' ? 'تم تحصيل' : 'تم صرف'} ${formatCurrencyShort(c.amount)} ${c.direction === 'incoming' ? 'إلى' : 'من'} الخزينة`, { duration: 4000 })
    } else if (action === 'bounce') {
      toast(`ارتداد الشيك — أُعيد ${formatCurrencyShort(data.restored_amount)} للحساب`, { duration: 4000 })
    } else if (action === 'cancel') {
      toast('تم إلغاء الشيك')
    } else {
      toast.success('تم تسجيل الإيداع بالبنك')
    }
    await loadData()
  }

  const parties = direction === 'incoming' ? customers.map((c) => ({ id: c.id, name: c.company_name || c.name || '' })) : suppliers.map((s) => ({ id: s.id, name: s.supplier_name || '' }))

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => nav('/sahl')} className="text-text-secondary text-lg">&rarr;</button>
          <div>
            <h1 className="text-lg font-bold text-text">الشيكات</h1>
            <p className="text-[10px] text-text-secondary">شيكات واردة وصادرة — تأثير الحساب فور التسجيل والخزينة عند التحصيل</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-text-secondary whitespace-nowrap">حساب التسوية (عند التحصيل/الصرف)</label>
          <select value={settleTrId} onChange={(e) => setSettleTrId(e.target.value)}
            className="text-[10px] border border-border rounded px-2 py-1.5 bg-white max-w-[170px]">
            <option value="">افتراضي (الدرج الرئيسي)</option>
            {treasuries.map((t) => (
              <option key={t.id} value={t.id}>{t.name}{t.kind === 'bank' ? ' (بنك)' : ''}</option>
            ))}
          </select>
        </div>
        <button onClick={loadData} className="text-[10px] text-primary border border-border rounded px-2 py-1">تحديث</button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="text-[10px] text-text-secondary">واردة قيد التحصيل</div>
          <div className="text-lg font-bold text-green-700 mt-1">{formatCurrencyShort(totals.incoming)}</div>
        </div>
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="text-[10px] text-text-secondary">صادرة قيد الصرف</div>
          <div className="text-lg font-bold text-danger mt-1">{formatCurrencyShort(totals.outgoing)}</div>
        </div>
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="text-[10px] text-text-secondary">تجاوزت الاستحقاق</div>
          <div className="text-lg font-bold text-accent mt-1">{totals.overdue}</div>
        </div>
      </div>

      {canManage && (
        <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="bg-gradient-to-l from-teal-700 to-teal-600 px-5 py-3.5 flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">🧾 تسجيل شيك</h2>
            <div className="flex rounded-lg overflow-hidden border border-white/30">
              <button onClick={() => { setDirection('incoming'); setPartyId('') }}
                className={`px-3 py-1 text-[11px] font-bold ${direction === 'incoming' ? 'bg-white text-teal-700' : 'text-white'}`}>وارد (عميل)</button>
              <button onClick={() => { setDirection('outgoing'); setPartyId('') }}
                className={`px-3 py-1 text-[11px] font-bold ${direction === 'outgoing' ? 'bg-white text-teal-700' : 'text-white'}`}>صادر (مورّد)</button>
            </div>
          </div>
          <div className="p-5 grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
            <div className="col-span-2">
              <label className="text-xs font-semibold text-text-secondary block mb-1.5">{direction === 'incoming' ? 'العميل' : 'المورد'} *</label>
              <select value={partyId} onChange={(e) => setPartyId(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white">
                <option value="">— اختر —</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-text-secondary block mb-1.5">المبلغ *</label>
              <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
            </div>
            <div>
              <label className="text-xs font-semibold text-text-secondary block mb-1.5">البنك *</label>
              <input value={bankName} onChange={(e) => setBankName(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
            </div>
            <div>
              <label className="text-xs font-semibold text-text-secondary block mb-1.5">رقم الشيك *</label>
              <input value={chqNumber} onChange={(e) => setChqNumber(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
            </div>
            <div>
              <label className="text-xs font-semibold text-text-secondary block mb-1.5">الاستحقاق *</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
            </div>
          </div>
          <div className="px-5 pb-4 grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
            <div className="md:col-span-4">
              <label className="text-xs font-semibold text-text-secondary block mb-1.5">ملاحظات</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder={direction === 'incoming' ? 'مثال: دفعة من العميل مقابل الفاتورة...' : ''}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
            </div>
            <button onClick={registerCheque} disabled={saving}
              className="md:col-span-2 bg-gradient-to-l from-teal-700 to-teal-600 disabled:opacity-50 text-white rounded-xl py-2.5 text-sm font-bold active:opacity-80">
              {saving ? 'جاري الحفظ...' : 'تسجيل الشيك'}
            </button>
          </div>
          <div className="px-5 pb-4 text-[10px] text-text-secondary bg-surface/60 mx-5 mb-4 rounded-lg p-2.5">
            {direction === 'incoming'
              ? 'التسجيل يخفض رصيد العميل فوراً (بنفس قاعدة القبض). الخزينة تتأثر فقط عند التحصيل؛ الارتداد أو الإلغاء يعيد المبلغ المخصوم.'
              : 'التسجيل يخفض المستحق للمورد فوراً. الخزينة تُخصم فقط عند الصرف الفعلي؛ الارتداد أو الإلغاء يعيد المستحق.'}
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="bg-surface px-5 py-3.5 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-bold text-text">📚 سجل الشيكات</h2>
          <label className="flex items-center gap-1.5 text-[10px] text-text-secondary cursor-pointer select-none">
            <input type="checkbox" checked={filter === 'all'} onChange={(e) => setFilter(e.target.checked ? 'all' : 'open')} />
            إظهار المغلقة
          </label>
        </div>
        {loading ? (
          <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
        ) : visible.length === 0 ? (
          <div className="text-center py-12 text-text-secondary text-sm">لا شيكات</div>
        ) : (
          <div className="divide-y divide-border/60 max-h-[520px] overflow-y-auto">
            {visible.map((c) => (
              <div key={c.id} className="px-5 py-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${c.direction === 'incoming' ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'}`}>
                      {c.direction === 'incoming' ? 'وارد' : 'صادر'}
                    </span>
                    <span className="text-sm font-semibold text-text truncate">{c.party_name}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${STATUS_BADGE[c.status]}`}>{STATUS_LABEL[c.status]}</span>
                    {c.overdue && <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-100 text-red-700">متأخر</span>}
                  </div>
                  <div className="text-[10px] text-text-secondary mt-0.5">
                    {c.code} • شيك رقم {c.cheque_number} — {c.bank_name} • استحقاق: {formatDate(c.due_date)}
                    {c.cleared_at ? ` • حُصّل ${formatDate(c.cleared_at)}` : ''}
                    {c.notes ? ` • ${c.notes}` : ''}
                  </div>
                </div>
                <div className="shrink-0 text-left flex items-center gap-2">
                  <div className="w-20">
                    <div className="text-[9px] text-text-secondary">المبلغ</div>
                    <div className="text-xs font-bold text-text">{formatCurrencyShort(c.amount)}</div>
                  </div>
                  {canManage && busyId !== c.id && (
                    <>
                      {c.status === 'pending' && (
                        <button onClick={() => doAction(c, 'deposited')} className="text-[10px] bg-cyan-600 text-white rounded px-2 py-1.5">إيداع</button>
                      )}
                      {(c.status === 'pending' || c.status === 'deposited') && (
                        <>
                          <button onClick={() => doAction(c, 'clear')} className="text-[10px] bg-green-600 text-white rounded px-2 py-1.5">
                            {c.direction === 'incoming' ? 'تحصيل' : 'صرف'}
                          </button>
                          <button onClick={() => doAction(c, 'bounce')} className="text-[10px] bg-red-600 text-white rounded px-2 py-1.5">ارتداد</button>
                          <button onClick={() => doAction(c, 'cancel')} className="text-[10px] border border-red-300 text-red-600 rounded px-2 py-1.5">إلغاء</button>
                        </>
                      )}
                    </>
                  )}
                  {busyId === c.id && <span className="text-[10px] text-text-secondary">...</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
