// Word export for the Customer Follow-up module (net-new).
// Produces a Word-readable document (.doc) using the HTML-in-Word format,
// which is opened natively by Microsoft Word / LibreOffice and fully supports
// right-to-left (Arabic) layout without any external dependency.
//
// Earliest-possible-compatible approach: no docx/xlsx zip dependency is
// required, so the app bundle stays unchanged.

export interface WordExportColumn {
  key: string
  label: string
}

export interface WordExportOptions {
  title: string
  subtitle?: string
  columns: WordExportColumn[]
  rows: Record<string, unknown>[]
  fileName: string
  summary?: { label: string; value: string }[]
  generatedAt?: Date
}

function esc(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function downloadDoc(content: string, fileName: string): void {
  const blob = new Blob(['\ufeff', content], { type: 'application/msword' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function exportToWord(opts: WordExportOptions): void {
  const { title, subtitle, columns, rows, summary, fileName, generatedAt } = opts

  const today = (generatedAt ?? new Date()).toLocaleString('ar-EG-u-nu-latn', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  const headerCells = columns
    .map((c) => `<th style="border:1pt solid #CBD5E1;background:#F1F5F9;padding:6px;font-size:12px;">${esc(c.label)}</th>`)
    .join('')

  const bodyRows = rows
    .map(
      (r) =>
        `<tr>${columns
          .map((c) => `<td style="border:1pt solid #E2E8F0;padding:5px;font-size:11px;">${esc(r[c.key])}</td>`)
          .join('')}</tr>`
    )
    .join('')

  const summaryHtml = summary && summary.length
    ? `<div style="margin:10px 0;" dir="rtl">${summary
        .map((s) => `<span style="display:inline-block;margin-left:14px;font-size:12px;"><b>${esc(s.label)}:</b> ${esc(s.value)}</span>`)
        .join('')}</div>`
    : ''

  const content = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>
  @page { size: A4; margin: 15mm; }
  body { font-family:"Segoe UI", Arial, sans-serif; color:#0F172A; }
</style>
</head>
<body>
<div style="text-align:center;margin-bottom:8px;">
  <h1 style="font-size:20px;margin:0 0 4px;">${esc(title)}</h1>
  ${subtitle ? `<div style="font-size:13px;color:#475569;">${esc(subtitle)}</div>` : ''}
  <div style="font-size:10px;color:#94A3B8;margin-top:2px;">تاريخ الإنشاء: ${esc(today)}</div>
</div>
${summaryHtml}
<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;direction:rtl;">
  <tr>${headerCells}</tr>
  ${bodyRows}
</table>
<p style="font-size:9px;color:#94A3B8;margin-top:12px;">صادر عن نظام الأهرام — متابعة العملاء</p>
</body>
</html>`

  downloadDoc(content, `${fileName}.doc`)
}