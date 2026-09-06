import { formatCurrencyShort, formatDateTimeStamp } from '../utils/format'
import { formatInteger } from '../utils/numbers'
import { cairoDateComponents } from '../lib/dateRange'
import { exportToExcel } from './excelExporter'
import { printInvoice } from '../components/orders/order-printing'

export interface VisitsReportRow {
  code: string
  status: string
  result: string
  customer: string
  employee: string
  check_in: string
  check_out: string
  duration: string
  coords_in: string
  coords_out: string
  visit_count: number
  order_count: number
  orders_total: number
  last_order_date: string
  last_visit_before: string
  phone: string
  address: string
  customer_created_at: string
  creator: string
  created_at: string
  notes: string
}

export interface VisitsReportTotals {
  visitCount: number
}

export interface VisitsReportMeta {
  title: string
  subtitle?: string
  generatedAt: Date
  filterLines: string[]
  fileName: string
}

export interface VisitsReportColumn {
  key: keyof VisitsReportRow
  label: string
  format?: 'number' | 'currency'
}

export const VISITS_REPORT_COLUMNS: VisitsReportColumn[] = [
  { key: 'code', label: 'رمز الزيارة' },
  { key: 'status', label: 'الحالة' },
  { key: 'result', label: 'النتيجة' },
  { key: 'customer', label: 'العميل' },
  { key: 'employee', label: 'المسؤول' },
  { key: 'check_in', label: 'بداية الزيارة' },
  { key: 'check_out', label: 'نهاية الزيارة' },
  { key: 'duration', label: 'المدة' },
  { key: 'coords_in', label: 'إحداثيات البداية' },
  { key: 'coords_out', label: 'إحداثيات النهاية' },
  { key: 'visit_count', label: 'عدد زيارات العميل', format: 'number' },
  { key: 'order_count', label: 'عدد طلبات العميل', format: 'number' },
  { key: 'orders_total', label: 'قيمة طلبات العميل', format: 'currency' },
  { key: 'last_order_date', label: 'تاريخ آخر طلب' },
  { key: 'last_visit_before', label: 'آخر زيارة سابقة' },
  { key: 'phone', label: 'هاتف العميل' },
  { key: 'address', label: 'عنوان العميل' },
  { key: 'customer_created_at', label: 'تاريخ إنشاء العميل' },
  { key: 'creator', label: 'أنشأ الحساب' },
  { key: 'created_at', label: 'تاريخ إنشاء الزيارة' },
  { key: 'notes', label: 'ملاحظات الزيارة' },
]

const DATE_PRESET_LABELS: Record<string, string> = {
  all: 'كل الفترات',
  today: 'اليوم',
  yesterday: 'أمس',
  week: 'الأسبوع الحالي',
  month: 'الشهر الحالي',
  prev_month: 'الشهر السابق',
  custom: 'الفترة المخصصة',
}

const VISIT_STATUS_LABELS: Record<string, string> = {
  active: 'نشط',
  completed: 'مكتمل',
  cancelled: 'ملغي',
}

