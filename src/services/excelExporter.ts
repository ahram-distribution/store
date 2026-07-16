import * as XLSX from 'xlsx'
import { cairoDateComponents } from '../lib/dateRange'

export interface ExportColumn {
  key: string
  label: string
  format?: 'number' | 'currency' | 'percentage' | 'time'
}

export interface ReportIdentityInfo {
  roleLabel?: string
  ownerName?: string
  managerName?: string
}

export interface ExportOptions {
  title: string
  subtitle?: string
  identity?: ReportIdentityInfo
  columns: ExportColumn[]
  data: Record<string, unknown>[]
  fileName: string
  dateFrom?: string
  dateTo?: string
  additionalSheetData?: {
    headers: string[]
    rows: (string | number)[][]
  }
}

function applyCellFormat(ws: XLSX.WorkSheet, startRow: number, dataRows: Record<string, unknown>[], columns: ExportColumn[]): void {
  for (let R = 0; R < dataRows.length; R++) {
    for (let C = 0; C < columns.length; C++) {
      const addr = XLSX.utils.encode_cell({ r: startRow + R, c: C })
      const cell = ws[addr]
      if (!cell || typeof cell.v !== 'number') continue
      const fmt = columns[C].format
      if (fmt === 'time') cell.z = 'h:mm'
      else if (fmt === 'percentage') cell.z = '0.0%'
      else if (fmt === 'currency') cell.z = '#,##0'
      else if (fmt === 'number') cell.z = '#,##0'
    }
  }
}

function fmtArabicDate(iso: string): string {
  try {
    const d = new Date(iso)
    const [y, m, day] = cairoDateComponents(d)
    return `${day}/${String(m).padStart(2, '0')}/${y}`
  } catch { return iso.slice(0, 10) }
}

export function exportToExcel({ title, subtitle, identity, columns, data, fileName, dateFrom, dateTo, additionalSheetData }: ExportOptions): void {
  const ws = XLSX.utils.json_to_sheet([])

  const headerRow = columns.map((c) => c.label)
  const dataRows = data.map((row) => columns.map((c) => row[c.key] ?? ''))

  const now = new Date()
  const printDate = now.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })
  const printTime = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true })

  let currentRow = 0

  // Row 0: Title (merged)
  XLSX.utils.sheet_add_aoa(ws, [[title]], { origin: `A${currentRow + 1}` })
  const titleRow = currentRow
  currentRow++

  // Row 1: Subtitle if present
  if (subtitle) {
    XLSX.utils.sheet_add_aoa(ws, [[subtitle]], { origin: `A${currentRow + 1}` })
    currentRow++
  }

  // Identity rows
  if (identity?.roleLabel) {
    XLSX.utils.sheet_add_aoa(ws, [[identity.roleLabel]], { origin: `A${currentRow + 1}` })
    currentRow++
  }
  if (identity?.ownerName) {
    XLSX.utils.sheet_add_aoa(ws, [[identity.ownerName]], { origin: `A${currentRow + 1}` })
    currentRow++
  }
  if (identity?.managerName) {
    XLSX.utils.sheet_add_aoa(ws, [[`يتبع: ${identity.managerName}`]], { origin: `A${currentRow + 1}` })
    currentRow++
  }

  // Period row
  if (dateFrom && dateTo) {
    XLSX.utils.sheet_add_aoa(ws, [[`الفترة: ${fmtArabicDate(dateFrom)} — ${fmtArabicDate(dateTo)}`]], { origin: `A${currentRow + 1}` })
    currentRow++
  }

  // Print date/time row
  XLSX.utils.sheet_add_aoa(ws, [[`تاريخ الطباعة: ${printDate} | الوقت: ${printTime}`]], { origin: `A${currentRow + 1}` })
  currentRow++

  // Blank row before data
  currentRow++

  // Column headers
  XLSX.utils.sheet_add_aoa(ws, [headerRow], { origin: `A${currentRow + 1}` })
  const colStartRow = currentRow
  currentRow++

  // Data rows
  XLSX.utils.sheet_add_aoa(ws, dataRows, { origin: `A${currentRow + 1}` })
  const dataStartRow = currentRow
  currentRow += dataRows.length

  applyCellFormat(ws, dataStartRow, data, columns)

  // Merges: title row, subtitle row, identity rows
  const mergeEnd = columns.length - 1
  ws['!merges'] = [
    { s: { r: titleRow, c: 0 }, e: { r: titleRow, c: mergeEnd } },
  ]
  const metaRows = [titleRow]
  if (subtitle) metaRows.push(titleRow + 1)
  if (identity?.roleLabel) metaRows.push(metaRows[metaRows.length - 1] + 1)
  if (identity?.ownerName) metaRows.push(metaRows[metaRows.length - 1] + 1)
  if (identity?.managerName) metaRows.push(metaRows[metaRows.length - 1] + 1)

  for (let i = 1; i < metaRows.length; i++) {
    ws['!merges'].push({ s: { r: metaRows[i], c: 0 }, e: { r: metaRows[i], c: mergeEnd } })
  }

  ws['!cols'] = headerRow.map((h) => ({ wch: Math.max(h.length * 2 + 2, 14) }))
  ws['!freeze'] = { x: 0, y: dataStartRow }
  ws['!autofilter'] = {
    ref: `${XLSX.utils.encode_cell({ r: colStartRow, c: 0 })}:${XLSX.utils.encode_cell({ r: dataStartRow + dataRows.length - 1, c: columns.length - 1 })}`,
  }

  if (additionalSheetData) {
    XLSX.utils.sheet_add_aoa(ws, [additionalSheetData.headers], { origin: `A${currentRow + 1}` })
    currentRow++
    for (const row of additionalSheetData.rows) {
      XLSX.utils.sheet_add_aoa(ws, [row], { origin: `A${currentRow + 1}` })
      currentRow++
    }
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'التقرير')

  const periodPart = dateFrom && dateTo
    ? `${dateFrom.slice(0, 10)}_${dateTo.slice(0, 10)}`
    : new Date().toISOString().slice(0, 10)

  const safeName = fileName.replace(/[<>:"/\\|?*]/g, '_')
  XLSX.writeFile(wb, `${safeName}_${periodPart}.xlsx`)
}

export function exportSimpleJsonToExcel(data: Record<string, unknown>[], sheetName: string, fileName: string): void {
  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  const periodPart = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `${fileName}_${periodPart}.xlsx`)
}
