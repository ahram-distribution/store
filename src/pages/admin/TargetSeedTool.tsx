import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { targetService } from '../../services/targets'

export function TargetSeedTool() {
  const nav = useNavigate()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [seeding, setSeeding] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    targetService.seedSalesRepTargets(true)
      .then((res) => {
        if (res.error) { setError(res.error.message); return }
        if (res.data?.error) { setError(res.data.error); return }
        setData(res.data)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const handleSeed = async () => {
    setSeeding(true)
    setError(null)
    try {
      const res = await targetService.seedSalesRepTargets(false)
      if (res.error) { setError(res.error.message); return }
      if (res.data?.error) { setError(res.data.error); return }
      setResult(res.data)
    } catch (e: any) { setError(e.message) }
    finally { setSeeding(false) }
  }

  if (loading) {
    return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  }

  if (error) {
    return <div className="text-center py-12 text-red-500 text-sm">{error}</div>
  }

  const hasMissing = (data?.reps_without_targets || 0) > 0

  return (
    <div className="space-y-5 p-4" dir="rtl">
      <div className="flex items-center gap-3">
        <button onClick={() => nav(-1)} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">بذر الأهداف التلقائي</h1>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
        <p className="font-semibold">شهر {data?.month} / {data?.year}</p>
        <p>العدد الإجمالي للمناديب المستهدفين: <strong>{data?.total_sales_reps}</strong></p>
        <p>لديهم هدف بالفعل: <strong className="text-green-600">{data?.reps_with_targets}</strong></p>
        <p className="text-red-600 font-semibold">بدون هدف: <strong>{data?.reps_without_targets}</strong></p>
      </div>

      {data?.missing_list?.length > 0 && (
        <div>
          <h2 className="text-[15px] font-semibold text-text mb-2">المناديب الناقصين:</h2>
          <div className="bg-white border border-border rounded-xl divide-y divide-border">
            {data.missing_list.map((name: string) => (
              <div key={name} className="px-4 py-2.5 text-sm text-text">{name}</div>
            ))}
          </div>
        </div>
      )}

      {data?.already_list?.length > 0 && (
        <div>
          <h2 className="text-[15px] font-semibold text-text mb-2">المناديب الموجودين:</h2>
          <div className="bg-white border border-border rounded-xl divide-y divide-border">
            {data.already_list.map((name: string) => (
              <div key={name} className="px-4 py-2.5 text-sm text-green-700">{name}</div>
            ))}
          </div>
        </div>
      )}

      {!result && hasMissing && (
        <button onClick={handleSeed} disabled={seeding}
          className="w-full bg-primary rounded-xl py-3.5 text-center text-white font-bold text-base active:opacity-80 transition-opacity disabled:opacity-60">
          {seeding ? 'جاري الإنشاء...' : `إنشاء أهداف لـ ${data?.reps_without_targets} مندوب`}
        </button>
      )}

      {!result && !hasMissing && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center text-green-700 text-sm font-semibold">
          جميع المناديب لديهم أهداف — لا حاجة للبذر
        </div>
      )}

      {result && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-800 space-y-1">
          <p className="font-semibold text-base">تم التنفيذ بنجاح</p>
          <p>المناديب الذين تمت إضافتهم: <strong>{result.created}</strong></p>
          {result.created > 0 && (
            <div className="mt-2">
              {result.created_list?.map((name: string) => (
                <div key={name} className="text-green-700">{name}</div>
              ))}
            </div>
          )}
          <button onClick={() => nav(-1)}
            className="mt-3 w-full bg-primary rounded-xl py-3 text-center text-white font-bold text-sm active:opacity-80 transition-opacity">
            العودة
          </button>
        </div>
      )}
    </div>
  )
}
