import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort, formatDate } from '../../utils/format'
import { useCapability } from '../../hooks/useCapability'
import toast from 'react-hot-toast'
import { printSahlDoc } from './sahl-printing'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface InvoiceRow {
  id: string; code: string; kind: 'sale' | 'quote'; status: string
  customer_name?: string | null; store_name?: string | null
  cash_treasury_name?: string | null; card_treasury_name?: string | null
  subtotal: number; discount_amount: number; additions_amount?: number; additions_type?: string | null
  tax_amount: number; grand_total: number
  paid_cash: number; paid_card: number; paid_credit: number
  notes?: string | null; reserve_stock?: boolean
  created_at: string; posted_at?: string | null; voided_at?: string | null; void_reason?: string | null
  created_by_name?: string | null; lines_count: number
}

const STATUS_BADGE: Record<string, string> = {
  posted: 'bg-success/10 text-success',
  voided: 'bg-danger/10 text-danger',
  open: 'bg-primary/10 text-primary',
  converted: 'bg-success/10 text-success',
  cancelled: 'bg-danger/10 text-danger',
}
const STATUS_LABEL: Record<string, string> = {
  posted: 'مُرحّلة', voided: 'ملغاة', open: 'مفتوح', converted: 'محوَّل لفاتورة', cancelled: 'ملغي',
}

