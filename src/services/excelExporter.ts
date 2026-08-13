import * as XLSX from 'xlsx'
import { cairoDateComponents } from '../lib/dateRange'
import { applyExcelPresentation, XL } from './excelStyling'

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

export interface ExcelPresentationOptions {
  rtl?: boolean
  landscape?: boolean
  fitToWidth?: boolean
  printTitles?: boolean
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
  summary?: { label: string; value: number; format?: 'number' | 'currency' }[]
  filters?: string[]
  columnWidths?: number[]
  presentation?: ExcelPresentationOptions
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

function downloadBlob(bytes: ArrayBuffer, fileName: string): void {
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function exportToExcel(opts: ExportOptions): void {
  if (opts.presentation) {
    exportStyledExcel(opts)
    return
  }
  exportPlainExcel(opts)
}

function exportPlainExcel({ title, subtitle, identity, columns, data, fileName, dateFrom, dateTo, additionalSheetData }: ExportOptions): void {
  const ws = XLSX.utils.json_to_sheet([])

  const headerRow = columns.map((c) => c.label)
  const dataRows = data.map((row) => columns.map((c) => row[c.key] ?? ''))

  const now = new Date()
  const printDate = now.toLocaleDateString('ar-EG-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' })
  const printTime = now.toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit', hour12: true })

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

function exportStyledExcel({ title, subtitle, identity, columns, data, fileName, dateFrom, dateTo, summary, filters, columnWidths, presentation = {} }: ExportOptions): void {
  const ws = XLSX.utils.json_to_sheet([])

  const headerRow = columns.map((c) => c.label)
  const dataRows = data.map((row) => columns.map((c) => row[c.key] ?? ''))

  const now = new Date()
  const printDate = now.toLocaleDateString('ar-EG-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' })
  const printTime = now.toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit', hour12: true })

  const writeRow = (values: unknown[], rowIndex: number) => {
    XLSX.utils.sheet_add_aoa(ws, [values], { origin: `A${rowIndex + 1}` })
  }

  const mergeRows: number[] = []
  let currentRow = 0

  const titleRow = currentRow
  writeRow([title], currentRow)
  mergeRows.push(currentRow)
  currentRow++

  if (subtitle) {
    writeRow([subtitle], currentRow)
    mergeRows.push(currentRow)
    currentRow++
  }
  if (identity?.roleLabel) {
    writeRow([identity.roleLabel], currentRow)
    mergeRows.push(currentRow)
    currentRow++
  }
  if (identity?.ownerName) {
    writeRow([identity.ownerName], currentRow)
    mergeRows.push(currentRow)
    currentRow++
  }
  if (identity?.managerName) {
    writeRow([`يتبع: ${identity.managerName}`], currentRow)
    mergeRows.push(currentRow)
    currentRow++
  }
  if (dateFrom && dateTo) {
    writeRow([`الفترة: ${fmtArabicDate(dateFrom)} — ${fmtArabicDate(dateTo)}`], currentRow)
    mergeRows.push(currentRow)
    currentRow++
  }
  writeRow([`تاريخ الطباعة: ${printDate} | الوقت: ${printTime}`], currentRow)
  mergeRows.push(currentRow)
  currentRow++

  currentRow++ // blank

  let summaryLabelRow = -1
  let summaryValueRow = -1
  if (summary && summary.length) {
    summaryLabelRow = currentRow
    writeRow(summary.map((s) => s.label), currentRow)
    currentRow++
    summaryValueRow = currentRow
    writeRow(summary.map((s) => s.value), currentRow)
    currentRow++
  }

  currentRow++ // blank

  let filterLabelRow = -1
  const filterRows: number[] = []
  if (filters && filters.length) {
    filterLabelRow = currentRow
    writeRow(['الفلاتر المطبقة:'], currentRow)
    mergeRows.push(currentRow)
    currentRow++
    for (const line of filters) {
      writeRow([line], currentRow)
      filterRows.push(currentRow)
      mergeRows.push(currentRow)
      currentRow++
    }
  }

  currentRow++ // blank

  const colStartRow = currentRow
  writeRow(headerRow, currentRow)
  currentRow++

  const dataStartRow = currentRow
  for (const row of dataRows) {
    writeRow(row, currentRow)
    currentRow++
  }
  const dataEndRow = currentRow - 1

  applyCellFormat(ws, dataStartRow, data, columns)

  if (summary && summaryValueRow >= 0) {
    summary.forEach((s, i) => {
      if (s.format === 'number' || s.format === 'currency') {
        const cell = ws[XLSX.utils.encode_cell({ r: summaryValueRow, c: i })]
        if (cell) cell.z = '#,##0'
      }
    })
  }

  const mergeEnd = columns.length - 1
  ws['!merges'] = mergeRows.map((r) => ({ s: { r, c: 0 }, e: { r, c: mergeEnd } }))
  ws['!cols'] = (columnWidths && columnWidths.length === columns.length
    ? columnWidths
    : headerRow.map((h) => Math.max(h.length * 2 + 2, 14))).map((w) => ({ wch: w }))
  ws['!autofilter'] = {
    ref: `${XLSX.utils.encode_cell({ r: colStartRow, c: 0 })}:${XLSX.utils.encode_cell({ r: dataEndRow, c: mergeEnd })}`,
  }

  const enc = XLSX.utils.encode_col
  const styleByCell = new Map<string, number>()
  const setCells = (r: number, cFrom: number, cTo: number, s: number) => {
    for (let c = cFrom; c <= cTo; c++) styleByCell.set(`${enc(c)}${r + 1}`, s)
  }

  setCells(titleRow, 0, 0, XL.TITLE)
  mergeRows.forEach((r) => { if (r !== titleRow) setCells(r, 0, 0, XL.META) })
  if (summary && summaryLabelRow >= 0) {
    summary.forEach((s, i) => {
      styleByCell.set(`${enc(i)}${summaryLabelRow + 1}`, XL.SUMMARY_LABEL)
      const isNum = s.format === 'number' || s.format === 'currency'
      styleByCell.set(`${enc(i)}${summaryValueRow + 1}`, isNum ? XL.SUMMARY_VALUE_NUM : XL.SUMMARY_VALUE)
    })
  }
  if (filterLabelRow >= 0) setCells(filterLabelRow, 0, 0, XL.FILTER_LABEL)
  filterRows.forEach((r) => setCells(r, 0, 0, XL.FILTER_ROW))
  setCells(colStartRow, 0, mergeEnd, XL.HEADER)
  data.forEach((row, di) => {
    const absRow = dataStartRow + di
    columns.forEach((col, ci) => {
      const isNum = col.format === 'number' || col.format === 'currency'
      const v = row[col.key]
      let s: number
      if (isNum) {
        s = typeof v === 'number' && v === 0 ? XL.DATA_ZERO_NUM : (di % 2 === 0 ? XL.DATA_BASE_NUM : XL.DATA_STRIPE_NUM)
      } else {
        s = di % 2 === 0 ? XL.DATA_BASE_TEXT : XL.DATA_STRIPE_TEXT
      }
      styleByCell.set(`${enc(ci)}${absRow + 1}`, s)
    })
  })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'التقرير')
  if (presentation.rtl ?? true) {
    wb.Workbook = { Views: [{ RTL: true }] }
  }

  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const styled = applyExcelPresentation(buffer, {
    rtl: presentation.rtl ?? true,
    landscape: presentation.landscape ?? true,
    fitToWidth: presentation.fitToWidth ?? true,
    freezeRows: colStartRow + 1,
    printTitleRow: presentation.printTitles ?? true ? colStartRow + 1 : 0,
    sheetName: wb.SheetNames[0],
    styleByCell,
  })

  const periodPart = dateFrom && dateTo
    ? `${dateFrom.slice(0, 10)}_${dateTo.slice(0, 10)}`
    : new Date().toISOString().slice(0, 10)
  const safeName = fileName.replace(/[<>:"/\\|?*]/g, '_')
  downloadBlob(styled, `${safeName}_${periodPart}.xlsx`)
}

export function exportSimpleJsonToExcel(data: Record<string, unknown>[], sheetName: string, fileName: string): void {
  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  const periodPart = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `${fileName}_${periodPart}.xlsx`)
}
