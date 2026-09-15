import { printInvoice } from '../orders/order-printing'

export interface ShippingLabelData {
  customerName: string
  customerPhone: string
  customerAddress: string
}

const SENDER = 'شركة الأهرام محمد سعيد للتجارة والتوزيع'

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
  .sheet { border: 2pt solid #000; display: flex; flex-direction: row; align-items: center; justify-content: space-between; padding: 6mm 8mm; }
  .info { display: flex; flex-direction: column; justify-content: center; gap: 9mm; flex: 1; }
  .row { text-align: right; line-height: 1.5; overflow-wrap: break-word; word-break: break-word; }
  .lbl { font-size: 29.7pt; font-weight: 700; color: #000; }
  .val { font-size: 38.016pt; font-weight: 700; color: #000; }
  .sender { font-size: 35.64pt; }
  .warn { border: 3pt solid #d00; color: #d00; background: #fff; font-weight: 700; text-align: center; padding: 4mm 3mm; margin-right: 8mm; white-space: nowrap; }
  .warn div { font-size: 26pt; line-height: 1.4; }
  @media print { body { margin: 7mm !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; } .sheet { height: 134mm; } }
</style></head>
<body>
<div class="sheet">
  <div class="info">
    <div class="row"><span class="lbl">المرسل له : </span><span class="val">${val(data.customerName)}</span></div>
    <div class="row"><span class="lbl">رقم التليفون : </span><span class="val" dir="ltr">${val(data.customerPhone)}</span></div>
    <div class="row"><span class="lbl">العنوان : </span><span class="val">${val(data.customerAddress)}</span></div>
    <div class="row"><span class="lbl">الراسل : </span><span class="val sender">${SENDER}</span></div>
  </div>
  <div class="warn">
    <div>أحذر</div>
    <div>قابل</div>
    <div>للكسر</div>
  </div>
</div>
</body></html>`
}

export function printShippingLabel(data: ShippingLabelData) {
  printInvoice(renderShippingLabelHtml(data))
}
