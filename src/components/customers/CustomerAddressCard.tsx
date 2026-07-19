import { useMemo } from 'react'
import { copyToClipboard } from '../../utils/safeClipboard'

interface ManualAddress {
  governorate: string | null
  city: string | null
  address_line1: string | null
  address_line2: string | null
  registered_address: string | null
  latitude?: number | null
  longitude?: number | null
}

interface GpsAddress {
  formatted_address: string | null
  latitude: number | null
  longitude: number | null
  accuracy_meters: number | null
  enrichment_status: string | null
  governorate_name: string | null
  city_name: string | null
  road: string | null
}

interface CustomerAddressCardProps {
  type: 'manual' | 'gps'
  manualData?: ManualAddress | null
  gpsData?: GpsAddress | null
  onUpdateLocation?: () => void
}

const ENRICHED = 'completed'

export function CustomerAddressCard({ type, manualData, gpsData, onUpdateLocation }: CustomerAddressCardProps) {
  const isManual = type === 'manual'

  const manualFullAddress = useMemo(() => {
    if (!manualData) return ''
    return [manualData.governorate, manualData.city, manualData.address_line1, manualData.address_line2]
      .filter(Boolean).join(' - ')
  }, [manualData])

  const hasCoords = gpsData?.latitude != null && gpsData?.longitude != null
  const statusPending = gpsData?.enrichment_status === 'pending'
  const statusCompleted = gpsData?.enrichment_status === 'completed'

  const mapsUrl = useMemo(() => {
    const lat = isManual ? (manualData?.latitude ?? null) : (gpsData?.latitude ?? null)
    const lng = isManual ? (manualData?.longitude ?? null) : (gpsData?.longitude ?? null)
    if (lat != null && lng != null) {
      return `https://www.google.com/maps?q=${lat},${lng}`
    }
    if (isManual && manualFullAddress) {
      return `https://www.google.com/maps/search/${encodeURIComponent(manualFullAddress)}`
    }
    return null
  }, [isManual, manualData, gpsData, manualFullAddress])

  const hasStructuredAddr = manualData && (manualData.governorate || manualData.city || manualData.address_line1)
  const hasLegacyAddr = manualData && !hasStructuredAddr && !!manualData.registered_address

  if (isManual && !hasStructuredAddr && !hasLegacyAddr) return null

  return (
    <div className={`bg-white rounded-xl border p-4 ${isManual ? 'border-blue-200' : 'border-emerald-200'}`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold flex items-center gap-1.5">
          {isManual ? (
            <><span className="text-blue-600">📝</span><span className="text-blue-700">العنوان الحر (اليدوي)</span></>
          ) : (
            <><span className="text-emerald-600">🛰️</span><span className="text-emerald-700">العنوان المستخرج من الموقع</span></>
          )}
        </h2>
      </div>

      {/* ===================== Manual Card ===================== */}
      {isManual && manualData && hasStructuredAddr && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 mb-3">
          {manualData.governorate && (
            <div>
              <div className="text-[10px] text-text-secondary">المحافظة</div>
              <div className="text-sm font-semibold text-text">{manualData.governorate}</div>
            </div>
          )}
          {manualData.city && (
            <div>
              <div className="text-[10px] text-text-secondary">المدينة</div>
              <div className="text-sm font-semibold text-text">{manualData.city}</div>
            </div>
          )}
          {manualData.address_line1 && (
            <div>
              <div className="text-[10px] text-text-secondary">الشارع</div>
              <div className="text-sm font-semibold text-text">{manualData.address_line1}</div>
            </div>
          )}
          {manualData.address_line2 && (
            <div>
              <div className="text-[10px] text-text-secondary">العلامة المميزة</div>
              <div className="text-sm font-semibold text-text">{manualData.address_line2}</div>
            </div>
          )}
          {manualFullAddress && (
            <>
              <hr className="border-border col-span-full my-1" />
              <div className="col-span-full">
                <div className="text-[10px] text-text-secondary mb-1">العنوان الكامل</div>
                <div className="bg-surface rounded-lg p-3 text-xs text-text leading-relaxed border border-border">
                  {manualFullAddress}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Legacy manual address (from customer_addresses.registered_address) */}
      {isManual && hasLegacyAddr && (
        <div className="mb-3">
          <div className="text-[10px] text-text-secondary mb-1">العنوان الحر (القديم)</div>
          <div className="bg-surface rounded-lg p-3 text-xs text-text leading-relaxed border border-border">
            {manualData.registered_address}
          </div>
        </div>
      )}

      {isManual && (hasStructuredAddr || hasLegacyAddr) && (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => { copyToClipboard(manualFullAddress).then((ok) => { if (ok) alert('تم نسخ العنوان') }) }}
            className="flex-1 text-xs py-1.5 rounded-lg font-semibold text-center"
            style={{ backgroundColor: '#EFF6FF', color: '#2563EB' }}>
            نسخ العنوان
          </button>
          {mapsUrl && (
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
              className="flex-1 text-xs py-1.5 rounded-lg font-semibold text-center"
              style={{ backgroundColor: '#EFF6FF', color: '#2563EB' }}>
              فتح على الخرائط
            </a>
          )}
          {mapsUrl && (
            <button onClick={() => { copyToClipboard(mapsUrl).then((ok) => { if (ok) alert('تم نسخ الرابط') }) }}
              className="flex-1 text-xs py-1.5 rounded-lg font-semibold text-center"
              style={{ backgroundColor: '#FEF3C7', color: '#D97706' }}>
              نسخ الرابط
            </button>
          )}
          {mapsUrl && (
            <button onClick={() => { navigator.share?.({ url: mapsUrl }) }}
              className="flex-1 text-xs py-1.5 rounded-lg font-semibold text-center"
              style={{ backgroundColor: '#F3E8FF', color: '#7C3AED' }}>
              مشاركة
            </button>
          )}
        </div>
      )}

      {/* ===================== GPS Card ===================== */}

      {/* State 3: No GPS coordinates (lat IS NULL OR lng IS NULL) */}
      {!isManual && !hasCoords && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">📍</span>
            <p className="text-xs text-text-secondary">لا يوجد موقع GPS مسجل لهذا العميل.</p>
          </div>
          <button onClick={onUpdateLocation}
            className="w-full bg-primary text-white text-xs py-2.5 rounded-lg font-semibold">
            تحديث موقع العميل
          </button>
        </div>
      )}

      {/* State 2: Has GPS coordinates AND enrichment_status = pending */}
      {!isManual && hasCoords && statusPending && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 py-2">
            <span className="inline-block w-4 h-4 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-text-secondary">جارى استخراج بيانات الموقع...</span>
          </div>
          {mapsUrl && (
            <div className="flex flex-wrap gap-2">
              <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
                className="flex-1 text-xs py-1.5 rounded-lg font-semibold text-center"
                style={{ backgroundColor: '#ECFDF5', color: '#059669' }}>
                فتح على الخرائط
              </a>
              <button onClick={() => { copyToClipboard(mapsUrl || '').then((ok) => { if (ok) alert('تم نسخ الرابط') }) }}
                className="flex-1 text-xs py-1.5 rounded-lg font-semibold text-center"
                style={{ backgroundColor: '#FEF3C7', color: '#D97706' }}>
                نسخ الرابط
              </button>
              <button onClick={() => { navigator.share?.({ url: mapsUrl || '' }) }}
                className="flex-1 text-xs py-1.5 rounded-lg font-semibold text-center"
                style={{ backgroundColor: '#F3E8FF', color: '#7C3AED' }}>
                مشاركة
              </button>
            </div>
          )}
        </div>
      )}

      {/* State 1: Has GPS coordinates AND enrichment_status = completed */}
      {!isManual && hasCoords && statusCompleted && (
        <>
          {gpsData.accuracy_meters != null && (
            <div className="mb-2">
              <span className="text-xs text-text-secondary">دقة GPS: </span>
              <span className="text-xs font-semibold text-text">
                {gpsData.accuracy_meters <= 20 ? 'ممتازة' : gpsData.accuracy_meters <= 100 ? 'جيدة' : 'متوسطة'}
                {' '}({gpsData.accuracy_meters} م)
              </span>
            </div>
          )}

          {gpsData.governorate_name && (
            <div className="mb-1">
              <div className="text-[10px] text-text-secondary">المحافظة المستخرجة</div>
              <div className="text-sm font-semibold text-text">{gpsData.governorate_name}</div>
            </div>
          )}
          {gpsData.city_name && (
            <div className="mb-1">
              <div className="text-[10px] text-text-secondary">المدينة المستخرجة</div>
              <div className="text-sm font-semibold text-text">{gpsData.city_name}</div>
            </div>
          )}
          {gpsData.road && (
            <div className="mb-1">
              <div className="text-[10px] text-text-secondary">الشارع المستخرج</div>
              <div className="text-sm font-semibold text-text">{gpsData.road}</div>
            </div>
          )}

          {gpsData.formatted_address && (
            <div className="mb-3 mt-2">
              <div className="text-[10px] text-text-secondary mb-1">العنوان الكامل</div>
              <div className="bg-gray-50 rounded-lg p-3 text-xs text-text leading-relaxed border border-gray-100">
                {gpsData.formatted_address}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {mapsUrl && (
              <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
                className="flex-1 text-xs py-1.5 rounded-lg font-semibold text-center"
                style={{ backgroundColor: '#ECFDF5', color: '#059669' }}>
                فتح على الخرائط
              </a>
            )}
            {mapsUrl && (
              <button onClick={() => { copyToClipboard(mapsUrl || '').then((ok) => { if (ok) alert('تم نسخ الرابط') }) }}
                className="flex-1 text-xs py-1.5 rounded-lg font-semibold text-center"
                style={{ backgroundColor: '#FEF3C7', color: '#D97706' }}>
                نسخ الرابط
              </button>
            )}
            {mapsUrl && (
              <button onClick={() => { navigator.share?.({ url: mapsUrl || '' }) }}
                className="flex-1 text-xs py-1.5 rounded-lg font-semibold text-center"
                style={{ backgroundColor: '#F3E8FF', color: '#7C3AED' }}>
                مشاركة
              </button>
            )}
          </div>

          <button onClick={onUpdateLocation}
            className="w-full bg-accent/10 text-accent text-xs py-1.5 rounded-lg font-semibold hover:bg-accent/20 mt-2">
            تحديث الموقع
          </button>
        </>
      )}
    </div>
  )
}
