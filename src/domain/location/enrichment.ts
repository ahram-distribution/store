import { supabase } from '../../lib/supabase'
import { geocoding } from './geocoding'
import { LocationRepository } from './repository'
import type { LocationRecord, EnrichLocationInput } from './types'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

function isEnriched(status: string | null | undefined): boolean {
  return status === 'completed'
}

function needsEnrichment(status: string | null | undefined): boolean {
  return !status || status === 'pending' || status === 'failed'
}

export class LocationNormalizationService {
  /**
   * enrichLocation — التابع الوحيد المسؤول عن تخصيب الموقع.
   * - يقبل location_id فقط.
   * - Idempotent: إذا كانت الحالة completed → لا يفعل شيئاً.
   * - يستدعي Nominatim → يطابق Reference IDs → يستدعي enrich_location RPC.
   */
  static async enrichLocation(locationId: string): Promise<boolean> {
    const token = getToken()
    if (!token) return false

    const repo = new LocationRepository(token)

    // 1. تحميل بيانات الموقع الحالية
    const location = await repo.fetchLocation(locationId)
    if (!location) return false

    // 2. Idempotent: إذا كان مكتملاً → تخطي
    if (isEnriched(location.enrichment_status)) return true

    // 3. التحقق من وجود إحداثيات
    if (location.latitude == null || location.longitude == null) return false

    // 4. استدعاء Nominatim
    const addr = await geocoding.reverseGeocodeStructured(location.latitude, location.longitude)
    if (!addr) return false

    // 5. مطابقة المحافظة
    let governorateId: string | null = null
    if (addr.state) {
      const { data: govs } = await supabase
        .from('reference_governorates')
        .select('id')
        .ilike('name_ar', addr.state)
        .limit(1)
      if (govs && govs.length > 0) governorateId = govs[0].id
    }

    // 6. مطابقة المدينة (ضمن المحافظة إن وُجدت)
    let cityId: string | null = null
    const cityName = addr.city || addr.town || addr.village
    if (cityName) {
      let query = supabase.from('reference_cities').select('id').ilike('name_ar', cityName)
      if (governorateId) query = query.eq('governorate_id', governorateId)
      const { data: cities } = await query.limit(1)
      if (cities && cities.length > 0) cityId = cities[0].id
    }

    // 7. حفظ نتائج التخصيب
    const input: EnrichLocationInput = {
      governorate_id: governorateId,
      city_id: cityId,
      road: addr.road || null,
      formatted_address: addr.displayName || null,
      geocoding_provider: 'nominatim',
      enrichment_version: 1,
    }

    return repo.enrichLocation(locationId, input)
  }

  /**
   * enrichLocationIfNeeded — مثل enrichLocation لكن يتخطى إذا كانت الحالة completed.
   */
  static async enrichLocationIfNeeded(locationId: string): Promise<boolean> {
    const token = getToken()
    if (!token) return false

    const repo = new LocationRepository(token)
    const location = await repo.fetchLocation(locationId)
    if (!location) return false

    if (!needsEnrichment(location.enrichment_status)) return true

    return LocationNormalizationService.enrichLocation(locationId)
  }

  /**
   * enrichLocationAfterSave — يُستدعى بعد حفظ موقع جديد (governed_create_location).
   * يتأكد من أن الموقع محفوظ ثم يخصبه.
   */
  static async enrichLocationAfterSave(locationId: string | null): Promise<void> {
    if (!locationId) return
    await LocationNormalizationService.enrichLocationIfNeeded(locationId)
  }
}
