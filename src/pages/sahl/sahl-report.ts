import { exportToExcel, type ExportColumn, type ExportOptions } from '../../services/excelExporter'
import { cairoDateComponents } from '../../lib/dateRange'

/* ── Generic SAHL report helpers — reuse across every SAHL page ── */

export type SahlReportColumn = ExportColumn

export interface SahlReportRow {
  [key: string]: unknown
}

export interface SahlReportMeta {
  title: string
  subtitle?: string
  fileName: string
  dateFrom?: string
  dateTo?: string
  filters?: string[]
  columnWidths?: number[]
  summary?: { label: string; value: number; format?: 'number' | 'currency' }[]
}

/** Build an Arabic date string: dd/mm/yyyy */
function fmtArabicDate(iso: string): string {
  try {
    const d = new Date(iso)
    const [y, m, day] = cairoDateComponents(d)
    return `${day}/${String(m).padStart(2, '0')}/${y}`
  } catch { return iso.slice(0, 10) }
}

/** Format a date filter preset into an Arabic label */
export function datePresetLabel(preset: string): string {
  const map: Record<string, string> = {
    all: 'كل الفترات', today: 'اليوم', yesterday: 'الأمس',
    week: 'هذا الأسبوع', prev_week: 'الأسبوع السابق',
    month: 'هذا الشهر', prev_month: 'الشهر السابق',
    year: 'هذا العام', custom: 'نطاق مخصص',
  }
  return map[preset] || preset
}

/** Export a SAHL page to a styled Excel file */
export function sahlExportExcel(meta: SahlReportMeta, columns: SahlReportColumn[], data: SahlReportRow[]): void {
  if (!data.length) return
  const opts: ExportOptions = {
    title: meta.title,
    subtitle: meta.subtitle,
    columns,
    data,
    fileName: meta.fileName,
    dateFrom: meta.dateFrom,
    dateTo: meta.dateTo,
    summary: meta.summary,
    filters: meta.filters,
    columnWidths: meta.columnWidths,
    presentation: { rtl: true, landscape: true, fitToWidth: true, printTitles: true },
  }
  exportToExcel(opts)
}

/* ── Generic SAHL print via hidden iframe ── */

function printViaIframe(html: string): void {
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  document.body.appendChild(frame)
  const win = frame.contentWindow
  if (!win) { document.body.removeChild(frame); return }
  win.document.open()
  win.document.write(html)
  win.document.close()
  const done = () => {
    try { win.focus(); win.print() } finally {
      setTimeout(() => { try { document.body.removeChild(frame) } catch {} }, 1000)
    }
  }
  if (win.document.readyState === 'complete') setTimeout(done, 200)
  else win.addEventListener('load', () => setTimeout(done, 200))
}

/** Print a generic SAHL page as an A4 RTL report */
export function sahlPrintReport(meta: SahlReportMeta, columns: SahlReportColumn[], data: SahlReportRow[]): void {
  const now = new Date()
  const printDate = now.toLocaleDateString('ar-EG-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' })
  const printTime = now.toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit', hour12: true })

  const headerRow = columns.map(c => `<th style="background:#1e293b;color:#fff;padding:8px 10px;text-align:right;font-size:11px;border:1px solid #475569">${c.label}</th>`).join('')

  const dataRows = data.map((row, ri) => {
    const bg = ri % 2 === 1 ? '#f8fafc' : '#fff'
    const cells = columns.map(c => {
      const v = row[c.key]
      const display = v == null ? '' : c.format === 'currency' ? Number(v).toLocaleString('ar-EG') : String(v)
      const align = c.format === 'currency' || c.format === 'number' ? 'text-align:left;font-variant-numeric:tabular-nums' : ''
      return `<td style="padding:6px 8px;border:1px solid #e2e8f0;font-size:11px;background:${bg};${align}">${display}</td>`
    }).join('')
    return `<tr>${cells}</tr>`
  }).join('')

  const filterLines = (meta.filters || []).map(f => `<span style="display:inline-block;background:#f1f5f9;padding:2px 8px;border-radius:4px;font-size:10px;margin:2px">${f}</span>`).join('')

  const summaryHtml = meta.summary?.length ? `
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin:12px 0;padding:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px">
      ${meta.summary.map(s => `
        <div style="text-align:center;min-width:100px">
          <div style="font-size:10px;color:#64748b">${s.label}</div>
          <div style="font-size:16px;font-weight:bold;color:#0f172a;margin-top:2px">${s.format === 'currency' ? Number(s.value).toLocaleString('ar-EG') : s.value}</div>
        </div>
      `).join('')}
    </div>` : ''

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar"><head><meta charset="utf-8"/>
<title>${meta.title}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; padding: 0; color: #0f172a; }
  .report-header { text-align: center; border-bottom: 2px solid #1e293b; padding-bottom: 10px; margin-bottom: 12px; }
  .report-header h1 { font-size: 18px; color: #1e293b; }
  .report-header .sub { font-size: 11px; color: #64748b; margin-top: 4px; }
  .meta-row { display: flex; justify-content: space-between; font-size: 10px; color: #64748b; margin-bottom: 10px; }
  .filters { margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; }
  .foot { text-align: center; font-size: 10px; color: #94a3b8; border-top: 1px solid #e2e8f0; margin-top: 12px; padding-top: 6px; }
</style></head><body>
  <div class="report-header">
    <h1>${meta.title}</h1>
    ${meta.subtitle ? `<div class="sub">${meta.subtitle}</div>` : ''}
  </div>
  <div class="meta-row">
    <span>تاريخ الطباعة: ${printDate} | ${printTime}</span>
    ${meta.dateFrom && meta.dateTo ? `<span>الفترة: ${fmtArabicDate(meta.dateFrom)} — ${fmtArabicDate(meta.dateTo)}</span>` : ''}
    <span>${data.length} سجل</span>
  </div>
  ${filterLines ? `<div class="filters">${filterLines}</div>` : ''}
  ${summaryHtml}
  <table>
    <thead><tr>${headerRow}</tr></thead>
    <tbody>${dataRows || `<tr><td colspan="${columns.length}" style="text-align:center;padding:20px;color:#94a3b8">لا توجد بيانات</td></tr>`}</tbody>
  </table>
  <div class="foot">نظام سهل — الأهرام للتوزيع</div>
</body></html>`

  printViaIframe(html)
}
