import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort, formatDate } from '../../utils/format'
import { useCapability } from '../../hooks/useCapability'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface InvRow {
  product_id: string; product_name: string; legacy_code?: string
  carton_quantity?: number | null; quantity: number
  avg_cost?: number | null; stock_value?: number | null
}
interface AdjustRow {
  id: string; product_id: string; product_name: string
  quantity_before: number; quantity_after: number; delta_pieces: number
  value_impact?: number | null; reason_category: string; reference_type: string
  reference_id?: string | null; notes?: string | null; created_at?: string
}
interface StocktakeRow {
  id: string; code: string; status: 'open' | 'closed' | 'cancelled'; notes?: string | null
  total_value_impact?: number | null; created_at?: string; closed_at?: string | null
  closed_by_name?: string | null; item_count: number; counted_count: number
}
interface StkItemRow {
  id: string; product_id: string; product_name: string; legacy_code?: string
  system_quantity: number; counted_quantity?: number | null; value_impact?: number | null
  avg_cost_snapshot?: number | null
}

const REASONS: Record<string, string> = {
  stocktake: 'جرد', damage: 'تالف', loss: 'مفقود', expiry: 'منتهي',
  correction: 'تصحيح', found: 'عجز مكتشف', other: 'أخرى',
}
const STATUS_BADGE: Record<string, string> = {
  open: 'bg-accent/10 text-accent',
  closed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-700',
}
const STATUS_LABEL: Record<string, string> = {
  open: 'جاري العد', closed: 'مُغلق', cancelled: 'ملغي',
}

