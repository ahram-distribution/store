import { supabase } from '../lib/supabase'
import type { CustomerCardData } from '../types/customers'
import { CUSTOMER_BUSINESS_TYPES } from '../lib/customerConstants'
import { toEnglishDigits, formatInteger } from '../utils/numbers'
import { formatCurrencyShort, formatDate } from '../utils/format'

const GOOGLE_CONTACTS_HEADERS = [
  'Name',
  'Given Name',
  'Additional Name',
  'Family Name',
  'Yomi Name',
  'Given Name Yomi',
  'Additional Name Yomi',
  'Family Name Yomi',
  'Name Prefix',
  'Name Suffix',
  'Initials',
  'Nickname',
  'Short Name',
  'Maiden Name',
  'Birthday',
  'Gender',
  'Location',
  'Billing Information',
  'Directory Server',
  'Mileage',
  'Occupation',
  'Hobby',
  'Sensitivity',
  'Priority',
  'Subject',
  'Notes',
  'Group Membership',
  'E-mail 1 - Type',
  'E-mail 1 - Value',
  'E-mail 2 - Type',
  'E-mail 2 - Value',
  'E-mail 3 - Type',
  'E-mail 3 - Value',
  'E-mail 4 - Type',
  'E-mail 4 - Value',
  'IM 1 - Type',
  'IM 1 - Service',
  'IM 1 - Value',
  'Phone 1 - Type',
  'Phone 1 - Value',
  'Phone 2 - Type',
  'Phone 2 - Value',
  'Phone 3 - Type',
  'Phone 3 - Value',
  'Phone 4 - Type',
  'Phone 4 - Value',
  'Phone 5 - Type',
  'Phone 5 - Value',
  'Address 1 - Type',
  'Address 1 - Formatted',
  'Address 1 - Street',
  'Address 1 - City',
  'Address 1 - PO Box',
  'Address 1 - Region',
  'Address 1 - Postal Code',
  'Address 1 - Country',
  'Address 1 - Extended Address',
  'Organization 1 - Type',
  'Organization 1 - Name',
  'Organization 1 - Yomi Name',
  'Organization 1 - Title',
  'Organization 1 - Department',
  'Organization 1 - Symbol',
  'Organization 1 - Location',
  'Organization 1 - Job Description',
  'Relation 1 - Type',
  'Relation 1 - Value',
  'Website 1 - Type',
  'Website 1 - Value',
  'Website 2 - Type',
  'Website 2 - Value',
  'Event 1 - Type',
  'Event 1 - Value',
]

interface CustomerContactRow {
  id: string
  customer_id: string
  phone: string | null
  full_name: string | null
  is_primary: boolean | null
  email: string | null
  role: string | null
}

interface LocationRow {
  id: string
  latitude: number | null
  longitude: number | null
}

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return '"' + value.replace(/"/g, '""') + '"'
  return value
}

function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return ''
  const digits = toEnglishDigits(raw.trim())
  if (/^01[0-9]{9}$/.test(digits)) return '+20' + digits.slice(1)
  return digits
}

function businessTypeLabel(value: string | null): string {
  if (!value) return ''
  const mapped = CUSTOMER_BUSINESS_TYPES.find((bt) => bt.value === value)
  return mapped?.label || value
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return ''
  const formatted = formatDate(value)
  return formatted === '--' ? '' : formatted
}

function fmtMoney(value: number | null | undefined): string {
  if (value == null) return ''
  return formatCurrencyShort(Number(value))
}

function fmtCount(value: number | null | undefined): string {
  if (value == null) return ''
  return formatInteger(Number(value))
}

function buildNotes(c: CustomerCardData): string {
  const lines: string[] = []
  if (c.code) lines.push(`كود العميل: ${c.code}`)
  const typeLabel = businessTypeLabel(c.business_type)
  if (typeLabel) lines.push(`نوع النشاط: ${typeLabel}`)
  if (c.owner_name) lines.push(`المندوب المسؤول: ${c.owner_name}`)
  const balance = fmtMoney(c.current_balance)
  if (balance) lines.push(`الرصيد الحالي: ${balance}`)
  const orderCount = fmtCount(c.previous_order_count)
  if (orderCount) lines.push(`عدد الطلبات: ${orderCount}`)
  const ordersTotal = fmtMoney(c.previous_orders_total)
  if (ordersTotal) lines.push(`إجمالي الطلبات: ${ordersTotal}`)
  if (c.last_order_number) lines.push(`آخر طلب: ${c.last_order_number}`)
  const lastOrderDate = fmtDate(c.last_order_date)
  if (lastOrderDate) lines.push(`تاريخ آخر طلب: ${lastOrderDate}`)
  const lastOrderTotal = fmtMoney(c.last_order_total)
  if (lastOrderTotal) lines.push(`قيمة آخر طلب: ${lastOrderTotal}`)
  const visitCount = fmtCount(c.visit_count)
  if (visitCount) lines.push(`عدد الزيارات: ${visitCount}`)
  const lastVisitDate = fmtDate(c.last_visit_date)
  if (lastVisitDate) lines.push(`تاريخ آخر زيارة: ${lastVisitDate}`)
  const registeredDate = fmtDate(c.registered_at)
  if (registeredDate) lines.push(`تاريخ التسجيل: ${registeredDate}`)
  return lines.join('\n')
}

