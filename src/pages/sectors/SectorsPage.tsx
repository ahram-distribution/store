import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'
import { isExecutiveDirectorUser } from '../../utils/roleNormalization'
import { SectorGovernoratesScreen } from './SectorGovernoratesScreen'
import { RepDistributionScreen } from './RepDistributionScreen'
import { ManagerDistributionScreen } from './ManagerDistributionScreen'
import { GeographicPricingScreen } from './GeographicPricingScreen'

type Screen = '1' | '2' | '3' | '4'

const ALL_SCREENS: { key: Screen; label: string; short: string }[] = [
  { key: '1', label: 'القطاعات والمحافظات', short: 'القطاعات' },
  { key: '2', label: 'توزيع المناديب', short: 'المناديب' },
  { key: '3', label: 'توزيع مديري البيع', short: 'المديرون' },
  { key: '4', label: 'التسعير الجغرافي', short: 'التسعير' },
]

export function SectorsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const user = useAuthStore(s => s.user)
  const isEd = isExecutiveDirectorUser(user)

  const screens = isEd
    ? ALL_SCREENS.filter(s => s.key !== '1' && s.key !== '4')
    : ALL_SCREENS

  const screen = (searchParams.get('screen') || screens[0].key) as Screen

  function setScreen(s: Screen) {
    setSearchParams({ screen: s }, { replace: true })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">إدارة القطاعات الجغرافية</h1>
      </div>

      <div className="flex gap-1 border-b border-border pb-1 overflow-x-auto">
        {screens.map(s => (
          <button key={s.key} onClick={() => setScreen(s.key)}
            className={`px-3 py-1.5 text-xs rounded-lg font-semibold transition-colors whitespace-nowrap ${screen === s.key ? 'bg-primary text-white' : 'text-text-secondary hover:bg-surface'}`}>
            <span className="hidden sm:inline">{s.label}</span>
            <span className="sm:hidden">{s.short}</span>
          </button>
        ))}
      </div>

      {screen === '1' && <SectorGovernoratesScreen />}
      {screen === '2' && <RepDistributionScreen />}
      {screen === '3' && <ManagerDistributionScreen />}
      {screen === '4' && <GeographicPricingScreen />}
    </div>
  )
}
