import { cairoDateComponents } from '../lib/dateRange'

export interface PdfSection {
  title: string
  subtitle?: string
  content: string
}

export interface ReportIdentityInfo {
  roleLabel?: string
  ownerName?: string
  managerName?: string
}

export interface PdfOptions {
  title: string
  subtitle?: string
  identity?: ReportIdentityInfo
  dateFrom?: string
  dateTo?: string
  sections: PdfSection[]
  orientation?: 'portrait' | 'landscape'
}

function buildStyles(): string {
  return `
    @page { size: A4; margin: 18mm 15mm }
    * { box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
      font-size: 11px;
      color: #1e293b;
      margin: 0;
      padding: 0;
      line-height: 1.5;
    }

    /* ── Header ── */
    .report-header {
      text-align: center;
      border-bottom: 3px solid #2563eb;
      padding-bottom: 14px;
      margin-bottom: 20px;
    }
    .report-header h1 {
      font-size: 20px;
      color: #1e293b;
      margin: 0 0 2px;
      font-weight: 800;
      letter-spacing: 0.3px;
    }
    .report-header .role-line {
      font-size: 12px;
      color: #475569;
      margin: 4px 0 0;
      font-weight: 600;
    }
    .report-header .owner-name {
      font-size: 14px;
      color: #2563eb;
      margin: 6px 0 0;
      font-weight: 700;
    }
    .report-header .manager-line {
      font-size: 11px;
      color: #64748b;
      margin: 3px 0 0;
    }
    .report-header .period-line {
      font-size: 11px;
      color: #475569;
      margin: 10px 0 2px;
      padding: 5px 14px;
      background: #f1f5f9;
      border-radius: 6px;
      display: inline-block;
    }
    .report-header .meta-line {
      font-size: 9.5px;
      color: #94a3b8;
      margin: 6px 0 0;
    }
    .report-header .meta-line span {
      margin: 0 6px;
    }

    /* ── Sections ── */
    .section {
      margin-bottom: 18px;
      page-break-inside: avoid;
    }
    .section h2 {
      font-size: 13px;
      color: #2563eb;
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 5px;
      margin: 0 0 10px;
      font-weight: 700;
    }
    .section .subtitle {
      font-size: 10px;
      color: #64748b;
      margin: 0 0 8px;
    }

    /* ── Tables ── */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10.5px;
      margin-bottom: 10px;
    }
    thead tr {
      background: #f1f5f9;
    }
    th {
      text-align: right;
      padding: 7px 10px;
      font-weight: 700;
      color: #475569;
      border-bottom: 2px solid #cbd5e1;
      font-size: 10px;
      text-transform: none;
    }
    td {
      padding: 6px 10px;
      border-bottom: 1px solid #f1f5f9;
    }
    tbody tr:nth-child(even) {
      background: #f8fafc;
    }
    tbody tr:hover {
      background: #f1f5f9;
    }

    /* ── KPI Grid ── */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      margin-bottom: 12px;
    }
    .kpi-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 10px 12px;
      text-align: center;
    }
    .kpi-card .value {
      font-size: 16px;
      font-weight: 800;
      color: #1e293b;
    }
    .kpi-card .label {
      font-size: 10px;
      color: #64748b;
      margin-top: 2px;
      font-weight: 500;
    }
    .kpi-card.color-emerald { border-left: 3px solid #10b981; }
    .kpi-card.color-blue { border-left: 3px solid #3b82f6; }
    .kpi-card.color-amber { border-left: 3px solid #f59e0b; }
    .kpi-card.color-violet { border-left: 3px solid #8b5cf6; }
    .kpi-card.color-success .value { color: #16a34a; }
    .kpi-card.color-primary .value { color: #2563eb; }
    .kpi-card.color-warning .value { color: #ca8a04; }
    .kpi-card.color-accent .value { color: #7c3aed; }

    /* ── Badges ── */
    .status-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 600;
    }
    .status-green { background: #dcfce7; color: #166534; }
    .status-yellow { background: #fef9c3; color: #854d0e; }
    .status-red { background: #fee2e2; color: #991b1b; }
    .text-green { color: #16a34a; }
    .text-yellow { color: #ca8a04; }
    .text-red { color: #dc2626; }
    .text-muted { color: #64748b; }

    /* ── Footer ── */
    .footer {
      text-align: center;
      font-size: 9px;
      color: #94a3b8;
      margin-top: 24px;
      padding-top: 10px;
      border-top: 1px solid #e2e8f0;
    }
  `
}

