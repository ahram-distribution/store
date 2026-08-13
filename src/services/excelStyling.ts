import { unzipSync, zipSync } from 'fflate'

// CellXf style indexes used by applyExcelPresentation. These map 1:1 to the
// <cellXfs> entries written in styles.xml (see buildStylesXml).
export const XL = {
  DEFAULT: 0,
  PLAIN_NUM: 1,
  HEADER: 2,
  DATA_BASE_TEXT: 3,
  DATA_BASE_NUM: 4,
  DATA_STRIPE_TEXT: 5,
  DATA_STRIPE_NUM: 6,
  DATA_ZERO_NUM: 7,
  TITLE: 8,
  META: 9,
  FILTER_LABEL: 10,
  FILTER_ROW: 11,
  SUMMARY_LABEL: 12,
  SUMMARY_VALUE: 13,
  SUMMARY_VALUE_NUM: 14,
} as const

export interface ExcelPresentationPatch {
  rtl: boolean
  landscape: boolean
  fitToWidth: boolean
  freezeRows: number
  printTitleRow: number
  sheetName: string
  styleByCell: Map<string, number>
}

function buildStylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="0"/>
<fonts count="8">
<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>
<font><b/><sz val="14"/><color rgb="FF1F3A5F"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>
<font><sz val="10"/><color rgb="FF55606E"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>
<font><b/><sz val="10"/><color rgb="FF1F3A5F"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>
<font><sz val="10"/><color rgb="FF374151"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>
<font><b/><sz val="10"/><color rgb="FF55606E"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>
<font><b/><sz val="12"/><color rgb="FF1F3A5F"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>
</fonts>
<fills count="6">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F3A5F"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFDE8D6"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF2F5F9"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFD5DCE5"/></left><right style="thin"><color rgb="FFD5DCE5"/></right><top style="thin"><color rgb="FFD5DCE5"/></top><bottom style="thin"><color rgb="FFD5DCE5"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="15">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0"/>
<xf numFmtId="3" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="4" fillId="5" borderId="1" xfId="0"/>
<xf numFmtId="0" fontId="5" fillId="5" borderId="1" xfId="0"/>
<xf numFmtId="0" fontId="6" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="7" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="3" fontId="7" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="0"/>
<tableStyles count="0" defaultTableStyle="TableStyleMedium9" defaultPivotStyle="PivotStyleMedium4"/>
</styleSheet>`
}

function escapeSheetName(name: string): string {
  return name.replace(/'/g, "''")
}

function buildDefinedNamesXml(patch: ExcelPresentationPatch): string {
  if (patch.printTitleRow <= 0) return ''
  const row = patch.printTitleRow
  return `<definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">'${escapeSheetName(patch.sheetName)}'!$${row}:$${row}</definedName></definedNames>`
}

export function applyExcelPresentation(buffer: ArrayBuffer, patch: ExcelPresentationPatch): ArrayBuffer {
  const enc = new TextEncoder()
  const dec = new TextDecoder()

  const files = unzipSync(new Uint8Array(buffer))

  let sheet = dec.decode(files['xl/worksheets/sheet1.xml'])

  if (patch.fitToWidth) {
    sheet = sheet.replace(/<worksheet[^>]*>/, (m) => `${m}<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>`)
  }

  sheet = sheet.replace(/<sheetView([^>]*)\/>/, (m, attrs) =>
    `<sheetView${attrs}><pane ySplit="${patch.freezeRows}" topLeftCell="A${patch.freezeRows + 1}" activePane="bottomLeft" state="frozen"/></sheetView>`,
  )

  const pageSetupXml = `<pageSetup paperSize="9"${patch.landscape ? ' orientation="landscape"' : ' orientation="portrait"'}${patch.fitToWidth ? ' fitToWidth="1" fitToHeight="0"' : ''}/>`
  if (/<pageMargins/.test(sheet)) {
    sheet = sheet.replace(/<pageMargins[^>]*\/>/, (m) => `${m}${pageSetupXml}`)
  } else {
    sheet = sheet.replace(/<ignoredErrors>/, () => `${pageSetupXml}<ignoredErrors>`)
  }

  sheet = sheet.replace(/<c r="([A-Z]+[0-9]+)"([^>]*?)(\/?>)/g, (all, addr: string, attrs: string, close: string) => {
    const s = patch.styleByCell.get(addr)
    if (s == null) return all
    const clean = attrs.replace(/\s+s="[0-9]+"/, '')
    return `<c r="${addr}" s="${s}"${clean}${close}`
  })

  files['xl/worksheets/sheet1.xml'] = enc.encode(sheet)
  files['xl/styles.xml'] = enc.encode(buildStylesXml())

  let wbXml = dec.decode(files['xl/workbook.xml'])
  const defined = buildDefinedNamesXml(patch)
  if (defined) {
    if (/<definedNames>/.test(wbXml)) {
      const inner = defined.replace(/^<definedNames>/, '').replace(/<\/definedNames>$/, '')
      wbXml = wbXml.replace(/<\/definedNames>/, () => `${inner}</definedNames>`)
    } else {
      wbXml = wbXml.replace(/<\/sheets>/, (m) => `${m}${defined}`)
    }
  }
  files['xl/workbook.xml'] = enc.encode(wbXml)

  const zipped = zipSync(files, { level: 6 })
  const out = new ArrayBuffer(zipped.byteLength)
  new Uint8Array(out).set(zipped)
  return out
}
