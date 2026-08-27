import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort } from '../../utils/format'
import { useCapability } from '../../hooks/useCapability'
import toast from 'react-hot-toast'
import { printSahlDoc } from './sahl-printing'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface CustomerRow { id: string; company_name?: string; current_balance?: number | null }
interface ProductRow {
  product_id: string; product_name: string; legacy_code: string
  carton_quantity: number; piece_price: number; dozen_price: number; carton_price: number
  avg_cost?: number | null; total_qty: number | null; store_qty: number
}
interface StoreRow { id: string; code: string; name: string; is_active: boolean }
interface TreasuryRow { id: string; code: string; name: string; kind: 'cash' | 'bank'; is_active: boolean }

interface Line {
  product_id: string
  product_name: string
  unit_type: 'piece' | 'dozen' | 'carton'
  qty: string
  unit_price: string
}

export function SahlPosPage() {
  const nav = useNavigate()
  const location = useLocation()
  const canManage = useCapability('sahl.sales.manage')

  const [kind, setKind] = useState<'sale' | 'quote'>('sale')
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [products, setProducts] = useState<ProductRow[]>([])
  const [stores, setStores] = useState<StoreRow[]>([])
  const [treasuries, setTreasuries] = useState<TreasuryRow[]>([])
  const [paper, setPaper] = useState<'80mm' | 'A4'>('80mm')
  const [printAfter, setPrintAfter] = useState(true)

  const [customerId, setCustomerId] = useState('')
  const [custSearch, setCustSearch] = useState('')
  const [storeId, setStoreId] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [itemSearch, setItemSearch] = useState('')
  const [discount, setDiscount] = useState('0')
  const [additions, setAdditions] = useState('0')
  const [additionsType, setAdditionsType] = useState('')
  const [tax, setTax] = useState('0')
  const [paidCash, setPaidCash] = useState('')
  const [paidCard, setPaidCard] = useState('')
  const [cashDrawerId, setCashDrawerId] = useState('')
  const [cardBankId, setCardBankId] = useState('')
  const [reserveStock, setReserveStock] = useState(false)
  const [notes, setNotes] = useState('')

  const [saving, setSaving] = useState(false)
  const [showQuickCustomer, setShowQuickCustomer] = useState(false)
  const [qcName, setQcName] = useState('')
  const [qcPhone, setQcPhone] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const preselectedCustomer = useRef(false)

  useEffect(() => {
    if (preselectedCustomer.current) return
    const state = location.state as { customerId?: string } | null
    if (!state?.customerId) { preselectedCustomer.current = true; return }
    const c = customers.find(x => x.id === state.customerId)
    if (c) {
      preselectedCustomer.current = true
      setCustomerId(state.customerId)
      setCustSearch(c.company_name || '')
    }
  }, [customers, location.state])

  async function loadData() {
    const token = getToken()
    if (!token) return
    const [cs, ps, st, tr, se] = await Promise.all([
      supabase.rpc('get_governed_customers', { p_token: token }),
      supabase.rpc('sahl_get_pos_products', { p_token: token }),
      supabase.rpc('sahl_get_stores', { p_token: token }),
      supabase.rpc('sahl_get_treasuries', { p_token: token }),
      supabase.rpc('sahl_get_settings', { p_token: token }),
    ])
    if (!cs.error) setCustomers((cs.data?.error ? [] : cs.data || []) as CustomerRow[])
    else if (cs.data?.error) toast.error(cs.data.error)
    if (!ps.error && !ps.data?.error) setProducts((ps.data || []) as ProductRow[])
    if (!st.error && Array.isArray(st.data)) setStores(st.data as StoreRow[])
    if (!tr.error && Array.isArray(tr.data)) setTreasuries(tr.data as TreasuryRow[])
    if (!se.error && se.data && !se.data.error) {
      const s = se.data as Record<string, unknown>
      if (s.receipt_paper_width === 'A4') setPaper('A4')
    }
  }

  useEffect(() => { loadData() }, [])
  useEffect(() => {
    if (!cashDrawerId) {
      const cash = treasuries.find(t => t.kind === 'cash' && t.is_active)
      if (cash) setCashDrawerId(cash.id)
    }
  }, [treasuries])

  const cashDrawers = useMemo(() => treasuries.filter(t => t.kind === 'cash'), [treasuries])
  const banks = useMemo(() => treasuries.filter(t => t.kind === 'bank' && t.is_active), [treasuries])
  const activeStores = useMemo(() => stores.filter(s => s.is_active), [stores])

  const filteredProducts = useMemo(() => {
    const q = itemSearch.trim().toLowerCase()
    if (!q) return []
    return products.filter(p =>
      p.product_name.toLowerCase().includes(q) || p.legacy_code.toLowerCase().includes(q)
    ).slice(0, 8)
  }, [products, itemSearch])

  const filteredCustomers = useMemo(() => {
    const q = custSearch.trim().toLowerCase()
    if (!q) return []
    return customers.filter(c => (c.company_name || '').toLowerCase().includes(q)).slice(0, 8)
  }, [customers, custSearch])

  function addProduct(p: ProductRow) {
    setLines(prev => [...prev, {
      product_id: p.product_id, product_name: p.product_name,
      unit_type: 'piece', qty: '1', unit_price: String(p.piece_price ?? 0),
    }])
    setItemSearch('')
    searchRef.current?.focus()
  }

  function setLine(idx: number, patch: Partial<Line>) {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l))
  }

  function changeUnit(idx: number, unitType: Line['unit_type']) {
    const l = lines[idx]
    const p = products.find(x => x.product_id === l.product_id)
    if (!p) return
    const price = unitType === 'carton' ? p.carton_price : unitType === 'dozen' ? p.dozen_price : p.piece_price
    setLine(idx, { unit_type: unitType, unit_price: String(price ?? 0) })
  }

  const totals = useMemo(() => {
    const sub = lines.reduce((s, l) => s + Number(l.qty || 0) * Number(l.unit_price || 0), 0)
    const disc = Math.min(Number(discount) || 0, sub)
    const adds = Number(additions) || 0
    const tx = Number(tax) || 0
    const grand = Math.max(sub - disc + adds + tx, 0)
    const cash = kind === 'sale' ? Number(paidCash) || 0 : 0
    const card = kind === 'sale' ? Number(paidCard) || 0 : 0
    const credit = Math.max(grand - cash - card, 0)
    return { sub, grand, cash, card, credit }
  }, [lines, discount, additions, tax, paidCash, paidCard, kind])

  function resetForm(full: boolean) {
    setLines([]); setDiscount('0'); setAdditions('0'); setTax('0')
    setPaidCash(''); setPaidCard(''); setNotes(''); setReserveStock(false)
    if (full) { setCustomerId(''); setCustSearch('') }
    searchRef.current?.focus()
  }

  async function save(printThenNew: boolean) {
    const token = getToken()
    if (!token) return
    if (!canManage) return toast.error('ليست لديك صلاحية إدارة الفواتير')
    if (lines.length === 0) return toast.error('أضف صنفاً واحداً على الأقل')
    if (totals.credit > 0 && !customerId) return toast.error('البيع الآجل يتطلب اختيار عميل')

    setSaving(true)
    try {
      const items = lines.map(l => ({
        product_id: l.product_id, unit_type: l.unit_type,
        qty: Number(l.qty), unit_price: Number(l.unit_price),
      }))
      const res = await supabase.rpc('sahl_create_invoice', {
        p_token: token, p_kind: kind, p_items: items,
        p_customer_id: customerId || null,
        p_store_id: storeId || null,
        p_discount_amount: Number(discount) || 0,
        p_additions_amount: Number(additions) || 0,
        p_additions_type: additionsType.trim() || null,
        p_tax_amount: Number(tax) || 0,
        p_paid_cash: totals.cash, p_paid_card: totals.card,
        p_cash_treasury_id: totals.cash > 0 ? (cashDrawerId || null) : null,
        p_card_treasury_id: totals.card > 0 ? (cardBankId || null) : null,
        p_notes: notes.trim() || null,
        p_reserve_stock: kind === 'quote' ? reserveStock : false,
      })
      const data = res.data as any
      if (res.error) throw new Error(res.error.message)
      if (data?.error) return toast.error(String(data.error))

      toast.success(
        kind === 'sale'
          ? `تم ترحيل الفاتورة ${data.code} — ${formatCurrencyShort(data.grand_total)}`
          : `تم حفظ عرض السعر ${data.code}`,
        { duration: 4500 })

      if (printAfter && printThenNew !== false) {
        const itemsRes = await supabase.rpc('sahl_get_invoice_items', { p_token: token, p_invoice_id: data.id })
        const docRows = await supabase.rpc('sahl_get_invoices', { p_token: token, p_kind: kind, p_search: data.code })
        const doc = (docRows.data || []).find((d: any) => d.code === data.code)
        const its = (itemsRes.data || []) as any[]
        if (doc && its.length) {
          printSahlDoc({
            code: doc.code, kind: doc.kind, status: doc.status, created_at: doc.created_at,
            customer_name: doc.customer_name, store_name: doc.store_name,
            subtotal: doc.subtotal, discount_amount: doc.discount_amount,
            additions_amount: doc.additions_amount, additions_type: doc.additions_type,
            tax_amount: doc.tax_amount, grand_total: doc.grand_total,
            paid_cash: doc.paid_cash, paid_card: doc.paid_card, paid_credit: doc.paid_credit,
            notes: doc.notes,
          }, its.map(i => ({
            product_name: i.product_name, unit_label: i.unit_label,
            qty: i.qty, unit_price: i.unit_price, line_total: i.line_total,
          })), paper)
        }
      }

      loadData() // refresh stock/customer balances
      resetForm(!printThenNew)
    } catch (e: any) {
      const msg = String(e?.message || e)
      if (msg.includes('INSUFFICIENT_STOCK')) toast.error('الكمية غير متوفرة في المخزن')
      else toast.error(msg)
    } finally { setSaving(false) }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus() }
      else if (e.key === 'F9') { e.preventDefault(); save(true) }
      else if (e.key === 'F10') { e.preventDefault(); resetForm(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, discount, additions, tax, paidCash, paidCard, customerId, storeId, kind, reserveStock, notes, additionsType])

  async function quickCreateCustomer() {
    const token = getToken()
    if (!token) return
    if (!qcName.trim()) return toast.error('أدخل اسم العميل')
    const res = await supabase.rpc('governed_create_customer', {
      p_token: token, p_company_name: qcName.trim(), p_phone: qcPhone.trim() || null,
    })
    const data = res.data as any
    if (res.error) return toast.error(res.error.message)
    if (data?.error) return toast.error(String(data.error))
    toast.success(`تم إنشاء العميل ${qcName.trim()}`)
    setShowQuickCustomer(false); setQcName(''); setQcPhone('')
    const cs = await supabase.rpc('get_governed_customers', { p_token: token })
    if (!cs.error && !cs.data?.error) {
      const list = (cs.data || []) as CustomerRow[]
      setCustomers(list)
      const created = list.find(c => c.id === data.id)
      if (created) { setCustomerId(created.id); setCustSearch(created.company_name || '') }
    }
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => nav('/sahl')} className="text-text-secondary text-lg">&rarr;</button>
          <div>
            <h1 className="text-lg font-bold text-text">فاتورة جديدة</h1>
            <p className="text-[10px] text-text-secondary">بيع نقدي / بطاقة / آجل — وعروض أسعار مع حجز البضاعة</p>
          </div>
        </div>
        <div className="flex gap-1.5">
          {([['sale', 'فاتورة بيع'], ['quote', 'عرض سعر']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setKind(k)}
              className={`text-xs px-3 py-1.5 rounded-lg font-bold ${kind === k ? 'bg-primary text-white' : 'border border-border text-text-secondary'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* header row: customer / store */}
      <div className="bg-white rounded-2xl border border-border shadow-sm p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="relative">
          <span className="text-[10px] text-text-secondary block mb-1">العميل {totals.credit > 0 && <b className="text-danger">(مطلوب — يوجد آجل)</b>}</span>
          <input value={custSearch} onChange={e => { setCustSearch(e.target.value); setCustomerId('') }}
            placeholder="ابحث باسم العميل..." className="w-full text-sm border border-border rounded-lg px-3 py-2" />
          {filteredCustomers.length > 0 && (
            <div className="absolute z-20 mt-1 w-full bg-white border border-border rounded-xl shadow-lg max-h-56 overflow-y-auto">
              {filteredCustomers.map(c => (
                <button key={c.id} onClick={() => { setCustomerId(c.id); setCustSearch(c.company_name || '') }}
                  className="w-full text-right px-3 py-2 text-sm hover:bg-surface flex justify-between">
                  <span>{c.company_name}</span>
                  <span className={`text-[10px] ${Number(c.current_balance) > 0 ? 'text-danger' : 'text-text-secondary'}`}>
                    {Number(c.current_balance) > 0 ? `مستحق: ${formatCurrencyShort(c.current_balance)}` : 'لا مستحقات'}
                  </span>
                </button>
              ))}
            </div>
          )}
          <button onClick={() => setShowQuickCustomer(true)} className="text-[10px] text-primary mt-1">+ عميل جديد</button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[10px] text-text-secondary block mb-1">المخزن</span>
            <select value={storeId} onChange={e => setStoreId(e.target.value)}
              className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-white">
              <option value="">افتراضي (من الإعدادات)</option>
              {activeStores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] text-text-secondary block mb-1">ورق الطباعة</span>
            <select value={paper} onChange={e => setPaper(e.target.value as '80mm' | 'A4')}
              className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-white">
              <option value="80mm">حراري 80mm</option>
              <option value="A4">A4</option>
            </select>
          </label>
        </div>
      </div>

      {/* item entry + lines */}
      <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-3 bg-surface border-b border-border">
          <div className="relative">
            <input ref={searchRef} autoFocus value={itemSearch} onChange={e => setItemSearch(e.target.value)}
              placeholder="ابحث عن صنف بالاسم أو الكود... (F2)"
              className="w-full text-sm border border-border rounded-lg px-3 py-2" />
            {filteredProducts.length > 0 && (
              <div className="absolute z-20 mt-1 w-full bg-white border border-border rounded-xl shadow-lg max-h-64 overflow-y-auto">
                {filteredProducts.map(p => (
                  <button key={p.product_id} onClick={() => addProduct(p)}
                    className="w-full text-right px-3 py-2 hover:bg-surface">
                    <div className="flex justify-between text-sm">
                      <span className="font-semibold">{p.product_name}</span>
                      <span className="text-primary">{formatCurrencyShort(p.piece_price)} / قطعة</span>
                    </div>
                    <div className="text-[10px] text-text-secondary">
                      {p.legacy_code} • رصيد المخزن: {p.store_qty} • الإجمالي: {p.total_qty ?? 0}
                      {p.carton_quantity > 1 && ` • كرتونة = ${p.carton_quantity}`}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {lines.length === 0 ? (
          <div className="text-center py-10 text-text-secondary text-sm">لا توجد أصناف — ابحث وأضف من الأعلى</div>
        ) : (
          <div className="divide-y divide-border/60">
            {lines.map((l, idx) => {
              const total = Number(l.qty || 0) * Number(l.unit_price || 0)
              return (
                <div key={`${l.product_id}-${idx}`} className="px-5 py-3 grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-12 md:col-span-4">
                    <div className="text-sm font-semibold text-text">{l.product_name}</div>
                  </div>
                  <select value={l.unit_type} onChange={e => changeUnit(idx, e.target.value as Line['unit_type'])}
                    className="col-span-3 md:col-span-2 text-xs border border-border rounded-lg px-2 py-1.5 bg-white">
                    <option value="piece">قطعة</option>
                    <option value="dozen">دستة</option>
                    <option value="carton">كرتونة</option>
                  </select>
                  <input type="number" min="0" step="0.25" value={l.qty} onChange={e => setLine(idx, { qty: e.target.value })}
                    className="col-span-3 md:col-span-2 text-xs border border-border rounded-lg px-2 py-1.5" placeholder="كمية" />
                  <input type="number" min="0" step="0.01" value={l.unit_price} onChange={e => setLine(idx, { unit_price: e.target.value })}
                    className="col-span-3 md:col-span-2 text-xs border border-border rounded-lg px-2 py-1.5" placeholder="سعر" />
                  <div className="col-span-2 md:col-span-1 text-left text-xs font-bold text-text">{formatCurrencyShort(total)}</div>
                  <button onClick={() => setLines(prev => prev.filter((_, i) => i !== idx))}
                    className="col-span-1 md:col-span-1 text-danger text-sm justify-self-center" title="حذف السطر">✕</button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* totals + payment */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-border shadow-sm p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label><span className="text-[10px] text-text-secondary block mb-1">خصم على الفاتورة</span>
              <input type="number" min="0" step="0.01" value={discount} onChange={e => setDiscount(e.target.value)}
                className="w-full text-sm border border-border rounded-lg px-3 py-2" /></label>
            <label><span className="text-[10px] text-text-secondary block mb-1">ضريبة</span>
              <input type="number" min="0" step="0.01" value={tax} onChange={e => setTax(e.target.value)}
                className="w-full text-sm border border-border rounded-lg px-3 py-2" /></label>
            <label><span className="text-[10px] text-text-secondary block mb-1">إضافات</span>
              <input type="number" min="0" step="0.01" value={additions} onChange={e => setAdditions(e.target.value)}
                className="w-full text-sm border border-border rounded-lg px-3 py-2" /></label>
            <label><span className="text-[10px] text-text-secondary block mb-1">نوع الإضافات</span>
              <input value={additionsType} onChange={e => setAdditionsType(e.target.value)}
                className="w-full text-sm border border-border rounded-lg px-3 py-2" placeholder="توصيل / تركيب..." /></label>
          </div>
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="ملاحظات (اختياري)"
            className="w-full text-sm border border-border rounded-lg px-3 py-2" />
          {kind === 'quote' && (
            <label className="flex items-center gap-2 text-xs text-text">
              <input type="checkbox" checked={reserveStock} onChange={e => setReserveStock(e.target.checked)} />
              حجز البضاعة للعميل (تُحرَّر عند التحويل أو الإلغاء)
            </label>
          )}
          <label className="flex items-center gap-2 text-xs text-text">
            <input type="checkbox" checked={printAfter} onChange={e => setPrintAfter(e.target.checked)} />
            طباعة بعد الحفظ ({paper})
          </label>
        </div>

        <div className="bg-white rounded-2xl border border-border shadow-sm p-4">
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-text-secondary">الإجمالي الفرعي</span><b>{formatCurrencyShort(totals.sub)}</b></div>
            {totals.credit === 0 || kind === 'sale' ? null : null}
            {Number(discount) > 0 && <div className="flex justify-between text-danger"><span>الخصم</span><span>-{formatCurrencyShort(Number(discount))}</span></div>}
            {Number(additions) > 0 && <div className="flex justify-between text-success"><span>إضافات{additionsType ? ` (${additionsType})` : ''}</span><span>+{formatCurrencyShort(Number(additions))}</span></div>}
            {Number(tax) > 0 && <div className="flex justify-between"><span>الضريبة</span><span>{formatCurrencyShort(Number(tax))}</span></div>}
            <div className="flex justify-between border-t border-border pt-2 text-base">
              <span className="font-bold">{kind === 'sale' ? 'المطلوب' : 'إجمالي العرض'}</span>
              <b className="text-primary">{formatCurrencyShort(totals.grand)}</b>
            </div>
          </div>

          {kind === 'sale' && (
            <div className="mt-3 pt-3 border-t border-border/60 grid grid-cols-2 gap-3">
              <label><span className="text-[10px] text-text-secondary block mb-1">نقدية</span>
                <input type="number" min="0" step="0.01" value={paidCash} onChange={e => setPaidCash(e.target.value)}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2" placeholder="0.00" /></label>
              <label><span className="text-[10px] text-text-secondary block mb-1">درج النقدية</span>
                <select value={cashDrawerId} onChange={e => setCashDrawerId(e.target.value)}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-white">
                  {cashDrawers.filter(d => d.is_active).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select></label>
              <label><span className="text-[10px] text-text-secondary block mb-1">بطاقة</span>
                <input type="number" min="0" step="0.01" value={paidCard} onChange={e => setPaidCard(e.target.value)}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2" placeholder="0.00" /></label>
              <label><span className="text-[10px] text-text-secondary block mb-1">حساب البنك</span>
                <select value={cardBankId} onChange={e => setCardBankId(e.target.value)}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-white">
                  <option value="">— اختر عند الدفع بالبطاقة —</option>
                  {banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select></label>
              <div className="col-span-2 text-xs">
                {totals.credit > 0
                  ? <span className="text-danger font-semibold">آجل على العميل: {formatCurrencyShort(totals.credit)}</span>
                  : <span className="text-success">مدفوع بالكامل</span>}
              </div>
            </div>
          )}

          <div className="mt-4 grid grid-cols-3 gap-2">
            <button onClick={() => save(true)} disabled={saving || !canManage}
              className="bg-gradient-to-l from-green-700 to-green-600 text-white rounded-xl py-2.5 text-sm font-bold disabled:opacity-50 col-span-2">
              {saving ? 'جاري الحفظ...' : kind === 'sale' ? 'ترحيل الفاتورة (F9)' : 'حفظ العرض (F9)'}
            </button>
            <button onClick={() => resetForm(true)} disabled={saving}
              className="border border-border text-text-secondary rounded-xl py-2.5 text-sm font-semibold">جديد (F10)</button>
          </div>
        </div>
      </div>

      {/* quick customer dialog */}
      {showQuickCustomer && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={() => setShowQuickCustomer(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-5 space-y-3" onClick={e => e.stopPropagation()} dir="rtl">
            <h3 className="text-base font-bold">عميل جديد</h3>
            <input value={qcName} onChange={e => setQcName(e.target.value)} placeholder="اسم العميل *"
              className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
            <input value={qcPhone} onChange={e => setQcPhone(e.target.value)} placeholder="الهاتف"
              className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
            <div className="flex gap-2">
              <button onClick={quickCreateCustomer} className="flex-1 bg-primary text-white rounded-xl py-2 text-sm font-bold">حفظ</button>
              <button onClick={() => setShowQuickCustomer(false)} className="flex-1 border border-border rounded-xl py-2 text-sm">تراجع</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
