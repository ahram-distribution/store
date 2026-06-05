import { useNavigate } from 'react-router-dom'

export function SecurityWorkspace() {
  const navigate = useNavigate()

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-gray-700 to-gray-900 text-white rounded-xl p-5">
        <p className="text-sm opacity-90">لوحة التحكم</p>
        <h2 className="text-xl font-bold mt-1">الأمن</h2>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => navigate('/visits?filter=today')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <span className="text-xs font-semibold text-text">تسجيل الزوار</span>
          <p className="text-2xl font-bold text-primary mt-1">تسجيل</p>
        </button>
        <button onClick={() => navigate('/visits/new')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <span className="text-xs font-semibold text-text">زيارة جديدة</span>
          <p className="text-2xl font-bold text-accent mt-1">جديد</p>
        </button>
      </div>

      <div className="bg-white rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold text-text mb-3">إجراءات سريعة</h3>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => navigate('/visits')} className="bg-primary text-white text-xs py-2.5 rounded-lg">سجل الزوار</button>
          <button onClick={() => navigate('/visits/new')} className="bg-primary text-white text-xs py-2.5 rounded-lg">تسجيل دخول زائر</button>
          <button onClick={() => navigate('/security/gate-log')} className="bg-surface text-text text-xs py-2.5 rounded-lg border border-border">سجل البوابة</button>
          <button onClick={() => navigate('/employees')} className="bg-surface text-text text-xs py-2.5 rounded-lg border border-border">الموظفين</button>
        </div>
      </div>
    </div>
  )
}