export function SahlInvoicesPage() {
  const nav = useNavigate()
  const canManage = useCapability('sahl.sales.manage')

  const [docs, setDocs] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [kindFilter, setKindFilter] = useState<'all' | 'sale' | 'quote'>('all')
  const [statusFilter, setStatusFilter] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')

  const [detail, setDetail] = useState<InvoiceRow | null>(null)
  const [items, setItems] = useState<any[]>([])
  const [paper, setPaper] = useState<'80mm' | 'A4'>('80mm')
  const [voidReason, setVoidReason] = useState('')
  const [cvCash, setCvCash] = useState('')
  const [cvCard, setCvCard] = useState('')
  const [busy, setBusy] = useState(false)

  async function loadData() {
    const token = getToken()
    if (!token) return
    setLoading(true)
    const res = await supabase.rpc('sahl_get_invoices', {
      p_token: token,
      p_kind: kindFilter === 'all' ? null : kindFilter,
      p_from: from || null, p_to: to || null,
      p_status: statusFilter || null, p_search: search.trim() || null,
    })
    if (res.error) toast.error(res.error.message)
    else if ((res.data as any)?.error) toast.error((res.data as any).error)
    else setDocs((res.data || []) as InvoiceRow[])
    setLoading(false)
  }

  useEffect(() => { loadData() }, [kindFilter])

  async function openDetail(d: InvoiceRow) {
    setDetail(d); setItems([]); setVoidReason(''); setCvCash(String(d.paid_cash ?? '')); setCvCard(String(d.paid_card ?? ''))
    const token = getToken()
    if (!token) return
    const res = await supabase.rpc('sahl_get_invoice_items', { p_token: token, p_invoice_id: d.id })
    if (!res.error && !res.data?.error) setItems((res.data || []) as any[])
  }

  async function doPrint(d: InvoiceRow) {
    const token = getToken()
    if (!token || items.length === 0) return
    printSahlDoc({
      code: d.code, kind: d.kind, status: d.status, created_at: d.created_at,
      customer_name: d.customer_name, store_name: d.store_name,
      subtotal: d.subtotal, discount_amount: d.discount_amount,
      additions_amount: d.additions_amount, additions_type: d.additions_type,
      tax_amount: d.tax_amount, grand_total: d.grand_total,
      paid_cash: d.paid_cash, paid_card: d.paid_card, paid_credit: d.paid_credit,
      notes: d.notes,
    }, items.map(i => ({
      product_name: i.product_name, unit_label: i.unit_label,
      qty: i.qty, unit_price: i.unit_price, line_total: i.line_total,
    })), paper)
  }

  async function doVoid() {
    const token = getToken()
    if (!token || !detail) return
    if (!confirm(`إلغاء الفاتورة ${detail.code}؟ سيتم إرجاع الكمية للمخزون وعكس أثر الخزينة والحساب.`)) return
    setBusy(true)
    const res = await supabase.rpc('sahl_void_invoice', {
      p_token: token, p_invoice_id: detail.id, p_reason: voidReason.trim() || null,
    })
    setBusy(false)
    const data = res.data as any
    if (res.error) return toast.error(res.error.message)
    if (data?.error) return toast.error(data.error)
    toast.success(`تم إلغاء الفاتورة ${data.code}`)
    setDetail(null); loadData()
  }

  async function convertQuote() {
    const token = getToken()
    if (!token || !detail) return
    setBusy(true)
    const res = await supabase.rpc('sahl_convert_quote', {
      p_token: token, p_quote_id: detail.id,
      p_paid_cash: Number(cvCash) || 0, p_paid_card: Number(cvCard) || 0,
    })
    setBusy(false)
    const data = res.data as any
    if (res.error) return toast.error(res.error.message)
    if (data?.error) return toast.error(data.error)
    toast.success(`تم التحويل — فاتورة ${data.invoice_code}`)
    setDetail(null); loadData()
  }

  async function cancelQuote() {
    const token = getToken()
    if (!token || !detail) return
    if (!confirm(`إلغاء عرض السعر ${detail.code}؟`)) return
    setBusy(true)
    const res = await supabase.rpc('sahl_cancel_quote', { p_token: token, p_quote_id: detail.id })
    setBusy(false)
    const data = res.data as any
    if (res.error) return toast.error(res.error.message)
    if (data?.error) return toast.error(data.error)
    toast.success('تم إلغاء العرض وتحرير الحجز')
    setDetail(null); loadData()
  }

  const totals = useMemo(() => ({
    sales: docs.filter(d => d.kind === 'sale' && d.status === 'posted').reduce((s, d) => s + Number(d.grand_total), 0),
    quotes: docs.filter(d => d.kind === 'quote' && d.status === 'open').reduce((s, d) => s + Number(d.grand_total), 0),
  }), [docs])

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => nav('/sahl')} className="text-text-secondary text-lg">&rarr;</button>
          <div>
            <h1 className="text-lg font-bold text-text">الفواتير وعروض الأسعار</h1>
            <p className="text-[10px] text-text-secondary">سجل المبيعات — عرض وطباعة وإلغاء وتحويل</p>
          </div>
        </div>
        <button onClick={() => nav('/sahl/pos')} className="text-xs px-3 py-2 rounded-lg bg-primary text-white font-bold">+ فاتورة جديدة</button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="text-[10px] text-text-secondary">إجمالي المبيعات المُرحّلة</div>
          <div className="text-lg font-bold text-green-700 mt-1">{formatCurrencyShort(totals.sales)}</div>
        </div>
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="text-[10px] text-text-secondary">عروض مفتوحة</div>
          <div className="text-lg font-bold text-text mt-1">{formatCurrencyShort(totals.quotes)}</div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 bg-surface border-b border-border flex flex-wrap items-center gap-2">
          <div className="flex gap-1.5">
            {([['all', 'الكل'], ['sale', 'فواتير'], ['quote', 'عروض']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setKindFilter(k)}
                className={`text-[10px] px-2 py-1 rounded ${kindFilter === k ? 'bg-primary text-white' : 'border border-border text-text-secondary'}`}>
                {label}
              </button>
            ))}
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="text-[10px] border border-border rounded px-2 py-1 bg-white">
            <option value="">كل الحالات</option>
            <option value="posted">مُرحّلة</option>
            <option value="voided">ملغاة</option>
            <option value="open">عروض مفتوحة</option>
            <option value="converted">محوّلة</option>
            <option value="cancelled">عروض ملغاة</option>
          </select>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="text-[10px] border border-border rounded px-2 py-1" />
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="text-[10px] border border-border rounded px-2 py-1" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="كود / عميل"
            onKeyDown={e => { if (e.key === 'Enter') loadData() }}
            className="text-[10px] border border-border rounded px-2 py-1 w-36" />
          <button onClick={loadData} className="text-[10px] text-primary border border-border rounded px-2 py-1">بحث</button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
        ) : docs.length === 0 ? (
          <div className="text-center py-12 text-text-secondary text-sm">لا توجد مستندات</div>
        ) : (
          <div className="divide-y divide-border/60 max-h-[560px] overflow-y-auto">
            {docs.map(d => (
              <button key={d.id} onClick={() => openDetail(d)}
                className="w-full text-right px-5 py-3 hover:bg-surface/60 transition-colors flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-text">{d.code}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${d.kind === 'sale' ? 'bg-primary/10 text-primary' : 'bg-surface text-text-secondary'}`}>
                      {d.kind === 'sale' ? 'بيع' : 'عرض سعر'}
                    </span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${STATUS_BADGE[d.status] || ''}`}>{STATUS_LABEL[d.status] || d.status}</span>
                  </div>
                  <div className="text-[10px] text-text-secondary mt-0.5 truncate">
                    {d.customer_name || 'بدون عميل'} • {d.lines_count} صنف • {formatDate(d.created_at)}{d.created_by_name ? ` • ${d.created_by_name}` : ''}
                  </div>
                </div>
                <div className="text-left shrink-0">
                  <div className="text-sm font-bold text-text">{formatCurrencyShort(d.grand_total)}</div>
                  {d.kind === 'sale' && Number(d.paid_credit) > 0 && (
                    <div className="text-[9px] text-danger">آجل {formatCurrencyShort(d.paid_credit)}</div>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* detail dialog */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[88vh] overflow-y-auto" onClick={e => e.stopPropagation()} dir="rtl">
            <div className="sticky top-0 bg-gradient-to-l from-primary to-primary-dark text-white px-5 py-4 flex items-start justify-between">
              <div>
                <h3 className="font-bold text-base">{detail.kind === 'sale' ? 'فاتورة بيع' : 'عرض سعر'} {detail.code}</h3>
                <p className="text-[10px] text-white/80 mt-0.5">
                  {detail.customer_name || 'بدون عميل'} • {formatDate(detail.created_at)} • مخزن: {detail.store_name || '—'}
                </p>
              </div>
              <span className={`text-[10px] px-2 py-1 rounded ${STATUS_BADGE[detail.status] || 'bg-white/20'}`}>{STATUS_LABEL[detail.status]}</span>
            </div>

            <div className="p-5 space-y-4">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-border text-text-secondary">
                  <th className="py-1.5 text-right font-semibold">الصنف</th>
                  <th className="py-1.5 text-center font-semibold">الوحدة</th>
                  <th className="py-1.5 text-center font-semibold">كمية</th>
                  <th className="py-1.5 text-left font-semibold">سعر</th>
                  <th className="py-1.5 text-left font-semibold">إجمالي</th>
                </tr></thead>
                <tbody>
                  {items.map((i: any) => (
                    <tr key={i.id} className="border-b border-border/40">
                      <td className="py-1.5">{i.product_name}</td>
                      <td className="py-1.5 text-center">{i.unit_label}</td>
                      <td className="py-1.5 text-center">{Number(i.qty)}</td>
                      <td className="py-1.5 text-left">{formatCurrencyShort(i.unit_price)}</td>
                      <td className="py-1.5 text-left font-bold">{formatCurrencyShort(i.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs bg-surface/60 rounded-xl p-4">
                <div className="flex justify-between"><span className="text-text-secondary">الإجمالي الفرعي</span><b>{formatCurrencyShort(detail.subtotal)}</b></div>
                <div className="flex justify-between"><span className="text-text-secondary">الخصم</span><b>{formatCurrencyShort(detail.discount_amount)}</b></div>
                {Number(detail.additions_amount) > 0 && (
                  <div className="flex justify-between"><span className="text-text-secondary">إضافات{detail.additions_type ? ` (${detail.additions_type})` : ''}</span><b>{formatCurrencyShort(detail.additions_amount)}</b></div>
                )}
                <div className="flex justify-between"><span className="text-text-secondary">الضريبة</span><b>{formatCurrencyShort(detail.tax_amount)}</b></div>
                <div className="flex justify-between col-span-2 border-t border-border pt-1.5">
                  <span className="font-bold">الإجمالي</span><b className="text-base text-primary">{formatCurrencyShort(detail.grand_total)}</b>
                </div>
                {detail.kind === 'sale' && (
                  <div className="col-span-2 text-[10px] text-text-secondary">
                    نقدية {formatCurrencyShort(detail.paid_cash)}{detail.cash_treasury_name ? ` (${detail.cash_treasury_name})` : ''} • بطاقة {formatCurrencyShort(detail.paid_card)}{detail.card_treasury_name ? ` (${detail.card_treasury_name})` : ''} • آجل {formatCurrencyShort(detail.paid_credit)}
                  </div>
                )}
                {detail.notes && <div className="col-span-2 text-[10px]">ملاحظات: {detail.notes}</div>}
                {detail.status === 'voided' && (
                  <div className="col-span-2 text-[10px] text-danger">أُلغيت في {formatDate(detail.voided_at || '')}{detail.void_reason ? ` — السبب: ${detail.void_reason}` : ''}</div>
                )}
              </div>

              {/* actions */}
              <div className="flex flex-wrap gap-2 items-center">
                <select value={paper} onChange={e => setPaper(e.target.value as '80mm' | 'A4')}
                  className="text-xs border border-border rounded-lg px-2 py-2 bg-white">
                  <option value="80mm">حراري 80mm</option>
                  <option value="A4">A4</option>
                </select>
                <button onClick={() => { if (detail) doPrint(detail) }} disabled={items.length === 0}
                  className="text-xs px-4 py-2 rounded-lg bg-primary text-white font-bold disabled:opacity-50">طباعة</button>

                {canManage && detail.kind === 'sale' && detail.status === 'posted' && (
                  <div className="flex gap-2 mr-auto">
                    <input value={voidReason} onChange={e => setVoidReason(e.target.value)} placeholder="سبب الإلغاء"
                      className="text-xs border border-border rounded-lg px-2 py-2 w-40" />
                    <button onClick={doVoid} disabled={busy}
                      className="text-xs px-4 py-2 rounded-lg bg-danger text-white font-bold disabled:opacity-50">إلغاء الفاتورة</button>
                  </div>
                )}

                {canManage && detail.kind === 'quote' && detail.status === 'open' && (
                  <>
                    <div className="w-full grid grid-cols-2 gap-2 pt-2 border-t border-border/60">
                      <label><span className="text-[10px] text-text-secondary block mb-1">نقدية عند التحويل</span>
                        <input type="number" min="0" step="0.01" value={cvCash} onChange={e => setCvCash(e.target.value)}
                          className="w-full text-sm border border-border rounded-lg px-3 py-2" /></label>
                      <label><span className="text-[10px] text-text-secondary block mb-1">بطاقة عند التحويل</span>
                        <input type="number" min="0" step="0.01" value={cvCard} onChange={e => setCvCard(e.target.value)}
                          className="w-full text-sm border border-border rounded-lg px-3 py-2" /></label>
                    </div>
                    <div className="flex gap-2 w-full">
                      <button onClick={convertQuote} disabled={busy}
                        className="flex-1 text-xs px-4 py-2 rounded-lg bg-success text-white font-bold disabled:opacity-50">تحويل لفاتورة بيع</button>
                      <button onClick={cancelQuote} disabled={busy}
                        className="text-xs px-4 py-2 rounded-lg border border-danger/40 text-danger font-bold disabled:opacity-50">إلغاء العرض</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
