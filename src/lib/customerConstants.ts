export const CUSTOMER_BUSINESS_TYPES = [
  { value: 'wholesaler', label: 'تاجر جملة' },
  { value: 'distributor', label: 'موزع' },
  { value: 'cosmetics_store', label: 'متجر مستحضرات تجميل' },
  { value: 'supermarket', label: 'سوبر ماركت' },
  { value: 'hypermarket', label: 'هايبر ماركت' },
  { value: 'perfume_store', label: 'متجر عطور / عطار' },
  { value: 'pharmacy', label: 'صيدلية' },
  { value: 'warehouse', label: 'مخزن' },
  { value: 'other', label: 'أخرى' },
]

export const CUSTOMER_DEFAULT_PASSWORD = '112233'

export function validateCustomerPhone(phone: string): string | null {
  if (!phone.trim()) return 'يرجى إدخال رقم الهاتف'
  if (!/^01[0-9]{9}$/.test(phone.trim())) return 'رقم الهاتف غير صالح (يجب أن يبدأ 01 ويتكون من 11 رقم)'
  return null
}

export function validateCustomerRequired(fields: Record<string, string>): string | null {
  for (const [key, value] of Object.entries(fields)) {
    if (!value.trim()) return `يرجى إدخال ${key}`
  }
  return null
}
