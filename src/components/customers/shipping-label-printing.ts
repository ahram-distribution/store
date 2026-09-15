import { printInvoice } from '../orders/order-printing'

export interface ShippingLabelData {
  customerName: string
  customerPhone: string
  customerAddress: string
}

const SENDER = 'شركة الأهرام للتجارة والتوزيع'

function esc(s: string | null | undefined): string {
  if (!s) return ''
  const d = document.createElement('div')
  d.textContent = s
  return d.innerHTML
}

function val(s: string | null | undefined): string {
  return s && s.trim() ? esc(s) : '—'
}

export function renderShippingLabelHtml(data: ShippingLabelData): string {
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><title>بوليصة شحن</title>
<style>
  @page { size: A5 landscape; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Calibri, sans-serif; background: #fff; color: #000; }
  .sheet { border: 2pt solid #000; display: flex; flex-direction: column; justify-content: center; gap: 9mm; padding: 6mm 8mm; }
  .row { text-align: right; line-height: 1.5; overflow-wrap: break-word; word-break: break-word; }
  .lbl { font-size: 25pt; font-weight: 700; color: #000; }
  .val { font-size: 32pt; font-weight: 700; color: #000; }
  .sender { font-size: 30pt; }
  @media print { body { margin: 7mm !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; } .sheet { height: 134mm; } }
</style></head>
<body>
<div class="sheet">
  <div class="row"><span class="lbl">المرسل له / </span><span class="val">${val(data.customerName)}</span></div>
  <div class="row"><span class="lbl">رقم التليفون / </span><span class="val" dir="ltr">${val(data.customerPhone)}</span></div>
  <div class="row"><span class="lbl">العنوان / </span><span class="val">${val(data.customerAddress)}</span></div>
  <div class="row"><span class="lbl">الراسل / </span><span class="val sender">${SENDER}</span></div>
</div>
</body></html>`
}

export function printShippingLabel(data: ShippingLabelData) {
  printInvoice(renderShippingLabelHtml(data))
}
