import { useEffect, useState, useMemo, useCallback } from 'react'
import { targetService } from '../../services/targets'

interface WeightForm {
  sales_weight: string; orders_weight: string; collections_weight: string; visits_weight: string
  new_customers_weight: string; attendance_weight: string
}

const WEIGHT_LABELS: Record<keyof WeightForm, string> = {
  sales_weight: 'المبيعات',
  orders_weight: 'الطلبات',
  collections_weight: 'التحصيل',
  visits_weight: 'الزيارات',
  new_customers_weight: 'العملاء الجدد',
  attendance_weight: 'الحضور والانضباط',
}

const WEIGHT_ORDER: (keyof WeightForm)[] = [
  'sales_weight', 'orders_weight', 'visits_weight', 'new_customers_weight',
  'collections_weight', 'attendance_weight',
]

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface WeightsTabProps {
  month: number
  year: number
}

export default function WeightsTab({ month: selMonth, year: selYear }: WeightsTabProps) {
  const [loading, setLoading] = useState(true)

  const [weightForm, setWeightForm] = useState<WeightForm>({
    sales_weight: '35', orders_weight: '7.5', collections_weight: '20', visits_weight: '15',
    new_customers_weight: '15', attendance_weight: '15',
  })

  const [savingWeights, setSavingWeights] = useState(false)
  const [weightError, setWeightError] = useState('')
  const [weightSuccess, setWeightSuccess] = useState(false)

  useEffect(() => {
    setLoading(true)
    const token = getToken()
    if (!token) { setLoading(false); return }
    targetService.getCompanyTarget(selMonth, selYear, token)
      .then(({ data }) => {
        if (data) {
          const ct = data as any
          if (ct?.sales_weight_percent != null) {
            setWeightForm({
              sales_weight: ct.sales_weight_percent?.toString() || '35',
              orders_weight: ct.orders_weight_percent?.toString() || '7.5',
              collections_weight: ct.collections_weight_percent?.toString() || '20',
              visits_weight: ct.visits_weight_percent?.toString() || '15',
              new_customers_weight: ct.new_customers_weight_percent?.toString() || '15',
              attendance_weight: ct.attendance_weight_percent?.toString() || '15',
            })
          }
        }
        setLoading(false)
      })
  }, [selMonth, selYear])

  const weightSum = useMemo(() => {
    return WEIGHT_ORDER.reduce((sum, key) => sum + (parseFloat(weightForm[key]) || 0), 0)
  }, [weightForm])

  const handleSaveWeights = useCallback(async () => {
    if (savingWeights) return
    setWeightError('')
    setWeightSuccess(false)
    const values = WEIGHT_ORDER.map(k => parseFloat(weightForm[k]) || 0)
    if (values.reduce((a, b) => a + b, 0) !== 100) {
      setWeightError('مجموع النسب يجب أن يساوي 100%')
      return
    }
    setSavingWeights(true)
    const token = getToken()
    if (!token) { setSavingWeights(false); return }
    const { error } = await targetService.upsertCompanyTarget(
      selMonth, selYear,
      0, 0, 0, 0,
      values[0], values[2], values[1], values[3], values[4], values[5], token
    )
    setSavingWeights(false)
    if (error) {
      setWeightError(error.message || 'حدث خطأ أثناء الحفظ')
      return
    }
    setWeightSuccess(true)
    setTimeout(() => setWeightSuccess(false), 2500)
  }, [savingWeights, weightForm, selMonth, selYear])

  function handleChange(field: keyof WeightForm, value: string) {
    setWeightForm(prev => ({ ...prev, [field]: value }))
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-400 text-sm">جاري التحميل...</div>
  }

  return (
    <div className="p-4 space-y-6">
      <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
        <h3 className="text-sm font-bold text-gray-800 mb-2">أوزان التقييم السنوية</h3>
        <p className="text-[10px] text-gray-500 mb-4">تطبق هذه الأوزان على جميع الموظفين لحساب نسبة الإنجاز الإجمالية.</p>
        <div className="space-y-3">
          {WEIGHT_ORDER.map(key => (
            <div key={key}>
              <label className="text-[10px] text-gray-500 block mb-1">{WEIGHT_LABELS[key]} %</label>
              <input type="number" value={weightForm[key]}
                onChange={e => handleChange(key, e.target.value)}
                className="w-full border border-gray-200 rounded-lg p-2 text-sm text-gray-800 text-right bg-white" />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-3">
          <span className="text-xs text-gray-500">المجموع:</span>
          <span className={`text-xs font-bold ${weightSum === 100 ? 'text-green-600' : 'text-red-500'}`}>
            {weightSum}% {weightSum === 100 ? '✓' : '✗'}
          </span>
        </div>
        {weightSuccess && (
          <div className="mt-3 bg-green-50 border border-green-200 text-green-700 text-xs rounded-lg p-3">تم حفظ الأوزان بنجاح</div>
        )}
        {weightError && (
          <div className="mt-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-3">{weightError}</div>
        )}
        <button onClick={handleSaveWeights} disabled={savingWeights || weightSum !== 100}
          className="mt-3 w-full py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-semibold active:opacity-80 disabled:opacity-50 transition-colors cursor-pointer">
          {savingWeights ? 'جاري الحفظ...' : 'حفظ الأوزان'}
        </button>
      </div>
    </div>
  )
}