export function SahlInventoryPage() {
  const nav = useNavigate()
  const canCount = useCapability('sahl.inventory.count')
  const canPost = useCapability('sahl.inventory.post')

  const [tab, setTab] = useState<'adjust' | 'stocktake'>('adjust')

  const [inv, setInv] = useState<InvRow[]>([])
  const [search, setSearch] = useState('')
  const [adjustments, setAdjustments] = useState<AdjustRow[]>([])
  const [loading, setLoading] = useState(true)

  const [stocktakes, setStocktakes] = useState<StocktakeRow[]>([])
  const [stkItems, setStkItems] = useState<StkItemRow[]>([])
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [stkSearch, setStkSearch] = useState('')

  const [adjustFor, setAdjustFor] = useState<InvRow | null>(null)
  const [newQty, setNewQty] = useState('')
  const [reasonCat, setReasonCat] = useState('correction')
  const [adjNotes, setAdjNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [stkBusy, setStkBusy] = useState(false)

  const openSession = useMemo(
    () => stocktakes.find((s) => s.status === 'open') || null,
    [stocktakes]
  )

  async function loadAdjustTab(token: string) {
    const [iRes, aRes] = await Promise.all([
      supabase.rpc('sahl_get_inventory_snapshot', { p_token: token, p_search: null }),
      supabase.rpc('sahl_get_inventory_adjustments', { p_token: token, p_limit: 100 }),
    ])
    if (iRes.error || aRes.error) { toast.error((iRes.error || aRes.error)?.message || ''); return }
    const invData = iRes.data as any, adjData = aRes.data as any
    if (invData?.error) { toast.error(invData.error); return }
    setInv(Array.isArray(invData) ? invData : [])
    setAdjustments(adjData?.error ? [] : Array.isArray(adjData) ? adjData : [])
  }

  async function loadStocktakes(token: string) {
    const res = await supabase.rpc('sahl_get_stocktakes', { p_token: token })
    if (res.error) { toast.error(res.error.message); return }
    const data = res.data as any
    if (data?.error) { toast.error(data.error); return }
    setStocktakes(Array.isArray(data) ? data : [])
  }

  async function loadData() {
    const token = getToken()
    if (!token) return
    setLoading(true)
    await Promise.all([loadAdjustTab(token), loadStocktakes(token)])
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  useEffect(() => {
    async function fetchItems() {
      if (!openSession) { setStkItems([]); setCounts({}); return }
      const token = getToken()
      if (!token) return
      const res = await supabase.rpc('sahl_get_stocktake_items', {
        p_token: token, p_stocktake_id: openSession.id,
      })
      if (res.error) { toast.error(res.error.message); return }
      const data = res.data as any
      if (data?.error) { toast.error(data.error); return }
      const rows: StkItemRow[] = Array.isArray(data) ? data : []
      setStkItems(rows)
      const init: Record<string, string> = {}
      rows.forEach((r) => { if (r.counted_quantity !== null && r.counted_quantity !== undefined) init[r.id] = String(r.counted_quantity) })
      setCounts(init)
    }
    fetchItems()
  }, [openSession?.id])

  const filteredInv = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return inv.slice(0, 80)
    return inv.filter((p) =>
      p.product_name.toLowerCase().includes(q) ||
      (p.legacy_code || '').toLowerCase().includes(q)
    ).slice(0, 80)
  }, [inv, search])

  const filteredStkItems = useMemo(() => {
    const q = stkSearch.trim().toLowerCase()
    if (!q) return stkItems.slice(0, 100)
    return stkItems.filter((i) =>
      i.product_name.toLowerCase().includes(q) ||
      (i.legacy_code || '').toLowerCase().includes(q)
    ).slice(0, 100)
  }, [stkItems, stkSearch])

  const invTotals = useMemo(() => ({
    products: inv.length,
    value: inv.reduce((s, p) => s + Number(p.stock_value || 0), 0),
    pieces: inv.reduce((s, p) => s + Number(p.quantity || 0), 0),
  }), [inv])

  const stkProgress = useMemo(() => ({
    total: stkItems.length,
    counted: stkItems.filter((i) => counts[i.id] !== undefined && counts[i.id] !== '').length,
    varianceValue: stkItems.reduce((s, i) => {
      const c = Number(counts[i.id])
      if (Number.isNaN(c)) return s
      return s + (c - i.system_quantity) * Number(i.avg_cost_snapshot || 0)
    }, 0),
  }), [stkItems, counts])

  function openAdjust(p: InvRow) {
    setAdjustFor(p)
    setNewQty(String(p.quantity))
    setReasonCat('correction')
    setAdjNotes('')
  }

  async function submitAdjustment() {
    if (!adjustFor) return
    const nq = Number(newQty)
    if (!Number.isInteger(nq) || nq < 0) { toast.error('أدخل كمية صحيحة'); return }
    const token = getToken()
    if (!token) return
    setSaving(true)
    const res = await supabase.rpc('sahl_create_manual_adjustment', {
      p_token: token, p_product_id: adjustFor.product_id, p_new_quantity: nq,
      p_reason_category: reasonCat, p_notes: adjNotes.trim() || null,
    })
    setSaving(false)
    if (res.error) { toast.error(res.error.message); return }
    const data = res.data as any
    if (data?.error) { toast.error(data.error); return }
    if (!data.changed) {
      toast('الكمية مطابقة — لا يوجد تغيير')
    } else {
      const sign = data.delta_pieces > 0 ? '+' : ''
      toast.success(`تم التعديل ${sign}${data.delta_pieces} قطعة (${data.quantity_before} ← ${data.quantity_after})`, { duration: 4000 })
    }
    setAdjustFor(null)
    await loadAdjustTab(token)
  }

  async function createStocktake() {
    const token = getToken()
    if (!token) return
    setStkBusy(true)
    const res = await supabase.rpc('sahl_create_stocktake', { p_token: token, p_notes: null })
    setStkBusy(false)
    if (res.error) { toast.error(res.error.message); return }
    const data = res.data as any
    if (data?.error) { toast.error(data.error); return }
    toast.success(`بدأ جرد ${data.code} على ${data.line_count} صنف`, { duration: 4000 })
    setTab('stocktake')
    await loadStocktakes(token)
  }

  async function saveCounts(silent = false): Promise<boolean> {
    const token = getToken()
    if (!openSession || !token) return false
    const payload = Object.entries(counts)
      .filter(([id, v]) => v !== '')
      .map(([id, v]) => ({ item_id: id, counted_quantity: Number(v) }))
    if (payload.length === 0) { if (!silent) toast.error('لا توجد أعداد مسجلة'); return false }
    setStkBusy(true)
    const res = await supabase.rpc('sahl_record_count', {
      p_token: token, p_stocktake_id: openSession.id, p_counts: payload,
    })
    setStkBusy(false)
    if (res.error) { toast.error(res.error.message); return false }
    const data = res.data as any
    if (data?.error) { toast.error(data.error); return false }
    if (!silent) toast.success(`تم حفظ ${data.counted_lines}/${data.total_lines}`)
    return true
  }

  async function closeStocktake() {
    const token = getToken()
    if (!openSession || !token) return
    const ok = await saveCounts(true)
    if (!ok) return
    setStkBusy(true)
    const res = await supabase.rpc('sahl_close_stocktake', { p_token: token, p_stocktake_id: openSession.id })
    setStkBusy(false)
    if (res.error) { toast.error(res.error.message); return }
    const data = res.data as any
    if (data?.error) {
      if (data.error === 'PENDING_COUNTS') toast.error(`باقي ${data.uncounted_lines} صنف بدون عد`)
      else toast.error(data.error)
      return
    }
    toast.success(`أُغلق الجرد ${data.code} — ${data.changed_lines} صنف متغير • أثر القيمة: ${formatCurrencyShort(data.value_impact)}`, { duration: 5000 })
    await loadStocktakes(token)
  }

  async function cancelStocktake() {
    const token = getToken()
    if (!openSession || !token) return
    setStkBusy(true)
    const res = await supabase.rpc('sahl_cancel_stocktake', { p_token: token, p_stocktake_id: openSession.id })
    setStkBusy(false)
    if (res.error) { toast.error(res.error.message); return }
    const data = res.data as any
    if (data?.error) { toast.error(data.error); return }
    toast('تم إلغاء الجرد')
    await loadStocktakes(token)
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => nav('/sahl')} className="text-text-secondary text-lg">&rarr;</button>
          <div>
            <h1 className="text-lg font-bold text-text">المخزون والجرد</h1>
            <p className="text-[10px] text-text-secondary">تسويات الكميات وجلسات الجرد الفعلي</p>
          </div>
        </div>
        <button onClick={loadData} className="text-[10px] text-primary border border-border rounded px-2 py-1">تحديث</button>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setTab('adjust')}
          className={`flex-1 rounded-xl py-2 text-xs font-bold transition-colors ${tab === 'adjust' ? 'bg-emerald-600 text-white' : 'bg-white border border-border text-text-secondary'}`}>
          التسويات
        </button>
        <button onClick={() => setTab('stocktake')} className={`relative flex-1 rounded-xl py-2 text-xs font-bold transition-colors ${tab === 'stocktake' ? 'bg-emerald-600 text-white' : 'bg-white border border-border text-text-secondary'}`}>
          الجرد
          {openSession && <span className="absolute top-1 left-1 h-2 w-2 rounded-full bg-accent animate-pulse" />}
        </button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-text-secondary text-sm">جاري التحميل...</div>
      ) : tab === 'adjust' ? (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white rounded-xl border border-border p-4">
              <div className="text-[10px] text-text-secondary">الأصناف النشطة</div>
              <div className="text-lg font-bold text-text mt-1">{invTotals.products}</div>
            </div>
            <div className="bg-white rounded-xl border border-border p-4">
              <div className="text-[10px] text-text-secondary">إجمالي القطع</div>
              <div className="text-lg font-bold text-text mt-1">{invTotals.pieces.toLocaleString()}</div>
            </div>
            <div className="bg-white rounded-xl border border-border p-4">
              <div className="text-[10px] text-text-secondary">قيمة المخزون</div>
              <div className="text-lg font-bold text-emerald-700 mt-1">{formatCurrencyShort(invTotals.value)}</div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
            <div className="bg-surface px-5 py-3 border-b border-border flex items-center justify-between gap-3">
              <h2 className="text-sm font-bold text-text shrink-0">📦 أرصدة المخزون</h2>
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث بالاسم أو الكود..."
                className="w-full max-w-[220px] border border-border rounded-lg px-3 py-1.5 text-xs bg-white" />
            </div>
            <div className="divide-y divide-border/60 max-h-[420px] overflow-y-auto">
              {filteredInv.length === 0 ? (
                <div className="text-center py-10 text-text-secondary text-sm">{search ? 'لا نتائج' : 'لا أصناف'}</div>
              ) : filteredInv.map((p) => (
                <button key={p.product_id} onClick={() => canPost && openAdjust(p)}
                  className={`w-full px-5 py-2.5 flex items-center justify-between gap-2 text-right hover:bg-surface/60 ${canPost ? 'cursor-pointer' : 'cursor-default'}`}>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-text truncate">{p.product_name}</div>
                    <div className="text-[10px] text-text-secondary">
                      {p.legacy_code || '—'}
                      {p.avg_cost != null ? ` • تكلفة ${formatCurrencyShort(p.avg_cost)}` : ''}
                    </div>
                  </div>
                  <div className="shrink-0 text-left flex items-center gap-3">
                    <div>
                      <div className="text-[9px] text-text-secondary">الكمية</div>
                      <div className="text-sm font-bold text-text">{p.quantity}</div>
                    </div>
                    <div className="w-20">
                      <div className="text-[9px] text-text-secondary">القيمة</div>
                      <div className="text-xs font-semibold text-emerald-700">{formatCurrencyShort(p.stock_value)}</div>
                    </div>
                    {canPost && <span className="text-[10px] text-primary">تعديل</span>}
                  </div>
                </button>
              ))}
            </div>
            {inv.length > 80 && !search && (
              <div className="px-5 py-2 text-[10px] text-text-secondary bg-surface border-t border-border">
                اعرض أول 80 صنفاً — استخدم البحث للوصول لباقي الأصناف ({inv.length})
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
            <div className="bg-surface px-5 py-3.5 border-b border-border">
              <h2 className="text-sm font-bold text-text">📝 سجل التسويات (آخر 100)</h2>
            </div>
            {adjustments.length === 0 ? (
              <div className="text-center py-10 text-text-secondary text-sm">لا تسويات بعد</div>
            ) : (
              <div className="divide-y divide-border/60 max-h-[360px] overflow-y-auto">
                {adjustments.map((a) => (
                  <div key={a.id} className="px-5 py-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-text truncate">{a.product_name}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-surface text-text-secondary">
                          {a.reference_type === 'stocktake' ? 'جرد' : 'تسوية'} • {REASONS[a.reason_category] || a.reason_category}
                        </span>
                      </div>
                      <div className="text-[10px] text-text-secondary">
                        {formatDate(a.created_at)} • {a.quantity_before} ← {a.quantity_after}
                        {a.notes ? ` • ${a.notes}` : ''}
                      </div>
                    </div>
                    <div className="shrink-0 text-left">
                      <div className={`text-sm font-bold ${a.delta_pieces > 0 ? 'text-green-700' : 'text-danger'}`}>
                        {a.delta_pieces > 0 ? '+' : ''}{a.delta_pieces}
                      </div>
                      {a.value_impact != null && Number(a.value_impact) !== 0 && (
                        <div className="text-[9px] text-text-secondary">{formatCurrencyShort(a.value_impact)}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {!openSession && canPost && (
            <button onClick={createStocktake} disabled={stkBusy}
              className="w-full bg-gradient-to-l from-emerald-700 to-emerald-600 disabled:opacity-50 text-white rounded-2xl py-3.5 text-sm font-bold shadow-sm active:opacity-80">
              {stkBusy ? 'جاري التحضير...' : '▶ بدء جلسة جرد جديدة'}
            </button>
          )}

          {openSession ? (
            <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
              <div className="bg-gradient-to-l from-emerald-700 to-emerald-600 px-5 py-3.5 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-white">جلسة جرد {openSession.code}</h2>
                  <p className="text-[10px] text-white/70 mt-0.5">
                    {stkProgress.counted}/{stkProgress.total} صنف معدود
                  </p>
                </div>
                <div className="text-left">
                  <div className="text-[10px] text-white/70">أثر القيمة المتوقع</div>
                  <div className="text-sm font-bold text-white">{formatCurrencyShort(stkProgress.varianceValue)}</div>
                </div>
              </div>
              <div className="h-1.5 bg-surface">
                <div className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${stkProgress.total ? (stkProgress.counted / stkProgress.total) * 100 : 0}%` }} />
              </div>

              <div className="px-5 pt-3 pb-2 border-b border-border flex items-center gap-3">
                <input value={stkSearch} onChange={(e) => setStkSearch(e.target.value)}
                  placeholder="بحث في أصناف الجرد..."
                  className="flex-1 border border-border rounded-lg px-3 py-2 text-xs bg-white" />
              </div>

              <div className="divide-y divide-border/60 max-h-[420px] overflow-y-auto">
                {filteredStkItems.map((i) => {
                  const val = counts[i.id] ?? ''
                  const c = val === '' ? NaN : Number(val)
                  const diff = !Number.isNaN(c) ? c - i.system_quantity : null
                  return (
                    <div key={i.id} className="px-5 py-2 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-text truncate">{i.product_name}</div>
                        <div className="text-[10px] text-text-secondary">رصيد النظام: {i.system_quantity}</div>
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        {diff !== null && diff !== 0 && (
                          <span className={`text-[10px] font-bold ${diff > 0 ? 'text-green-700' : 'text-danger'}`}>
                            {diff > 0 ? '+' : ''}{diff}
                          </span>
                        )}
                        <input type="number" min="0" inputMode="numeric" value={val}
                          onChange={(e) => setCounts((prev) => ({ ...prev, [i.id]: e.target.value }))}
                          placeholder={String(i.system_quantity)}
                          disabled={!canCount}
                          className="w-24 border border-border rounded-lg px-2 py-1.5 text-sm text-center bg-white disabled:bg-surface" />
                      </div>
                    </div>
                  )
                })}
              </div>

              {canPost && (
                <div className="p-4 grid grid-cols-3 gap-2 border-t border-border bg-surface/50">
                  <button onClick={() => saveCounts()} disabled={stkBusy || canCount === false}
                    className="bg-cyan-600 disabled:opacity-50 text-white rounded-xl py-2.5 text-xs font-bold">
                    حفظ الأعداد
                  </button>
                  <button onClick={closeStocktake} disabled={stkBusy}
                    className="bg-gradient-to-l from-emerald-700 to-emerald-600 disabled:opacity-50 text-white rounded-xl py-2.5 text-xs font-bold">
                    إغلاق الجرد وتطبيق
                  </button>
                  <button onClick={cancelStocktake} disabled={stkBusy}
                    className="border border-red-300 text-red-600 disabled:opacity-50 rounded-xl py-2.5 text-xs font-bold">
                    إلغاء
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8 bg-white rounded-2xl border border-dashed border-border text-text-secondary text-sm">
              لا توجد جلسة جرد مفتوحة
            </div>
          )}

          <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
            <div className="bg-surface px-5 py-3.5 border-b border-border">
              <h2 className="text-sm font-bold text-text">📚 سجل جلسات الجرد</h2>
            </div>
            {stocktakes.length === 0 ? (
              <div className="text-center py-10 text-text-secondary text-sm">لا جلسات بعد</div>
            ) : (
              <div className="divide-y divide-border/60 max-h-[320px] overflow-y-auto">
                {stocktakes.map((s) => (
                  <div key={s.id} className="px-5 py-3 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-text">{s.code}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded ${STATUS_BADGE[s.status]}`}>{STATUS_LABEL[s.status]}</span>
                      </div>
                      <div className="text-[10px] text-text-secondary">
                        {formatDate(s.created_at)} • {s.item_count} صنف
                        {s.status === 'closed' && s.closed_by_name ? ` • أغلقها ${s.closed_by_name}` : ''}
                        {s.notes ? ` • ${s.notes}` : ''}
                      </div>
                    </div>
                    <div className="shrink-0 text-left">
                      {s.status === 'closed' ? (
                        <>
                          <div className="text-[9px] text-text-secondary">أثر القيمة</div>
                          <div className={`text-xs font-bold ${Number(s.total_value_impact) >= 0 ? 'text-green-700' : 'text-danger'}`}>
                            {formatCurrencyShort(s.total_value_impact)}
                          </div>
                        </>
                      ) : s.status === 'open' ? (
                        <div className="text-[10px] text-text-secondary">{s.counted_count}/{s.item_count} معدود</div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {adjustFor && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setAdjustFor(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="bg-gradient-to-l from-emerald-700 to-emerald-600 px-5 py-4">
              <h3 className="text-base font-bold text-white">تعديل رصيد — {adjustFor.product_name.trim()}</h3>
              <p className="text-[10px] text-white/70 mt-0.5">رصيد النظام الحالي: {adjustFor.quantity} قطعة</p>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-semibold text-text-secondary block mb-1.5">الكمية الصحيحة *</label>
                <input type="number" min="0" step="1" inputMode="numeric" value={newQty}
                  onChange={(e) => setNewQty(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
                {Number.isInteger(Number(newQty)) && Number(newQty) !== adjustFor.quantity && (
                  <div className={`text-[11px] font-bold mt-1 ${Number(newQty) > adjustFor.quantity ? 'text-green-700' : 'text-danger'}`}>
                    فرق: {Number(newQty) > adjustFor.quantity ? '+' : ''}{Number(newQty) - adjustFor.quantity} قطعة
                    {adjustFor.avg_cost != null && ` • أثر القيمة: ${formatCurrencyShort((Number(newQty) - adjustFor.quantity) * Number(adjustFor.avg_cost))}`}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-text-secondary block mb-1.5">سبب التسوية</label>
                  <select value={reasonCat} onChange={(e) => setReasonCat(e.target.value)}
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white">
                    {Object.entries(REASONS).filter(([k]) => k !== 'stocktake').map(([k, label]) => (
                      <option key={k} value={k}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-text-secondary block mb-1.5">ملاحظات</label>
                  <input value={adjNotes} onChange={(e) => setAdjNotes(e.target.value)}
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
                </div>
              </div>
              <button onClick={submitAdjustment} disabled={saving}
                className="w-full bg-gradient-to-l from-emerald-700 to-emerald-600 disabled:opacity-50 text-white rounded-xl py-2.5 text-sm font-bold">
                {saving ? 'جاري الحفظ...' : 'تنفيذ التسوية'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
