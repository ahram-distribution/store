import { formatCurrencyShort } from '../utils/format'
import { formatInteger } from '../utils/numbers'
import { cairoDateComponents } from '../lib/dateRange'
import { exportToExcel } from './excelExporter'
import { printInvoice } from '../components/orders/order-printing'
import { ORDER_STATUS_LABELS, orderTypeLabel, visibleStatusLabel } from '../types/order-display'

export interface OrdersReportRow {
  company_name: string
  total_amount: number
  created_at: string
  address: string
  governorate: string
  phone: string
  owner_name: string
  previous_order_count: number
  previous_orders_total: number
  last_order_total: number | null
  last_order_date: string
  status: string
  order_number: string
  reference_number: string
}

export interface OrdersReportTotals {
  orderCount: number
  totalValue: number
}

export interface OrdersReportMeta {
  title: string
  subtitle?: string
  generatedAt: Date
  filterLines: string[]
  fileName: string
}

export interface OrdersReportColumn {
  key: keyof OrdersReportRow
  label: string
  format?: 'number' | 'currency'
}

export const ORDERS_REPORT_COLUMNS: OrdersReportColumn[] = [
  { key: 'company_name', label: 'اسم العميل' },
  { key: 'total_amount', label: 'قيمة الطلب', format: 'currency' },
  { key: 'created_at', label: 'تاريخ الطلب' },
  { key: 'address', label: 'العنوان' },
  { key: 'governorate', label: 'المحافظة' },
  { key: 'phone', label: 'رقم التليفون' },
  { key: 'owner_name', label: 'المسؤول عن العميل' },
  { key: 'previous_order_count', label: 'عدد الطلبات السابقة', format: 'number' },
  { key: 'previous_orders_total', label: 'إجمالي الطلبات السابقة', format: 'currency' },
  { key: 'last_order_total', label: 'قيمة آخر طلب سابق', format: 'currency' },
  { key: 'last_order_date', label: 'تاريخ آخر طلب سابق' },
  { key: 'status', label: 'حالة الطلب' },
  { key: 'order_number', label: 'رقم الطلب' },
  { key: 'reference_number', label: 'الرقم المرجعي' },
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

const TAB_LABELS: Record<string, string> = {
  all: 'الكل',
  my_orders: 'طلباتي',
  my_invoices: 'فواتيري',
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const [y, m, day] = cairoDateComponents(d)
  return `${String(day).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
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

/** المحافظة: prefer the governorate id → name mapping; fall back to the first
 *  segment of the display address only when it matches a known reference
 *  governorate name (avoids reporting a city as a governorate). */
function resolveGovernorate(order: any, governorateById: Map<string, string>, governorateNames: Set<string>): string {
  if (order.customer_governorate_id) {
    const name = governorateById.get(order.customer_governorate_id)
    if (name) return name
  }
  const addr = order.customer_display_address
  if (addr && typeof addr === 'string') {
    const first = addr.split(' - ')[0].trim()
    if (first && governorateNames.has(first)) return first
  }
  return '—'
}

export function buildOrdersReportRows(orders: any[], governorates: { id: string; name_ar: string }[] = []): OrdersReportRow[] {
  const governorateById = new Map(governorates.map((g) => [g.id, g.name_ar]))
  const governorateNames = new Set(governorates.map((g) => g.name_ar))
  return orders.map((o) => ({
    company_name: safeStr(o.customer_name),
    total_amount: Number(o.total_amount || 0),
    created_at: fmtDate(o.created_at),
    address: safeStr(o.customer_display_address),
    governorate: resolveGovernorate(o, governorateById, governorateNames),
    phone: safeStr(o.customer_phone),
    owner_name: safeStr(o.customer_owner_name),
    previous_order_count: Number(o.strict_previous_order_count ?? 0),
    previous_orders_total: Number(o.strict_previous_orders_total ?? 0),
    last_order_total: o.strict_previous_order_total != null ? Number(o.strict_previous_order_total) : null,
    last_order_date: fmtDate(o.strict_previous_order_date),
    status: visibleStatusLabel(o.status || ''),
    order_number: safeStr(o.order_number),
    reference_number: safeStr(o.reference_number),
  }))
}

export function buildOrdersReportTotals(rows: OrdersReportRow[]): OrdersReportTotals {
  return {
    orderCount: rows.length,
    totalValue: rows.reduce((acc, r) => acc + (Number(r.total_amount) || 0), 0),
  }
}

export function buildOrdersReportFilterSummary(ctx: {
  tab: string
  datePreset: string
  dateFrom: string
  dateTo: string
  search: string
  employeeId: string
  statusFilter: string
  customerFilter: string
  orderTypeFilter: string
  governorateFilter: string
  employees: { id: string; name: string }[]
  customers: { id: string; company_name: string }[]
  governorates: { id: string; name_ar: string }[]
}): string[] {
  const out: string[] = []

  out.push(`النوع: ${TAB_LABELS[ctx.tab] ?? 'الكل'}`)

  if (ctx.datePreset === 'custom' && ctx.dateFrom && ctx.dateTo) {
    out.push(`الفترة: ${ctx.dateFrom} إلى ${ctx.dateTo}`)
  } else {
    out.push(`الفترة: ${DATE_PRESET_LABELS[ctx.datePreset] ?? 'كل الفترات'}`)
  }

  if (ctx.search && ctx.search.trim()) out.push(`بحث: "${ctx.search.trim()}"`)

  if (ctx.employeeId) {
    const emp = ctx.employees.find((e) => e.id === ctx.employeeId)
    out.push(`المسؤول: ${emp ? emp.name : 'غير محدد'}`)
  }

  if (ctx.statusFilter) {
    const label = ORDER_STATUS_LABELS[ctx.statusFilter] || ctx.statusFilter
    out.push(`الحالة: ${label}`)
  }

  if (ctx.customerFilter) {
    const cust = ctx.customers.find((c) => c.id === ctx.customerFilter)
    out.push(`العميل: ${cust ? cust.company_name : 'غير محدد'}`)
  }

  if (ctx.orderTypeFilter) {
    out.push(`نوع الطلب: ${orderTypeLabel(ctx.orderTypeFilter)}`)
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

function reportHeaderHtml(meta: OrdersReportMeta, count: number): string {
  const gen = fmtDate(meta.generatedAt.toISOString())
  return `
    <div class="report-header">
      <div class="report-header-right">
        <div class="report-title">${esc(meta.title)}</div>
        <div class="report-subtitle">${esc(meta.subtitle || 'تقرير الطلبات المعروضة')}</div>
      </div>
      <div class="report-header-left">
        <div>تاريخ التقرير: ${esc(gen)}</div>
        <div>عدد الطلبات المشمولة: ${formatInteger(count)}</div>
      </div>
    </div>`
}

function reportFiltersHtml(meta: OrdersReportMeta): string {
  const items = meta.filterLines.length
    ? meta.filterLines.map((l) => `<span class="filter-chip">${esc(l)}</span>`).join('')
    : '<span class="filter-chip">بدون فلاتر</span>'
  return `
    <div class="report-filters">
      <span class="filter-label">الفلاتر المطبقة:</span>${items}
    </div>`
}

function reportTableHtml(rows: OrdersReportRow[]): string {
  const header = ORDERS_REPORT_COLUMNS.map((c) => `<th>${esc(c.label)}</th>`).join('')
  const body = rows.map((r) => `
      <tr>
        <td class="cell-name">${esc(r.company_name)}</td>
        <td>${fmtMoney(r.total_amount)}</td>
        <td>${esc(r.created_at)}</td>
        <td class="cell-addr">${esc(r.address)}</td>
        <td>${esc(r.governorate)}</td>
        <td dir="ltr">${esc(r.phone)}</td>
        <td>${esc(r.owner_name)}</td>
        <td>${fmtCount(r.previous_order_count)}</td>
        <td>${fmtMoney(r.previous_orders_total)}</td>
        <td>${fmtMoney(r.last_order_total)}</td>
        <td>${esc(r.last_order_date)}</td>
        <td>${esc(r.status)}</td>
        <td class="cell-order-no" dir="ltr">${esc(r.order_number)}</td>
        <td class="cell-order-no" dir="ltr">${esc(r.reference_number)}</td>
      </tr>`).join('')
  return `
    <table class="report-table">
      <thead><tr>${header}</tr></thead>
      <tbody>${body}</tbody>
    </table>`
}

function reportTotalsHtml(totals: OrdersReportTotals): string {
  const boxes: { label: string; value: string }[] = [
    { label: 'إجمالي الطلبات', value: formatInteger(totals.orderCount) },
    { label: 'إجمالي قيمة الطلبات', value: formatCurrencyShort(totals.totalValue) },
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

function buildReportHtml(rows: OrdersReportRow[], meta: OrdersReportMeta): string {
  const totals = buildOrdersReportTotals(rows)
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
  table.report-table td.cell-addr { text-align: right; font-size: 8px; color: #3a4553; }
  table.report-table td.cell-order-no { font-family: 'Courier New', monospace; font-size: 8px; }
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

export function exportOrdersReportExcel(rows: OrdersReportRow[], meta: OrdersReportMeta): void {
  const totals = buildOrdersReportTotals(rows)

  const data: Record<string, unknown>[] = rows.map((r) => ({
    company_name: r.company_name,
    total_amount: r.total_amount,
    created_at: r.created_at,
    address: r.address,
    governorate: r.governorate,
    phone: r.phone,
    owner_name: r.owner_name,
    previous_order_count: r.previous_order_count,
    previous_orders_total: r.previous_orders_total,
    last_order_total: r.last_order_total != null ? r.last_order_total : 0,
    last_order_date: r.last_order_date,
    status: r.status,
    order_number: r.order_number,
    reference_number: r.reference_number,
  }))

  const summary: { label: string; value: number; format?: 'number' | 'currency' }[] = [
    { label: 'إجمالي الطلبات', value: totals.orderCount, format: 'number' },
    { label: 'إجمالي قيمة الطلبات', value: totals.totalValue, format: 'currency' },
  ]

  const columnWidths = [26, 12, 14, 26, 14, 15, 18, 12, 14, 12, 14, 16, 16, 14]

  exportToExcel({
    title: meta.title,
    subtitle: meta.subtitle || 'تقرير الطلبات المعروضة',
    columns: ORDERS_REPORT_COLUMNS.map((c) => ({ key: c.key, label: c.label, format: c.format })),
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

export function printOrdersReport(rows: OrdersReportRow[], meta: OrdersReportMeta): void {
  printInvoice(buildReportHtml(rows, meta))
}
