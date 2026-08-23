import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort, formatDate } from '../../utils/format'
import { useCapability } from '../../hooks/useCapability'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const methodLabels: Record<string, string> = {
  cash: 'نقداً', bank_transfer: 'تحويل بنكي', cheque: 'شيك', deposit: 'إيداع',
}

const statusLabels: Record<string, string> = {
  pending: 'معلق', approved: 'معتمد', treasury_posted: 'مرحّل للخزينة',
}

const statusStyles: Record<string, string> = {
  pending: 'bg-accent/10 text-accent',
  approved: 'bg-primary/10 text-primary',
  treasury_posted: 'bg-success/10 text-success',
}

interface CustomerRow {
  id: string
  code?: string
  company_name?: string
  phone?: string
  current_balance?: number | null
}

interface TreasuryRow { id: string; name: string; kind: 'cash' | 'bank'; is_active: boolean }

export function SahlReceiptsPage() {
  const nav = useNavigate()
  const canPost = useCapability('sahl.receipts.post')

  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [receipts, setReceipts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [search, setSearch] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('cash')
  const [referenceNumber, setReferenceNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [treasuries, setTreasuries] = useState<TreasuryRow[]>([])
  const [drawerId, setDrawerId] = useState('')

  const [statementCustomer, setStatementCustomer] = useState<CustomerRow | null>(null)
  const [ledgerRows, setLedgerRows] = useState<any[]>([])
  const [ledgerLoading, setLedgerLoading] = useState(false)

  async function loadData() {
    const token = getToken()
    if (!token) return
    setLoading(true)
    const [custRes, colRes, trRes] = await Promise.all([
      supabase.rpc('get_governed_customers', { p_token: token }),
      supabase.rpc('get_governed_collections', { p_token: token }),
      supabase.rpc('sahl_get_treasuries', { p_token: token }),
    ])
    if (custRes.data && Array.isArray(custRes.data)) setCustomers(custRes.data as CustomerRow[])
    else if (custRes.error) toast.error(custRes.error.message)
    if (colRes.data && Array.isArray(colRes.data)) setReceipts(colRes.data as any[])
    if (!trRes.error && Array.isArray(trRes.data))
      setTreasuries((trRes.data as TreasuryRow[]).filter(t => t.is_active && t.kind === 'cash'))
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = q
      ? customers.filter((c) =>
          (c.company_name || '').toLowerCase().includes(q) ||
          (c.code || '').toLowerCase().includes(q) ||
          (c.phone || '').includes(q))
      : customers
    return [...list].sort((a, b) => (b.current_balance || 0) - (a.current_balance || 0)).slice(0, 8)
  }, [customers, search])

  const todayPostedTotal = useMemo(() => {
    const n = new Date()
    return receipts
      .filter((r) => r.status === 'treasury_posted' && (() => { const d = new Date(r.created_at); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate() })())
      .reduce((s, r) => s + Number(r.amount || 0), 0)
  }, [receipts])

  const unposted = useMemo(() => receipts.filter((r) => r.status !== 'treasury_posted'), [receipts])
  const recentReceipts = useMemo(() => receipts.slice(0, 30), [receipts])

  const customerMap = useMemo(() => {
    const m = new Map<string, CustomerRow>()
    for (const c of customers) m.set(c.id, c)
    return m
  }, [customers])

  async function submitReceipt(post: boolean) {
    if (!selectedCustomer) { toast.error('اختر العميل أولاً'); return }
    const amt = Number(amount)
    if (!amt || amt <= 0) { toast.error('أدخل مبلغاً صحيحاً'); return }
    const token = getToken()
    if (!token) { toast.error('انتهت الجلسة'); return }
    setSaving(true)

    const createRes = await supabase.rpc('governed_create_collection', {
      p_token: token,
      p_customer_id: selectedCustomer.id,
      p_method: method,
      p_amount: amt,
      p_reference_number: referenceNumber.trim() || null,
      p_notes: notes.trim() || null,
    })

    if (createRes.error) { toast.error(createRes.error.message); setSaving(false); return }
    const created = createRes.data as any
    if (created?.error) { toast.error(created.error); setSaving(false); return }

    let postInfo = ''
    if (post) {
      const postRes = await supabase.rpc('sahl_post_receipt', {
        p_token: token,
        p_collection_id: created.id,
        p_treasury_id: drawerId || null,
      })
      if (postRes.error) { toast.error(`تم إنشاء السند ${created.code} لكن فشل الترحيل: ${postRes.error.message}`); setSaving(false); await loadData(); return }
      const posted = postRes.data as any
      if (posted?.error) { toast.error(`تم إنشاء السند ${created.code} لكن فشل الترحيل: ${posted.error}`); setSaving(false); await loadData(); return }
      postInfo = ` — رصيد العميل بعد القبض: ${formatCurrencyShort(posted.outstanding_after || 0)}`
    }

    toast.success(`${post ? 'تم القبض والترحيل' : 'تم حفظ سند معلق'} ${created.code}${postInfo}`, { duration: 4000 })
    setAmount(''); setReferenceNumber(''); setNotes(''); setSelectedCustomer(null); setSearch('')
    setSaving(false)
    await loadData()
  }

  async function postExisting(id: string) {
    const token = getToken()
    if (!token) return
    const res = await supabase.rpc('sahl_post_receipt', { p_token: token, p_collection_id: id, p_treasury_id: drawerId || null })
    if (res.error) { toast.error(res.error.message); return }
    const posted = res.data as any
    if (posted?.error) { toast.error(posted.error); return }
    toast.success(`تم ترحيل السند ${posted.code} إلى الخزينة`)
    await loadData()
  }

  async function openStatement(cust: CustomerRow) {
    setStatementCustomer(cust)
    setLedgerRows([])
    const token = getToken()
    if (!token) return
    setLedgerLoading(true)
    const res = await supabase.rpc('sahl_get_customer_ledger', { p_token: token, p_customer_id: cust.id })
    setLedgerLoading(false)
    if (res.error) { toast.error(res.error.message); return }
    const data = res.data as any
    if (data?.error) { toast.error(data.error); return }
    setLedgerRows(Array.isArray(data) ? data : [])
  }

  const customerReceipts = useMemo(() =>
    statementCustomer ? receipts.filter((r) => r.customer_id === statementCustomer.id).slice(0, 15) : []
  , [receipts, statementCustomer])

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => nav('/sahl')} className="text-text-secondary text-lg">&rarr;</button>
          <div>
            <h1 className="text-lg font-bold text-text">القبض</h1>
            <p className="text-[10px] text-text-secondary">سندات قبض من العملاء — ترحيل للخزينة وكشف حساب</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="text-[10px] text-text-secondary">محصل اليوم (مرحّل)</div>
          <div className="text-lg font-bold text-success mt-1">{formatCurrencyShort(todayPostedTotal)}</div>
        </div>
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="text-[10px] text-text-secondary">بانتظار الترحيل</div>
          <div className="text-lg font-bold text-warning mt-1">{unposted.length}</div>
        </div>
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="text-[10px] text-text-secondary">عدد سندات اليوم</div>
          <div className="text-lg font-bold text-text mt-1">
            {receipts.filter((r) => (() => { const d = new Date(r.created_at); const n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate() })()).length}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="text-[10px] text-text-secondary">معلق + معتمد (قيمة)</div>
          <div className="text-lg font-bold text-text mt-1">{formatCurrencyShort(unposted.reduce((s, r) => s + Number(r.amount || 0), 0))}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="bg-gradient-to-l from-emerald-700 to-emerald-600 px-5 py-3.5">
            <h2 className="text-sm font-bold text-white">🧾 سند قبض جديد</h2>
          </div>
          <div className="p-5 space-y-4">
            <div className="relative">
              <label className="text-xs font-semibold text-text-secondary block mb-1.5">العميل</label>
              <button type="button" onClick={() => { setPickerOpen(!pickerOpen); setSearch('') }}
                className={`w-full border rounded-lg px-3 py-2.5 text-sm text-right ${pickerOpen ? 'border-primary' : 'border-border'} bg-white flex items-center justify-between`}>
                <span className={selectedCustomer ? 'text-text' : 'text-text-secondary'}>
                  {selectedCustomer ? selectedCustomer.company_name : 'ابحث واختر عميلاً...'}
                </span>
                {selectedCustomer && (
                  <span className="text-[10px] text-danger">الرصيد المستحق: {formatCurrencyShort(selectedCustomer.current_balance || 0)}</span>
                )}
              </button>
              {pickerOpen && (
                <div className="absolute z-20 mt-1 w-full bg-white border border-border rounded-lg shadow-lg max-h-64 overflow-y-auto">
                  <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)}
                    placeholder="اسم العميل / الكود / الهاتف..."
                    className="w-full border-b border-border px-3 py-2 text-sm outline-none sticky top-0 bg-white" />
                  {filteredCustomers.length === 0 ? (
                    <div className="text-center text-xs text-text-secondary py-6">لا يوجد عملاء مطابقون</div>
                  ) : filteredCustomers.map((c) => (
                    <button key={c.id} type="button"
                      onClick={() => { setSelectedCustomer(c); setPickerOpen(false) }}
                      className="w-full text-right px-3 py-2.5 hover:bg-surface flex items-center justify-between border-b border-border/60 last:border-0">
                      <span>
                        <span className="text-sm text-text block">{c.company_name}</span>
                        <span className="text-[10px] text-text-secondary">{c.code}{c.phone ? ` • ${c.phone}` : ''}</span>
                      </span>
                      <span className={`text-[11px] font-bold ${(c.current_balance || 0) > 0 ? 'text-danger' : 'text-success'}`}>
                        {formatCurrencyShort(c.current_balance || 0)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-text-secondary block mb-1.5">المبلغ</label>
                <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
              </div>
              <div>
                <label className="text-xs font-semibold text-text-secondary block mb-1.5">وسيلة الدفع</label>
                <select value={method} onChange={(e) => setMethod(e.target.value)}
                  className="w-full border border-border rounded-lg px-2 py-2.5 text-sm bg-white">
                  <option value="cash">نقداً</option>
                  <option value="bank_transfer">تحويل بنكي</option>
                  <option value="cheque">شيك</option>
                  <option value="deposit">إيداع</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-text-secondary block mb-1.5">درج الاستلام (عند الترحيل)</label>
              <select value={drawerId} onChange={(e) => setDrawerId(e.target.value)}
                className="w-full border border-border rounded-lg px-2 py-2.5 text-sm bg-white">
                <option value="">افتراضي (الدرج الرئيسي)</option>
                {treasuries.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-text-secondary block mb-1.5">رقم المرجع (شيك / تحويل)</label>
              <input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder="اختياري"
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
            </div>

            <div>
              <label className="text-xs font-semibold text-text-secondary block mb-1.5">ملاحظات</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                placeholder="اختياري"
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white resize-none" />
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={() => submitReceipt(true)} disabled={saving || !canPost}
                className="flex-1 bg-gradient-to-l from-emerald-700 to-emerald-600 disabled:opacity-50 text-white rounded-xl py-3 text-sm font-bold active:opacity-80">
                {saving ? 'جاري الحفظ...' : 'قبض وترحيل للخزينة'}
              </button>
              <button onClick={() => submitReceipt(false)} disabled={saving}
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
          ) : recentReceipts.length === 0 ? (
            <div className="text-center py-12 text-text-secondary text-sm">لا توجد سندات قبض بعد</div>
          ) : (
            <div className="divide-y divide-border/60 max-h-[560px] overflow-y-auto">
              {recentReceipts.map((col: any) => {
                const custName = col.customer_name || customerMap.get(col.customer_id)?.company_name || ''
                const isPosted = col.status === 'treasury_posted'
                return (
                  <div key={col.id} className="px-5 py-3 hover:bg-surface/60 transition-colors">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-text truncate">{custName}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded ${statusStyles[col.status] || 'bg-surface text-text-secondary'}`}>
                            {statusLabels[col.status] || col.status}
                          </span>
                        </div>
                        <div className="text-[10px] text-text-secondary mt-0.5">
                          {col.code} • {methodLabels[col.method] || col.method} • {formatDate(col.collected_at ?? col.created_at)}
                          {col.reference_number ? ` • مرجع: ${col.reference_number}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-bold text-success">{formatCurrencyShort(col.amount)}</span>
                        {!isPosted && canPost && (
                          <button onClick={() => postExisting(col.id)}
                            className="text-[10px] bg-emerald-700 text-white px-2 py-1 rounded">ترحيل</button>
                        )}
                        <button onClick={() => openStatement(customerMap.get(col.customer_id) || { id: col.customer_id, company_name: custName })}
                          className="text-[10px] border border-border text-text px-2 py-1 rounded">كشف</button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {statementCustomer && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setStatementCustomer(null)}>
          <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="bg-gradient-to-l from-slate-700 to-slate-600 px-5 py-4 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white">كشف حساب — {statementCustomer.company_name}</h3>
                <p className="text-[10px] text-white/70 mt-0.5">{statementCustomer.code}</p>
              </div>
              <div className="text-left">
                <div className="text-[10px] text-white/70">الرصيد المستحق</div>
                <div className="text-lg font-bold text-white">{formatCurrencyShort(statementCustomer.current_balance || 0)}</div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border overflow-y-auto">
              <div className="p-4">
                <h4 className="text-xs font-bold text-text mb-2">آخر حركات الحساب</h4>
                {ledgerLoading ? (
                  <div className="text-center py-8 text-text-secondary text-xs">جاري التحميل...</div>
                ) : ledgerRows.length === 0 ? (
                  <div className="text-center py-8 text-text-secondary text-xs">لا توجد حركات مسجلة على الدفتر</div>
                ) : (
                  <div className="space-y-1.5">
                    {ledgerRows.map((l: any) => (
                      <div key={l.id} className="flex items-center justify-between text-xs border-b border-border/50 pb-1.5">
                        <span className="text-text-secondary">{formatDate(l.created_at)}</span>
                        <span className={l.transaction_type === 'debit' ? 'text-success font-semibold' : 'text-danger font-semibold'}>
                          {l.transaction_type === 'debit' ? '+' : '-'}{formatCurrencyShort(l.amount)}
                        </span>
                        <span className="text-[9px] text-text-secondary w-24 text-left truncate" title={l.notes || ''}>{l.notes || l.reference_type || ''}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="p-4">
                <h4 className="text-xs font-bold text-text mb-2">سندات القبض</h4>
                {customerReceipts.length === 0 ? (
                  <div className="text-center py-8 text-text-secondary text-xs">لا توجد سندات</div>
                ) : (
                  <div className="space-y-1.5">
                    {customerReceipts.map((r: any) => (
                      <div key={r.id} className="flex items-center justify-between text-xs border-b border-border/50 pb-1.5">
                        <span className="text-text-secondary">{formatDate(r.created_at)}</span>
                        <span>{r.code} <span className="text-[9px] text-text-secondary">({statusLabels[r.status] || r.status})</span></span>
                        <span className="font-semibold text-success">{formatCurrencyShort(r.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="border-t border-border p-3 text-center">
              <button onClick={() => setStatementCustomer(null)} className="text-text-secondary text-xs py-1">إغلاق</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
