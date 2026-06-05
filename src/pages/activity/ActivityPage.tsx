import { useNavigate } from 'react-router-dom'

export default function ActivityPage() {
  const nav = useNavigate()

  return (
    <div className="p-4 space-y-6" dir="rtl">
      <div className="flex items-center gap-3">
        <button onClick={() => nav(-1)} className="text-sm text-primary font-semibold">→ رجوع</button>
        <h1 className="text-xl font-bold text-text">النشاط الموحد</h1>
      </div>

      <div className="bg-white rounded-xl border border-border p-8 text-center">
        <div className="text-5xl mb-4">🔄</div>
        <h2 className="text-lg font-bold text-text mb-2">النشاط الموحد</h2>
        <p className="text-sm text-text-secondary mb-6">
          آخر الأحداث التشغيلية من مكان واحد
        </p>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-w-xl mx-auto">
          <PlaceholderCard label="الطلبات" />
          <PlaceholderCard label="الزيارات" />
          <PlaceholderCard label="التحصيلات" />
          <PlaceholderCard label="العملاء الجدد" />
          <PlaceholderCard label="تغييرات الملكية" />
          <PlaceholderCard label="العمليات التشغيلية" />
        </div>

        <p className="text-xs text-text-secondary mt-6">
          سيتم تفعيل مصادر البيانات في التحديثات القادمة
        </p>
      </div>
    </div>
  )
}

function PlaceholderCard({ label }: { label: string }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-4 text-center opacity-60">
      <span className="text-sm font-semibold text-text">{label}</span>
    </div>
  )
}
