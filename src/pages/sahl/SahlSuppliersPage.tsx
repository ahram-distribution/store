import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort, formatDate } from '../../utils/format'
import { useCapability } from '../../hooks/useCapability'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface SupplierRow {
  id: string
  code?: string
  supplier_name?: string
  phone?: string
  address?: string
  notes?: string
  is_active?: boolean
  outstanding_credit?: number | null
}

const methodLabels: Record<string, string> = {
  cash: 'نقداً', bank_transfer: 'تحويل بنكي', cheque: 'شيك', deposit: 'إيداع',
}

export function SahlSuppliersPage() {
  const nav = useNavigate()
  const canManage = useCapability('sahl.suppliers.manage')
  const canPay = useCapability('sahl.payments.suppliers.create')
  const canPostPay = useCapability('sahl.payments.suppliers.post')

  const [suppliers, setSuppliers] = useState<SupplierRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newAddress, setNewAddress] = useState('')
  const [savingSupplier, setSavingSupplier] = useState(false)

  const [statement, setStatement] = useState<SupplierRow | null>(null)
  const [ledgerRows, setLedgerRows] = useState<any[]>([])
  const [payments, setPayments] = useState<any[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('cash')
  const [payRef, setPayRef] = useState('')
  const [payNotes, setPayNotes] = useState('')
  const [paying, setPaying] = useState(false)

  async function loadSuppliers() {
    const token = getToken()
    if (!token) return
    setLoading(true)
    const res = await supabase.rpc('sahl_get_suppliers', { p_token: token })
    if (res.error) toast.error(res.error.message)
    else {
      const data = res.data as any
      if (data?.error) toast.error(data.error)
      else setSuppliers(Array.isArray(data) ? data : [])
    }
    setLoading(false)
  }

  async function loadAllPayments() {
    const token = getToken()
    if (!token) return []
    const res = await supabase.rpc('sahl_get_supplier_payments', { p_token: token })
    if (res.error || (res.data as any)?.error) return []
    return Array.isArray(res.data) ? res.data : []
  }

  useEffect(() => { loadSuppliers() }, [])

  const totals = useMemo(() => {
    let payable = 0
    for (const s of suppliers) payable += Number(s.outstanding_credit || 0)
    return { payable }
  }, [suppliers])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return suppliers
    return suppliers.filter((s) =>
      (s.supplier_name || '').toLowerCase().includes(q) ||
      (s.code || '').toLowerCase().includes(q) ||
      (s.phone || '').includes(q))
  }, [suppliers, search])

  async function createSupplier() {
    if (!newName.trim()) { toast.error('أدخل اسم المورد'); return }
    const token = getToken()
    if (!token) return
    setSavingSupplier(true)
    const res = await supabase.rpc('sahl_create_supplier', {
      p_token: token,
      p_supplier_name: newName.trim(),
      p_phone: newPhone.trim() || null,
      p_address: newAddress.trim() || null,
      p_notes: null,
    })
    setSavingSupplier(false)
    if (res.error) { toast.error(res.error.message); return }
    const data = res.data as any
    if (data?.error) { toast.error(data.error); return }
    toast.success(`تم إضافة المورد`)
    setNewName(''); setNewPhone(''); setNewAddress(''); setShowCreate(false)
    await loadSuppliers()
  }

  async function openStatement(s: SupplierRow) {
    setStatement(s)
    setLedgerRows([])
    setPayments([])
    setPayAmount(''); setPayRef(''); setPayNotes('')
    const token = getToken()
    if (!token) return
    setDetailLoading(true)
    const [ledRes, payRes] = await Promise.all([
      supabase.rpc('sahl_get_supplier_ledger', { p_token: token, p_supplier_id: s.id }),
      loadAllPayments(),
    ])
    setDetailLoading(false)
    if (ledRes.error) { toast.error(ledRes.error.message); return }
    const ledData = ledRes.data as any
    if (ledData?.error) { toast.error(ledData.error); return }
    setLedgerRows(Array.isArray(ledData) ? ledData : [])
    setPayments(payRes.filter((p: any) => p.supplier_id === s.id).slice(0, 10))
  }

  async function submitPayment() {
    if (!statement) return
    const amt = Number(payAmount)
    if (!amt || amt <= 0) { toast.error('أدخل مبلغاً صحيحاً'); return }
    const token = getToken()
    if (!token) return
    setPaying(true)
    const cr = await supabase.rpc('sahl_create_supplier_payment', {
      p_token: token, p_supplier_id: statement.id, p_amount: amt, p_method: payMethod,
      p_reference_number: payRef.trim() || null, p_notes: payNotes.trim() || null,
    })
    if (cr.error) { toast.error(cr.error.message); setPaying(false); return }
    const created = cr.data as any
    if (created?.error) { toast.error(created.error); setPaying(false); return }

    let postInfo = ''
    if (canPostPay) {
      const pr = await supabase.rpc('sahl_post_supplier_payment', { p_token: token, p_payment_id: created.id })
      if (pr.error) { toast.error(`تم إنشاء السند ${created.code} لكن فشل الترحيل: ${pr.error.message}`); setPaying(false); await openStatementRefresh(); return }
      const posted = pr.data as any
      if (posted?.error) { toast.error(`تم إنشاء السند ${created.code} لكن فشل الترحيل: ${posted.error}`); setPaying(false); await openStatementRefresh(); return }
      postInfo = ` — المستحق بعد الدفع: ${formatCurrencyShort(posted.outstanding_after || 0)}`
    }
    toast.success(`${canPostPay ? 'تم الصرف والترحيل' : 'تم حفظ سند معلق'} ${created.code}${postInfo}`, { duration: 4000 })
    setPaying(false)
    await openStatementRefresh()
  }

  async function openStatementRefresh() {
    if (!statement) return
    const cur = statement
    await loadSuppliers()
    const updated = suppliers.find((x) => x.id === cur.id)
    setStatement(updated || cur)
    await openStatement(updated || cur)
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => nav('/sahl')} className="text-text-secondary text-lg">&rarr;</button>
          <div>
            <h1 className="text-lg font-bold text-text">الموردين</h1>
            <p className="text-[10px] text-text-secondary">بيانات الموردين والمستحقات وسندات الصرف</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={loadSuppliers} className="text-[10px] text-primary border border-border rounded px-2 py-1">تحديث</button>
          {canManage && (
            <button onClick={() => setShowCreate(!showCreate)}
              className={`text-[10px] rounded px-2 py-1 ${showCreate ? 'border border-border text-text-secondary' : 'bg-primary text-white'}`}>
              مورد جديد
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="text-[10px] text-text-secondary">إجمالي ما علينا للموردين</div>
          <div className="text-lg font-bold text-danger mt-1">{formatCurrencyShort(totals.payable)}</div>
        </div>
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="text-[10px] text-text-secondary">عدد الموردين</div>
          <div className="text-lg font-bold text-text mt-1">{suppliers.length}</div>
        </div>
      </div>

      {showCreate && canManage && (
        <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="bg-gradient-to-l from-indigo-700 to-indigo-600 px-5 py-3.5">
            <h2 className="text-sm font-bold text-white">➕ مورد جديد</h2>
          </div>
          <div className="p-5 grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div className="md:col-span-1">
              <label className="text-xs font-semibold text-text-secondary block mb-1.5">الاسم *</label>
              <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
            </div>
            <div>
              <label className="text-xs font-semibold text-text-secondary block mb-1.5">الهاتف</label>
              <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
            </div>
            <div>
              <label className="text-xs font-semibold text-text-secondary block mb-1.5">العنوان</label>
              <input value={newAddress} onChange={(e) => setNewAddress(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
            </div>
            <button onClick={createSupplier} disabled={savingSupplier}
              className="bg-gradient-to-l from-indigo-700 to-indigo-600 disabled:opacity-50 text-white rounded-xl py-2.5 text-sm font-bold active:opacity-80">
              {savingSupplier ? 'جاري الحفظ...' : 'حفظ المورد'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 bg-surface border-b border-border flex items-center gap-3">
          <h2 className="text-sm font-bold text-text shrink-0">🏭 قائمة الموردين</h2>
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث بالاسم / الكود / الهاتف..."
            className="flex-1 border border-border rounded-lg px-3 py-1.5 text-xs bg-white outline-none focus:border-primary" />
        </div>
        {loading ? (
          <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-text-secondary text-sm">
            {suppliers.length === 0 ? 'لا يوجد موردين بعد — أضف أول مورد' : 'لا يوجد موردين مطابقون'}
          </div>
        ) : (
          <div className="divide-y divide-border/60 max-h-[520px] overflow-y-auto">
            {filtered.map((s) => {
              const bal = Number(s.outstanding_credit || 0)
              return (
                <button key={s.id} onClick={() => openStatement(s)}
                  className="w-full text-right px-5 py-3 hover:bg-surface/60 transition-colors flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-text truncate">{s.supplier_name}</span>
                      {!s.is_active && <span className="text-[9px] px-1.5 py-0.5 rounded bg-surface text-text-secondary">موقوف</span>}
                    </div>
                    <div className="text-[10px] text-text-secondary">{s.code}{s.phone ? ` • ${s.phone}` : ''}{s.address ? ` • ${s.address}` : ''}</div>
                  </div>
                  <div className="shrink-0 text-left">
                    <div className="text-[9px] text-text-secondary">المستحق له</div>
                    <div className={`text-sm font-bold ${bal > 0 ? 'text-danger' : 'text-success'}`}>{formatCurrencyShort(bal)}</div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {statement && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setStatement(null)}>
          <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[88vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="bg-gradient-to-l from-slate-700 to-slate-600 px-5 py-4 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white">حساب المورد — {statement.supplier_name}</h3>
                <p className="text-[10px] text-white/70 mt-0.5">{statement.code}</p>
              </div>
              <div className="text-left">
                <div className="text-[10px] text-white/70">المستحق له</div>
                <div className="text-lg font-bold text-white">{formatCurrencyShort(statement.outstanding_credit || 0)}</div>
              </div>
            </div>

            <div className="overflow-y-auto flex-1">
              <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
                <div className="p-4">
                  <h4 className="text-xs font-bold text-text mb-2">حركات الحساب</h4>
                  {detailLoading ? (
                    <div className="text-center py-8 text-text-secondary text-xs">جاري التحميل...</div>
                  ) : ledgerRows.length === 0 ? (
                    <div className="text-center py-8 text-text-secondary text-xs">لا توجد حركات</div>
                  ) : (
                    <div className="space-y-1.5">
                      {ledgerRows.map((l: any) => (
                        <div key={l.id} className="flex items-center justify-between text-xs border-b border-border/50 pb-1.5">
                          <span className="text-text-secondary">{formatDate(l.created_at)}</span>
                          <span className={l.transaction_type === 'credit' ? 'text-danger font-semibold' : 'text-success font-semibold'}>
                            {l.transaction_type === 'credit' ? '+' : '-'}{formatCurrencyShort(l.amount)}
                            <span className="text-[9px] text-text-secondary mr-1">(رصيد: {formatCurrencyShort(l.running_balance)})</span>
                          </span>
                          <span className="text-[9px] text-text-secondary w-24 text-left truncate" title={l.notes || ''}>{l.notes || ''}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <h4 className="text-xs font-bold text-text mb-2">سندات الصرف للمورد</h4>
                  {payments.length === 0 ? (
                    <div className="text-center py-8 text-text-secondary text-xs">لا توجد سندات</div>
                  ) : (
                    <div className="space-y-1.5">
                      {payments.map((p: any) => (
                        <div key={p.id} className="flex items-center justify-between text-xs border-b border-border/50 pb-1.5">
                          <span className="text-text-secondary">{formatDate(p.created_at)}</span>
                          <span>{p.code}
                            <span className={`text-[9px] mr-1 ${p.status === 'treasury_posted' ? 'text-success' : 'text-accent'}`}>
                              ({p.status === 'treasury_posted' ? 'مرحّل' : 'معلق'})
                            </span>
                          </span>
                          <span className="font-semibold text-danger">{formatCurrencyShort(p.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {(canPay || canPostPay) && (
                <div className="border-t border-border bg-surface/60 p-4">
                  <h4 className="text-xs font-bold text-text mb-2">💸 سند صرف جديد للمورد</h4>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
                    <div>
                      <label className="text-[10px] font-semibold text-text-secondary block mb-1">المبلغ</label>
                      <input type="number" min="0" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)}
                        placeholder="0.00" className="w-full border border-border rounded-lg px-2 py-2 text-sm bg-white" />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-text-secondary block mb-1">الطريقة</label>
                      <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}
                        className="w-full border border-border rounded-lg px-1 py-2 text-sm bg-white">
                        {Object.entries(methodLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-text-secondary block mb-1">مرجع</label>
                      <input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="اختياري"
                        className="w-full border border-border rounded-lg px-2 py-2 text-sm bg-white" />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-text-secondary block mb-1">ملاحظات</label>
                      <input value={payNotes} onChange={(e) => setPayNotes(e.target.value)} placeholder="اختياري"
                        className="w-full border border-border rounded-lg px-2 py-2 text-sm bg-white" />
                    </div>
                    <button onClick={submitPayment} disabled={paying || !canPay}
                      className="bg-gradient-to-l from-indigo-700 to-indigo-600 disabled:opacity-50 text-white rounded-lg py-2 text-xs font-bold active:opacity-80">
                      {paying ? 'جاري...' : canPostPay ? 'صرف وترحيل للخزينة' : 'حفظ كمعلق'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-border p-3 text-center">
              <button onClick={() => setStatement(null)} className="text-text-secondary text-xs py-1">إغلاق</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
