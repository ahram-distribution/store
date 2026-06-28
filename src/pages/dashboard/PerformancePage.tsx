import { useState } from 'react'
import ActivityScreen from './ActivityScreen'
import TargetsPage from './TargetsPage'
import WeightsPage from './WeightsPage'

const MONTHS = ['يناير', 'فبراير', 'مارس', 'إبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']

const TABS = [
  { key: 'activity', label: 'النشاط' },
  { key: 'achievement', label: 'الإنجاز' },
  { key: 'targets', label: 'التارجت' },
  { key: 'weights', label: 'الأوزان' },
] as const

type TabKey = (typeof TABS)[number]['key']

function Placeholder({ title }: { title: string }) {
  return (
    <div className="text-center py-24 text-gray-400">
      <div className="text-5xl mb-4">🏗️</div>
      <p className="text-lg font-semibold">{title}</p>
      <p className="text-sm mt-1">قيد التطوير — قريباً</p>
    </div>
  )
}

export default function PerformancePage() {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [activeTab, setActiveTab] = useState<TabKey>('activity')

  const yearOptions: number[] = []
  for (let y = year - 1; y <= year + 1; y++) yearOptions.push(y)

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 pt-3 pb-0 space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold text-gray-800">📊 النشاط والتارجت</h1>
            <div className="flex items-center gap-2">
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white">
                {MONTHS.map((name, i) => <option key={i} value={i + 1}>{name}</option>)}
              </select>
              <select value={year} onChange={(e) => setYear(Number(e.target.value))}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white">
                {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
          <div className="flex">
            {TABS.map((tab) => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={`flex-1 pb-2 text-sm font-semibold transition-colors relative ${
                  activeTab === tab.key ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-700'
                }`}>
                {tab.label}
                {activeTab === tab.key && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto">
        <div style={{ display: activeTab === 'activity' ? 'block' : 'none' }}>
          <ActivityScreen month={month} year={year} embedded />
        </div>
        <div style={{ display: activeTab === 'achievement' ? 'block' : 'none' }}>
          <Placeholder title="شاشة الإنجاز" />
        </div>
        <div style={{ display: activeTab === 'targets' ? 'block' : 'none' }}>
          <TargetsPage />
        </div>
        <div style={{ display: activeTab === 'weights' ? 'block' : 'none' }}>
          <WeightsPage />
        </div>
      </div>
    </div>
  )
}
