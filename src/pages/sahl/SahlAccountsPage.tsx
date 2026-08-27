import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort, formatDate } from '../../utils/format'
import { printSahlStatement } from './sahl-printing'
import { resolveDateRangeISO } from '../../lib/dateRange'
import SahlToolbar from '../../components/sahl/SahlToolbar'
import SahlKpiCard from '../../components/sahl/SahlKpiCard'
import SahlDetailPanel from '../../components/sahl/SahlDetailPanel'
import type { SahlDateFilterState } from '../../components/sahl/SahlDateFilter'
import { sahlExportExcel, sahlPrintReport, datePresetLabel } from './sahl-report'
import type { SahlReportColumn } from './sahl-report'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface CustomerRow {
  id: string
  code?: string
  company_name?: string
  phone?: string
  current_balance?: number | null
}

interface Movement {
  doc_type: 'order' | 'invoice' | 'return' | 'collection' | 'cheque'
  id: string
  code: string
  label: string
  amount: number
  direction: number
  status: string
  created_at: string
  running_balance: number
}

interface StatementComponents {
  sales_orders: number
  sales_invoices_credit: number
  sales_returns: number
  receipts: number
  incoming_cheques: number
  current_balance: number
}

interface Statement {
  customer?: { id: string; code?: string; company_name?: string; phone?: string }
  components?: StatementComponents
  balance_before?: number
  movements?: Movement[]
}

const docStatusLabels: Record<string, string> = {
  pending: 'معلق', approved: 'معتمد', treasury_posted: 'مرحّل للخزينة',
  posted: 'مرحّلة', deposited: 'مودَع', cleared: 'محصَّل', bounced: 'مرتد', cancelled: 'ملغي',
}

const docTypeLabels: Record<string, string> = {
  order: 'طلب بيع معتمد',
  invoice: 'فاتورة بيع آجل',
  return: 'مرتجع بيع',
  collection: 'سند قبض',
  cheque: 'شيك وارد ساري',
}

const ACCOUNTS_COLUMNS: SahlReportColumn[] = [
  { key: 'code', label: 'رقم المستند' },
  { key: 'doc_type', label: 'نوع المستند' },
  { key: 'label', label: 'الوصف' },
  { key: 'amount', label: 'المبلغ', format: 'currency' },
  { key: 'direction_label', label: 'الاتجاه' },
  { key: 'status', label: 'الحالة' },
  { key: 'created_at', label: 'التاريخ' },
  { key: 'running_balance', label: 'الرصيد', format: 'currency' },
]

type TabKey = 'statement' | 'sources' | 'invoices' | 'receipts' | 'returns' | 'cheques'

