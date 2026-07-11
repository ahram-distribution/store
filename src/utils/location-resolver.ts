export interface LocationResult {
  city: string
  governorate: string
}

interface CustomerLike {
  city?: string | null
  governorate?: string | null
}

interface OrderLike {
  snapshot_customer_address?: string | null
}

export function resolveLocation(customer: CustomerLike | null, order?: OrderLike | null): LocationResult {
  const city = customer?.city || customer?.governorate || null
  const governorate = customer?.governorate || null

  if (city && governorate) return { city, governorate }
  if (city) return { city, governorate: 'غير محدد' }
  if (governorate) return { city: governorate, governorate }

  const snapshot = order?.snapshot_customer_address
  if (snapshot) return { city: snapshot, governorate: snapshot }

  return { city: 'غير محدد', governorate: 'غير محدد' }
}
