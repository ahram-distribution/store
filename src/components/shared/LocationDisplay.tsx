import { MapPin } from 'lucide-react'
import { locationService } from '../../services/location'

interface LocationDisplayProps {
  lat: number | null | undefined
  lng: number | null | undefined
  showAddress?: boolean
  address?: string | null
  size?: 'sm' | 'md'
  className?: string
}

export function LocationDisplay({ lat, lng, showAddress = true, address, size = 'sm', className = '' }: LocationDisplayProps) {
  const hasCoords = lat != null && lng != null

  if (!hasCoords) return null

  const mapsUrl = locationService.buildGoogleMapsUrl(lat, lng)
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'
  const textSize = size === 'sm' ? 'text-[10px]' : 'text-xs'
  const tooltip = lat != null && lng != null ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : ''

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
      {showAddress && address && (
        <span className={`${textSize} text-gray-600 leading-normal`}>
          {address}
        </span>
      )}
    </span>
  )
}
