import { useNavigate } from 'react-router-dom'

const shortcuts = [
  { label: 'صفقة اليوم', icon: '🔥', path: '/daily-deals' },
  { label: 'عرض الساعة', icon: '⏰', path: '/flash-offers' },
  { label: 'المزاد', icon: '🏷️', path: '/auctions' },
  { label: 'الشرائح', icon: '📊', path: '/tiers' },
  { label: 'الائتمان', icon: '💳', path: '/credit' },
]

export function BusinessShortcuts() {
  const navigate = useNavigate()

  return (
    <div className="flex items-stretch gap-1">
      {shortcuts.map((s) => (
        <button
          key={s.label}
          onClick={() => navigate(s.path)}
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            padding: '10px 2px',
            cursor: 'pointer',
            WebkitAppearance: 'none',
            background: 'none',
            border: 'none',
          }}
        >
          <span style={{ fontSize: 18, lineHeight: 1 }}>{s.icon}</span>
          <span style={{ color: 'var(--theme-accent)', fontSize: 10, fontWeight: 500, textAlign: 'center', whiteSpace: 'nowrap' }}>{s.label}</span>
        </button>
      ))}
    </div>
  )
}
