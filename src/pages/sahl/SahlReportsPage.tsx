import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort, formatDate } from '../../utils/format'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface TreasurySourceRow { reference_type: string; inflow?: number; outflow?: number; movements?: number }
interface DailyReport {
  date: string
  sales: { orders_count?: number; total?: number }
  opening_balance: number
  treasury_by_source: TreasurySourceRow[] | null
  inflow_total: number
  outflow_total: number
  collections_count: number
  expenses_count: number
  purchases_count: number
  sales_returns_count: number
  purchase_returns_count: number
  advances_count: number
  cheques_cleared_in: number
  cheques_cleared_out: number
}
interface FinSummary {
  from: string; to: string
  inflow_total: number; outflow_total: number
  treasury_by_source: TreasurySourceRow[] | null
  sales_total: number; orders_count: number; expenses_total: number
  receivables: number; payables: number; inventory_value: number
  installments_outstanding: number; installments_overdue_parts: number
  cheques_incoming_open: number; cheques_outgoing_open: number
}
interface TopCustomerRow { customer_id: string; customer_name: string; orders_count: number; total: number }
interface TopProductRow { product_id: string; product_name: string; pieces_sold: number; total: number }
interface SalesReport {
  from: string; to: string
  totals: {
    invoices_count?: number; sales_total?: number
    cash_total?: number; card_total?: number; credit_total?: number
    quotes_open?: number; quotes_value?: number
    voided_count?: number; voided_total?: number
  }
  by_day: Array<{ day: string; count: number; total: number; cash: number; card: number; credit: number }> | null
  top_items: Array<{ product_id: string; product_name: string; pieces: number; line_total: number }> | null
}
interface DuePartRow {
  id: string; plan_code: string; customer_name: string; part_number: number
  amount: number; paid_amount: number; remaining: number; due_date: string
  overdue: boolean; days_until_due: number
}
interface ChequeDueRow { id: string; direction: string; status: string; amount: number; due_date?: string; cheque_number?: string; bank_name?: string; party_name?: string }
interface StoreStockRow { product_id: string; product_name: string; legacy_code?: string; store_qty: number; total_qty: number; carton_quantity?: number }
interface StoreOption { id: string; name: string }

const REF_LABEL: Record<string, string> = {
  collection: 'تحصيلات عملاء',
  expense: 'مصروفات',
  employee_advance: 'سلف موظفين',
  purchase: 'مشتريات',
  supplier_payment: 'صرف للموردين',
  purchase_return: 'مرتجعات شراء',
  advance_settlement: 'تسويات سلف',
  cheque: 'شيكات',
  sale: 'مبيعات نقدي',
  sale_card: 'مبيعات شبكة',
  sale_void: 'إلغاء فاتورة',
  sale_void_card: 'إلغاء فاتورة (شبكة)',
  treasury_transfer_out: 'تحويل بين الخزائن (خارج)',
  treasury_transfer_in: 'تحويل بين الخزائن (داخل)',
}

