import toast from 'react-hot-toast'

interface MapButtonProps {
  latitude: number
  longitude: number
  size?: 'sm' | 'md' | 'lg'
  showCopyLink?: boolean
}

function buildMapsUrl(lat: number, lng: number): string {
  return `https://maps.google.com/?q=${lat},${lng}`
}

function mapsUrl(lat: number, lng: number, locationLabel?: string) {
  return buildMapsUrl(lat, lng)
}

export function MapButton({ latitude, longitude, size = 'md', showCopyLink = true }: MapButtonProps) {
  const url = buildMapsUrl(latitude, longitude)

  const sizeClasses: Record<string, string> = {
    sm: 'text-[10px] px-2 py-1',
    md: 'text-xs px-3 py-1.5',
    lg: 'text-sm px-4 py-2',
  }
  const iconSize: Record<string, string> = {
    sm: 'w-3 h-3',
    md: 'w-3.5 h-3.5',
    lg: 'w-4 h-4',
  }
  const cls = sizeClasses[size]
  const icn = iconSize[size]

  function handleCopy() {
    navigator.clipboard.writeText(url).then(() => {
      toast.success('تم نسخ رابط الخريطة')
    })
  }

  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-1 ${cls} text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors font-medium`}
      >
        <svg className={icn} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        فتح الخريطة
      </a>
      {showCopyLink && (
        <button
          onClick={handleCopy}
          className={`inline-flex items-center gap-1 ${cls} text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors font-medium`}
        >
          <svg className={icn} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
          </svg>
          نسخ الرابط
        </button>
      )}
    </span>
  )
}
