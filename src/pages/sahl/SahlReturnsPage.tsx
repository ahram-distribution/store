import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort, formatDate } from '../../utils/format'
import { useCapability } from '../../hooks/useCapability'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface CustomerRow { id: string; company_name?: string }
interface OrderRow { id: string; order_number?: string; total_amount?: number | null; delivered_at?: string; item_count?: number | null }
interface ReturnableLine {
  product_id: string; product_name: string; legacy_code?: string; unit_type: string
  ordered_units: number; returned_units: number; unit_price: number | string; pieces_per_unit: number
}
interface ReturnRow {
  id: string; code?: string; status?: string; credit_note_number?: string | null
  credit_note_amount?: number | null; order_number?: string; customer_name?: string
  item_count?: number | null; inspected_count?: number | null; created_at?: string; notes?: string | null
}
interface Line { productId: string; name: string; unit: 'piece' | 'dozen' | 'carton'; qty: number; unitCost: number; cartonQty: number }
interface StoreRow { id: string; code: string; name: string; is_active: boolean }
interface TreasuryRow { id: string; name: string; kind: 'cash' | 'bank'; is_active: boolean }

const retStatusLabels: Record<string, string> = { pending: 'معلق', inspecting: 'تحت الفحص', approved: 'معتمد', rejected: 'مرفوض' }
const retStatusStyles: Record<string, string> = {
  pending: 'bg-accent/10 text-accent', inspecting: 'bg-blue-100 text-blue-800',
  approved: 'bg-green-100 text-green-800', rejected: 'bg-red-100 text-red-700',
}
const conditionLabels: Record<string, string> = { saleable: 'قابل للبيع', damaged: 'تالف', expired: 'منتهي', unsaleable: 'غير قابل للبيع' }

