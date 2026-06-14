import { useState, useEffect } from 'react'
import { MapPin } from 'lucide-react'
import { locationService } from '../../services/location'

interface LocationDisplayProps {
  lat: number | null | undefined
  lng: number | null | undefined
  showAddress?: boolean
  size?: 'sm' | 'md'
  className?: string
}

export function LocationDisplay({ lat, lng, showAddress = true, size = 'sm', className = '' }: LocationDisplayProps) {
  const [address, setAddress] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const hasCoords = lat != null && lng != null

  useEffect(() => {
    if (!hasCoords || !showAddress) return
    let cancelled = false
    setLoading(true)
    locationService.reverseGeocodeStructured(lat!, lng!).then(addr => {
      if (!cancelled) {
        const short = locationService.formatShortAddress(lat!, lng!, addr)
        setAddress(short)
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [lat, lng, showAddress])

  if (!hasCoords) return null

  const mapsUrl = locationService.buildGoogleMapsUrl(lat, lng)
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'
  const textSize = size === 'sm' ? 'text-[10px]' : 'text-xs'
  const tooltip = `${lat?.toFixed(6)}, ${lng?.toFixed(6)}`

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <a
        href={mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={e => e.stopPropagation()}
        className="text-blue-600 hover:text-blue-800 transition-colors shrink-0"
        title={tooltip}
      >
        <MapPin className={iconSize} />
      </a>
      {showAddress && (
        <span className={`${textSize} text-gray-600 leading-normal`}>
          {loading ? '...' : address || ''}
        </span>
      )}
    </span>
  )
}
