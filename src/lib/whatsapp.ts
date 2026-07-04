import type { OrderDisplayData, OrderDisplayItem } from '../types/order-display'
import toast from 'react-hot-toast'

function normalizeWhatsAppNumber(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '')
  let normalized = digits
  if (normalized.startsWith('00')) normalized = normalized.slice(2)
  if (normalized.startsWith('0')) normalized = normalized.slice(1)
  if (!normalized.startsWith('20')) normalized = '20' + normalized
  return normalized
}

function toEnUS(n: number | null | undefined): string {
  if (n == null) return '0'
  return Math.round(n).toLocaleString('en-US')
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const h = String(d.getHours()).padStart(2, '0')
    const min = String(d.getMinutes()).padStart(2, '0')
    return y + '-' + m + '-' + day + ' ' + h + ':' + min
  } catch { return '' }
}

// ============================================================================
// NEW — WhatsApp message built from unified OrderDisplayData ONLY
// ============================================================================

export function buildWhatsAppMessageFromDisplay(display: OrderDisplayData): string {
  console.log('WHATSAPP_DISPLAY_INPUT', display)
  const isOrder = display.docType === 'order'
  const docType = isOrder ? 'طلب' : 'فاتورة'
  const orderNum = display.orderNumber
  const cust = display.customer
  const owner = display.owner
  const creator = display.creator
  const items = display.items
  const execLoc = display.executionLocation
  const createdAt = display.createdAt

  const grandTotal = items.reduce((s, i) => s + i.totalPrice, 0)

  let msg = ''

  msg += (isOrder ? '📦 ' : '📄 ') + docType + ' جديد\n\n'
  msg += 'رقم الطلب: ' + orderNum + '\n\n'
  msg += 'التاريخ: ' + formatDateTime(createdAt) + '\n\n'

  msg += '👤 العميل\n\n'
  msg += 'الاسم: ' + (cust.name || 'غير متوفر') + '\n'
  msg += 'الهاتف: ' + (cust.phone || 'غير متوفر') + '\n'
  msg += 'العنوان: ' + (cust.address || 'غير متوفر') + '\n\n'

  msg += '👨‍💼 المسؤول عن العميل\n\n'
  msg += 'الاسم: ' + (owner?.name || 'غير متوفر') + '\n'
  msg += 'الهاتف: ' + (owner?.phone || 'غير متوفر') + '\n\n'

  msg += '📤 مرسل الطلب\n\n'
  msg += 'الاسم: ' + (creator.name || 'غير متوفر') + '\n'
  msg += 'الهاتف: ' + (creator.phone || 'غير متوفر') + '\n'
  msg += 'الدور: ' + (display.creatorType || 'غير متوفر') + '\n\n'

  msg += '━━━━━━━━━━━━━━\n'
  msg += 'ملخص الطلب\n'
  msg += '━━━━━━━━━━━━━━\n\n'
  msg += 'عدد الأصناف: ' + items.length + '\n'
  if (display.tierName) msg += 'الشريحة: ' + display.tierName + '\n'
  msg += 'طريقة الدفع: ' + (display.paymentMethod === 'cash' ? 'نقداً' : display.paymentMethod === 'credit' ? 'آجل' : display.paymentMethod || 'غير متوفر') + '\n\n'
  msg += 'إجمالي الطلب: ' + toEnUS(grandTotal) + ' جنيه\n\n'

  const grouped: Record<string, OrderDisplayItem[]> = {}
  for (const item of items) {
    const company = item.companyName || 'أخرى'
    if (!grouped[company]) grouped[company] = []
    grouped[company].push(item)
  }

  for (const [companyName, companyItems] of Object.entries(grouped)) {
    msg += '━━━━━━━━━━━━━━\n'
    msg += companyName + ' (' + companyItems.length + ' صنف)\n'
    msg += '━━━━━━━━━━━━━━\n\n'

    companyItems.forEach((item, idx) => {
      const num = idx + 1
      msg += num + '. ' + item.productName + '\n\n'
      msg += 'كود: ' + (item.legacyCode || 'غير متوفر') + '  (' + item.quantity + ' ' + item.unitLabel + ')  ' + toEnUS(item.unitPrice) + ' ج\n\n'
    })
  }

  // ── Location (from saved order data only) ──
  if (execLoc) {
    msg += '━━━━━━━━━━━━━━\n'
    msg += 'موقع تنفيذ الطلب\n'
    msg += execLoc.mapsUrl + '\n'
  }

  return msg
}

export function sendWhatsAppFromDisplay(display: OrderDisplayData) {
  const msg = buildWhatsAppMessageFromDisplay(display)
  console.log('WHATSAPP_MESSAGE_FINAL', msg)
  const COMPANY_RAW = import.meta.env.VITE_WHATSAPP_NUMBER || '01040880002'
  const targetNumber = normalizeWhatsAppNumber(COMPANY_RAW)
  const encoded = encodeURIComponent(msg)
  const url = 'https://wa.me/' + targetNumber + '?text=' + encoded
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function copyWhatsAppFromDisplay(display: OrderDisplayData) {
  const msg = buildWhatsAppMessageFromDisplay(display)
  navigator.clipboard.writeText(msg).then(() => {
    toast.success('تم نسخ نص الرسالة')
  }).catch(() => {
    toast.error('فشل نسخ النص')
  })
}




