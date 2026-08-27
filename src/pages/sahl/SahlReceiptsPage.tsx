import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort, formatDate } from '../../utils/format'
import { useCapability } from '../../hooks/useCapability'
import { resolveDateRangeISO } from '../../lib/dateRange'
import SahlToolbar from '../../components/sahl/SahlToolbar'
import SahlKpiCard from '../../components/sahl/SahlKpiCard'
import SahlDetailPanel from '../../components/sahl/SahlDetailPanel'
import type { DetailField } from '../../components/sahl/SahlDetailPanel'
import SahlAuditLog from '../../components/sahl/SahlAuditLog'
import type { AuditEntry } from '../../components/sahl/SahlAuditLog'
import type { SahlDateFilterState } from '../../components/sahl/SahlDateFilter'
import { sahlExportExcel, sahlPrintReport, datePresetLabel } from './sahl-report'
import type { SahlReportColumn } from './sahl-report'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const methodLabels: Record<string, string> = {
  cash: 'نقداً', bank_transfer: 'تحويل بنكي', cheque: 'شيك', deposit: 'إيداع',
}

const statusLabels: Record<string, string> = {
  pending: 'معلق', approved: 'معتمد', treasury_posted: 'مرحّل للخزينة', cancelled: 'ملغى',
}

const statusStyles: Record<string, string> = {
  pending: 'bg-accent/10 text-accent',
  approved: 'bg-primary/10 text-primary',
  treasury_posted: 'bg-success/10 text-success',
  cancelled: 'bg-text-secondary/10 text-text-secondary line-through',
}

interface CustomerRow {
  id: string
  code?: string
  company_name?: string
  phone?: string
  current_balance?: number | null
}

interface TreasuryRow { id: string; name: string; kind: 'cash' | 'bank'; is_active: boolean }

const REPORT_COLUMNS: SahlReportColumn[] = [
  { key: 'code', label: 'رقم السند' },
  { key: 'customer_name', label: 'العميل' },
  { key: 'amount', label: 'المبلغ', format: 'currency' },
  { key: 'method', label: 'وسيلة الدفع' },
  { key: 'status', label: 'الحالة' },
  { key: 'reference_number', label: 'رقم المرجع' },
  { key: 'collected_at', label: 'تاريخ القبض' },
  { key: 'notes', label: 'ملاحظات' },
]

