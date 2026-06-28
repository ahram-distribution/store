import { useState } from 'react'
import ActivityScreen from './ActivityScreen'
import TargetsPage from './TargetsPage'
import WeightsPage from './WeightsPage'

const TABS = [
  { key: 'activity', label: 'النشاط' },
  { key: 'achievement', label: 'الإنجاز' },
  { key: 'targets', label: 'التارجت' },
  { key: 'weights', label: 'الأوزان' },
] as const

type TabKey = (typeof TABS)[number]['key']

export default function PerformancePage() {
  const [activeTab, setActiveTab] = useState<TabKey>('activity')

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200">
        <div className="flex">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-3 text-sm font-semibold transition-colors relative ${
                activeTab === tab.key
                  ? 'text-indigo-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
              {activeTab === tab.key && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className={activeTab !== 'activity' ? 'hidden' : ''}>
        <ActivityScreen />
      </div>

      <div className={activeTab !== 'achievement' ? 'hidden' : ''}>
        <div className="max-w-4xl mx-auto p-4">
          <div className="text-center py-20 text-gray-400">
            <div className="text-5xl mb-4">🏗️</div>
            <p className="text-lg font-semibold">شاشة الإنجاز</p>
            <p className="text-sm mt-1">قيد التطوير — قريباً</p>
          </div>
        </div>
      </div>

      <div className={activeTab !== 'targets' ? 'hidden' : ''}>
        <TargetsPage />
      </div>

      <div className={activeTab !== 'weights' ? 'hidden' : ''}>
        <WeightsPage />
      </div>
    </div>
  )
}
