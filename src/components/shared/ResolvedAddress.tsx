import { useEffect, useState } from 'react'
import { locationService } from '../../services/location'

const LOCATION_ADDRESS_LOADING = 'جاري تحديد العنوان...'
const LOCATION_ADDRESS_FALLBACK = 'تعذر تحديد العنوان'

interface ResolvedAddressProps {
  lat: number
  lng: number
  size?: 'sm' | 'md'
  className?: string
}

export function ResolvedAddress({ lat, lng, size = 'sm', className = '' }: ResolvedAddressProps) {
  const [address, setAddress] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setAddress(null)
      return
    }
    setAddress(undefined)
    ;(async () => {
      const addr = await locationService.reverseGeocodeStructured(lat, lng)
      if (cancelled) return
      const resolved = addr && (addr.displayName || locationService.formatShortAddress(lat, lng, addr))
      setAddress(resolved || null)
    })()
    return () => { cancelled = true }
  }, [lat, lng])

  const textSize = size === 'sm' ? 'text-[10px]' : 'text-xs'
  const text = address === undefined ? LOCATION_ADDRESS_LOADING : (address || LOCATION_ADDRESS_FALLBACK)

  return (
    <span className={`${textSize} leading-normal ${className}`}>
      {text}
    </span>
  )
}