export function SahlReturnsPage() {
  const nav = useNavigate()
  const canCreate = useCapability('sahl.returns.create')
  const canPost = useCapability('sahl.returns.post')

  const [tab, setTab] = useState<'sales' | 'purchases'>('sales')

  // ===== Sales returns state =====
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [custSearch, setCustSearch] = useState('')
  const [custOpen, setCustOpen] = useState(false)
  const [customer, setCustomer] = useState<CustomerRow | null>(null)
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [orderId, setOrderId] = useState('')
  const [lines, setLines] = useState<ReturnableLine[]>([])
  const [qtys, setQtys] = useState<Record<string, number>>({})
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [retNotes, setRetNotes] = useState('')
  const [creatingRet, setCreatingRet] = useState(false)

  const [returns, setReturns] = useState<ReturnRow[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [itemsCache, setItemsCache] = useState<Record<string, any[]>>({})
  const [inspectFor, setInspectFor] = useState<string | null>(null)
  const [inspState, setInspState] = useState<Record<string, { condition: string; notes: string }>>({})
  const [stores, setStores] = useState<StoreRow[]>([])
  const [salesRetStoreId, setSalesRetStoreId] = useState('')
  const [prtStoreId, setPrtStoreId] = useState('')
  const [treasuries, setTreasuries] = useState<TreasuryRow[]>([])
  const [prtDrawerId, setPrtDrawerId] = useState('')

  // ===== Purchase returns state =====
  const [suppliers, setSuppliers] = useState<any[]>([])
  const [supplierId, setSupplierId] = useState('')
  const [plines, setPlines] = useState<Line[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [refundMethod, setRefundMethod] = useState('account')
  const [prtNotes, setPrtNotes] = useState('')
  const [savingPrt, setSavingPrt] = useState(false)
  const [purchaseReturns, setPurchaseReturns] = useState<any[]>([])
  const [postingId, setPostingId] = useState<string | null>(null)

  async function loadBase() {
    const token = getToken()
    if (!token) return
    const [cRes, sRes] = await Promise.all([
      supabase.rpc('get_governed_customers', { p_token: token }),
      supabase.rpc('sahl_get_suppliers', { p_token: token }),
    ])
    if (Array.isArray(cRes.data)) setCustomers(cRes.data as CustomerRow[])
    if (Array.isArray(sRes.data)) setSuppliers(sRes.data as any[])
  }

  async function loadReturns() {
    const token = getToken()
    if (!token) return
    const res = await supabase.rpc('sahl_get_returns', { p_token: token })
    if (!res.error && !(res.data as any)?.error) setReturns(Array.isArray(res.data) ? res.data : [])
  }

  async function loadPurchaseReturns() {
    const token = getToken()
    if (!token) return
    const res = await supabase.rpc('sahl_get_purchase_returns', { p_token: token })
    if (!res.error && !(res.data as any)?.error) setPurchaseReturns(Array.isArray(res.data) ? res.data : [])
  }

  useEffect(() => {
    loadBase(); loadReturns(); loadPurchaseReturns()
    const token = getToken()
    if (!token) return
    Promise.all([
      supabase.rpc('sahl_get_stores', { p_token: token }),
      supabase.rpc('sahl_get_treasuries', { p_token: token }),
    ]).then(([st, tr]) => {
      if (!st.error && Array.isArray(st.data)) setStores(st.data as StoreRow[])
      if (!tr.error && Array.isArray(tr.data))
        setTreasuries((tr.data as TreasuryRow[]).filter(t => t.is_active))
    })
  }, [])

  const filteredCustomers = useMemo(() => {
    const q = custSearch.trim().toLowerCase()
    if (!q) return customers.slice(0, 8)
    return customers.filter((c) => (c.company_name || '').toLowerCase().includes(q)).slice(0, 8)
  }, [customers, custSearch])

  async function pickCustomer(c: CustomerRow) {
    setCustomer(c); setCustOpen(false); setOrderId(''); setLines([]); setQtys({}); setReasons({})
    const token = getToken()
    if (!token) return
    const res = await supabase.rpc('sahl_get_customer_orders', { p_token: token, p_customer_id: c.id })
    if (!res.error && !(res.data as any)?.error) setOrders(Array.isArray(res.data) ? res.data : [])
  }

  async function pickOrder(id: string) {
    setOrderId(id); setLines([]); setQtys({}); setReasons({})
    if (!id) return
    const token = getToken()
    if (!token) return
    const res = await supabase.rpc('sahl_get_order_returnable', { p_token: token, p_order_id: id })
    if (res.error || (res.data as any)?.error) { toast.error((res.error?.message) || (res.data as any)?.error); return }
    setLines(Array.isArray(res.data) ? res.data : [])
  }

  function remainingOf(l: ReturnableLine) { return l.ordered_units - l.returned_units }

  async function createSalesReturn() {
    const items = lines
      .filter((l) => (qtys[l.product_id + '|' + l.unit_type] || 0) > 0)
      .map((l) => ({
        product_id: l.product_id, unit_type: l.unit_type,
        quantity: qtys[l.product_id + '|' + l.unit_type],
        reason: reasons[l.product_id + '|' + l.unit_type] || null,
      }))
    if (items.length === 0) { toast.error('أدخل كمية مرتجعة لصنف واحد على الأقل'); return }
    for (const it of items) {
      const line = lines.find((l) => l.product_id === it.product_id && l.unit_type === it.unit_type)!
      if (it.quantity > remainingOf(line)) { toast.error(`الكمية تتجاوز المتبقي للصنف ${line.product_name}`); return }
    }
    const token = getToken()
    if (!token) return
    setCreatingRet(true)
    const res = await supabase.rpc('sahl_create_sales_return', { p_token: token, p_order_id: orderId, p_items: items, p_notes: retNotes.trim() || null })
    setCreatingRet(false)
    if (res.error) { toast.error(res.error.message); return }
    const data = res.data as any
    if (data?.error) { toast.error(data.error); return }
    toast.success('تم إنشاء المرتجع — بانتظار الاعتماد')
    setLines([]); setQtys({}); setReasons({}); setRetNotes(''); setOrders([]); setOrderId('')
    await loadReturns()
  }

  async function expandReturn(r: ReturnRow) {
    if (expanded === r.id) { setExpanded(null); setInspectFor(null); return }
    setExpanded(r.id); setInspectFor(null)
    if (!itemsCache[r.id]) {
      const token = getToken()
      if (!token) return
      const res = await supabase.rpc('sahl_get_return_items', { p_token: token, p_return_id: r.id })
      if (!res.error && !(res.data as any)?.error) setItemsCache((prev) => ({ ...prev, [r.id]: Array.isArray(res.data) ? res.data : [] }))
    }
  }

  function startInspection(r: ReturnRow) {
    setInspectFor(r.id)
    const st: Record<string, { condition: string; notes: string }> = {}
    for (const it of itemsCache[r.id] || []) {
      st[it.id] = { condition: it.inspection_condition || 'saleable', notes: '' }
    }
    setInspState(st)
  }

  async function submitInspection(r: ReturnRow) {
    const arr = Object.entries(inspState).map(([return_item_id, v]) => ({ return_item_id, condition: v.condition, notes: v.notes || null }))
    if (arr.length === 0) return
    const token = getToken()
    if (!token) return
    const res = await supabase.rpc('sahl_record_return_inspection', { p_token: token, p_return_id: r.id, p_inspections: arr })
    if (res.error) { toast.error(res.error.message); return }
    const data = res.data as any
    if (data?.error) { toast.error(data.error); return }
    toast.success('تم تسجيل الفحص')
    setInspectFor(null)
    setItemsCache((prev) => { const c = { ...prev }; delete c[r.id]; return c })
    await Promise.all([loadReturns(), expandRefresh(r)])
  }

  async function expandRefresh(r: ReturnRow) {
    const token = getToken()
    if (!token) return
    const res = await supabase.rpc('sahl_get_return_items', { p_token: token, p_return_id: r.id })
    if (!res.error && !(res.data as any)?.error) setItemsCache((prev) => ({ ...prev, [r.id]: Array.isArray(res.data) ? res.data : [] }))
  }

  async function approveReturn(r: ReturnRow) {
    const token = getToken()
    if (!token) return
    const res = await supabase.rpc('sahl_approve_sales_return', { p_token: token, p_return_id: r.id, p_store_id: salesRetStoreId || null })
    if (res.error) { toast.error(res.error.message); return }
    const data = res.data as any
    if (data?.error) { toast.error(data.error); return }
    toast.success(`تم الاعتماد — إشعار دائن ${data.credit_note_number} بقيمة ${formatCurrencyShort(data.credit_note_amount)}${Number(data.outstanding_after) >= 0 ? '' : ''}`, { duration: 4000 })
    await loadReturns()
  }

  async function rejectReturn(r: ReturnRow) {
    const token = getToken()
    if (!token) return
    const res = await supabase.rpc('sahl_reject_sales_return', { p_token: token, p_return_id: r.id })
    if (res.error) { toast.error(res.error.message); return }
    const data = res.data as any
    if (data?.error) { toast.error(data.error); return }
    toast.success('تم رفض المرتجع')
    await loadReturns()
  }

  // ===== Purchase-return builder helpers =====
  function runSearch(q: string) {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!q.trim()) { setResults([]); return }
    searchTimer.current = setTimeout(async () => {
      const token = getToken()
      if (!token) return
      setSearching(true)
      const res = await supabase.rpc('get_governed_products', { p_token: token, p_search: q.trim(), p_active_only: true })
      setSearching(false)
      if (!res.error && !(res.data as any)?.error) setResults(Array.isArray(res.data) ? res.data.slice(0, 8) : [])
    }, 300)
  }

  function addLine(p: any) {
    if (plines.some((l) => l.productId === p.id)) { toast.error('المنتج مضاف بالفعل'); return }
    setPlines((prev) => [...prev, {
      productId: p.id, name: p.product_name, unit: 'carton',
      qty: 1, unitCost: Number(p.avg_cost) > 0 ? Number(p.avg_cost) * (Number(p.carton_quantity) || 1) : 0,
      cartonQty: Number(p.carton_quantity) || 1,
    }])
    setQuery(''); setResults([])
  }

  const prtTotal = useMemo(() => plines.reduce((s, l) => s + l.unitCost * l.qty, 0), [plines])

  function buildPayloadLines() {
    return plines.map((l) => {
      const mult = l.unit === 'piece' ? 1 : l.unit === 'dozen' ? 12 : l.cartonQty || 1
      return {
        product_id: l.productId, unit_type: l.unit,
        quantity: Math.max(1, Math.round(l.qty)),
        unit_cost: Number((l.unitCost).toFixed(2)),
        _mult: mult,
      }
    }).filter((x) => x.quantity > 0 && x.unit_cost > 0 && x._mult > 0)
  }

  async function savePurchaseReturn(post: boolean) {
    if (!supplierId) { toast.error('اختر المورد'); return }
    if (buildPayloadLines().length === 0) { toast.error('أضف صنفاً بكمية وتكلفة صحيحتين'); return }
    const token = getToken()
    if (!token) return
    setSavingPrt(true)
    const cr = await supabase.rpc('sahl_create_purchase_return', {
      p_token: token, p_supplier_id: supplierId, p_items: buildPayloadLines(),
      p_refund_method: refundMethod, p_notes: prtNotes.trim() || null,
    })
    if (cr.error) { toast.error(cr.error.message); setSavingPrt(false); return }
    const created = cr.data as any
    if (created?.error) { toast.error(created.error); setSavingPrt(false); return }

    let info = ''
    if (post) {
      const pr = await supabase.rpc('sahl_post_purchase_return', {
        p_token: token, p_purchase_return_id: created.id,
        p_store_id: prtStoreId || null, p_treasury_id: prtDrawerId || null,
      })
      if (pr.error || (pr.data as any)?.error) {
        toast.error(`تم الإنشاء لكن فشل الترحيل: ${pr.error?.message || (pr.data as any)?.error}`, { duration: 5000 })
      } else {
        const posted = pr.data as any
        info = posted.refund_method === 'cash' || posted.refunded_from_treasury > 0
          ? ` — استرداد نقدي ${formatCurrencyShort(posted.refunded_from_treasury)}`
          : ` — خصم من حساب المورد ${formatCurrencyShort(posted.refunded_to_account)}`
      }
    }
    toast.success(`${post ? 'تم الترحيل' : 'تم الحفظ كمعلق'} ${created.code}${info}`, { duration: 4000 })
    setSavingPrt(false)
    setPlines([]); setPrtNotes('')
    await loadPurchaseReturns()
  }

  async function postPurchaseReturn(id: string) {
    const token = getToken()
    if (!token) return
    setPostingId(id)
    const res = await supabase.rpc('sahl_post_purchase_return', {
      p_token: token, p_purchase_return_id: id,
      p_store_id: prtStoreId || null, p_treasury_id: prtDrawerId || null,
    })
    setPostingId(null)
    if (res.error) { toast.error(res.error.message); return }
    const data = res.data as any
    if (data?.error) {
      if (data.product_name) toast.error(`مخزون غير كافٍ: ${data.product_name} (المتوفر ${data.available})`)
      else toast.error(data.error)
      return
    }
    toast.success(`تم ترحيل ${data.code}${data.refunded_from_treasury > 0 ? ` — استرداد نقدي ${formatCurrencyShort(data.refunded_from_treasury)}` : ` — خصم ${formatCurrencyShort(data.refunded_to_account)} من حساب المورد`}`, { duration: 4000 })
    await loadPurchaseReturns()
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => nav('/sahl')} className="text-text-secondary text-lg">&rarr;</button>
          <div>
            <h1 className="text-lg font-bold text-text">المرتجعات</h1>
            <p className="text-[10px] text-text-secondary">مرتجع البيع ومرتجع الشراء — الفحص والاعتماد والأثر على المخزون والحسابات</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setTab('sales')}
            className={`text-xs rounded-lg px-3 py-1.5 font-semibold ${tab === 'sales' ? 'bg-primary text-white' : 'border border-border text-text-secondary'}`}>مرتجع بيع</button>
          <button onClick={() => setTab('purchases')}
            className={`text-xs rounded-lg px-3 py-1.5 font-semibold ${tab === 'purchases' ? 'bg-primary text-white' : 'border border-border text-text-secondary'}`}>مرتجع شراء</button>
        </div>
      </div>

      {tab === 'sales' && (
        <>
          {canCreate && (
            <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
              <div className="bg-gradient-to-l from-orange-700 to-orange-600 px-5 py-3.5">
                <h2 className="text-sm font-bold text-white">↩️ إنشاء مرتجع بيع</h2>
              </div>
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="relative">
                    <label className="text-xs font-semibold text-text-secondary block mb-1.5">العميل *</label>
                    {customer ? (
                      <div className="flex items-center justify-between border border-border rounded-lg px-3 py-2.5 bg-surface">
                        <span className="text-sm font-medium">{customer.company_name}</span>
                        <button onClick={() => { setCustomer(null); setOrders([]); setOrderId(''); setLines([]) }} className="text-danger text-sm">&times;</button>
                      </div>
                    ) : (
                      <>
                        <input value={custSearch} onChange={(e) => { setCustSearch(e.target.value); setCustOpen(true) }}
                          onFocus={() => setCustOpen(true)} placeholder="ابحث عن العميل..."
                          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
                        {custOpen && filteredCustomers.length > 0 && (
                          <div className="absolute z-20 w-full mt-1 bg-white border border-border rounded-xl shadow-lg overflow-hidden max-h-52 overflow-y-auto">
                            {filteredCustomers.map((c) => (
                              <button key={c.id} onClick={() => pickCustomer(c)}
                                className="w-full text-right px-4 py-2.5 hover:bg-surface text-sm border-b border-border/50 last:border-b-0">
                                {c.company_name}
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-text-secondary block mb-1.5">الطلب المُسلَّم *</label>
                    <select value={orderId} onChange={(e) => pickOrder(e.target.value)} disabled={!customer}
                      className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white disabled:bg-surface">
                      <option value="">— اختر الطلب —</option>
                      {orders.map((o) => (
                        <option key={o.id} value={o.id}>{o.order_number} • {formatDate(o.delivered_at)} • {formatCurrencyShort(o.total_amount)}</option>
                      ))}
                    </select>
                    {customer && orders.length === 0 && <div className="text-[10px] text-text-secondary mt-1">لا توجد طلبات مُسلَّمة لهذا العميل</div>}
                  </div>
                </div>

                {lines.length > 0 && (
                  <div className="border border-border rounded-xl overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-surface text-text-secondary">
                          <th className="px-2 py-2 text-right font-semibold">الصنف</th>
                          <th className="px-2 py-2 text-center font-semibold w-[12%]">المطلوب</th>
                          <th className="px-2 py-2 text-center font-semibold w-[12%]">مرتجع سابق</th>
                          <th className="px-2 py-2 text-center font-semibold w-[14%]">كمية المرتجع</th>
                          <th className="px-2 py-2 text-right font-semibold w-[22%]">السبب</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {lines.map((l) => {
                          const key = l.product_id + '|' + l.unit_type
                          const rem = remainingOf(l)
                          return (
                            <tr key={key}>
                              <td className="px-2 py-2">
                                <div className="font-medium text-text truncate" title={l.product_name}>{l.product_name}</div>
                                <div className="text-[9px] text-text-secondary">
                                  {l.unit_type === 'piece' ? 'قطعة' : l.unit_type === 'dozen' ? 'درزن' : `كرتون (${l.pieces_per_unit} قطعة)`} • سعر الوحدة {formatCurrencyShort(Number(l.unit_price))}
                                </div>
                              </td>
                              <td className="px-2 py-2 text-center">{l.ordered_units}</td>
                              <td className="px-2 py-2 text-center">{l.returned_units}</td>
                              <td className="px-2 py-2">
                                <input type="number" min="0" max={rem} step="1" disabled={rem === 0}
                                  value={qtys[key] ?? ''} onChange={(e) => {
                                    const v = Math.min(Math.max(0, Number(e.target.value) || 0), rem)
                                    setQtys((prev) => ({ ...prev, [key]: v }))
                                  }}
                                  placeholder="0"
                                  className="w-20 border border-border rounded px-1 py-1 text-center bg-white disabled:bg-surface mx-auto block" />
                                <div className="text-[9px] text-text-secondary text-center">متاح: {rem}</div>
                              </td>
                              <td className="px-2 py-2">
                                <input value={reasons[key] ?? ''} onChange={(e) => setReasons((prev) => ({ ...prev, [key]: e.target.value }))}
                                  className="w-full border border-border rounded px-2 py-1 bg-white" />
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    <div className="flex gap-3 p-3 bg-surface/60">
                      <input value={retNotes} onChange={(e) => setRetNotes(e.target.value)} placeholder="ملاحظات عامة (اختياري)"
                        className="flex-1 border border-border rounded-lg px-3 py-2 text-xs bg-white" />
                      <button onClick={createSalesReturn} disabled={creatingRet}
                        className="bg-gradient-to-l from-orange-700 to-orange-600 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-xs font-bold">
                        {creatingRet ? '...' : 'إنشاء المرتجع'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
            <div className="bg-surface px-5 py-3.5 border-b border-border flex items-center justify-between gap-2 flex-wrap">
              <h2 className="text-sm font-bold text-text">📋 سجل مرتجعات البيع</h2>
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-text-secondary">مخزون إرجاع البضاعة (عند الاعتماد)</label>
                <select value={salesRetStoreId} onChange={(e) => setSalesRetStoreId(e.target.value)}
                  className="text-[10px] border border-border rounded px-2 py-1 bg-white max-w-[180px]">
                  <option value="">افتراضي (من الإعدادات)</option>
                  {stores.filter(s => s.is_active).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <span className="text-[10px] text-text-secondary">{returns.length}</span>
            </div>
            {returns.length === 0 ? (
              <div className="text-center py-12 text-text-secondary text-sm">لا توجد مرتجعات بعد</div>
            ) : (
              <div className="divide-y divide-border/60 max-h-[520px] overflow-y-auto">
                {returns.map((r) => {
                  const active = r.status === 'pending' || r.status === 'inspecting'
                  const fullyInspected = (r.inspected_count || 0) >= (r.item_count || 0) && (r.item_count || 0) > 0
                  return (
                    <div key={r.id}>
                      <div className="px-5 py-3 flex items-center justify-between gap-2 hover:bg-surface/60 cursor-pointer" onClick={() => expandReturn(r)}>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-text">{r.code}</span>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded ${retStatusStyles[r.status || '']}`}>{retStatusLabels[r.status || ''] || r.status}</span>
                            {r.credit_note_number && <span className="text-[9px] text-success">{r.credit_note_number}</span>}
                          </div>
                          <div className="text-[10px] text-text-secondary">
                            {r.customer_name} • طلب {r.order_number} • {r.item_count} صنف • {formatDate(r.created_at)}
                          </div>
                        </div>
                        <div className="shrink-0 text-left">
                          {r.credit_note_amount != null && <div className="text-sm font-bold text-danger">{formatCurrencyShort(r.credit_note_amount)}</div>}
                        </div>
                      </div>

                      {expanded === r.id && (
                        <div className="px-5 pb-3 bg-surface/40 space-y-2">
                          {(itemsCache[r.id] || []).map((it: any) => (
                            <div key={it.id} className="text-[11px] border-b border-border/40 pb-1">
                              <div className="flex justify-between">
                                <span className="truncate">{it.product_name}</span>
                                <span className="text-text-secondary shrink-0 mr-3">
                                  {it.quantity} × {it.unit_type === 'piece' ? 'قطعة' : it.unit_type === 'dozen' ? 'درزن' : 'كرتون'}
                                  {it.inspection_condition && <span className={`mr-1 ${it.inspection_condition === 'saleable' ? 'text-success' : 'text-danger'}`}>({conditionLabels[it.inspection_condition]})</span>}
                                  {it.unit_price != null && <span className="mr-1">• {formatCurrencyShort(Number(it.unit_price) * it.quantity)}</span>}
                                </span>
                              </div>
                              {inspectFor === r.id && (
                                <div className="flex gap-2 mt-1 items-center">
                                  <select value={inspState[it.id]?.condition || 'saleable'}
                                    onChange={(e) => setInspState((prev) => ({ ...prev, [it.id]: { ...prev[it.id], condition: e.target.value } }))}
                                    className="border border-border rounded px-1 py-0.5 text-[10px] bg-white">
                                    {Object.entries(conditionLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                  </select>
                                  <input value={inspState[it.id]?.notes || ''} onChange={(e) => setInspState((prev) => ({ ...prev, [it.id]: { ...prev[it.id], notes: e.target.value } }))}
                                    placeholder="ملاحظة الفحص" className="flex-1 border border-border rounded px-1 py-0.5 text-[10px] bg-white" />
                                </div>
                              )}
                            </div>
                          ))}

                          {canCreate && active && inspectFor !== r.id && (
                            <button onClick={() => startInspection(r)} className="text-[10px] border border-primary text-primary rounded px-2 py-1">
                              🔍 فحص الأصناف {(r.inspected_count || 0) > 0 ? `(تم فحص ${r.inspected_count}/${r.item_count})` : ''}
                            </button>
                          )}
                          {inspectFor === r.id && (
                            <div className="flex gap-2">
                              <button onClick={() => submitInspection(r)} className="text-[10px] bg-primary text-white rounded px-2 py-1">حفظ الفحص</button>
                              <button onClick={() => setInspectFor(null)} className="text-[10px] border border-border text-text-secondary rounded px-2 py-1">إلغاء</button>
                            </div>
                          )}

                          {canPost && active && (
                            <div className="flex gap-2 pt-1">
                              <button onClick={() => approveReturn(r)}
                                className="text-[10px] bg-green-600 text-white rounded px-3 py-1.5 font-bold">
                                ✅ اعتماد وإصدار إشعار دائن{!fullyInspected ? ' (غير المفحوص يُعتبر قابلاً للبيع)' : ''}
                              </button>
                              <button onClick={() => rejectReturn(r)} className="text-[10px] border border-red-300 text-red-600 rounded px-3 py-1.5">رفض</button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'purchases' && (
        <>
          {canCreate && (
            <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
              <div className="bg-gradient-to-l from-rose-700 to-rose-600 px-5 py-3.5 flex items-center justify-between">
                <h2 className="text-sm font-bold text-white">📦 إنشاء مرتجع شراء</h2>
                <span className="text-white font-bold">الإجمالي: {formatCurrencyShort(prtTotal)}</span>
              </div>
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-text-secondary block mb-1.5">المورد *</label>
                    <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}
                      className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white">
                      <option value="">— اختر المورد —</option>
                      {suppliers.map((s) => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}
                    </select>
                  </div>
                  <div className="relative">
                    <label className="text-xs font-semibold text-text-secondary block mb-1.5">إضافة صنف</label>
                    <input value={query} onChange={(e) => { setQuery(e.target.value); runSearch(e.target.value) }}
                      placeholder="ابحث باسم المنتج أو الكود..."
                      className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white outline-none focus:border-primary" />
                    {(results.length > 0 || searching) && (
                      <div className="absolute z-20 w-full mt-1 bg-white border border-border rounded-xl shadow-lg overflow-hidden max-h-60 overflow-y-auto">
                        {searching && <div className="px-4 py-2.5 text-xs text-text-secondary">جاري البحث...</div>}
                        {results.map((p) => (
                          <button key={p.id} onClick={() => addLine(p)}
                            className="w-full text-right px-4 py-2.5 hover:bg-surface transition-colors border-b border-border/50 last:border-b-0">
                            <div className="text-sm font-medium text-text">{p.product_name}</div>
                            <div className="text-[10px] text-text-secondary">
                              {p.legacy_code}{Number(p.carton_quantity) > 0 ? ` • الكرتون = ${p.carton_quantity} قطعة` : ''}
                              {Number(p.avg_cost) > 0 ? ` • متوسط التكلفة/قطعة ${Number(p.avg_cost).toFixed(4)}` : ''}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {plines.length > 0 && (
                  <div className="border border-border rounded-xl overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-surface text-text-secondary">
                          <th className="px-2 py-2 text-right font-semibold w-[34%]">الصنف</th>
                          <th className="px-2 py-2 text-center font-semibold w-[16%]">الوحدة</th>
                          <th className="px-2 py-2 text-center font-semibold w-[14%]">الكمية</th>
                          <th className="px-2 py-2 text-center font-semibold w-[18%]">تكلفة الوحدة</th>
                          <th className="px-2 py-2 text-center font-semibold w-[12%]">الإجمالي</th>
                          <th className="px-2 py-2 w-[6%]"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {plines.map((l, i) => (
                          <tr key={l.productId}>
                            <td className="px-2 py-2">
                              <div className="font-medium text-text truncate" title={l.name}>{l.name}</div>
                              {l.unit === 'carton' && <div className="text-[9px] text-text-secondary">كرتون = {l.cartonQty} قطعة</div>}
                            </td>
                            <td className="px-2 py-2">
                              <select value={l.unit} onChange={(e) => {
                                const unit = e.target.value as Line['unit']
                                const mult = unit === 'piece' ? 1 : unit === 'dozen' ? 12 : l.cartonQty || 1
                                setPlines((prev) => prev.map((x, xi) => xi === i ? { ...x, unit, unitCost: mult > 0 ? x.unitCost : x.unitCost } : x))
                              }} className="w-full border border-border rounded px-1 py-1 text-xs bg-white">
                                <option value="piece">قطعة</option>
                                <option value="dozen">درزن</option>
                                <option value="carton">كرتون</option>
                              </select>
                            </td>
                            <td className="px-2 py-2">
                              <input type="number" min="1" step="1" value={l.qty}
                                onChange={(e) => setPlines((prev) => prev.map((x, xi) => xi === i ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x))}
                                className="w-full border border-border rounded px-1 py-1 text-center bg-white" />
                            </td>
                            <td className="px-2 py-2">
                              <input type="number" min="0" step="0.01" value={l.unitCost || ''}
                                onChange={(e) => setPlines((prev) => prev.map((x, xi) => xi === i ? { ...x, unitCost: Math.max(0, Number(e.target.value) || 0) } : x))}
                                className="w-full border border-border rounded px-1 py-1 text-center bg-white" />
                            </td>
                            <td className="px-2 py-2 text-center font-bold text-text">{formatCurrencyShort(l.unitCost * l.qty)}</td>
                            <td className="px-2 py-2 text-center">
                              <button onClick={() => setPlines(plines.filter((_, x) => x !== i))} className="text-danger text-sm leading-none">&times;</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
                  <div>
                    <label className="text-xs font-semibold text-text-secondary block mb-1.5">طريقة الاسترداد</label>
                    <select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)}
                      className="w-full border border-border rounded-lg px-2 py-2.5 text-sm bg-white">
                      <option value="account">خصم من حساب المورد</option>
                      <option value="cash">استرداد نقدي من الخزينة</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-text-secondary block mb-1.5">مخزون الخروج</label>
                    <select value={prtStoreId} onChange={(e) => setPrtStoreId(e.target.value)}
                      className="w-full border border-border rounded-lg px-2 py-2.5 text-sm bg-white">
                      <option value="">افتراضي (من الإعدادات)</option>
                      {stores.filter(s => s.is_active).map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-text-secondary block mb-1.5">درج الاسترداد</label>
                    <select value={prtDrawerId} onChange={(e) => setPrtDrawerId(e.target.value)}
                      className="w-full border border-border rounded-lg px-2 py-2.5 text-sm bg-white">
                      <option value="">افتراضي (الدرج الرئيسي)</option>
                      {treasuries.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}{t.kind === 'bank' ? ' (بنك)' : ''}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-text-secondary block mb-1.5">ملاحظات</label>
                    <input value={prtNotes} onChange={(e) => setPrtNotes(e.target.value)}
                      className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <button onClick={() => savePurchaseReturn(false)} disabled={savingPrt || plines.length === 0}
                      className="border border-primary text-primary disabled:opacity-50 rounded-xl py-2.5 text-xs font-bold">
                      {savingPrt ? '...' : 'حفظ كمعلق'}
                    </button>
                    {canPost && (
                      <button onClick={() => savePurchaseReturn(true)} disabled={savingPrt || plines.length === 0}
                        className="bg-gradient-to-l from-rose-700 to-rose-600 disabled:opacity-50 text-white rounded-xl py-2.5 text-xs font-bold">
                        {savingPrt ? '...' : 'حفظ وترحيل'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
            <div className="bg-surface px-5 py-3.5 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-bold text-text">📋 سجل مرتجعات الشراء</h2>
              <span className="text-[10px] text-text-secondary">{purchaseReturns.length}</span>
            </div>
            {purchaseReturns.length === 0 ? (
              <div className="text-center py-12 text-text-secondary text-sm">لا توجد مرتجعات شراء بعد</div>
            ) : (
              <div className="divide-y divide-border/60 max-h-[480px] overflow-y-auto">
                {purchaseReturns.map((p) => {
                  const pending = p.status !== 'treasury_posted'
                  return (
                    <div key={p.id} className="px-5 py-3 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-text">{p.code}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded ${pending ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'}`}>
                            {pending ? 'معلق' : 'مرحّل'}
                          </span>
                        </div>
                        <div className="text-[10px] text-text-secondary">
                          {p.supplier_name} • {p.item_count} صنف • {p.refund_method === 'cash' ? 'استرداد نقدي' : 'خصم من الحساب'} • {formatDate(p.created_at)}
                        </div>
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        <span className="text-sm font-bold text-text">{formatCurrencyShort(p.total_amount)}</span>
                        {pending && canPost && (
                          <button onClick={() => postPurchaseReturn(p.id)} disabled={postingId === p.id}
                            className="text-[10px] bg-rose-600 disabled:opacity-50 text-white rounded px-2 py-1">
                            {postingId === p.id ? '...' : 'ترحيل'}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
