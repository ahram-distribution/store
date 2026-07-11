import { useMemo } from 'react'

interface ManualAddress {
  governorate: string | null
  city: string | null
  address_line1: string | null
  address_line2: string | null
  latitude?: number | null
  longitude?: number | null
}

interface GpsAddress {
  formatted_address: string | null
  latitude: number | null
  longitude: number | null
  accuracy_meters: number | null
}

interface CustomerAddressCardProps {
  type: 'manual' | 'gps'
  manualData?: ManualAddress | null
  gpsData?: GpsAddress | null
}

export function CustomerAddressCard({ type, manualData, gpsData }: CustomerAddressCardProps) {
  const isManual = type === 'manual'

  const fullAddress = useMemo(() => {
    if (isManual && manualData) {
      return [manualData.governorate, manualData.city, manualData.address_line1, manualData.address_line2]
        .filter(Boolean).join(' - ')
    }
    if (!isManual && gpsData) {
      return gpsData.formatted_address || ''
    }
    return ''
  }, [isManual, manualData, gpsData])

  const mapsUrl = useMemo(() => {
    const lat = gpsData?.latitude ?? manualData?.latitude ?? null
    const lng = gpsData?.longitude ?? manualData?.longitude ?? null
    if (lat != null && lng != null) {
      return `https://www.google.com/maps?q=${lat},${lng}`
    }
    if (fullAddress) {
      return `https://www.google.com/maps/search/${encodeURIComponent(fullAddress)}`
    }
    return null
  }, [gpsData, manualData, fullAddress])

  const hasGps = gpsData?.latitude != null && gpsData?.longitude != null
  const hasManualAddr = manualData && (manualData.governorate || manualData.city || manualData.address_line1)

  if (isManual && !hasManualAddr) return null

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

      {isManual && manualData && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 mb-3">
          {manualData.governorate && (
            <div>
              <div className="text-[10px] text-gray-500">المحافظة</div>
              <div className="text-sm font-semibold text-gray-900">{manualData.governorate}</div>
            </div>
          )}
          {manualData.city && (
            <div>
              <div className="text-[10px] text-gray-500">المدينة</div>
              <div className="text-sm font-semibold text-gray-900">{manualData.city}</div>
            </div>
          )}
          {manualData.address_line1 && (
            <div>
              <div className="text-[10px] text-gray-500">الشارع</div>
              <div className="text-sm font-semibold text-gray-900">{manualData.address_line1}</div>
            </div>
          )}
          {manualData.address_line2 && (
            <div>
              <div className="text-[10px] text-gray-500">العلامة المميزة</div>
              <div className="text-sm font-semibold text-gray-900">{manualData.address_line2}</div>
            </div>
          )}
        </div>
      )}

      {!isManual && !hasGps && (
        <div className="bg-amber-50 rounded-lg border border-amber-200 p-3 flex items-center gap-2 mb-3">
          <span className="text-lg">📍</span>
          <p className="text-xs text-amber-700">لا توجد بيانات GPS للعميل.</p>
        </div>
      )}

      {!isManual && hasGps && gpsData?.accuracy_meters != null && (
        <div className="text-xs text-gray-500 mb-2">
          دقة GPS: {gpsData.accuracy_meters <= 20 ? 'ممتازة' : gpsData.accuracy_meters <= 100 ? 'جيدة' : 'متوسطة'}
          {' '}({gpsData.accuracy_meters} م)
        </div>
      )}

      {fullAddress && (
        <div className="mb-3">
          <div className="text-[10px] text-gray-500 mb-1">العنوان الكامل</div>
          <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-700 leading-relaxed border border-gray-100">
            {fullAddress}
          </div>
        </div>
      )}

      {(fullAddress || hasGps) && (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => { navigator.clipboard.writeText(fullAddress); alert('تم نسخ العنوان') }}
            className="flex-1 text-xs py-1.5 rounded-lg font-semibold text-center"
            style={{ backgroundColor: isManual ? '#EFF6FF' : '#ECFDF5', color: isManual ? '#2563EB' : '#059669' }}>
            نسخ العنوان
          </button>
          {mapsUrl && (
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
              className="flex-1 text-xs py-1.5 rounded-lg font-semibold text-center"
              style={{ backgroundColor: isManual ? '#EFF6FF' : '#ECFDF5', color: isManual ? '#2563EB' : '#059669' }}>
              فتح على الخرائط
            </a>
          )}
          {mapsUrl && (
            <button onClick={() => { navigator.clipboard.writeText(mapsUrl); alert('تم نسخ الرابط') }}
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
    </div>
  )
}
