import type { CustomerCardData } from '../types/customers'
import { formatCurrencyShort, formatDate } from '../utils/format'
import { formatInteger } from '../utils/numbers'
import { cairoDateComponents } from '../lib/dateRange'
import { exportToExcel } from './excelExporter'
import { printInvoice } from '../components/orders/order-printing'

export interface CustomerReportRow {
  company_name: string
  phone: string
  address: string
  governorate: string
  created_at: string
  owner_name: string
  previous_orders_total: number
  previous_order_count: number
  last_order_total: number | null
  last_order_date: string
  delivered_total: number
  visit_count: number
  last_visit_date: string
}

export interface CustomerReportTotals {
  customerCount: number
  totalSales: number
  totalDelivered: number
  totalOrders: number
  totalVisits: number
}

export interface CustomerReportMeta {
  title: string
  generatedAt: Date
  filterLines: string[]
  fileName: string
}

export interface CustomerReportFilterContext {
  search: string
  datePreset: string
  dateFrom: string
  dateTo: string
  employeeId: string
  myOnly: boolean
  quickFilters: { noOrders: boolean; noVisits: boolean; noLocation: boolean; needsCorrection: boolean }
  governorateId: string
  employees: { id: string; name: string }[]
  governorates: { id: string; name_ar: string }[]
}

export interface CustomerReportColumn {
  key: keyof CustomerReportRow
  label: string
  format?: 'number' | 'currency'
}

export const CUSTOMER_REPORT_COLUMNS: CustomerReportColumn[] = [
  { key: 'company_name', label: 'اسم العميل' },
  { key: 'phone', label: 'الهاتف' },
  { key: 'address', label: 'العنوان' },
  { key: 'created_at', label: 'تاريخ الإنشاء' },
  { key: 'owner_name', label: 'المسؤول الحالي' },
  { key: 'previous_orders_total', label: 'إجمالي المبيعات', format: 'currency' },
  { key: 'previous_order_count', label: 'عدد الطلبات', format: 'number' },
  { key: 'last_order_total', label: 'قيمة آخر طلب', format: 'currency' },
  { key: 'last_order_date', label: 'تاريخ آخر طلب' },
  { key: 'delivered_total', label: 'إجمالي المنفذ فعليًا', format: 'currency' },
  { key: 'visit_count', label: 'إجمالي الزيارات', format: 'number' },
  { key: 'last_visit_date', label: 'تاريخ آخر زيارة' },
]