function monthStart(): string {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function SahlReportsPage() {
  const nav = useNavigate()
  const [tab, setTab] = useState<'daily' | 'financial' | 'tops' | 'sales' | 'due' | 'stock'>('daily')

  const [dayDate, setDayDate] = useState(today())
  const [daily, setDaily] = useState<DailyReport | null>(null)
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(today())
  const [fin, setFin] = useState<FinSummary | null>(null)
  const [topCustomers, setTopCustomers] = useState<TopCustomerRow[]>([])
  const [topProducts, setTopProducts] = useState<TopProductRow[]>([])
  const [salesRep, setSalesRep] = useState<SalesReport | null>(null)
  const [dueParts, setDueParts] = useState<DuePartRow[]>([])
  const [dueDays, setDueDays] = useState(30)
  const [chequesDue, setChequesDue] = useState<ChequeDueRow[]>([])
  const [stockRows, setStockRows] = useState<StoreStockRow[]>([])
  const [stockStoreId, setStockStoreId] = useState('')
  const [stores, setStores] = useState<StoreOption[]>([])
  const [loading, setLoading] = useState(false)

  const loadDaily = async () => {
    const token = getToken()
    if (!token) return
    setLoading(true)
    const res = await supabase.rpc('sahl_get_daily_report', { p_token: token, p_date: dayDate })
    setLoading(false)
    if (res.error) { toast.error(res.error.message); return }
    const data = res.data as any
    if (data?.error) { toast.error(data.error); return }
    setDaily(data as DailyReport)
  }

  const loadFinancial = async () => {
    const token = getToken()
    if (!token) return
    setLoading(true)
    const [fRes, cRes, pRes] = await Promise.all([
      supabase.rpc('sahl_get_financial_summary', { p_token: token, p_from: from, p_to: to }),
      supabase.rpc('sahl_get_top_customers', { p_token: token, p_from: from, p_to: to }),
      supabase.rpc('sahl_get_top_products', { p_token: token, p_from: from, p_to: to }),
    ])
    setLoading(false)
    if (fRes.error) { toast.error(fRes.error.message); return }
    const fData = fRes.data as any
    if (fData?.error) { toast.error(fData.error); return }
    setFin(fData as FinSummary)
    if (!cRes.error && Array.isArray(cRes.data)) setTopCustomers(cRes.data as TopCustomerRow[])
    if (!pRes.error && Array.isArray(pRes.data)) setTopProducts(pRes.data as TopProductRow[])
  }

  const loadSales = async () => {
    const token = getToken()
    if (!token) return
    setLoading(true)
    const res = await supabase.rpc('sahl_get_sales_report', { p_token: token, p_from: from, p_to: to })
    setLoading(false)
    if (res.error) { toast.error(res.error.message); return }
    const data = res.data as any
    if (data?.error) { toast.error(data.error); return }
    setSalesRep(data as SalesReport)
  }

  const loadDue = async () => {
    const token = getToken()
    if (!token) return
    setLoading(true)
    const [dRes, qRes] = await Promise.all([
      supabase.rpc('sahl_get_due_installments', { p_token: token, p_days: dueDays }),
      supabase.rpc('sahl_get_cheques', { p_token: token }),
    ])
    setLoading(false)
    if (!dRes.error && Array.isArray(dRes.data)) setDueParts(dRes.data as DuePartRow[])
    else if (dRes.error) toast.error(dRes.error.message)
    if (!qRes.error && Array.isArray(qRes.data)) {
      const open = (qRes.data as ChequeDueRow[])
        .filter(c => c.status === 'pending' || c.status === 'deposited')
        .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))
      setChequesDue(open)
    }
  }

  const loadStock = async () => {
    const token = getToken()
    if (!token) return
    setLoading(true)
    const [sRes, stRes] = await Promise.all([
      supabase.rpc('sahl_get_store_stock', { p_token: token, p_store_id: stockStoreId || null }),
      supabase.rpc('sahl_get_stores', { p_token: token }),
    ])
    setLoading(false)
    if (sRes.error) { toast.error(sRes.error.message); return }
    if ((sRes.data as any)?.error) { toast.error((sRes.data as any).error); return }
    setStockRows(sRes.data as StoreStockRow[])
    if (!stRes.error && Array.isArray(stRes.data))
      setStores((stRes.data as any[]).filter(s => s.is_active !== false).map(s => ({ id: s.id, name: s.name })))
  }

  useEffect(() => { if (tab === 'financial' || tab === 'tops') loadFinancial() }, [tab])
  useEffect(() => { if (tab === 'daily') loadDaily() }, [tab])
  useEffect(() => { if (tab === 'sales') loadSales() }, [tab])
  useEffect(() => { if (tab === 'due') loadDue() }, [tab])
  useEffect(() => { if (tab === 'stock') loadStock() }, [tab])

  useEffect(() => { loadDaily() }, [])

  const closing = useMemo(() => {
    if (!daily) return 0
    return Number(daily.opening_balance || 0) + Number(daily.inflow_total || 0) - Number(daily.outflow_total || 0)
  }, [daily])

  const netFlow = useMemo(() => {
    if (!fin) return 0
    return Number(fin.inflow_total || 0) - Number(fin.outflow_total || 0)
  }, [fin])

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => nav('/sahl')} className="text-text-secondary text-lg">&rarr;</button>
          <div>
            <h1 className="text-lg font-bold text-text">التقارير</h1>
            <p className="text-[10px] text-text-secondary">التقارير المالية والتشغيلية لمساحة سهل</p>
          </div>
        </div>
        <button onClick={() => {
          if (tab === 'daily') loadDaily()
          else if (tab === 'sales') loadSales()
          else if (tab === 'due') loadDue()
          else if (tab === 'stock') loadStock()
          else loadFinancial()
        }} disabled={loading}
          className="text-[10px] text-primary border border-border rounded px-2 py-1">تحديث</button>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {([['daily', 'اليومي'], ['financial', 'المالي'], ['tops', 'الأكثر مبيعاً'], ['sales', 'تحليل المبيعات'], ['due', 'الاستحقاقات'], ['stock', 'مخزون المخازن']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`flex-1 rounded-xl py-2 text-[10px] md:text-xs font-bold transition-colors whitespace-nowrap ${tab === k ? 'bg-slate-700 text-white' : 'bg-white border border-border text-text-secondary'}`}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-16 text-text-secondary text-sm">جاري التحميل...</div>
      ) : tab === 'daily' ? (
        <>
          <div className="bg-white rounded-2xl border border-border shadow-sm px-5 py-3 flex items-center gap-3">
            <label className="text-xs font-semibold text-text-secondary shrink-0">تاريخ التقرير</label>
            <input type="date" value={dayDate} onChange={(e) => setDayDate(e.target.value)}
              className="border border-border rounded-lg px-3 py-2 text-sm bg-white" />
            <button onClick={loadDaily} className="text-[11px] bg-slate-700 text-white rounded-lg px-4 py-2 font-bold">عرض</button>
          </div>

          {daily && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="bg-white rounded-xl border border-border p-4">
                  <div className="text-[10px] text-text-secondary">مبيعات اليوم</div>
                  <div className="text-base font-bold text-text mt-1">{formatCurrencyShort(daily.sales?.total)}</div>
                  <div className="text-[10px] text-text-secondary">{daily.sales?.orders_count || 0} طلب</div>
                </div>
                <div className="bg-white rounded-xl border border-border p-4">
                  <div className="text-[10px] text-text-secondary">داخل للخزينة</div>
                  <div className="text-base font-bold text-green-700 mt-1">{formatCurrencyShort(daily.inflow_total)}</div>
                </div>
                <div className="bg-white rounded-xl border border-border p-4">
                  <div className="text-[10px] text-text-secondary">خارج من الخزينة</div>
                  <div className="text-base font-bold text-danger mt-1">{formatCurrencyShort(daily.outflow_total)}</div>
                </div>
                <div className="bg-white rounded-xl border border-border p-4">
                  <div className="text-[10px] text-text-secondary">رصيد أول المدة</div>
                  <div className="text-base font-bold text-text mt-1">{formatCurrencyShort(daily.opening_balance)}</div>
                </div>
                <div className="bg-white rounded-xl border border-border p-4">
                  <div className="text-[10px] text-text-secondary">رصيد آخر المدة</div>
                  <div className={`text-base font-bold mt-1 ${closing >= 0 ? 'text-emerald-700' : 'text-danger'}`}>{formatCurrencyShort(closing)}</div>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
                <div className="bg-surface px-5 py-3.5 border-b border-border">
                  <h2 className="text-sm font-bold text-text">💰 حركة الخزينة حسب المصدر — {formatDate(dayDate)}</h2>
                </div>
                {!daily.treasury_by_source?.length ? (
                  <div className="text-center py-10 text-text-secondary text-sm">لا حركات في هذا اليوم</div>
                ) : (
                  <table className="w-full text-right text-xs">
                    <thead>
                      <tr className="bg-white border-b border-border text-text-secondary">
                        <th className="px-5 py-2 font-semibold">المصدر</th>
                        <th className="px-5 py-2 font-semibold">داخل</th>
                        <th className="px-5 py-2 font-semibold">خارج</th>
                        <th className="px-5 py-2 font-semibold">حركات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {daily.treasury_by_source.map((s) => (
                        <tr key={s.reference_type}>
                          <td className="px-5 py-2 font-semibold text-text">{REF_LABEL[s.reference_type] || s.reference_type}</td>
                          <td className="px-5 py-2 text-green-700 font-bold">{Number(s.inflow) > 0 ? formatCurrencyShort(s.inflow) : '—'}</td>
                          <td className="px-5 py-2 text-danger font-bold">{Number(s.outflow) > 0 ? formatCurrencyShort(s.outflow) : '—'}</td>
                          <td className="px-5 py-2 text-text-secondary">{s.movements}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
                <div className="bg-surface px-5 py-3.5 border-b border-border">
                  <h2 className="text-sm font-bold text-text">📄 مستندات اليوم</h2>
                </div>
                <div className="grid grid-cols-3 md:grid-cols-6 divide-x divide-x-reverse divide-border/60">
                  <button onClick={() => nav('/sahl/receipts')} className="py-3 text-center hover:bg-surface/60 transition-colors">
                    <div className="text-[10px] text-text-secondary">سندات قبض</div>
                    <div className="text-base font-bold text-text mt-0.5">{daily.collections_count}</div>
                  </button>
                  <div className="py-3 text-center">
                    <div className="text-[10px] text-text-secondary">مصروفات</div>
                    <div className="text-base font-bold text-text mt-0.5">{daily.expenses_count}</div>
                  </div>
                  <div className="py-3 text-center">
                    <div className="text-[10px] text-text-secondary">فواتير شراء</div>
                    <div className="text-base font-bold text-text mt-0.5">{daily.purchases_count}</div>
                  </div>
                  <button onClick={() => nav('/sahl/returns')} className="py-3 text-center hover:bg-surface/60 transition-colors">
                    <div className="text-[10px] text-text-secondary">مرتجع بيع</div>
                    <div className="text-base font-bold text-text mt-0.5">{daily.sales_returns_count}</div>
                  </button>
                  <div className="py-3 text-center">
                    <div className="text-[10px] text-text-secondary">مرتجع شراء</div>
                    <div className="text-base font-bold text-text mt-0.5">{daily.purchase_returns_count}</div>
                  </div>
                  <div className="py-3 text-center">
                    <div className="text-[10px] text-text-secondary">سلف موظفين</div>
                    <div className="text-base font-bold text-text mt-0.5">{daily.advances_count}</div>
                  </div>
                </div>
                <div className="px-5 py-3 bg-surface/50 border-t border-border text-[11px] text-text-secondary flex gap-6">
                  <span>شيكات وردة حُصّلت: <b className="text-green-700">{formatCurrencyShort(daily.cheques_cleared_in)}</b></span>
                  <span>شيكات صادرة صُرفت: <b className="text-danger">{formatCurrencyShort(daily.cheques_cleared_out)}</b></span>
                </div>
              </div>
            </>
          )}
        </>
      ) : tab === 'financial' ? (
        <>
          <div className="bg-white rounded-2xl border border-border shadow-sm px-5 py-3 flex items-center gap-3 flex-wrap">
            <label className="text-xs font-semibold text-text-secondary shrink-0">من</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="border border-border rounded-lg px-3 py-2 text-sm bg-white" />
            <label className="text-xs font-semibold text-text-secondary shrink-0">إلى</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="border border-border rounded-lg px-3 py-2 text-sm bg-white" />
            <button onClick={loadFinancial} className="text-[11px] bg-slate-700 text-white rounded-lg px-4 py-2 font-bold">عرض</button>
          </div>

          {fin && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-white rounded-xl border border-border p-4">
                  <div className="text-[10px] text-text-secondary">إجمالي المبيعات</div>
                  <div className="text-base font-bold text-text mt-1">{formatCurrencyShort(fin.sales_total)}</div>
                  <div className="text-[10px] text-text-secondary">{fin.orders_count} طلب</div>
                </div>
                <div className="bg-white rounded-xl border border-border p-4">
                  <div className="text-[10px] text-text-secondary">داخل الخزينة</div>
                  <div className="text-base font-bold text-green-700 mt-1">{formatCurrencyShort(fin.inflow_total)}</div>
                </div>
                <div className="bg-white rounded-xl border border-border p-4">
                  <div className="text-[10px] text-text-secondary">خارج الخزينة</div>
                  <div className="text-base font-bold text-danger mt-1">{formatCurrencyShort(fin.outflow_total)}</div>
                </div>
                <div className="bg-white rounded-xl border border-border p-4">
                  <div className="text-[10px] text-text-secondary">صافي التدفق النقدي</div>
                  <div className={`text-base font-bold mt-1 ${netFlow >= 0 ? 'text-emerald-700' : 'text-danger'}`}>{formatCurrencyShort(netFlow)}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <button onClick={() => nav('/sahl/accounts')} className="bg-white rounded-xl border border-border p-4 text-left hover:border-primary/40 transition-colors">
                  <div className="text-[10px] text-text-secondary">مديونيات العملاء</div>
                  <div className={`text-base font-bold mt-1 text-danger`}>{formatCurrencyShort(fin.receivables)}</div>
                </button>
                <button onClick={() => nav('/sahl/suppliers')} className="bg-white rounded-xl border border-border p-4 text-left hover:border-primary/40 transition-colors">
                  <div className="text-[10px] text-text-secondary">مستحقات الموردين</div>
                  <div className={`text-base font-bold mt-1 text-danger`}>{formatCurrencyShort(fin.payables)}</div>
                </button>
                <button onClick={() => nav('/sahl/inventory')} className="bg-white rounded-xl border border-border p-4 text-left hover:border-primary/40 transition-colors">
                  <div className="text-[10px] text-text-secondary">قيمة المخزون</div>
                  <div className={`text-base font-bold mt-1 text-emerald-700`}>{formatCurrencyShort(fin.inventory_value)}</div>
                </button>
                <button onClick={() => nav('/sahl/installments')} className="bg-white rounded-xl border border-border p-4 text-left hover:border-primary/40 transition-colors">
                  <div className="text-[10px] text-text-secondary">متبقي أقساط</div>
                  <div className={`text-base font-bold mt-1 text-danger`}>{formatCurrencyShort(fin.installments_outstanding)}</div>
                </button>
                <button onClick={() => nav('/sahl/installments')} className={`bg-white rounded-xl border border-border p-4 text-left transition-colors ${fin.installments_overdue_parts > 0 ? 'hover:border-primary/40' : ''}`}>
                  <div className="text-[10px] text-text-secondary">أقساط متأخرة</div>
                  <div className={`text-base font-bold mt-1 ${fin.installments_overdue_parts > 0 ? 'text-accent' : 'text-text'}`}>{String(fin.installments_overdue_parts ?? 0) + ' قسط'}</div>
                </button>
                <div className="bg-white rounded-xl border border-border p-4">
                  <div className="text-[10px] text-text-secondary">مصروفات الفترة</div>
                  <div className={`text-base font-bold mt-1 text-danger`}>{formatCurrencyShort(fin.expenses_total)}</div>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
                <div className="bg-surface px-5 py-3.5 border-b border-border">
                  <h2 className="text-sm font-bold text-text">💰 تدفق الخزينة حسب المصدر ({formatDate(from)} — {formatDate(to)})</h2>
                </div>
                {!fin.treasury_by_source?.length ? (
                  <div className="text-center py-10 text-text-secondary text-sm">لا حركات في هذه الفترة</div>
                ) : (
                  <table className="w-full text-right text-xs">
                    <thead>
                      <tr className="bg-white border-b border-border text-text-secondary">
                        <th className="px-5 py-2 font-semibold">المصدر</th>
                        <th className="px-5 py-2 font-semibold">داخل</th>
                        <th className="px-5 py-2 font-semibold">خارج</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {fin.treasury_by_source.map((s) => (
                        <tr key={s.reference_type}>
                          <td className="px-5 py-2 font-semibold text-text">{REF_LABEL[s.reference_type] || s.reference_type}</td>
                          <td className="px-5 py-2 text-green-700 font-bold">{Number(s.inflow) > 0 ? formatCurrencyShort(s.inflow) : '—'}</td>
                          <td className="px-5 py-2 text-danger font-bold">{Number(s.outflow) > 0 ? formatCurrencyShort(s.outflow) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
                <div className="bg-surface px-5 py-3.5 border-b border-border flex items-center justify-between">
                  <h2 className="text-sm font-bold text-text">🧾 شيكات قيد التحصيل/الصرف</h2>
                </div>
                <div className="grid grid-cols-2 divide-x divide-x-reverse divide-border/60">
                  <div className="py-4 text-center">
                    <div className="text-[10px] text-text-secondary">واردة (من عملاء)</div>
                    <div className="text-lg font-bold text-green-700 mt-1">{formatCurrencyShort(fin.cheques_incoming_open)}</div>
                  </div>
                  <div className="py-4 text-center">
                    <div className="text-[10px] text-text-secondary">صادرة (لموردين)</div>
                    <div className="text-lg font-bold text-orange-600 mt-1">{formatCurrencyShort(fin.cheques_outgoing_open)}</div>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      ) : tab === 'sales' ? (
        <>
          <div className="bg-white rounded-2xl border border-border shadow-sm px-5 py-3 flex items-center gap-3 flex-wrap">
            <label className="text-xs font-semibold text-text-secondary shrink-0">من</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="border border-border rounded-lg px-3 py-2 text-sm bg-white" />
            <label className="text-xs font-semibold text-text-secondary shrink-0">إلى</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="border border-border rounded-lg px-3 py-2 text-sm bg-white" />
            <button onClick={loadSales} className="text-[11px] bg-slate-700 text-white rounded-lg px-4 py-2 font-bold">عرض</button>
          </div>

          {salesRep && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-white rounded-xl border border-border p-4">
                  <div className="text-[10px] text-text-secondary">إجمالي المبيعات</div>
                  <div className="text-base font-bold text-emerald-700 mt-1">{formatCurrencyShort(salesRep.totals?.sales_total)}</div>
                  <div className="text-[10px] text-text-secondary">{salesRep.totals?.invoices_count || 0} فاتورة</div>
                </div>
                {[
                  ['نقدي', salesRep.totals?.cash_total, 'text-text'],
                  ['شبكة', salesRep.totals?.card_total, 'text-indigo-700'],
                  ['آجل', salesRep.totals?.credit_total, 'text-danger'],
                ].map(([l, v, c]) => (
                  <div key={String(l)} className="bg-white rounded-xl border border-border p-4">
                    <div className="text-[10px] text-text-secondary">تحصيل {l as string}</div>
                    <div className={`text-base font-bold mt-1 ${c}`}>{formatCurrencyShort(Number(v) || 0)}</div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="bg-white rounded-xl border border-border p-4 text-center">
                  <div className="text-[10px] text-text-secondary">عروض مفتوحة</div>
                  <div className="text-sm font-bold text-text mt-1">{salesRep.totals?.quotes_open || 0}</div>
                  <div className="text-[10px] text-text-secondary">{formatCurrencyShort(salesRep.totals?.quotes_value)}</div>
                </div>
                <div className="bg-white rounded-xl border border-border p-4 text-center">
                  <div className="text-[10px] text-text-secondary">فواتير ملغاة</div>
                  <div className="text-sm font-bold text-danger mt-1">{salesRep.totals?.voided_count || 0}</div>
                  <div className="text-[10px] text-text-secondary">{formatCurrencyShort(salesRep.totals?.voided_total)}</div>
                </div>
                <div className="bg-white rounded-xl border border-border p-4 text-center">
                  <div className="text-[10px] text-text-secondary">متوسط الفاتورة</div>
                  <div className="text-sm font-bold text-text mt-1">
                    {formatCurrencyShort((salesRep.totals?.invoices_count || 0) > 0
                      ? Number(salesRep.totals?.sales_total || 0) / Number(salesRep.totals!.invoices_count!) : 0)}
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
                <div className="bg-gradient-to-l from-emerald-800 to-emerald-600 px-5 py-3">
                  <h2 className="text-sm font-bold text-white">📈 المبيعات يومياً ({formatDate(from)} — {formatDate(to)})</h2>
                </div>
                {!salesRep.by_day?.length ? (
                  <div className="text-center py-10 text-text-secondary text-sm">لا مبيعات في هذه الفترة</div>
                ) : (
                  <table className="w-full text-right text-xs">
                    <thead>
                      <tr className="bg-white border-b border-border text-text-secondary">
                        <th className="px-5 py-2 font-semibold">اليوم</th>
                        <th className="px-5 py-2 font-semibold">فواتير</th>
                        <th className="px-5 py-2 font-semibold">الإجمالي</th>
                        <th className="px-5 py-2 font-semibold">نقدي</th>
                        <th className="px-5 py-2 font-semibold">شبكة</th>
                        <th className="px-5 py-2 font-semibold">آجل</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {salesRep.by_day.map((d) => (
                        <tr key={d.day}>
                          <td className="px-5 py-2 font-semibold text-text">{formatDate(d.day)}</td>
                          <td className="px-5 py-2 text-text-secondary">{d.count}</td>
                          <td className="px-5 py-2 font-bold text-emerald-700">{formatCurrencyShort(d.total)}</td>
                          <td className="px-5 py-2">{Number(d.cash) > 0 ? formatCurrencyShort(d.cash) : '—'}</td>
                          <td className="px-5 py-2">{Number(d.card) > 0 ? formatCurrencyShort(d.card) : '—'}</td>
                          <td className="px-5 py-2">{Number(d.credit) > 0 ? formatCurrencyShort(d.credit) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
                <div className="bg-surface px-5 py-3.5 border-b border-border">
                  <h2 className="text-sm font-bold text-text">📦 الأصناف الأكثر تحقيقاً للإيراد</h2>
                </div>
                {!salesRep.top_items?.length ? (
                  <div className="text-center py-10 text-text-secondary text-sm">لا بيانات في هذه الفترة</div>
                ) : (
                  <div className="divide-y divide-border/60">
                    {salesRep.top_items.map((p, i) => (
                      <div key={p.product_id} className="px-5 py-2.5 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="h-6 w-6 rounded-full bg-surface flex items-center justify-center text-[10px] font-bold text-text-secondary shrink-0">{i + 1}</span>
                          <span className="text-sm font-semibold text-text truncate">{p.product_name}</span>
                        </div>
                        <div className="shrink-0 text-left flex items-center gap-4">
                          <span className="text-[10px] text-text-secondary">{(p.pieces || 0).toLocaleString()} قطعة</span>
                          <span className="text-xs font-bold text-text">{formatCurrencyShort(p.line_total)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      ) : tab === 'due' ? (
        <>
          <div className="bg-white rounded-2xl border border-border shadow-sm px-5 py-3 flex items-center gap-3">
            <label className="text-xs font-semibold text-text-secondary shrink-0">أقساط تستحق خلال</label>
            <select value={dueDays} onChange={(e) => setDueDays(Number(e.target.value))}
              className="border border-border rounded-lg px-3 py-2 text-sm bg-white">
              <option value={7}>7 أيام</option>
              <option value={30}>30 يوماً</option>
              <option value={60}>60 يوماً</option>
              <option value={365}>سنة</option>
            </select>
            <button onClick={loadDue} className="text-[11px] bg-slate-700 text-white rounded-lg px-4 py-2 font-bold">عرض</button>
          </div>

          <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
            <div className="bg-surface px-5 py-3.5 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-bold text-text">📅 أقساط مستحقة / متأخرة</h2>
              <span className="text-[10px] text-text-secondary">{dueParts.length} قسط</span>
            </div>
            {dueParts.length === 0 ? (
              <div className="text-center py-10 text-text-secondary text-sm">لا أقساط مستحقة خلال المدة</div>
            ) : (
              <div className="divide-y divide-border/60 max-h-[420px] overflow-y-auto">
                {dueParts.map((d) => (
                  <div key={d.id} className="px-5 py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-[9px] font-bold rounded px-1.5 py-0.5 ${d.overdue ? 'bg-red-100 text-red-700' : 'bg-surface text-text-secondary'}`}>
                          {d.overdue ? `متأخر ${Math.abs(d.days_until_due)} يوم` : `بعد ${d.days_until_due} يوم`}
                        </span>
                        <span className="text-sm font-semibold text-text truncate">{d.customer_name}</span>
                      </div>
                      <div className="text-[10px] text-text-secondary mt-0.5">{d.plan_code} — قسط {d.part_number} — استحقاق {formatDate(d.due_date)}</div>
                    </div>
                    <div className="shrink-0 text-left">
                      <div className="text-xs font-bold text-danger">{formatCurrencyShort(d.remaining)}</div>
                      <div className="text-[10px] text-text-secondary">من {formatCurrencyShort(d.amount)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
            <div className="bg-surface px-5 py-3.5 border-b border-border">
              <h2 className="text-sm font-bold text-text">🧾 شيكات قائمة (مرتبة بالاستحقاق)</h2>
            </div>
            {chequesDue.length === 0 ? (
              <div className="text-center py-10 text-text-secondary text-sm">لا شيكات قائمة</div>
            ) : (
              <div className="divide-y divide-border/60 max-h-[360px] overflow-y-auto">
                {chequesDue.map((ch) => {
                  const overdue = ch.due_date && String(ch.due_date) < new Date().toISOString().slice(0, 10)
                  return (
                    <div key={ch.id} className="px-5 py-2.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-[9px] font-bold rounded px-1.5 py-0.5 ${ch.direction === 'incoming' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                            {ch.direction === 'incoming' ? 'وارد' : 'صادر'}
                          </span>
                          {overdue && <span className="text-[9px] font-bold rounded px-1.5 py-0.5 bg-red-100 text-red-700">تجاوز الاستحقاق</span>}
                          <span className="text-sm font-semibold text-text truncate">{ch.party_name || '—'}</span>
                        </div>
                        <div className="text-[10px] text-text-secondary mt-0.5">
                          شيك {ch.cheque_number || '—'}{ch.bank_name ? ` — ${ch.bank_name}` : ''}{ch.due_date ? ` — استحقاق ${formatDate(ch.due_date)}` : ''}
                        </div>
                      </div>
                      <div className="shrink-0 text-xs font-bold text-text">{formatCurrencyShort(ch.amount)}</div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      ) : tab === 'stock' ? (
        <>
          <div className="bg-white rounded-2xl border border-border shadow-sm px-5 py-3 flex items-center gap-3">
            <label className="text-xs font-semibold text-text-secondary shrink-0">المخزن</label>
            <select value={stockStoreId} onChange={(e) => setStockStoreId(e.target.value)}
              className="border border-border rounded-lg px-3 py-2 text-sm bg-white min-w-[140px]">
              <option value="">المخزن الرئيسي</option>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button onClick={loadStock} className="text-[11px] bg-slate-700 text-white rounded-lg px-4 py-2 font-bold">عرض</button>
          </div>

          <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
            <div className="bg-surface px-5 py-3.5 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-bold text-text">🏬 أرصدة الأصناف بالمخزن</h2>
              <span className="text-[10px] text-text-secondary">{stockRows.length} صنف</span>
            </div>
            {stockRows.length === 0 ? (
              <div className="text-center py-10 text-text-secondary text-sm">لا أصناف</div>
            ) : (
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="bg-white border-b border-border text-text-secondary">
                    <th className="px-5 py-2 font-semibold">الصنف</th>
                    <th className="px-5 py-2 font-semibold">كود</th>
                    <th className="px-5 py-2 font-semibold">رصيد المخزن</th>
                    <th className="px-5 py-2 font-semibold">إجمالي الشركة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60 max-h-[480px] overflow-y-auto">
                  {stockRows.map((r) => {
                    const cartons = r.carton_quantity && r.store_qty > 0
                      ? `${Math.floor(r.store_qty / r.carton_quantity)}كرتونة${' + '}${r.store_qty % r.carton_quantity}قطعة` : null
                    return (
                      <tr key={r.product_id}>
                        <td className="px-5 py-2 font-semibold text-text truncate max-w-[220px]">{r.product_name}</td>
                        <td className="px-5 py-2 text-text-secondary">{r.legacy_code || '—'}</td>
                        <td className="px-5 py-2 font-bold text-text">
                          {r.store_qty.toLocaleString()}
                          {cartons && <span className="text-[10px] font-normal text-text-secondary mr-1">({cartons})</span>}
                        </td>
                        <td className="px-5 py-2 text-text-secondary">{r.total_qty?.toLocaleString()}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-border shadow-sm px-5 py-3 flex items-center gap-3 flex-wrap">
            <label className="text-xs font-semibold text-text-secondary shrink-0">من</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="border border-border rounded-lg px-3 py-2 text-sm bg-white" />
            <label className="text-xs font-semibold text-text-secondary shrink-0">إلى</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="border border-border rounded-lg px-3 py-2 text-sm bg-white" />
            <button onClick={loadFinancial} className="text-[11px] bg-slate-700 text-white rounded-lg px-4 py-2 font-bold">عرض</button>
          </div>

          <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
            <div className="bg-gradient-to-l from-indigo-700 to-indigo-600 px-5 py-3">
              <h2 className="text-sm font-bold text-white">🏆 أفضل 10 عملاء</h2>
            </div>
            {topCustomers.length === 0 ? (
              <div className="text-center py-10 text-text-secondary text-sm">لا بيانات في هذه الفترة</div>
            ) : (
              <div className="divide-y divide-border/60">
                {topCustomers.map((c, i) => (
                  <div key={c.customer_id} className="px-5 py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                        i === 0 ? 'bg-yellow-400 text-yellow-900' : i === 1 ? 'bg-gray-300 text-gray-700' : i === 2 ? 'bg-orange-200 text-orange-800' : 'bg-surface text-text-secondary'}`}>
                        {i + 1}
                      </span>
                      <span className="text-sm font-semibold text-text truncate">{c.customer_name}</span>
                    </div>
                    <div className="shrink-0 text-left flex items-center gap-4">
                      <span className="text-[10px] text-text-secondary">{c.orders_count} طلب</span>
                      <span className="text-xs font-bold text-text">{formatCurrencyShort(c.total)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
            <div className="bg-gradient-to-l from-cyan-800 to-cyan-600 px-5 py-3">
              <h2 className="text-sm font-bold text-white">📦 أفضل 10 أصناف</h2>
            </div>
            {topProducts.length === 0 ? (
              <div className="text-center py-10 text-text-secondary text-sm">لا بيانات في هذه الفترة</div>
            ) : (
              <div className="divide-y divide-border/60">
                {topProducts.map((p, i) => (
                  <div key={p.product_id} className="px-5 py-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                        i === 0 ? 'bg-yellow-400 text-yellow-900' : i === 1 ? 'bg-gray-300 text-gray-700' : i === 2 ? 'bg-orange-200 text-orange-800' : 'bg-surface text-text-secondary'}`}>
                        {i + 1}
                      </span>
                      <span className="text-sm font-semibold text-text truncate">{p.product_name}</span>
                    </div>
                    <div className="shrink-0 text-left flex items-center gap-4">
                      <span className="text-[10px] text-text-secondary">{p.pieces_sold?.toLocaleString()} قطعة</span>
                      <span className="text-xs font-bold text-text">{formatCurrencyShort(p.total)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
