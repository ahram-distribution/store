const UNIT_LABELS: Record<string, string> = { piece: 'قطعة', dozen: 'دستة', carton: 'كرتونة' }

function money(n: number | null | undefined): string {
  if (n == null) return '0 ج.م'
  return Math.round(Number(n)).toLocaleString('en-US') + ' ج.م'
}

export function buildFullWhatsAppMessage(
  order: any,
  customer?: { name?: string; phone?: string; address?: string; mapsUrl?: string } | null,
  owner?: { name?: string; phone?: string; address?: string; mapsUrl?: string } | null,
  creator?: { name?: string; phone?: string; address?: string; mapsUrl?: string } | null,
  items?: any[],
): string {
  const grandTotal = (items || []).reduce((s: number, i: any) => s + Number(i.total_price || 0), 0)

  let msg = `🏢 شركة الأهرام للتجارة والتوزيع\n`
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n`
  msg += `📄 فاتورة رقم ${order.order_number || ''}\n\n`
  msg += `┌─ ❲ معلومات العميل ❳ ─┐\n`
  msg += `الاسم: ${customer?.name || ''}\n`
  if (customer?.phone) msg += `الهاتف: ${customer.phone}\n`
  if (customer?.address) msg += `العنوان: ${customer.address}\n`
  if (customer?.mapsUrl) msg += `الموقع: ${customer.mapsUrl}\n`
  msg += `\n┌─ ❲ المسؤول ❳ ─┐\n`
  msg += `الاسم: ${owner?.name || '—'}\n`
  if (owner?.phone) msg += `الهاتف: ${owner.phone}\n`
  if (owner?.address) msg += `العنوان: ${owner.address}\n`
  if (owner?.mapsUrl) msg += `الموقع: ${owner.mapsUrl}\n`
  msg += `\n┌─ ❲ منشئ الطلب ❳ ─┐\n`
  msg += `الاسم: ${creator?.name || ''}\n`
  if (creator?.phone) msg += `الهاتف: ${creator.phone}\n`
  if (creator?.address) msg += `العنوان: ${creator.address}\n`
  if (creator?.mapsUrl) msg += `الموقع: ${creator.mapsUrl}\n`
  msg += `\n━━━━━━━━━━━━━━━━━━━━━━\n📦 المنتجات\n\n`
  for (const item of items || []) {
    const name = item.products?.product_name || item.productName || item.product_name || ''
    const code = item.products?.legacy_code || item.productCode || item.product_code || ''
    const unit = UNIT_LABELS[item.unit_type || item.unitType] || item.unit_type || item.unitType || 'قطعة'
    const qty = Number(item.unit_quantity || item.unitQuantity || 1)
    const price = Number(item.unit_price || item.unitPrice || 0)
    const lineTotal = qty * price
    msg += `▸ ${name}\n  كود: ${code || '—'} | ${qty} ${unit} | ${money(price)} = ${money(lineTotal)}\n\n`
  }
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n`
  msg += `💵 الإجمالي: ${money(grandTotal)}`
  if (order.notes) msg += `\n📝 ملاحظات: ${order.notes}`

  return msg
}

export function sendFullOrderToWhatsApp(
  order: any,
  customer?: { name?: string; phone?: string; address?: string; mapsUrl?: string } | null,
  owner?: { name?: string; phone?: string; address?: string; mapsUrl?: string } | null,
  creator?: { name?: string; phone?: string; address?: string; mapsUrl?: string } | null,
  items?: any[],
) {
  const phone = import.meta.env.VITE_WHATSAPP_NUMBER
  if (!phone) return
  const msg = buildFullWhatsAppMessage(order, customer, owner, creator, items)
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener,noreferrer')
}
