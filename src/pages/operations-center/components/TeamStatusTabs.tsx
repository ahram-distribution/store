export type TeamTab = 'active' | 'ended' | 'no_start' | 'map'

interface TeamStatusTabsProps {
  active: TeamTab
  onChange: (tab: TeamTab) => void
  activeCount: number
  endedCount: number
  noStartCount: number
}

const TABS: { key: TeamTab; label: string; color: string }[] = [
  { key: 'active', label: 'النشطون', color: 'text-green-600' },
  { key: 'ended', label: 'المنتهون', color: 'text-green-700' },
  { key: 'no_start', label: 'لم يبدؤوا', color: 'text-gray-500' },
  { key: 'map', label: '🗺️ الخريطة', color: 'text-blue-500' },
]

export default function TeamStatusTabs({ active, onChange, activeCount, endedCount, noStartCount }: TeamStatusTabsProps) {
  const counts = { active: activeCount, ended: endedCount, no_start: noStartCount }

  return (
    <div className="mb-4">
      <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className={`whitespace-nowrap px-4 py-2 rounded-xl text-sm font-bold transition-all shrink-0 ${
              active === tab.key
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
            }`}
          >
            {tab.label}
            {tab.key !== 'map' && (
              <span className={`mr-1.5 ${active === tab.key ? 'text-white/80' : tab.color}`}>
                ({counts[tab.key as keyof typeof counts]})
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