function fmtCairoDate(iso: string): string {
  try {
    const [y, m, d] = cairoDateComponents(new Date(iso))
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  } catch { return iso.slice(0, 10) }
}

function fmtArabicDate(iso: string): string {
  try {
    const d = new Date(iso)
    const [y, m, day] = cairoDateComponents(d)
    const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
    return `${day} ${months[m - 1]} ${y}`
  } catch { return iso.slice(0, 10) }
}

export function exportToPdf({ title, subtitle, identity, dateFrom, dateTo, sections }: PdfOptions): void {
  const win = window.open('', '_blank')
  if (!win) return

  const now = new Date()
  const printDate = now.toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const printTime = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true })

  const periodLabel = dateFrom && dateTo
    ? `الفترة: ${fmtArabicDate(dateFrom)} — ${fmtArabicDate(dateTo)}`
    : ''

  const identityHtml = (() => {
    const lines: string[] = []
    if (identity?.roleLabel) {
      lines.push(`<div class="role-line">${identity.roleLabel}</div>`)
    }
    if (identity?.ownerName) {
      lines.push(`<div class="owner-name">${identity.ownerName}</div>`)
    }
    if (identity?.managerName) {
      lines.push(`<div class="manager-line">يتبع: ${identity.managerName}</div>`)
    }
    return lines.join('\n')
  })()

  const sectionsHtml = sections
    .map(
      (s) => `
    <div class="section">
      <h2>${s.title}</h2>
      ${s.subtitle ? `<p class="subtitle">${s.subtitle}</p>` : ''}
      ${s.content}
    </div>
  `
    )
    .join('')

  win.document.write(`<!DOCTYPE html>
<html dir="rtl">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>${buildStyles()}</style>
</head>
<body>
  <div class="report-header">
    <h1>${subtitle || title}</h1>
    ${identityHtml}
    ${periodLabel ? `<div class="period-line">${periodLabel}</div>` : ''}
    <div class="meta-line">
      <span>تاريخ الطباعة: ${printDate}</span>
      <span>|</span>
      <span>الوقت: ${printTime}</span>
    </div>
  </div>
  ${sectionsHtml}
  <div class="footer">تم التصدير بواسطة نظام الأهرام للتوزيع المتكامل — ${printDate}</div>
</body>
</html>`)
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 500)
}

export function tableToHtml(headers: string[], rows: (string | number | null)[][]): string {
  const headerRow = headers.map((h) => `<th>${h}</th>`).join('')
  const bodyRows = rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${cell ?? '\u2014'}</td>`).join('')}</tr>`
    )
    .join('')
  return `<table><thead><tr>${headerRow}</tr></thead><tbody>${bodyRows}</tbody></table>`
}

export function kpiGridToHtml(kpis: { label: string; value: string; color?: string }[]): string {
  const colorClass: Record<string, string> = {
    emerald: 'color-emerald color-success',
    blue: 'color-blue color-primary',
    amber: 'color-amber color-warning',
    violet: 'color-violet color-accent',
  }
  const cards = kpis
    .map(
      (kpi) =>
        `<div class="kpi-card ${kpi.color ? colorClass[kpi.color] || '' : ''}"><div class="value">${kpi.value}</div><div class="label">${kpi.label}</div></div>`
    )
    .join('')
  return `<div class="kpi-grid">${cards}</div>`
}
