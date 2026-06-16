import { useNavigate } from 'react-router-dom'

export function NotFoundPage() {
  const navigate = useNavigate()

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-4">
      <div className="w-16 h-16 mb-4 rounded-full bg-amber-100 flex items-center justify-center">
        <span className="text-amber-500 text-2xl font-bold">404</span>
      </div>
      <h2 className="text-lg font-bold mb-2" style={{ color: '#1F2937' }}>الصفحة غير موجودة</h2>
      <p className="text-sm mb-6 text-center" style={{ color: '#6B7280' }}>
        الصفحة التي تبحث عنها غير متوفرة أو قد تكون قد حُذفت
      </p>
      <div className="flex gap-3">
        <button
          onClick={() => navigate(-1)}
          className="px-5 py-2 rounded-lg text-sm font-medium"
          style={{ background: '#F3F4F6', color: '#374151' }}
        >
          العودة للصفحة السابقة
        </button>
        <button
          onClick={() => navigate('/')}
          className="px-5 py-2 rounded-lg text-white text-sm font-medium"
          style={{ background: '#0B3D91' }}
        >
          الرئيسية
        </button>
      </div>
    </div>
  )
}