function buildGroupMembership(c: CustomerCardData): string {
  const labels: string[] = []
  labels.push(c.is_active ? 'عميل نشط' : 'عميل غير نشط')
  if (c.needs_address_correction) labels.push('تصحيح عنوان')
  if (!labels.length) return ''
  return labels.join(' ::: ')
}

function buildRow(
  c: CustomerCardData,
  governorateById: Map<string, string>,
  mapsByLocation: Map<string, string>,
  contactsByCustomer: Map<string, CustomerContactRow[]>,
): string {
  const values = new Map<string, string>()

  const governorate = c.manual_governorate_id ? governorateById.get(c.manual_governorate_id) || '' : ''
  const displayName = c.company_name ? (governorate ? `${c.company_name} - ${governorate}` : c.company_name) : ''

  values.set('Name', displayName)

  const notes = buildNotes(c)
  if (notes) values.set('Notes', notes)

  const groupMembership = buildGroupMembership(c)
  if (groupMembership) values.set('Group Membership', groupMembership)

  const email = c.email && c.email.trim() && c.email.trim() !== 'غير متوفر' ? c.email.trim() : ''
  if (email) {
    values.set('E-mail 1 - Type', 'Work')
    values.set('E-mail 1 - Value', email)
  }

  const phones: string[] = []
  const mainPhone = normalizePhone(c.phone)
  if (mainPhone) phones.push(mainPhone)
  for (const contact of contactsByCustomer.get(c.id) || []) {
    const p = normalizePhone(contact.phone)
    if (p && !phones.includes(p)) phones.push(p)
  }
  const maxPhones = 5
  for (let i = 0; i < Math.min(phones.length, maxPhones); i++) {
    values.set(`Phone ${i + 1} - Type`, 'Mobile')
    values.set(`Phone ${i + 1} - Value`, phones[i])
  }

  const address = c.registered_address || c.location_address
  if (address && address.trim()) {
    values.set('Address 1 - Type', 'Work')
    values.set('Address 1 - Formatted', address.trim())
  }

  if (c.company_name) {
    values.set('Organization 1 - Type', 'Work')
    values.set('Organization 1 - Name', c.company_name)
  }

  const mapsUrl = c.location_id ? mapsByLocation.get(c.location_id) || '' : ''
  if (mapsUrl) {
    values.set('Website 1 - Type', 'Work')
    values.set('Website 1 - Value', mapsUrl)
  }

  return GOOGLE_CONTACTS_HEADERS
    .map((h) => csvEscape(values.get(h) || ''))
    .join(',')
}

export interface GoogleContactsExportParams {
  customers: CustomerCardData[]
  governorates: { id: string; name_ar: string }[]
}

export async function exportCustomersToPhone(params: GoogleContactsExportParams): Promise<number> {
  if (!params.customers.length) return 0

  const token = getToken()
  if (!token) throw new Error('NO_SESSION')

  const governorateById = new Map(params.governorates.map((g) => [g.id, g.name_ar]))

  const mapsByLocation = new Map<string, string>()
  const locationIds = Array.from(new Set(params.customers.map((c) => c.location_id).filter(Boolean) as string[]))
  if (locationIds.length) {
    try {
      const { data } = await supabase.rpc('get_governed_locations', { p_token: token, p_ids: locationIds })
      if (Array.isArray(data)) {
        for (const loc of data as LocationRow[]) {
          if (loc && loc.id && loc.latitude != null && loc.longitude != null) {
            mapsByLocation.set(loc.id, `https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`)
          }
        }
      }
    } catch {
      // Batch location fetch failed — export continues without maps links.
    }
  }

  const exportedCustomerIds = new Set(params.customers.map((c) => c.id))
  const contactsByCustomer = new Map<string, CustomerContactRow[]>()
  try {
    const { data } = await supabase.rpc('get_governed_customer_contacts', { p_token: token })
    if (Array.isArray(data)) {
      for (const contact of data as CustomerContactRow[]) {
        if (!contact || !contact.customer_id) continue
        if (!exportedCustomerIds.has(contact.customer_id)) continue
        const list = contactsByCustomer.get(contact.customer_id) || []
        list.push(contact)
        contactsByCustomer.set(contact.customer_id, list)
      }
    }
  } catch {
    // Additional contact fetch failed — export continues with main phone only.
  }

  const header = GOOGLE_CONTACTS_HEADERS.map(csvEscape).join(',')
  const body = params.customers.map((c) => buildRow(c, governorateById, mapsByLocation, contactsByCustomer)).join('\r\n')
  const csv = `\uFEFF${header}\r\n${body}`

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'عملاء_الهاتف.csv'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)

  return params.customers.length
}