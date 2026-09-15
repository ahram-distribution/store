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
  @page { size: A5; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Calibri, sans-serif; background: #fff; color: #000; }
  .sheet { border: 2pt solid #000; display: flex; flex-direction: column; }
  .warn-zone { flex: 0 0 33%; display: flex; flex-direction: row; align-items: center; justify-content: space-evenly; border-bottom: 1.5pt solid #000; }
  .warn-text { font-size: 44.7216pt; font-weight: 900; color: #000; text-align: center; white-space: nowrap; }
  .fragile { border: 2pt solid #000; background: #fff; padding: 2mm; display: flex; }
  .fragile svg { display: block; width: 24mm; height: 24mm; }
  .data-zone { flex: 1; display: flex; flex-direction: column; justify-content: space-evenly; padding: 4mm 3mm; }
  .row { text-align: right; line-height: 1.4; }
  .lbl { font-size: 26.62pt; font-weight: 700; color: #000; }
  .val { font-size: 31.944pt; font-weight: 700; color: #000; }
  .sender { font-size: 19pt; white-space: nowrap; }
  .data-zone > .row:last-child { white-space: nowrap; }
  @media print { body { margin: 7mm !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; } .sheet { height: 196mm; } }
</style></head>
<body>
<div class="sheet">
  <div class="warn-zone">
    <div class="warn-text">أحذر قابل للكسر</div>
    <div class="fragile">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 64">
        <g fill="#fff" stroke="#000" stroke-width="3" stroke-linejoin="round">
          <path d="M12 10 L48 10 L44 24 C43 31 37 34 30 34 C23 34 17 31 16 24 Z"/>
          <path d="M30 34 L30 50"/>
          <path d="M21 53 L39 53"/>
          <path d="M30 50 L21 53"/>
          <path d="M30 50 L39 53"/>
          <path d="M44 9 L38 17 L41 20 L33 28"/>
        </g>
      </svg>
    </div>
  </div>
  <div class="data-zone">
    <div class="row"><span class="lbl">المرسل له : </span><span class="val">${val(data.customerName)}</span></div>
    <div class="row"><span class="lbl">رقم التليفون : </span><span class="val" dir="ltr">${val(data.customerPhone)}</span></div>
    <div class="row"><span class="lbl">العنوان : </span><span class="val">${val(data.customerAddress)}</span></div>
    <div class="row"><span class="lbl">الراسل : </span><span class="val sender">${SENDER}</span></div>
  </div>
</div>
</body></html>`
}

export function printShippingLabel(data: ShippingLabelData) {
  printInvoice(renderShippingLabelHtml(data))
}