const VISIT_RESULT_LABELS: Record<string, string> = {
  order_taken: 'تم الطلب',
  collection_taken: 'تم التحصيل',
  order_and_collection: 'طلب وتحصيل',
  follow_up: 'متابعة',
  customer_closed: 'العميل مغلق',
  no_responsible_person: 'لا يوجد مسؤول',
  order_rejected: 'رفض الطلب',
  postponed: 'تأجل',
  other: 'أخرى',
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const [y, m, day] = cairoDateComponents(d)
  return `${String(day).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
}

function fmtDT(iso: string | null | undefined): string {
  if (!iso) return '—'
  const out = formatDateTimeStamp(iso)
  return out && out !== '--' ? out : '—'
}

function fmtMoney(v: number | null | undefined): string {
  if (v == null) return '—'
  return formatCurrencyShort(Number(v) || 0)
}

function fmtCount(v: number | null | undefined): string {
  if (v == null) return '—'
  return formatInteger(Number(v) || 0)
}

function safeStr(v: string | null | undefined): string {
  return v && v.trim() ? v.trim() : '—'
}

function calcDuration(start: string, end: string): string {
  const diff = new Date(end).getTime() - new Date(start).getTime()
  const mins = Math.floor(diff / 60000)
  if (!isFinite(mins) || mins < 1) return 'أقل من دقيقة'
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  return hours > 0
    ? hours + 'س ' + (rem > 0 ? rem + 'د' : '')
    : rem + ' دقيقة'
}

function fmtCoords(lat: string | number | null | undefined, lng: string | number | null | undefined): string {
  if (lat == null || lng == null || lat === '' || lng === '') return '—'
  const la = Number(lat)
  const ln = Number(lng)
  if (!isFinite(la) || !isFinite(ln)) return '—'
  return `${la.toFixed(6)}, ${ln.toFixed(6)}`
}

/** Uses stored field values only (same fields displayed on the visit card /
 *  detail screen). No restructured or re-derived numbers other than the
 *  presentation formats the screen itself shows (duration, coordinates). */
export function buildVisitsReportRows(visits: any[], ctx: { customers?: { id: string; company_name: string }[]; employees?: { id: string; name: string }[] } = {}): VisitsReportRow[] {
  const customerById = new Map((ctx.customers || []).map((c) => [c.id, c.company_name]))
  const employeeById = new Map((ctx.employees || []).map((e) => [e.id, e.name]))
  return visits.map((v) => {
    const ccx = v.customer_context || null
    const hasEnd = !!v.check_out_at
    const custName = safeStr(v.customer_name)
    const empName = safeStr(v.employee_name)
    return {
      code: safeStr(v.code),
      status: VISIT_STATUS_LABELS[v.status] || v.status || '—',
      result: v.visit_result ? (VISIT_RESULT_LABELS[v.visit_result] || safeStr(v.visit_result)) : '—',
      customer: custName !== '—' ? custName : safeStr(customerById.get(v.customer_id)),
      employee: empName !== '—' ? empName : safeStr(employeeById.get(v.employee_id)),
      check_in: v.check_in_at ? fmtDT(v.check_in_at) : '—',
      check_out: hasEnd ? fmtDT(v.check_out_at) : '—',
      duration: v.check_in_at && hasEnd ? calcDuration(v.check_in_at, v.check_out_at) : '—',
      coords_in: fmtCoords(v.check_in_latitude, v.check_in_longitude),
      coords_out: fmtCoords(v.check_out_latitude, v.check_out_longitude),
      visit_count: Number(ccx?.visit_count ?? 0),
      order_count: Number(ccx?.order_count ?? 0),
      orders_total: Number(ccx?.orders_total ?? 0),
      last_order_date: ccx?.last_order_date ? fmtDate(ccx.last_order_date) : '—',
      last_visit_before: ccx?.last_visit_before ? fmtDT(ccx.last_visit_before) : '—',
      phone: safeStr(ccx?.phone),
      address: safeStr(ccx?.registered_address),
      customer_created_at: ccx?.created_at ? fmtDate(ccx.created_at) : '—',
      creator: safeStr(ccx?.creator_name),
      created_at: v.created_at ? fmtDT(v.created_at) : '—',
      notes: v.notes ? v.notes.trim() : '—',
    }
  })
}

export function buildVisitsReportTotals(rows: VisitsReportRow[]): VisitsReportTotals {
  return { visitCount: rows.length }
}

export function buildVisitsReportFilterSummary(ctx: {
  datePreset: string
  dateFrom: string
  dateTo: string
  search: string
  employeeId: string
  statusFilter: string
  customerFilter: string
  governorateFilter: string
  employees: { id: string; name: string }[]
  customers: { id: string; company_name: string }[]
  governorates: { id: string; name_ar: string }[]
}): string[] {
  const out: string[] = []

  if (ctx.datePreset === 'custom' && ctx.dateFrom && ctx.dateTo) {
    out.push(`الفترة: ${ctx.dateFrom} إلى ${ctx.dateTo}`)
  } else {
    out.push(`الفترة: ${DATE_PRESET_LABELS[ctx.datePreset] ?? 'كل الفترات'}`)
  }

  if (ctx.search && ctx.search.trim()) out.push(`بحث: "${ctx.search.trim()}"`)

  if (ctx.employeeId) {
    const name = ctx.employees.find((e) => e.id === ctx.employeeId)?.name || 'غير محدد'
    out.push(`المسؤول: ${name}`)
  }

  if (ctx.statusFilter) {
    out.push(`الحالة: ${VISIT_STATUS_LABELS[ctx.statusFilter] ?? ctx.statusFilter}`)
  }

  if (ctx.customerFilter) {
    const cust = ctx.customers.find((c) => c.id === ctx.customerFilter)
    out.push(`العميل: ${cust ? cust.company_name : 'غير محدد'}`)
  }

  if (ctx.governorateFilter) {
    const gov = ctx.governorates.find((g) => g.id === ctx.governorateFilter)
    out.push(`المحافظة: ${gov ? gov.name_ar : 'غير محددة'}`)
  }

  return out.length ? out : ['بدون فلاتر']
}

// ---------------------------------------------------------------------------
// HTML report (shared by print rendering)
// ---------------------------------------------------------------------------

function esc(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function reportHeaderHtml(meta: VisitsReportMeta, count: number): string {
  const gen = fmtDT(meta.generatedAt.toISOString())
  return `
    <div class="report-header">
      <div class="report-header-right">
        <div class="report-title">${esc(meta.title)}</div>
        <div class="report-subtitle">${esc(meta.subtitle || 'تقرير الزيارات المعروضة')}</div>
      </div>
      <div class="report-header-left">
        <div>تاريخ التقرير: ${esc(gen)}</div>
        <div>عدد الزيارات المشمولة: ${formatInteger(count)}</div>
      </div>
    </div>`
}

function reportFiltersHtml(meta: VisitsReportMeta): string {
  const items = meta.filterLines.length
    ? meta.filterLines.map((l) => `<span class="filter-chip">${esc(l)}</span>`).join('')
    : '<span class="filter-chip">بدون فلاتر</span>'
  return `
    <div class="report-filters">
      <span class="filter-label">الفلاتر المطبقة:</span>${items}
    </div>`
}

function customerInfoCellHtml(r: VisitsReportRow): string {
  const items: [string, string][] = []
  if (r.phone !== '—') items.push(['الهاتف', r.phone])
  if (r.address !== '—') items.push(['العنوان', r.address])
  if (r.visit_count > 0) items.push(['عدد الزيارات', fmtCount(r.visit_count)])
  if (r.order_count > 0) items.push(['عدد الطلبات', fmtCount(r.order_count)])
  if (r.orders_total > 0) items.push(['قيمة الطلبات', fmtMoney(r.orders_total)])
  if (r.last_order_date !== '—') items.push(['آخر طلب', r.last_order_date])
  if (r.last_visit_before !== '—') items.push(['آخر زيارة سابقة', r.last_visit_before])
  if (r.customer_created_at !== '—') items.push(['تاريخ الإنشاء', r.customer_created_at])
  if (r.creator !== '—') items.push(['أنشأ الحساب', r.creator])
  if (!items.length) return '—'
  return items.map(([l, v]) => `<div class="ci-line"><span class="ci-label">${esc(l)}:</span> ${esc(v)}</div>`).join('')
}

function reportTableHtml(rows: VisitsReportRow[]): string {
  const header = [
    'رمز الزيارة', 'الحالة', 'النتيجة', 'العميل', 'المسؤول',
    'بداية الزيارة', 'نهاية الزيارة', 'المدة',
    'إحداثيات البداية', 'إحداثيات النهاية', 'بيانات العميل',
    'تاريخ الإنشاء', 'ملاحظات الزيارة',
  ].map((label) => `<th>${esc(label)}</th>`).join('')
  const body = rows.map((r) => `
      <tr>
        <td class="cell-code" dir="ltr">${esc(r.code)}</td>
        <td>${esc(r.status)}</td>
        <td>${esc(r.result)}</td>
        <td class="cell-name">${esc(r.customer)}</td>
        <td>${esc(r.employee)}</td>
        <td dir="ltr">${esc(r.check_in)}</td>
        <td dir="ltr">${esc(r.check_out)}</td>
        <td>${esc(r.duration)}</td>
        <td class="cell-coords" dir="ltr">${esc(r.coords_in)}</td>
        <td class="cell-coords" dir="ltr">${esc(r.coords_out)}</td>
        <td class="cell-cinfo">${customerInfoCellHtml(r)}</td>
        <td dir="ltr">${esc(r.created_at)}</td>
        <td class="cell-notes">${esc(r.notes)}</td>
      </tr>`).join('')
  return `
    <table class="report-table">
      <colgroup>
        <col style="width:6%">
        <col style="width:5%">
        <col style="width:7%">
        <col style="width:11%">
        <col style="width:8%">
        <col style="width:9%">
        <col style="width:9%">
        <col style="width:6%">
        <col style="width:7%">
        <col style="width:7%">
        <col style="width:13%">
        <col style="width:7%">
        <col style="width:17%">
      </colgroup>
      <thead><tr>${header}</tr></thead>
      <tbody>${body}</tbody>
    </table>`
}

function reportTotalsHtml(totals: VisitsReportTotals): string {
  const boxes: { label: string; value: string }[] = [
    { label: 'إجمالي الزيارات', value: formatInteger(totals.visitCount) },
  ]
  return `
    <div class="report-totals">
      ${boxes.map((b) => `
        <div class="total-box">
          <div class="total-label">${esc(b.label)}</div>
          <div class="total-value">${esc(b.value)}</div>
        </div>`).join('')}
    </div>`
}

function buildReportHtml(rows: VisitsReportRow[], meta: VisitsReportMeta): string {
  const totals = buildVisitsReportTotals(rows)
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8">
<title>${esc(meta.title)}</title>
<style>
  @page { size: A4 landscape; margin: 8mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #1a2332; }
  .report { width: 100%; padding: 3mm 2mm; }
  .report-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4mm; border-bottom: 2px solid #1f3a5f; padding-bottom: 3mm; }
  .report-title { font-size: 17px; font-weight: 800; color: #1f3a5f; }
  .report-subtitle { font-size: 11px; color: #55606e; margin-top: 1px; }
  .report-header-left { text-align: left; font-size: 11px; color: #3a4553; line-height: 1.7; }
  .report-filters { background: #f2f5f9; border: 1px solid #dbe2ea; border-radius: 4px; padding: 2.5mm 3mm; margin-bottom: 4mm; display: flex; flex-wrap: wrap; gap: 2mm; align-items: center; }
  .filter-label { font-size: 11px; font-weight: 700; color: #1f3a5f; }
  .filter-chip { font-size: 10.5px; color: #374151; background: #fff; border: 1px solid #d5dce5; border-radius: 3px; padding: 0.8mm 2mm; }
  table.report-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 9px; }
  table.report-table th { background: #1f3a5f; color: #fff; font-size: 9px; font-weight: 700; padding: 2.4mm 1mm; text-align: center; border: 1px solid #1f3a5f; }
  table.report-table td { border: 1px solid #ccd3dc; padding: 1.8mm 1mm; text-align: center; vertical-align: middle; word-break: break-word; overflow-wrap: break-word; }
  table.report-table tbody tr:nth-child(even) { background: #f8fafc; }
  table.report-table td.cell-name { text-align: right; font-weight: 700; }
  table.report-table td.cell-code { font-family: 'Courier New', monospace; font-size: 8px; }
  table.report-table td.cell-coords { font-family: 'Courier New', monospace; font-size: 7.5px; color: #3a4553; }
  table.report-table td.cell-notes { text-align: right; font-size: 8px; color: #3a4553; }
  table.report-table td.cell-cinfo { text-align: right; font-size: 8px; }
  table.report-table td.cell-cinfo .ci-line { padding: 1px 0; color: #3a4553; }
  table.report-table td.cell-cinfo .ci-label { font-weight: 700; color: #1f3a5f; }
  .report-totals { margin-top: 5mm; display: flex; flex-wrap: wrap; gap: 3mm; }
  .total-box { flex: 1; min-width: 40mm; background: #f2f5f9; border: 1px solid #d5dce5; border-radius: 4px; padding: 2.5mm 3mm; text-align: center; }
  .total-label { font-size: 9.5px; color: #55606e; }
  .total-value { font-size: 13px; font-weight: 800; color: #1f3a5f; margin-top: 1mm; }
  @media print {
    .report { padding: 0; }
  }
</style>
</head>
<body>
<div class="report">
  ${reportHeaderHtml(meta, rows.length)}
  ${reportFiltersHtml(meta)}
  ${reportTableHtml(rows)}
  ${reportTotalsHtml(totals)}
</div>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Excel export
// ---------------------------------------------------------------------------

export function exportVisitsReportExcel(rows: VisitsReportRow[], meta: VisitsReportMeta): void {
  const totals = buildVisitsReportTotals(rows)

  const data: Record<string, unknown>[] = rows.map((r) => ({ ...r }))

  const summary: { label: string; value: number; format?: 'number' | 'currency' }[] = [
    { label: 'إجمالي الزيارات', value: totals.visitCount, format: 'number' },
  ]

  const columnWidths = [16, 10, 12, 26, 16, 16, 16, 10, 18, 18, 12, 12, 14, 14, 16, 15, 28, 14, 14, 16, 40]

  exportToExcel({
    title: meta.title,
    subtitle: meta.subtitle || 'تقرير الزيارات المعروضة',
    columns: VISITS_REPORT_COLUMNS.map((c) => ({ key: c.key, label: c.label, format: c.format })),
    data,
    fileName: meta.fileName,
    summary,
    filters: meta.filterLines.length ? meta.filterLines : ['بدون فلاتر'],
    columnWidths,
    presentation: { rtl: true, landscape: true, fitToWidth: true, printTitles: true },
  })
}

// ---------------------------------------------------------------------------
// Print
// ---------------------------------------------------------------------------

export function printVisitsReport(rows: VisitsReportRow[], meta: VisitsReportMeta): void {
  printInvoice(buildReportHtml(rows, meta))
}