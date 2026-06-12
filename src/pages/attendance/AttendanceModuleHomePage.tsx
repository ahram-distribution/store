import { useNavigate } from 'react-router-dom'
import { Monitor, Clock, Map, BarChart3, Settings } from 'lucide-react'

interface ModuleCard {
  title: string
  description: string
  icon: React.ReactNode
  path: string
  color: string
  bgColor: string
}

const cards: ModuleCard[] = [
  {
    title: 'غرفة العمليات',
    description: 'مراقبة مباشرة للفريق',
    icon: <Monitor className="w-8 h-8" />,
    path: '/attendance/operations',
    color: 'text-blue-600',
    bgColor: 'bg-blue-50 hover:bg-blue-100',
  },
  {
    title: 'سجل الحضور',
    description: 'سجل حضور الموظفين',
    icon: <Clock className="w-8 h-8" />,
    path: '/attendance/history',
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-50 hover:bg-emerald-100',
  },
  {
    title: 'الخرائط والتتبع',
    description: 'خريطة الفريق والمواقع',
    icon: <Map className="w-8 h-8" />,
    path: '/attendance/team-map',
    color: 'text-purple-600',
    bgColor: 'bg-purple-50 hover:bg-purple-100',
  },
  {
    title: 'التقارير والتحليلات',
    description: 'تقارير الحضور والتحليل',
    icon: <BarChart3 className="w-8 h-8" />,
    path: '/attendance/reports',
    color: 'text-amber-600',
    bgColor: 'bg-amber-50 hover:bg-amber-100',
  },
  {
    title: 'السياسات والإعدادات',
    description: 'إعدادات الحضور والسياسات',
    icon: <Settings className="w-8 h-8" />,
    path: '/attendance/settings',
    color: 'text-gray-600',
    bgColor: 'bg-gray-100 hover:bg-gray-200',
  },
]

export default function AttendanceModuleHomePage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-gray-50 p-5" dir="rtl">
      <div className="mx-auto" style={{ maxWidth: '900px' }}>
        <div className="flex items-center gap-3 mb-6">
          <Clock className="w-8 h-8 text-blue-600" />
          <h1 className="text-2xl font-bold text-gray-800">الحضور والانصراف</h1>
        </div>

        <p className="text-sm text-gray-500 mb-6">
          النظام الرئيسي لإدارة الحضور والانصراف — اختر إحدى الخدمات
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map((card) => (
            <button
              key={card.path}
              onClick={() => navigate(card.path)}
              className={`${card.bgColor} rounded-2xl p-5 text-right transition-all hover:shadow-md active:scale-[0.98] border border-transparent hover:border-gray-200`}
            >
              <div className={`${card.color} mb-3`}>{card.icon}</div>
              <h3 className="font-bold text-gray-800 mb-1">{card.title}</h3>
              <p className="text-xs text-gray-500">{card.description}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