const DATE_PRESET_LABELS: Record<string, string> = {
  all: 'كل الفترات',
  today: 'اليوم',
  yesterday: 'أمس',
  week: 'آخر 7 أيام',
  month: 'هذا الشهر',
  prev_month: 'الشهر السابق',
  custom: 'فترة مخصصة',
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

export function buildCustomerReportRows(customers: CustomerCardData[], governorates: { id: string; name_ar: string }[] = []): CustomerReportRow[] {
  const governorateById = new Map(governorates.map((g) => [g.id, g.name_ar]))
  return customers.map((c) => ({
    company_name: safeStr(c.company_name),
    phone: safeStr(c.phone),
    address: safeStr(c.registered_address || c.location_address),
    governorate: c.manual_governorate_id ? governorateById.get(c.manual_governorate_id) || '' : '',
    created_at: fmtDate(c.created_at),
    owner_name: safeStr(c.owner_name),
    previous_orders_total: Number(c.previous_orders_total || 0),
    previous_order_count: Number(c.previous_order_count || 0),
    last_order_total: c.last_order_total != null ? Number(c.last_order_total) : null,
    last_order_date: fmtDate(c.last_order_date),
    delivered_total: Number(c.delivered_total || 0),
    visit_count: Number(c.visit_count || 0),
    last_visit_date: fmtDate(c.last_visit_date),
  }))
}

export function buildCustomerReportTotals(rows: CustomerReportRow[]): CustomerReportTotals {
  const sum = (fn: (r: CustomerReportRow) => number) =>
    rows.reduce((acc, r) => acc + (Number(fn(r)) || 0), 0)
  return {
    customerCount: rows.length,
    totalSales: sum((r) => r.previous_orders_total),
    totalDelivered: sum((r) => r.delivered_total),
    totalOrders: sum((r) => r.previous_order_count),
    totalVisits: sum((r) => r.visit_count),
  }
}

export function buildCustomerReportFilterSummary(ctx: CustomerReportFilterContext): string[] {
  const out: string[] = []
  if (ctx.search && ctx.search.trim()) out.push(`بحث: "${ctx.search.trim()}"`)

  if (ctx.myOnly) {
    out.push('النطاق: عملائي فقط')
  } else if (ctx.employeeId) {
    const emp = ctx.employees.find((e) => e.id === ctx.employeeId)
    out.push(`المسؤول: ${emp ? emp.name : 'غير محدد'}`)
  } else {
    out.push('المسؤول: كل الموظفين')
  }

  if (ctx.datePreset === 'custom' && ctx.dateFrom && ctx.dateTo) {
    out.push(`الفترة: ${ctx.dateFrom} إلى ${ctx.dateTo}`)
  } else {
    out.push(`الفترة: ${DATE_PRESET_LABELS[ctx.datePreset] ?? 'كل الفترات'}`)
  }

  const gov = ctx.governorates.find((g) => g.id === ctx.governorateId)
  out.push(gov ? `المحافظة: ${gov.name_ar}` : 'المحافظة: كل المحافظات')

  const quick: string[] = []
  if (ctx.quickFilters.needsCorrection) quick.push('يحتاج تصحيح عنوان')
  if (ctx.quickFilters.noOrders) quick.push('بدون طلبات')
  if (ctx.quickFilters.noVisits) quick.push('بدون زيارات')
  if (ctx.quickFilters.noLocation) quick.push('بدون رابط لوكيشن')
  if (quick.length) out.push(`فلاتر إضافية: ${quick.join('، ')}`)

  return out
}

// ---------------------------------------------------------------------------
// HTML report (shared by print + PDF rendering)
// ---------------------------------------------------------------------------

function esc(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function reportHeaderHtml(meta: CustomerReportMeta, count: number): string {
  const gen = formatDate(meta.generatedAt)
  return `
    <div class="report-header">
      <div class="report-header-right">
        <div class="report-title">${esc(meta.title)}</div>
        <div class="report-subtitle">تقرير شامل لحالة العملاء</div>
      </div>
      <div class="report-header-left">
        <div>تاريخ التقرير: ${esc(gen)}</div>
        <div>عدد العملاء المشمولين: ${formatInteger(count)}</div>
      </div>
    </div>`
}

function reportFiltersHtml(meta: CustomerReportMeta): string {
  const items = meta.filterLines.length
    ? meta.filterLines.map((l) => `<span class="filter-chip">${esc(l)}</span>`).join('')
    : '<span class="filter-chip">بدون فلاتر</span>'
  return `
    <div class="report-filters">
      <span class="filter-label">الفلاتر المطبقة:</span>${items}
    </div>`
}

function reportTableHtml(rows: CustomerReportRow[]): string {
  const header = CUSTOMER_REPORT_COLUMNS.map((c) => `<th>${esc(c.label)}</th>`).join('')
  const body = rows.map((r) => `
      <tr>
        <td class="cell-name">${esc(r.company_name)}</td>
        <td>${esc(r.phone)}</td>
        <td class="cell-addr">${esc(r.address)}</td>
        <td>${esc(r.created_at)}</td>
        <td>${esc(r.owner_name)}</td>
        <td>${fmtMoney(r.previous_orders_total)}</td>
        <td>${fmtCount(r.previous_order_count)}</td>
        <td>${fmtMoney(r.last_order_total)}</td>
        <td>${esc(r.last_order_date)}</td>
        <td class="cell-delivered">${fmtMoney(r.delivered_total)}</td>
        <td>${fmtCount(r.visit_count)}</td>
        <td>${esc(r.last_visit_date)}</td>
      </tr>`).join('')
  return `
    <table class="report-table">
      <thead><tr>${header}</tr></thead>
      <tbody>${body}</tbody>
    </table>`
}

function reportTotalsHtml(totals: CustomerReportTotals): string {
  const boxes: { label: string; value: string }[] = [
    { label: 'إجمالي العملاء', value: formatInteger(totals.customerCount) },
    { label: 'إجمالي المبيعات', value: formatCurrencyShort(totals.totalSales) },
    { label: 'إجمالي المنفذ فعليًا', value: formatCurrencyShort(totals.totalDelivered) },
    { label: 'إجمالي الطلبات', value: formatInteger(totals.totalOrders) },
    { label: 'إجمالي الزيارات', value: formatInteger(totals.totalVisits) },
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

function buildReportHtml(rows: CustomerReportRow[], meta: CustomerReportMeta): string {
  const totals = buildCustomerReportTotals(rows)
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
  table.report-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 9.5px; }
  table.report-table th { background: #1f3a5f; color: #fff; font-size: 9.5px; font-weight: 700; padding: 2.6mm 1.2mm; text-align: center; border: 1px solid #1f3a5f; }
  table.report-table td { border: 1px solid #ccd3dc; padding: 2mm 1.2mm; text-align: center; vertical-align: middle; word-break: break-word; overflow-wrap: break-word; }
  table.report-table tbody tr:nth-child(even) { background: #f8fafc; }
  table.report-table td.cell-name { text-align: right; font-weight: 700; }
  table.report-table td.cell-addr { text-align: right; font-size: 8.5px; color: #3a4553; }
  table.report-table td.cell-delivered { font-weight: 700; color: #047857; }
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
// PDF export
//
// The downloaded PDF is produced from the SAME printable HTML used by the
// print preview (buildReportHtml), so the browser's native text engine does all
// Arabic shaping and bidi re-ordering exactly as the printable report does.
// The page is rasterised with html2canvas and sliced into A4-landscape pages;
// the page-number footer is drawn on a canvas (again by the browser), which
// keeps Arabic correct there too.
// ---------------------------------------------------------------------------

const PDF_PAGE_W = 297 // mm, A4 landscape
const PDF_PAGE_H = 210 // mm
const PDF_MARGIN = 8 // mm
const PDF_CONTENT_W = PDF_PAGE_W - PDF_MARGIN * 2 // 281mm
const PDF_CONTENT_H = PDF_PAGE_H - PDF_MARGIN * 2 // 194mm
const PDF_RENDER_SCALE = 2

function pdfMmToPx(mm: number): number {
  return Math.round((mm / 25.4) * 96 * PDF_RENDER_SCALE)
}

// Draws a page-number footer with the browser text engine, so Arabic is shaped
// and re-ordered correctly even though jsPDF cannot handle Arabic itself.
function pdfFooterImage(text: string): string {
  const width = pdfMmToPx(PDF_PAGE_W)
  const height = pdfMmToPx(8)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.fillStyle = '#55606e'
    ctx.font = `${Math.round(8 * PDF_RENDER_SCALE)}px 'Segoe UI', Tahoma, Arial, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, width / 2, height / 2)
  }
  return canvas.toDataURL('image/png')
}

export async function exportCustomersReportPdf(rows: CustomerReportRow[], meta: CustomerReportMeta): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const html2canvas = (await import('html2canvas')).default

  const parsed = new DOMParser().parseFromString(buildReportHtml(rows, meta), 'text/html')

  const container = document.createElement('div')
  container.style.cssText = `position:fixed;left:-9999px;top:0;width:${PDF_CONTENT_W}mm;background:#ffffff;direction:rtl`
  Array.from(parsed.querySelectorAll('style')).forEach((style) => container.appendChild(style.cloneNode(true)))
  container.innerHTML += parsed.body.innerHTML
  document.body.appendChild(container)

  // Let fonts/layout settle before rasterising.
  await new Promise((resolve) => setTimeout(resolve, 400))

  const canvas = await html2canvas(container, {
    scale: PDF_RENDER_SCALE,
    useCORS: true,
    logging: false,
    backgroundColor: '#ffffff',
  })
  document.body.removeChild(container)

  const sliceH = pdfMmToPx(PDF_CONTENT_H)
  const pageCount = Math.max(1, Math.ceil(canvas.height / sliceH))

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  for (let i = 0; i < pageCount; i++) {
    if (i > 0) pdf.addPage('a4', 'landscape')

    const srcY = Math.min(i * sliceH, Math.max(0, canvas.height - 1))
    const bandH = Math.min(sliceH, canvas.height - srcY)

    const band = document.createElement('canvas')
    band.width = canvas.width
    band.height = Math.max(1, bandH)
    const bctx = band.getContext('2d')
    if (bctx) {
      bctx.fillStyle = '#ffffff'
      bctx.fillRect(0, 0, band.width, band.height)
      bctx.drawImage(canvas, 0, srcY, canvas.width, bandH, 0, 0, canvas.width, bandH)
    }

    const drawH = PDF_CONTENT_H * (bandH / sliceH)
    pdf.addImage(band.toDataURL('image/jpeg', 0.92), 'JPEG', PDF_MARGIN, PDF_MARGIN, PDF_CONTENT_W, drawH)

    pdf.addImage(
      pdfFooterImage(`الصفحة ${i + 1} من ${pageCount}`),
      'PNG',
      PDF_MARGIN,
      PDF_PAGE_H - PDF_MARGIN - 2.5,
      PDF_PAGE_W - PDF_MARGIN * 2,
      5,
      undefined,
      'FAST',
    )
  }

  pdf.save(`${meta.fileName}.pdf`)
}

// ---------------------------------------------------------------------------
// Excel export
// ---------------------------------------------------------------------------

export function exportCustomersReportExcel(rows: CustomerReportRow[], meta: CustomerReportMeta): void {
  const totals = buildCustomerReportTotals(rows)

  const excelColumns: CustomerReportColumn[] = []
  for (const c of CUSTOMER_REPORT_COLUMNS) {
    excelColumns.push(c)
    if (c.key === 'address') excelColumns.push({ key: 'governorate', label: 'المحافظة' })
  }

  const data: Record<string, unknown>[] = rows.map((r) => ({
    company_name: r.company_name,
    phone: r.phone,
    address: r.address,
    governorate: r.governorate,
    created_at: r.created_at,
    owner_name: r.owner_name,
    previous_orders_total: r.previous_orders_total,
    previous_order_count: r.previous_order_count,
    last_order_total: r.last_order_total != null ? r.last_order_total : 0,
    last_order_date: r.last_order_date,
    delivered_total: r.delivered_total,
    visit_count: r.visit_count,
    last_visit_date: r.last_visit_date,
  }))

  const summary: { label: string; value: number; format?: 'number' | 'currency' }[] = [
    { label: 'إجمالي العملاء', value: totals.customerCount, format: 'number' },
    { label: 'إجمالي الطلبات', value: totals.totalOrders, format: 'number' },
    { label: 'إجمالي المبيعات', value: totals.totalSales, format: 'currency' },
    { label: 'إجمالي المنفذ فعليًا', value: totals.totalDelivered, format: 'currency' },
    { label: 'إجمالي الزيارات', value: totals.totalVisits, format: 'number' },
  ]

  const columnWidths = [30, 16, 26, 14, 15, 16, 15, 12, 14, 15, 15, 12, 15]

  exportToExcel({
    title: meta.title,
    subtitle: 'تقرير شامل لحالة العملاء',
    columns: excelColumns.map((c) => ({ key: c.key, label: c.label, format: c.format })),
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

export function printCustomersReport(rows: CustomerReportRow[], meta: CustomerReportMeta): void {
  printInvoice(buildReportHtml(rows, meta))
}
