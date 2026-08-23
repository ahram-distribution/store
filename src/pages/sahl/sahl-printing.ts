// SAHL document printing — فاتورة بيع / عرض سعر
// Mirrors SAHL's 80mm receipt and A4 layouts using the house
// hidden-iframe printing pattern (see components/orders/order-printing.ts).

export interface SahlPrintDoc {
  code: string
  kind: 'sale' | 'quote'
  status: string
  created_at: string
  customer_name?: string | null
  store_name?: string | null
  subtotal: number | string
  discount_amount: number | string
  additions_amount?: number | string
  additions_type?: string | null
  tax_amount: number | string
  grand_total: number | string
  paid_cash?: number | string
  paid_card?: number | string
  paid_credit?: number | string
  notes?: string | null
}

export interface SahlPrintItem {
  product_name: string
  unit_label?: string | null
  qty: number | string
  unit_price: number | string
  line_total: number | string
}

const money = (v: unknown) =>
  Number(v || 0).toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function buildSahlDocHtml(doc: SahlPrintDoc, items: SahlPrintItem[], paper: '80mm' | 'A4'): string {
  const isQuote = doc.kind === 'quote'
  const title = isQuote ? 'عرض سعر' : 'فاتورة بيع'
  const narrow = paper === '80mm'
  const pageWidth = narrow ? '80mm' : '210mm'
  const rows = items.map((it, i) => `
    <tr>
      ${narrow ? '' : `<td class="c">${i + 1}</td>`}
      <td>${it.product_name}</td>
      <td class="c">${it.unit_label || 'قطعة'}</td>
      <td class="c">${Number(it.qty)}</td>
      <td class="n">${money(it.unit_price)}</td>
      <td class="n">${money(it.line_total)}</td>
    </tr>`).join('')

  const totalRow = (label: string, value: string, cls = '') => `
    <div class="trow ${cls}"><span>${label}</span><span>${value}</span></div>`

  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"/>
<title>${title} ${doc.code}</title><style>
  @page { size: ${paper === '80mm' ? '80mm auto' : 'A4'}; margin: ${narrow ? '4mm' : '12mm'}; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; width: ${pageWidth}; color: #111; }
  .head { text-align: center; border-bottom: 1px dashed #444; padding-bottom: 6px; margin-bottom: 6px; }
  .head h1 { font-size: ${narrow ? '14px' : '20px'}; }
  .meta { font-size: ${narrow ? '10px' : '12px'}; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 2px; margin-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; font-size: ${narrow ? '10px' : '12px'}; margin-top: 4px; }
  th, td { border: ${narrow ? 'none' : '1px solid #999'}; padding: ${narrow ? '2px' : '5px'}; }
  th { background: #f0f0f0; text-align: right; }
  td.c, th.c { text-align: center; } td.n, th.n { text-align: left; white-space: nowrap; }
  .totals { margin-top: 8px; font-size: ${narrow ? '11px' : '13px'}; }
  .trow { display: flex; justify-content: space-between; padding: 1px 0; }
  .trow.grand { border-top: 1px dashed #444; margin-top: 4px; padding-top: 4px; font-weight: bold; font-size: ${narrow ? '13px' : '15px'}; }
  .pay { margin-top: 6px; font-size: ${narrow ? '10px' : '12px'}; }
  .foot { margin-top: 10px; text-align: center; font-size: ${narrow ? '9px' : '11px'}; border-top: 1px dashed #444; padding-top: 4px; }
</style></head><body>
  <div class="head"><h1>${title}</h1><div>${doc.code}</div></div>
  <div class="meta">
    <span>التاريخ: ${new Date(doc.created_at).toLocaleString('ar-EG-u-nu-latn')}</span>
    ${doc.customer_name ? `<span>العميل: ${doc.customer_name}</span>` : ''}
    ${doc.store_name ? `<span>المخزن: ${doc.store_name}</span>` : ''}
    ${doc.status === 'voided' ? '<span style="color:#b00;font-weight:bold">ملغاة</span>' : ''}
  </div>
  <table>
    <thead><tr>
      ${narrow ? '' : '<th class="c">#</th>'}
      <th>الصنف</th><th class="c">الوحدة</th><th class="c">الكمية</th><th class="n">السعر</th><th class="n">الإجمالي</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    ${totalRow('الإجمالي الفرعي', money(doc.subtotal))}
    ${Number(doc.discount_amount) > 0 ? totalRow('الخصم', money(doc.discount_amount)) : ''}
    ${Number(doc.additions_amount) > 0 ? totalRow(`إضافات${doc.additions_type ? ` (${doc.additions_type})` : ''}`, money(doc.additions_amount)) : ''}
    ${Number(doc.tax_amount) > 0 ? totalRow('الضريبة', money(doc.tax_amount)) : ''}
    ${totalRow(isQuote ? 'إجمالي العرض' : 'الإجمالي المستحق', money(doc.grand_total), 'grand')}
    ${!isQuote && doc.paid_credit != null && Number(doc.paid_credit) !== Number(doc.grand_total) ? `
      <div class="pay">
        نقدية: ${money(doc.paid_cash)} • بطاقة: ${money(doc.paid_card)} • آجل: ${money(doc.paid_credit)}
      </div>` : ''}
  </div>
  ${doc.notes ? `<div class="meta" style="margin-top:4px">ملاحظات: ${doc.notes}</div>` : ''}
  <div class="foot">نظام سهل — الأهرام للتوزيع</div>
</body></html>`
}

export function printSahlDoc(doc: SahlPrintDoc, items: SahlPrintItem[], paper: '80mm' | 'A4') {
  const html = buildSahlDocHtml(doc, items, paper)
  const frame = document.createElement('iframe')
  frame.style.position = 'fixed'
  frame.style.right = '0'
  frame.style.bottom = '0'
  frame.style.width = '0'
  frame.style.height = '0'
  frame.style.border = '0'
  document.body.appendChild(frame)
  const win = frame.contentWindow
  if (!win) return
  win.document.open()
  win.document.write(html)
  win.document.close()
  const done = () => {
    try { frame.contentWindow?.focus(); frame.contentWindow?.print() } finally {
      setTimeout(() => document.body.removeChild(frame), 1000)
    }
  }
  if (win.document.readyState === 'complete') setTimeout(done, 150)
  else win.addEventListener('load', () => setTimeout(done, 150))
}