export function SahlAccountsPage() {
  const nav = useNavigate()
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [collections, setCollections] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [kpiFilter, setKpiFilter] = useState<'all' | 'debtors'>('all')

  const [activeCustomer, setActiveCustomer] = useState<CustomerRow | null>(null)
  const [statement, setStatement] = useState<Statement | null>(null)
  const [stmtLoading, setStmtLoading] = useState(false)
  const [tab, setTab] = useState<TabKey>('statement')

  const [fromInput, setFromInput] = useState('')
  const [toInput, setToInput] = useState('')
  const [period, setPeriod] = useState<{ from: string | null; to: string | null }>({ from: null, to: null })

  const [docDetail, setDocDetail] = useState<Movement | null>(null)
  const [docItems, setDocItems] = useState<any[]>([])
  const [docItemsLoading, setDocItemsLoading] = useState(false)

  // Global date filter for the customers list
  const [dateFilter, setDateFilter] = useState<SahlDateFilterState>({ preset: 'all', customFrom: '', customTo: '' })

  async function loadData() {
    const token = getToken()
    if (!token) return
    setLoading(true)
    const [custRes, colRes] = await Promise.all([
      supabase.rpc('get_governed_customers', { p_token: token }),
      supabase.rpc('get_governed_collections', { p_token: token }),
    ])
    if (custRes.data && Array.isArray(custRes.data)) setCustomers(custRes.data as CustomerRow[])
    else if (custRes.error) toast.error(custRes.error.message)
    if (colRes.data && Array.isArray(colRes.data)) setCollections(colRes.data as any[])
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  async function fetchStatement(custId: string, pFrom: string | null, pTo: string | null) {
    const token = getToken()
    if (!token) return
    setStmtLoading(true)
    const res = await supabase.rpc('sahl_get_customer_account_statement', {
      p_token: token,
      p_customer_id: custId,
      p_date_from: pFrom,
      p_date_to: pTo,
    })
    setStmtLoading(false)
    if (res.error) { toast.error(res.error.message); return }
    const data = res.data as any
    if (data?.error) { toast.error(data.error); return }
    setStatement(data as Statement)
  }

  function openWorkspace(cust: CustomerRow) {
    setActiveCustomer(cust)
    setStatement(null)
    setDocDetail(null)
    setTab('statement')
    setFromInput(''); setToInput('')
    setPeriod({ from: null, to: null })
    fetchStatement(cust.id, null, null)
  }

  function applyPeriod() {
    if (!activeCustomer) return
    const from = fromInput ? new Date(`${fromInput}T00:00:00`).toISOString() : null
    const to = toInput ? new Date(`${toInput}T23:59:59.999`).toISOString() : null
    setPeriod({ from, to })
    fetchStatement(activeCustomer.id, from, to)
  }

  function clearPeriod() {
    if (!activeCustomer) return
    setFromInput(''); setToInput('')
    setPeriod({ from: null, to: null })
    fetchStatement(activeCustomer.id, null, null)
  }

  async function openDoc(m: Movement) {
    setDocDetail(m)
    setDocItems([])
    if (m.doc_type !== 'invoice') return
    const token = getToken()
    if (!token) return
    setDocItemsLoading(true)
    const res = await supabase.rpc('sahl_get_invoice_items', { p_token: token, p_invoice_id: m.id })
    setDocItemsLoading(false)
    if (!res.error && !res.data?.error) setDocItems((res.data || []) as any[])
  }

  const totals = useMemo(() => {
    let debt = 0, debtors = 0
    for (const c of customers) {
      const b = Number(c.current_balance || 0)
      if (b > 0) { debt += b; debtors++ }
    }
    return { debt, debtors }
  }, [customers])

  const filtered = useMemo(() => {
    let list = customers
    if (kpiFilter === 'debtors') list = customers.filter(c => Number(c.current_balance || 0) > 0)
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter((c) =>
        (c.company_name || '').toLowerCase().includes(q) ||
        (c.code || '').toLowerCase().includes(q) ||
        (c.phone || '').includes(q))
    }
    return [...list].sort((a, b) => (b.current_balance || 0) - (a.current_balance || 0))
  }, [customers, search, kpiFilter])

  const comp = statement?.components
  const movements = statement?.movements || []
  const opening = Number(statement?.balance_before || 0)
  const periodEnd = movements.length > 0 ? Number(movements[movements.length - 1].running_balance) : opening

  function movementsFor(docTypes: Movement['doc_type'][]) {
    return movements.filter((m) => docTypes.includes(m.doc_type))
  }

  const invoicesList = useMemo(() => movementsFor(['invoice']), [movements])
  const receiptsList = useMemo(() => movementsFor(['collection']), [movements])
  const returnsList = useMemo(() => movementsFor(['return']), [movements])
  const chequesList = useMemo(() => movementsFor(['cheque']), [movements])

  const stmtTotals = useMemo(() => {
    let sales = 0, returns = 0, receipts = 0, cheques = 0
    for (const m of movements) {
      const amt = Math.abs(Number(m.amount))
      if ((m.doc_type === 'order' || m.doc_type === 'invoice') && m.direction > 0) sales += amt
      else if (m.doc_type === 'return') returns += amt
      else if (m.doc_type === 'collection') receipts += amt
      else if (m.doc_type === 'cheque') cheques += amt
    }
    return { sales, returns, receipts, cheques }
  }, [movements])

  function handleDocClick(m: Movement) {
    if (m.doc_type === 'order') nav(`/orders/${m.id}`)
    else openDoc(m)
  }

  function printStatement() {
    if (!activeCustomer) return
    printSahlStatement({
      customer_name: activeCustomer.company_name || '',
      customer_code: activeCustomer.code,
      phone: activeCustomer.phone,
      date_from: period.from,
      date_to: period.to,
      balance_before: opening,
      total_sales: stmtTotals.sales,
      total_returns: stmtTotals.returns,
      total_receipts: stmtTotals.receipts,
      total_cheques: stmtTotals.cheques,
      balance_after: periodEnd,
    }, movements.map((m) => ({
      code: m.code,
      date: m.created_at,
      kind: docTypeLabels[m.doc_type] || m.doc_type,
      debit: m.direction > 0 ? Number(m.amount) : 0,
      credit: m.direction < 0 ? Number(m.amount) : 0,
      balance: Number(m.running_balance),
      note: docStatusLabels[m.status] || m.status,
    })), 'A4')
  }

  // Excel export for customer balances list
  function handleExportExcel() {
    const rows = filtered.map(c => ({
      code: c.code || '',
      company_name: c.company_name || '',
      phone: c.phone || '',
      current_balance: Number(c.current_balance || 0),
    }))
    sahlExportExcel({
      title: 'أرصدة العملاء',
      subtitle: 'قائمة شاملة بأرصدة جميع العملاء',
      fileName: 'أرصدة_العملاء',
      filters: [datePresetLabel(dateFilter.preset), kpiFilter === 'debtors' ? 'مديونين فقط' : 'الكل'],
      summary: [
        { label: 'إجمالي المستحقات', value: totals.debt, format: 'currency' },
        { label: 'عدد المديونين', value: totals.debtors, format: 'number' },
        { label: 'إجمالي العملاء', value: customers.length, format: 'number' },
      ],
      columnWidths: [16, 30, 16, 18],
    }, ACCOUNTS_COLUMNS, rows)
  }

  // Print for customer balances list
  function handlePrint() {
    const rows = filtered.map(c => ({
      code: c.code || '',
      company_name: c.company_name || '',
      phone: c.phone || '',
      current_balance: Number(c.current_balance || 0),
    }))
    sahlPrintReport({
      title: 'أرصدة العملاء',
      subtitle: 'قائمة شاملة بأرصدة جميع العملاء',
      fileName: 'أرصدة_العملاء',
      filters: [kpiFilter === 'debtors' ? 'مديونين فقط' : 'الكل'],
      summary: [
        { label: 'إجمالي المستحقات', value: totals.debt, format: 'currency' },
        { label: 'عدد المديونين', value: totals.debtors, format: 'number' },
      ],
    }, ACCOUNTS_COLUMNS, rows)
  }

  const sourceGroups: Array<{ key: keyof StatementComponents; title: string; sign: 1 | -1; docTypes: Movement['doc_type'][] }> = [
    { key: 'sales_orders', title: 'طلبات بيع معتمدة (أهرام)', sign: 1, docTypes: ['order'] },
    { key: 'sales_invoices_credit', title: 'الجزء الآجل من فواتير البيع (سهل)', sign: 1, docTypes: ['invoice'] },
    { key: 'sales_returns', title: 'مرتجعات بيع معتمدة', sign: -1, docTypes: ['return'] },
    { key: 'receipts', title: 'سندات القبض الفعلية', sign: -1, docTypes: ['collection'] },
    { key: 'incoming_cheques', title: 'شيكات واردة سارية', sign: -1, docTypes: ['cheque'] },
  ]

  const colInfo = useMemo(() =>
    docDetail?.doc_type === 'collection'
      ? collections.find((r) => r.id === docDetail.id) || null
      : null
  , [collections, docDetail])

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'statement', label: 'كشف الحساب' },
    { key: 'sources', label: 'مصادر تكوين الرصيد' },
    { key: 'invoices', label: `الفواتير (${invoicesList.length})` },
    { key: 'receipts', label: `سندات القبض (${receiptsList.length})` },
    { key: 'returns', label: `المرتجعات (${returnsList.length})` },
    { key: 'cheques', label: `الشيكات والأقساط (${chequesList.length})` },
  ]

  function MovementRow({ m }: { m: Movement }) {
    return (
      <button onClick={() => handleDocClick(m)}
        className="w-full text-right px-4 py-2.5 hover:bg-surface/60 flex items-center justify-between gap-2">
        <span className="min-w-0 w-40 shrink-0">
          <span className="text-[9px] text-text-secondary block">{formatDate(m.created_at)}</span>
          <span className="text-[9px] text-text-secondary">{docTypeLabels[m.doc_type]}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-xs text-text truncate block">{m.code} — {m.label}</span>
          <span className="text-[9px] text-text-secondary">{docStatusLabels[m.status] || m.status}</span>
        </span>
        <span className={`text-xs font-bold shrink-0 w-20 text-left ${m.direction > 0 ? 'text-danger' : 'text-success'}`}>
          {m.direction > 0 ? '+' : '−'}{formatCurrencyShort(Math.abs(Number(m.amount)))}
        </span>
        <span className="text-[10px] text-text-secondary shrink-0 w-20 text-left">رصيد: {formatCurrencyShort(m.running_balance)}</span>
      </button>
    )
  }

  function EmptyList({ text }: { text: string }) {
    return <div className="text-center py-12 text-text-secondary text-sm">{text}</div>
  }

  const balTag = Number(activeCustomer?.current_balance || 0) > 0 ? 'مديونية مستحقة'
    : Number(activeCustomer?.current_balance || 0) < 0 ? 'رصيد دائن' : 'متزن'

  return (
    <div className="space-y-4" dir="rtl">
      <SahlToolbar
        title="الحسابات"
        subtitle="مساحة عمل مالية لكل عميل — رصيد واحد مشتق من المستندات الفعلية"
        dateFilter={dateFilter}
        onDateFilterChange={setDateFilter}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث بالاسم / الكود / الهاتف..."
        onExportExcel={handleExportExcel}
        onPrint={handlePrint}
        onRefresh={loadData}
      />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <SahlKpiCard
          label="إجمالي مستحقات العملاء" value={totals.debt} format="currency" color="danger"
          icon="💰" active={kpiFilter === 'debtors'} onClick={() => setKpiFilter(kpiFilter === 'debtors' ? 'all' : 'debtors')}
          traceLabel="عرض المديونين" />
        <SahlKpiCard label="عملاء عليهم مديونية" value={totals.debtors} format="count" color="warning" icon="👥" />
        <SahlKpiCard label="إجمالي العملاء" value={customers.length} format="count" color="text" icon="📋" />
      </div>

      <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 bg-surface border-b border-border flex items-center gap-3">
          <h2 className="text-sm font-bold text-text shrink-0">👥 أرصدة العملاء</h2>
        </div>
        {loading ? (
          <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-text-secondary text-sm">لا يوجد عملاء مطابقون</div>
        ) : (
          <div className="divide-y divide-border/60 max-h-[560px] overflow-y-auto">
            {filtered.map((c) => {
              const bal = Number(c.current_balance || 0)
              return (
                <button key={c.id} onClick={() => openWorkspace(c)}
                  className="w-full text-right px-5 py-3 hover:bg-surface/60 transition-colors flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-text truncate">{c.company_name}</div>
                    <div className="text-[10px] text-text-secondary">{c.code}{c.phone ? ` • ${c.phone}` : ''}</div>
                  </div>
                  <span className={`text-sm font-bold shrink-0 ${bal > 0 ? 'text-danger' : bal < 0 ? 'text-warning' : 'text-success'}`}>
                    {formatCurrencyShort(bal)}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* مساحة العمل المالية لحساب العميل */}
      {activeCustomer && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setActiveCustomer(null)}>
          <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* الترويسة المالية */}
            <div className="bg-gradient-to-l from-slate-700 to-slate-600 px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-white truncate">{activeCustomer.company_name}</h3>
                  <p className="text-[10px] text-white/70 mt-0.5">{activeCustomer.code}{activeCustomer.phone ? ` • ${activeCustomer.phone}` : ''}</p>
                </div>
                <div className="text-left shrink-0">
                  <div className="text-[10px] text-white/70">{balTag}</div>
                  <div className="text-xl font-bold text-white">{formatCurrencyShort(activeCustomer.current_balance || 0)}</div>
                </div>
              </div>
              {comp && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5 text-[10px] text-white/85">
                  <span>طلبات بيع: <b>{formatCurrencyShort(comp.sales_orders)}</b></span>
                  <span>فواتير آجل: <b>{formatCurrencyShort(comp.sales_invoices_credit)}</b></span>
                  <span>مرتجعات: <b>{formatCurrencyShort(comp.sales_returns)}</b></span>
                  <span>محصّل: <b>{formatCurrencyShort(comp.receipts)}</b></span>
                  <span>شيكات وأقساط: <b>{formatCurrencyShort(comp.incoming_cheques)}</b></span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2 px-4 py-2.5 bg-surface border-b border-border">
              <button onClick={() => nav('/sahl/receipts', { state: { customerId: activeCustomer.id } })}
                className="text-[11px] bg-emerald-700 text-white px-3 py-1.5 rounded-lg font-semibold">＋ سند قبض جديد</button>
              <button onClick={() => nav('/sahl/pos', { state: { customerId: activeCustomer.id } })}
                className="text-[11px] border border-border text-text px-3 py-1.5 rounded-lg font-semibold">فاتورة بيع جديدة</button>
              <button onClick={() => nav('/sahl/returns', { state: { customerId: activeCustomer.id } })}
                className="text-[11px] border border-border text-text px-3 py-1.5 rounded-lg font-semibold">مرتجع بيع</button>
              <button onClick={() => nav('/sahl/installments', { state: { customerId: activeCustomer.id } })}
                className="text-[11px] border border-border text-text px-3 py-1.5 rounded-lg font-semibold">الأقساط</button>
              <button onClick={() => nav('/sahl/cheques', { state: { customerId: activeCustomer.id } })}
                className="text-[11px] border border-border text-text px-3 py-1.5 rounded-lg font-semibold">الشيكات</button>
            </div>

            <div className="flex overflow-x-auto border-b border-border bg-surface">
              {tabs.map((t) => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`py-2.5 px-3 text-xs font-bold whitespace-nowrap ${tab === t.key ? 'text-primary border-b-2 border-primary' : 'text-text-secondary'}`}>
                  {t.label}
                </button>
              ))}
            </div>

            <div className="overflow-y-auto flex-1 min-h-[280px]">
              {stmtLoading ? (
                <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
              ) : !comp ? (
                <EmptyList text="لا توجد بيانات" />
              ) : tab === 'statement' ? (
                <div className="p-4 space-y-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <div>
                      <label className="text-[9px] text-text-secondary block mb-0.5">من تاريخ</label>
                      <input type="date" value={fromInput} onChange={(e) => setFromInput(e.target.value)}
                        className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white" />
                    </div>
                    <div>
                      <label className="text-[9px] text-text-secondary block mb-0.5">إلى تاريخ</label>
                      <input type="date" value={toInput} onChange={(e) => setToInput(e.target.value)}
                        className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white" />
                    </div>
                    <button onClick={applyPeriod} className="text-[11px] bg-primary text-white px-3 py-1.5 rounded-lg font-semibold">تطبيق</button>
                    {(fromInput || toInput) && (
                      <button onClick={clearPeriod} className="text-[11px] border border-border text-text px-3 py-1.5 rounded-lg">مسح الفترة</button>
                    )}
                    <button onClick={printStatement} className="text-[11px] mr-auto border border-primary text-primary px-3 py-1.5 rounded-lg font-semibold">🖨 طباعة الكشف (A4)</button>
                  </div>

                  <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                    <div className="border border-border rounded-lg p-2 text-center">
                      <div className="text-[9px] text-text-secondary">رصيد سابق</div>
                      <div className="text-xs font-bold text-text">{formatCurrencyShort(opening)}</div>
                    </div>
                    <div className="border border-border rounded-lg p-2 text-center">
                      <div className="text-[9px] text-text-secondary">بيع</div>
                      <div className="text-xs font-bold text-danger">{formatCurrencyShort(stmtTotals.sales)}</div>
                    </div>
                    <div className="border border-border rounded-lg p-2 text-center">
                      <div className="text-[9px] text-text-secondary">مرتجع بيع</div>
                      <div className="text-xs font-bold text-success">{formatCurrencyShort(stmtTotals.returns)}</div>
                    </div>
                    <div className="border border-border rounded-lg p-2 text-center">
                      <div className="text-[9px] text-text-secondary">قبض</div>
                      <div className="text-xs font-bold text-success">{formatCurrencyShort(stmtTotals.receipts)}</div>
                    </div>
                    <div className="border border-border rounded-lg p-2 text-center">
                      <div className="text-[9px] text-text-secondary">شيكات وأقساط</div>
                      <div className="text-xs font-bold text-success">{formatCurrencyShort(stmtTotals.cheques)}</div>
                    </div>
                    <div className="border-2 border-slate-500 rounded-lg p-2 text-center bg-surface">
                      <div className="text-[9px] text-text-secondary">رصيد حالى{period.from || period.to ? ' (الفترة)' : ''}</div>
                      <div className="text-sm font-bold text-text">{formatCurrencyShort(periodEnd)}</div>
                    </div>
                  </div>

                  <div className="border border-border rounded-xl overflow-hidden divide-y divide-border/50">
                    {movements.length === 0 ? (
                      <EmptyList text="لا توجد حركات في هذه الفترة" />
                    ) : movements.map((m) => <MovementRow key={`${m.doc_type}-${m.id}`} m={m} />)}
                  </div>
                </div>
              ) : tab === 'sources' ? (
                <div className="p-4 space-y-3">
                  {sourceGroups.map((g) => {
                    const val = Number(comp[g.key] || 0)
                    const rows = movementsFor(g.docTypes)
                    return (
                      <details key={g.key} className="border border-border rounded-xl overflow-hidden" open={val !== 0}>
                        <summary className="cursor-pointer select-none px-4 py-2.5 bg-surface flex items-center justify-between hover:bg-surface/70">
                          <span className="text-xs font-semibold text-text">{g.title}</span>
                          <span className="flex items-center gap-2">
                            <span className={`text-xs font-bold ${g.sign > 0 ? 'text-danger' : 'text-success'}`}>
                              {g.sign > 0 ? '+' : '−'}{formatCurrencyShort(Math.abs(val))}
                            </span>
                            <span className="text-[9px] text-text-secondary">{rows.length} مستند</span>
                          </span>
                        </summary>
                        <div className="divide-y divide-border/50">
                          {rows.length === 0 ? (
                            <div className="px-4 py-3 text-center text-[10px] text-text-secondary">لا توجد مستندات</div>
                          ) : rows.map((m) => <MovementRow key={`src-${m.doc_type}-${m.id}`} m={m} />)}
                        </div>
                      </details>
                    )
                  })}
                  <div className="border-2 border-border rounded-xl px-4 py-3 flex items-center justify-between bg-surface">
                    <span className="text-sm font-bold text-text">= الرصيد الحالي المستحق على العميل</span>
                    <span className={`text-base font-bold ${Number(comp.current_balance) > 0 ? 'text-danger' : Number(comp.current_balance) < 0 ? 'text-warning' : 'text-success'}`}>
                      {formatCurrencyShort(comp.current_balance)}
                    </span>
                  </div>
                </div>
              ) : tab === 'invoices' ? (
                <div className="divide-y divide-border/60">
                  {invoicesList.length === 0 ? <EmptyList text="لا توجد فواتير آجلة" />
                    : invoicesList.map((m) => <MovementRow key={m.id} m={m} />)}
                </div>
              ) : tab === 'receipts' ? (
                <div className="divide-y divide-border/60">
                  {receiptsList.length === 0 ? <EmptyList text="لا توجد سندات قبض" />
                    : receiptsList.map((m) => <MovementRow key={m.id} m={m} />)}
                </div>
              ) : tab === 'returns' ? (
                <div className="divide-y divide-border/60">
                  {returnsList.length === 0 ? <EmptyList text="لا توجد مرتجعات بيع" />
                    : returnsList.map((m) => <MovementRow key={m.id} m={m} />)}
                </div>
              ) : (
                <div className="divide-y divide-border/60">
                  {chequesList.length === 0 ? <EmptyList text="لا توجد شيكات واردة سارية" />
                    : chequesList.map((m) => <MovementRow key={m.id} m={m} />)}
                </div>
              )}
            </div>

            <div className="border-t border-border p-3 text-center">
              <button onClick={() => setActiveCustomer(null)} className="text-text-secondary text-xs py-1">إغلاق</button>
            </div>
          </div>
        </div>
      )}

      {/* تفاصيل المستند الأصلي */}
      {docDetail && (
        <SahlDetailPanel
          title={`${docTypeLabels[docDetail.doc_type]} — ${docDetail.code}`}
          subtitle={formatDate(docDetail.created_at)}
          statusBadge={{ label: docStatusLabels[docDetail.status] || docDetail.status, className: 'bg-surface text-text-secondary' }}
          sections={[
            {
              title: 'بيانات المستند',
              fields: [
                { label: 'الحالة', value: docStatusLabels[docDetail.status] || docDetail.status },
                { label: 'الأثر على الرصيد', value: `${docDetail.direction > 0 ? 'زيادة (+)' : 'تخفيض (−)'} ${formatCurrencyShort(Math.abs(Number(docDetail.amount)))}`, bold: true, color: docDetail.direction > 0 ? 'text-danger' : 'text-success' },
                { label: 'الوصف', value: docDetail.label },
                ...(docDetail.doc_type === 'collection' && colInfo ? [
                  { label: 'وسيلة الدفع', value: colInfo.method },
                  { label: 'رقم المرجع', value: colInfo.reference_number || '—' },
                  ...(colInfo.notes ? [{ label: 'ملاحظات', value: colInfo.notes }] : []),
                ] : []),
              ],
            },
          ]}
          actions={
            docDetail.doc_type === 'invoice' ? (
              docItemsLoading ? <span className="text-xs text-text-secondary">جاري تحميل البنود...</span> : undefined
            ) : undefined
          }
          onClose={() => setDocDetail(null)}
        />
      )}
    </div>
  )
}
