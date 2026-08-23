import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort, formatDate } from '../../utils/format'
import { useCapability } from '../../hooks/useCapability'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface SupplierRow { id: string; supplier_name?: string; outstanding_credit?: number | null }
interface StoreRow { id: string; code: string; name: string; is_active: boolean }
interface TreasuryRow { id: string; code: string; name: string; kind: 'cash' | 'bank'; is_active: boolean }
interface PurchaseRow {
  id: string; code?: string; status?: string; total_amount?: number | null
  paid_amount?: number | null; payment_method?: string; item_count?: number | null
  created_at?: string; supplier_id?: string; supplier_name?: string
}
interface Line { productId: string; name: string; unit: 'piece' | 'dozen' | 'carton'; qty: number; unitCost: number; cartonQty: number }

const methodLabels: Record<string, string> = { credit: 'على الحساب (آجل)', cash: 'نقداً / فوري', bank_transfer: 'تحويل بنكي', cheque: 'شيك', deposit: 'إيداع' }

export function SahlPurchasesPage() {
  const nav = useNavigate()
  const canCreate = useCapability('sahl.purchases.create')
  const canPost = useCapability('sahl.purchases.post')

  const [suppliers, setSuppliers] = useState<SupplierRow[]>([])
  const [supplierId, setSupplierId] = useState('')
  const [stores, setStores] = useState<StoreRow[]>([])
  const [treasuries, setTreasuries] = useState<TreasuryRow[]>([])
  const [storeId, setStoreId] = useState('')
  const [drawerId, setDrawerId] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [method, setMethod] = useState('credit')
  const [paid, setPaid] = useState('0')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [purchases, setPurchases] = useState<PurchaseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [items, setItems] = useState<Record<string, any[]>>({})
  const [postingId, setPostingId] = useState<string | null>(null)

  async function loadSuppliers() {
    const token = getToken()
    if (!token) return
    const res = await supabase.rpc('sahl_get_suppliers', { p_token: token })
    if (!res.error && !(res.data as any)?.error) setSuppliers(Array.isArray(res.data) ? res.data : [])
  }

  async function loadPurchases() {
    const token = getToken()
    if (!token) return
    setLoading(true)
    const res = await supabase.rpc('sahl_get_purchases', { p_token: token })
    if (res.error) toast.error(res.error.message)
    else {
      const data = res.data as any
      if (data?.error) toast.error(data.error)
      else setPurchases(Array.isArray(data) ? data : [])
    }
    setLoading(false)
  }

  useEffect(() => {
    loadSuppliers(); loadPurchases()
    const token = getToken()
    if (!token) return
    Promise.all([
      supabase.rpc('sahl_get_stores', { p_token: token }),
      supabase.rpc('sahl_get_treasuries', { p_token: token }),
    ]).then(([st, tr]) => {
      if (!st.error && Array.isArray(st.data)) setStores(st.data as StoreRow[])
      if (!tr.error && Array.isArray(tr.data)) setTreasuries((tr.data as TreasuryRow[]).filter(t => t.is_active))
    })
  }, [])

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
    if (lines.some((l) => l.productId === p.id)) { toast.error('المنتج مضاف بالفعل'); return }
    setLines((prev) => [...prev, {
      productId: p.id, name: p.product_name, unit: 'carton',
      qty: 1, unitCost: 0, cartonQty: Number(p.carton_quantity) || 1,
    }])
    setQuery(''); setResults([])
  }

  const total = useMemo(() => lines.reduce((sum, l) => sum + l.unitCost * l.qty, 0), [lines])

  function switchMethod(m: string) {
    setMethod(m)
    if (m !== 'credit') setPaid(total.toFixed(2))
    else setPaid('0')
  }

  function updateLine(idx: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  }

  function buildPayloadLines() {
    return lines.map((l) => {
      const mult = l.unit === 'piece' ? 1 : l.unit === 'dozen' ? 12 : l.cartonQty || 1
      return {
        product_id: l.productId,
        quantity_pieces: Math.round(l.qty * mult),
        cost_per_piece: Number((l.unitCost / mult).toFixed(4)),
      }
    }).filter((x) => x.quantity_pieces > 0)
  }

  async function save(post: boolean) {
    if (!supplierId) { toast.error('اختر المورد'); return }
    if (lines.length === 0) { toast.error('أضف صنفاً واحداً على الأقل'); return }
    if (buildPayloadLines().length === 0) { toast.error('تحقق من الكميات'); return }
    const amt = Number(paid) || 0
    if (amt > total + 0.001) { toast.error('المدفوع أكبر من الإجمالي'); return }
    const token = getToken()
    if (!token) return
    setSaving(true)
    const cr = await supabase.rpc('sahl_create_purchase', {
      p_token: token, p_supplier_id: supplierId, p_items: buildPayloadLines(),
      p_payment_method: method, p_paid_amount: amt,
      p_reference_number: reference.trim() || null, p_notes: notes.trim() || null,
    })
    if (cr.error) { toast.error(cr.error.message); setSaving(false); return }
    const created = cr.data as any
    if (created?.error) { toast.error(created.error); setSaving(false); return }

    let info = ''
    if (post) {
      const pr = await supabase.rpc('sahl_post_purchase', {
        p_token: token, p_purchase_id: created.id,
        p_store_id: storeId || null, p_treasury_id: drawerId || null,
      })
      if (pr.error || (pr.data as any)?.error) {
        const err = pr.error?.message || (pr.data as any)?.error
        toast.error(`تم إنشاء ${created.code} لكن فشل الترحيل: ${err}`, { duration: 5000 })
      } else {
        const posted = pr.data as any
        info = ` — خزينة: ${formatCurrencyShort(posted.paid_from_treasury)} • حساب المورد: ${formatCurrencyShort(posted.added_to_supplier_account)}`
      }
    }
    toast.success(`${post ? 'تم الترحيل' : 'تم الحفظ كمعلق'} ${created.code}${info}`, { duration: 4000 })
    setSaving(false)
    setLines([]); setPaid('0'); setReference(''); setNotes('')
    await loadPurchases()
  }

  async function toggleExpand(id: string) {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    if (!items[id]) {
      const token = getToken()
      if (!token) return
      const res = await supabase.rpc('sahl_get_purchase_items', { p_token: token, p_purchase_id: id })
      if (!res.error && !(res.data as any)?.error) setItems((prev) => ({ ...prev, [id]: Array.isArray(res.data) ? res.data : [] }))
    }
  }

  async function postPurchase(id: string) {
    const token = getToken()
    if (!token) return
    setPostingId(id)
    const res = await supabase.rpc('sahl_post_purchase', {
      p_token: token, p_purchase_id: id,
      p_store_id: storeId || null, p_treasury_id: drawerId || null,
    })
    setPostingId(null)
    if (res.error) { toast.error(res.error.message); return }
    const data = res.data as any
    if (data?.error) { toast.error(data.error); return }
    toast.success(`تم ترحيل ${data.code} — خزينة: ${formatCurrencyShort(data.paid_from_treasury)} • حساب المورد: ${formatCurrencyShort(data.added_to_supplier_account)}`, { duration: 4000 })
    await Promise.all([loadPurchases(), loadSuppliers()])
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => nav('/sahl')} className="text-text-secondary text-lg">&rarr;</button>
          <div>
            <h1 className="text-lg font-bold text-text">المشتريات</h1>
            <p className="text-[10px] text-text-secondary">تسجيل فواتير الشراء والترحيل للخزينة والمخزون</p>
          </div>
        </div>
        <button onClick={loadPurchases} className="text-[10px] text-primary border border-border rounded px-2 py-1">تحديث</button>
      </div>

      {canCreate && (
        <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="bg-gradient-to-l from-emerald-700 to-emerald-600 px-5 py-3.5 flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">🛒 فاتورة شراء جديدة</h2>
            <span className="text-white font-bold">الإجمالي: {formatCurrencyShort(total)}</span>
          </div>

          <div className="p-5 space-y-4">
            <div>
              <label className="text-xs font-semibold text-text-secondary block mb-1.5">المورد *</label>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white">
                <option value="">— اختر المورد —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.supplier_name} {Number(s.outstanding_credit) > 0 ? `(مستحق: ${formatCurrencyShort(s.outstanding_credit)})` : ''}</option>
                ))}
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
                      <div className="text-[10px] text-text-secondary">{p.legacy_code}{Number(p.carton_quantity) > 0 ? ` • الكرتون = ${p.carton_quantity} قطعة` : ''}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {lines.length > 0 && (
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
                    {lines.map((l, i) => (
                      <tr key={l.productId}>
                        <td className="px-2 py-2">
                          <div className="font-medium text-text truncate" title={l.name}>{l.name}</div>
                          {l.unit === 'carton' && <div className="text-[9px] text-text-secondary">كرتون = {l.cartonQty} قطعة</div>}
                        </td>
                        <td className="px-2 py-2">
                          <select value={l.unit} onChange={(e) => updateLine(i, { unit: e.target.value as Line['unit'] })}
                            className="w-full border border-border rounded px-1 py-1 text-xs bg-white">
                            <option value="piece">قطعة</option>
                            <option value="dozen">درزن</option>
                            <option value="carton">كرتون</option>
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <input type="number" min="1" step="1" value={l.qty}
                            onChange={(e) => updateLine(i, { qty: Math.max(1, Number(e.target.value) || 1) })}
                            className="w-full border border-border rounded px-1 py-1 text-center bg-white" />
                        </td>
                        <td className="px-2 py-2">
                          <input type="number" min="0" step="0.0001" value={l.unitCost || ''}
                            onChange={(e) => updateLine(i, { unitCost: Math.max(0, Number(e.target.value) || 0) })}
                            className="w-full border border-border rounded px-1 py-1 text-center bg-white" />
                        </td>
                        <td className="px-2 py-2 text-center font-bold text-text">{formatCurrencyShort(l.unitCost * l.qty)}</td>
                        <td className="px-2 py-2 text-center">
                          <button onClick={() => setLines(lines.filter((_, x) => x !== i))}
                            className="text-danger text-sm leading-none">&times;</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-text-secondary block mb-1.5">مخزون الاستلام</label>
                <select value={storeId} onChange={(e) => setStoreId(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white">
                  <option value="">افتراضي (من الإعدادات)</option>
                  {stores.filter(s => s.is_active).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-text-secondary block mb-1.5">درج الدفع</label>
                <select value={drawerId} onChange={(e) => setDrawerId(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white">
                  <option value="">افتراضي (الدرج الرئيسي)</option>
                  {treasuries.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}{t.kind === 'bank' ? ' (بنك)' : ''}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
              <div>
                <label className="text-xs font-semibold text-text-secondary block mb-1.5">طريقة الدفع</label>
                <select value={method} onChange={(e) => switchMethod(e.target.value)}
                  className="w-full border border-border rounded-lg px-2 py-2.5 text-sm bg-white">
                  {Object.entries(methodLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-text-secondary block mb-1.5">
                  المدفوع الآن {method === 'cash' && total > 0 && (
                    <button type="button" onClick={() => setPaid(total.toFixed(2))} className="text-primary text-[10px]">(دفع كامل)</button>
                  )}
                </label>
                <input type="number" min="0" step="0.01" value={paid} onChange={(e) => setPaid(e.target.value)}
                  className={`w-full border rounded-lg px-3 py-2.5 text-sm bg-white ${Number(paid) > total ? 'border-danger' : 'border-border'}`} />
                <div className="text-[9px] text-text-secondary mt-1">
                  {method === 'credit' ? 'يُضاف الإجمالي لحساب المورد' : `يُخصم من الخزينة • يبقى على الحساب: ${formatCurrencyShort(Math.max(0, total - (Number(paid) || 0)))}`}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-text-secondary block mb-1.5">رقم مرجعي</label>
                <input value={reference} onChange={(e) => setReference(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
              </div>
              <div>
                <label className="text-xs font-semibold text-text-secondary block mb-1.5">ملاحظات</label>
                <input value={notes} onChange={(e) => setNotes(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
              </div>
              <div className="flex flex-col gap-2">
                <button onClick={() => save(false)} disabled={saving || lines.length === 0}
                  className="border border-primary text-primary disabled:opacity-50 rounded-xl py-2.5 text-xs font-bold active:opacity-80">
                  {saving ? '...' : 'حفظ كمعلق'}
                </button>
                {canPost && (
                  <button onClick={() => save(true)} disabled={saving || lines.length === 0}
                    className="bg-gradient-to-l from-emerald-700 to-emerald-600 disabled:opacity-50 text-white rounded-xl py-2.5 text-xs font-bold active:opacity-80">
                    {saving ? '...' : 'حفظ وترحيل'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="bg-surface px-5 py-3.5 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-bold text-text">📋 سجل المشتريات</h2>
          <span className="text-[10px] text-text-secondary">{purchases.length}</span>
        </div>
        {loading ? (
          <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
        ) : purchases.length === 0 ? (
          <div className="text-center py-12 text-text-secondary text-sm">لا توجد فواتير شراء بعد</div>
        ) : (
          <div className="divide-y divide-border/60 max-h-[480px] overflow-y-auto">
            {purchases.map((p) => {
              const pending = p.status !== 'treasury_posted'
              return (
                <div key={p.id}>
                  <div className="px-5 py-3 flex items-center justify-between gap-2 hover:bg-surface/60 cursor-pointer"
                    onClick={() => toggleExpand(p.id)}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-text">{p.code}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded ${pending ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'}`}>
                          {pending ? 'معلق' : 'مرحّل'}
                        </span>
                      </div>
                      <div className="text-[10px] text-text-secondary">
                        {p.supplier_name || 'مورد محذوف'} • {p.item_count || 0} صنف • {formatDate(p.created_at)}
                        {p.payment_method && p.payment_method !== 'credit' ? ` • مدفوع ${formatCurrencyShort(p.paid_amount || 0)}` : ''}
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      <span className="text-sm font-bold text-text">{formatCurrencyShort(p.total_amount || 0)}</span>
                      {pending && canPost && (
                        <button onClick={(e) => { e.stopPropagation(); postPurchase(p.id) }} disabled={postingId === p.id}
                          className="text-[10px] bg-emerald-600 disabled:opacity-50 text-white rounded px-2 py-1">
                          {postingId === p.id ? '...' : 'ترحيل'}
                        </button>
                      )}
                    </div>
                  </div>
                  {expanded === p.id && (
                    <div className="px-5 pb-3 bg-surface/40">
                      {!items[p.id] ? (
                        <div className="text-[10px] text-text-secondary py-2">جاري تحميل الأصناف...</div>
                      ) : items[p.id].length === 0 ? (
                        <div className="text-[10px] text-text-secondary py-2">لا توجد أصناف</div>
                      ) : (
                        <div className="space-y-1 py-1">
                          {items[p.id].map((it: any) => (
                            <div key={it.id} className="flex items-center justify-between text-[11px] border-b border-border/40 pb-1">
                              <span className="truncate">{it.product_name || 'منتج'}</span>
                              <span className="text-text-secondary shrink-0 mr-3">
                                {it.quantity_pieces} قطعة × {it.cost_per_piece} = {formatCurrencyShort(it.line_total)}
                              </span>
                            </div>
                          ))}
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
    </div>
  )
}