export function SahlReceiptsPage() {
  const nav = useNavigate()
  const location = useLocation()
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

  const [kpiFilter, setKpiFilter] = useState<'all' | 'today_posted' | 'unposted' | 'today_count'>('all')
  const [detailReceipt, setDetailReceipt] = useState<any | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ type: 'post' | 'cancel'; receipt: any } | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [cancelReason, setCancelReason] = useState('')

  // Date filter state
  const [dateFilter, setDateFilter] = useState<SahlDateFilterState>({ preset: 'month', customFrom: '', customTo: '' })

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

  const preselectApplied = useRef(false)
  useEffect(() => {
    if (preselectApplied.current || loading || customers.length === 0) return
    preselectApplied.current = true
    const preId = (location.state as any)?.customerId as string | undefined
    if (!preId) return
    const c = customers.find((x) => x.id === preId)
    if (c) setSelectedCustomer(c)
  }, [loading, customers, location.state])

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

  // Date-filtered receipts
  const { from: dateFrom, to: dateTo } = resolveDateRangeISO(dateFilter.preset, dateFilter.customFrom, dateFilter.customTo)

  const dateFilteredReceipts = useMemo(() => {
    let list = receipts
    if (dateFrom || dateTo) {
      list = list.filter((r: any) => {
        const d = new Date(r.created_at).getTime()
        if (dateFrom && d < new Date(dateFrom).getTime()) return false
        if (dateTo && d >= new Date(dateTo).getTime()) return false
        return true
      })
    }
    return list
  }, [receipts, dateFrom, dateTo])

  const todayPostedTotal = useMemo(() => {
    return dateFilteredReceipts
      .filter((r) => r.status === 'treasury_posted' && (() => { const d = new Date(r.created_at); const n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate() })())
      .reduce((s, r) => s + Number(r.amount || 0), 0)
  }, [dateFilteredReceipts])

  const unposted = useMemo(() => dateFilteredReceipts.filter((r) => r.status !== 'treasury_posted'), [dateFilteredReceipts])
  const recentReceipts = useMemo(() => {
    const list = kpiFilter === 'today_posted'
      ? dateFilteredReceipts.filter((r) => r.status === 'treasury_posted' && (() => { const d = new Date(r.created_at); const n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate() })())
      : kpiFilter === 'unposted'
      ? unposted
      : kpiFilter === 'today_count'
      ? dateFilteredReceipts.filter((r) => (() => { const d = new Date(r.created_at); const n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate() })())
      : dateFilteredReceipts
    return list.slice(0, 50)
  }, [dateFilteredReceipts, kpiFilter, unposted])

  const customerMap = useMemo(() => {
    const m = new Map<string, CustomerRow>()
    for (const c of customers) m.set(c.id, c)
    return m
  }, [customers])

  // Export Excel
  function handleExportExcel() {
    const rows = recentReceipts.map((r: any) => ({
      code: r.code,
      customer_name: r.customer_name || customerMap.get(r.customer_id)?.company_name || '',
      amount: Number(r.amount || 0),
      method: methodLabels[r.method] || r.method,
      status: statusLabels[r.status] || r.status,
      reference_number: r.reference_number || '',
      collected_at: r.collected_at ? formatDate(r.collected_at) : '',
      notes: r.notes || '',
    }))
    sahlExportExcel({
      title: 'تقرير سندات القبض',
      subtitle: 'قائمة سندات القبض من العملاء',
      fileName: 'سندات_قبض',
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      filters: [datePresetLabel(dateFilter.preset)],
      summary: [
        { label: 'إجمالي السندات', value: recentReceipts.length, format: 'number' },
        { label: 'الإجمالي المالي', value: recentReceipts.reduce((s: number, r: any) => s + Number(r.amount || 0), 0), format: 'currency' },
        { label: 'بانتظار الترحيل', value: unposted.length, format: 'number' },
      ],
      columnWidths: [16, 24, 14, 14, 14, 16, 16, 20],
    }, REPORT_COLUMNS, rows)
  }

  // Print
  function handlePrint() {
    const rows = recentReceipts.map((r: any) => ({
      code: r.code,
      customer_name: r.customer_name || customerMap.get(r.customer_id)?.company_name || '',
      amount: Number(r.amount || 0),
      method: methodLabels[r.method] || r.method,
      status: statusLabels[r.status] || r.status,
      reference_number: r.reference_number || '',
      collected_at: r.collected_at ? formatDate(r.collected_at) : '',
      notes: r.notes || '',
    }))
    sahlPrintReport({
      title: 'سندات القبض',
      subtitle: 'قائمة سندات القبض من العملاء',
      fileName: 'سندات_قبض',
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      filters: [datePresetLabel(dateFilter.preset)],
      summary: [
        { label: 'إجمالي السندات', value: recentReceipts.length, format: 'number' },
        { label: 'الإجمالي المالي', value: recentReceipts.reduce((s: number, r: any) => s + Number(r.amount || 0), 0), format: 'currency' },
      ],
    }, REPORT_COLUMNS, rows)
  }

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

  // Build audit entries for a receipt
  function buildAudit(receipt: any): AuditEntry[] {
    const entries: AuditEntry[] = []
    entries.push({ id: 'create', action: 'create', actionAr: 'إنشاء', performedBy: receipt.created_by_name || receipt.created_by, performedAt: receipt.created_at, details: `سند قبض بمبلغ ${formatCurrencyShort(receipt.amount)}` })
    if (receipt.status === 'approved' || receipt.status === 'treasury_posted') {
      entries.push({ id: 'approve', action: 'approve', actionAr: 'اعتماد', performedBy: receipt.approved_by_name || 'النظام', performedAt: receipt.approved_at || receipt.created_at })
    }
    if (receipt.status === 'treasury_posted') {
      entries.push({ id: 'post', action: 'post', actionAr: 'ترحيل', performedBy: receipt.posted_by_name || 'النظام', performedAt: receipt.collected_at || receipt.created_at, details: `ترحيل للخزينة` })
    }
    if (receipt.status === 'cancelled') {
      entries.push({ id: 'cancel', action: 'cancel', actionAr: 'إلغاء', performedBy: receipt.cancelled_by_name || 'النظام', performedAt: receipt.cancelled_at || receipt.created_at, details: receipt.cancel_reason || 'تم الإلغاء' })
    }
    return entries
  }

  const currentFilters = [datePresetLabel(dateFilter.preset)]
  if (kpiFilter !== 'all') currentFilters.push(kpiFilter === 'today_posted' ? 'محصل اليوم' : kpiFilter === 'unposted' ? 'بانتظار الترحيل' : 'سندات اليوم')

  return (
    <div className="space-y-4" dir="rtl">
      <SahlToolbar
        title="القبض"
        subtitle="سندات قبض من العملاء — ترحيل للخزينة وكشف حساب"
        dateFilter={dateFilter}
        onDateFilterChange={setDateFilter}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث بالاسم / الكود / الهاتف..."
        onExportExcel={handleExportExcel}
        onPrint={handlePrint}
        onRefresh={loadData}
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SahlKpiCard
          label="محصل اليوم (مرحّل)" value={todayPostedTotal} format="currency" color="success"
          icon="💰" active={kpiFilter === 'today_posted'} onClick={() => setKpiFilter(kpiFilter === 'today_posted' ? 'all' : 'today_posted')}
          traceLabel="عرض التفاصيل" />
        <SahlKpiCard
          label="بانتظار الترحيل" value={unposted.length} format="count" color="warning"
          icon="⏳" active={kpiFilter === 'unposted'} onClick={() => setKpiFilter(kpiFilter === 'unposted' ? 'all' : 'unposted')}
          subtitle={formatCurrencyShort(unposted.reduce((s: number, r: any) => s + Number(r.amount || 0), 0))} traceLabel="عرض القائمة" />
        <SahlKpiCard
          label="عدد سندات الفترة" value={dateFilteredReceipts.length} format="count" color="primary"
          icon="📄" active={kpiFilter === 'today_count'} onClick={() => setKpiFilter(kpiFilter === 'today_count' ? 'all' : 'today_count')}
          traceLabel="عرض القائمة" />
        <SahlKpiCard
          label="إجمالي قيمة السندات" value={dateFilteredReceipts.reduce((s: number, r: any) => s + Number(r.amount || 0), 0)}
          format="currency" color="text" icon="📊" />
      </div>

      {kpiFilter !== 'all' && (
        <div className="flex items-center justify-between bg-primary/5 border border-primary/20 rounded-lg px-4 py-2">
          <span className="text-xs text-primary font-semibold">
            🔍 عرض: {kpiFilter === 'today_posted' ? 'محصل اليوم فقط' : kpiFilter === 'unposted' ? 'بانتظار الترحيل فقط' : 'سندات الفترة فقط'} — {recentReceipts.length} سند
          </span>
          <button onClick={() => setKpiFilter('all')} className="text-[10px] text-primary underline">إزالة التصفية</button>
        </div>
      )}

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
            <span className="text-[10px] text-text-secondary">{recentReceipts.length} سند</span>
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
                const isCancelled = col.status === 'cancelled'
                const canCancel = !isPosted && !isCancelled && canPost
                return (
                  <div key={col.id}
                    onClick={() => !isCancelled && setDetailReceipt(col)}
                    className={`px-5 py-3 transition-colors ${isCancelled ? 'opacity-50' : 'hover:bg-surface/60 cursor-pointer'}`}>
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
                        <span className={`text-sm font-bold ${isCancelled ? 'text-text-secondary line-through' : 'text-success'}`}>{formatCurrencyShort(col.amount)}</span>
                        {!isPosted && !isCancelled && canPost && (
                          <button onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'post', receipt: col }) }}
                            className="text-[10px] bg-emerald-700 text-white px-2 py-1 rounded">ترحيل</button>
                        )}
                        {canCancel && (
                          <button onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'cancel', receipt: col }) }}
                            className="text-[10px] bg-danger/10 text-danger px-2 py-1 rounded">إلغاء</button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Detail Panel with Audit */}
      {detailReceipt && (
        <SahlDetailPanel
          title={`سند قبض — ${detailReceipt.code}`}
          subtitle={detailReceipt.code}
          statusBadge={{ label: statusLabels[detailReceipt.status] || detailReceipt.status, className: statusStyles[detailReceipt.status] || 'bg-surface text-text-secondary' }}
          sections={[
            {
              title: 'بيانات المستند',
              fields: [
                { label: 'العميل', value: customerMap.get(detailReceipt.customer_id)?.company_name || '—' },
                { label: 'المبلغ', value: formatCurrencyShort(detailReceipt.amount), bold: true, color: 'text-success' },
                { label: 'وسيلة الدفع', value: methodLabels[detailReceipt.method] || detailReceipt.method },
                { label: 'رقم المرجع', value: detailReceipt.reference_number || '—' },
                { label: 'ملاحظات', value: detailReceipt.notes || '—' },
                { label: 'تاريخ الإنشاء', value: formatDate(detailReceipt.created_at) },
                ...(detailReceipt.collected_at ? [{ label: 'تاريخ القبض', value: formatDate(detailReceipt.collected_at) }] : []),
              ],
            },
            {
              title: 'سجل التغييرات (Audit)',
              fields: [],
            },
          ]}
          actions={
            <>
              {!detailReceipt.treasury_posted && detailReceipt.status !== 'cancelled' && canPost && (
                <button onClick={() => { setConfirmAction({ type: 'post', receipt: detailReceipt }); setDetailReceipt(null) }}
                  className="flex-1 bg-emerald-700 text-white rounded-xl py-2 text-xs font-bold">ترحيل</button>
              )}
              {detailReceipt.status !== 'treasury_posted' && detailReceipt.status !== 'cancelled' && canPost && (
                <button onClick={() => { setConfirmAction({ type: 'cancel', receipt: detailReceipt }); setDetailReceipt(null) }}
                  className="flex-1 border border-danger text-danger rounded-xl py-2 text-xs font-bold">إلغاء</button>
              )}
            </>
          }
          onClose={() => setDetailReceipt(null)}
        />
      )}

      {confirmAction && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => { setConfirmAction(null); setCancelReason('') }}>
          <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className={`px-5 py-4 ${confirmAction.type === 'post' ? 'bg-gradient-to-l from-emerald-700 to-emerald-600' : 'bg-gradient-to-l from-red-700 to-red-600'}`}>
              <h3 className="text-sm font-bold text-white">
                {confirmAction.type === 'post' ? 'تأكيد الترحيل للخزينة' : 'تأكيد إلغاء السند'}
              </h3>
            </div>
            <div className="p-5 space-y-3">
              <div className="text-center">
                <div className="text-sm text-text">{confirmAction.receipt.code}</div>
                <div className="text-lg font-bold text-text mt-1">{formatCurrencyShort(confirmAction.receipt.amount)}</div>
                <div className="text-xs text-text-secondary mt-1">
                  {customerMap.get(confirmAction.receipt.customer_id)?.company_name || ''}
                </div>
              </div>
              {confirmAction.type === 'post' ? (
                <p className="text-xs text-text-secondary text-center">
                  سيتم تسجيل هذا المبلغ كدخل في الخزينة. لا يمكن التراجع بعد الترحيل.
                </p>
              ) : (
                <div>
                  <label className="text-xs text-text-secondary block mb-1">سبب الإلغاء (اختياري)</label>
                  <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="مثال: خطأ في المبلغ..."
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => { setConfirmAction(null); setCancelReason('') }}
                  className="flex-1 border border-border rounded-xl py-2.5 text-sm font-semibold">تراجع</button>
                <button disabled={actionLoading}
                  onClick={async () => {
                    const token = getToken()
                    if (!token) { toast.error('انتهت الجلسة'); return }
                    setActionLoading(true)
                    if (confirmAction.type === 'post') {
                      const res = await supabase.rpc('sahl_post_receipt', {
                        p_token: token, p_collection_id: confirmAction.receipt.id, p_treasury_id: drawerId || null,
                      })
                      if (res.error) { toast.error(res.error.message) }
                      else if ((res.data as any)?.error) { toast.error((res.data as any).error) }
                      else {
                        toast.success(`تم ترحيل ${confirmAction.receipt.code} إلى الخزينة — رصيد العميل: ${formatCurrencyShort((res.data as any)?.outstanding_after || 0)}`, { duration: 4000 })
                        await loadData()
                      }
                    } else {
                      const res = await supabase.rpc('sahl_cancel_receipt', {
                        p_token: token, p_collection_id: confirmAction.receipt.id,
                        p_reason: cancelReason.trim() || null,
                      })
                      if (res.error) { toast.error(res.error.message) }
                      else if ((res.data as any)?.error) { toast.error((res.data as any).error) }
                      else {
                        toast.success(`تم إلغاء ${confirmAction.receipt.code} — رصيد العميل: ${formatCurrencyShort((res.data as any)?.customer_balance_now || 0)}`, { duration: 4000 })
                        await loadData()
                      }
                    }
                    setActionLoading(false); setConfirmAction(null); setCancelReason('')
                  }}
                  className={`flex-1 text-white rounded-xl py-2.5 text-sm font-bold ${confirmAction.type === 'post' ? 'bg-emerald-700' : 'bg-danger'}`}>
                  {actionLoading ? 'جاري...' : confirmAction.type === 'post' ? 'تأكيد الترحيل' : 'تأكيد الإلغاء'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
