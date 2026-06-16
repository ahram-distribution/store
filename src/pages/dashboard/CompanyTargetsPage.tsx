import { useEffect, useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { targetService } from '../../services/targets'

interface WeightForm {
  sales_weight: string; collections_weight: string; visits_weight: string
  new_customers_weight: string; attendance_weight: string
}

const MONTHS = ['يناير', 'فبراير', 'مارس', 'إبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

function fmt(n: number): string {
  return n.toLocaleString('ar-EG-u-nu-latn')
}

export default function CompanyTargetsPage() {
  const nav = useNavigate()
  const now = new Date()
  const [selMonth, setSelMonth] = useState(now.getMonth() + 1)
  const [selYear, setSelYear] = useState(now.getFullYear())
  const [loading, setLoading] = useState(true)
  const [totalEmployees, setTotalEmployees] = useState(0)
  const [totalAchievement, setTotalAchievement] = useState<number | null>(null)
  const [topEmployee, setTopEmployee] = useState<{ name: string; score: number } | null>(null)

  const [weightForm, setWeightForm] = useState<WeightForm>({
    sales_weight: '35', collections_weight: '20', visits_weight: '15',
    new_customers_weight: '15', attendance_weight: '15',
  })

  const [savingWeights, setSavingWeights] = useState(false)
  const [weightError, setWeightError] = useState('')
  const [weightSuccess, setWeightSuccess] = useState(false)

  async function loadData(month: number, year: number) {
    const token = getToken()
    if (!token) { setLoading(false); return }
    const [targetResult, perfResult] = await Promise.all([
      targetService.getCompanyTarget(month, year, token),
      targetService.getPerformance(month, year, token),
    ])
    if (!targetResult.error && targetResult.data) {
      const ct = targetResult.data as any
      if (ct && ct.sales_weight_percent != null) {
        setWeightForm({
          sales_weight: ct.sales_weight_percent?.toString() || '35',
          collections_weight: ct.collections_weight_percent?.toString() || '20',
          visits_weight: ct.visits_weight_percent?.toString() || '15',
          new_customers_weight: ct.new_customers_weight_percent?.toString() || '15',
          attendance_weight: ct.attendance_weight_percent?.toString() || '15',
        })
      }
    }
    if (!perfResult.error && perfResult.data) {
      const p = perfResult.data as any
      if (p.employees) {
        const emps = p.employees as any[]
        setTotalEmployees(emps.length)
        const totalScore = emps.reduce((s: number, e: any) => s + (e.overall_achievement_score || 0), 0)
        setTotalAchievement(emps.length > 0 ? totalScore / emps.length : null)
        if (p.best_employee) {
          setTopEmployee({
            name: p.best_employee.employee_name,
            score: p.best_employee.overall_achievement_score || 0,
          })
        }
      }
    }
    setLoading(false)
  }

  useEffect(() => {
    setLoading(true)
    loadData(selMonth, selYear)
  }, [selMonth, selYear])

  function goPrevMonth() {
    if (selMonth === 1) { setSelMonth(12); setSelYear(selYear - 1) }
    else setSelMonth(selMonth - 1)
  }

  function goNextMonth() {
    if (selMonth === 12) { setSelMonth(1); setSelYear(selYear + 1) }
    else setSelMonth(selMonth + 1)
  }

  const monthOptions = []
  for (let i = -6; i <= 6; i++) {
    const d = new Date(selYear, selMonth - 1 + i, 1)
    monthOptions.push({
      month: d.getMonth() + 1,
      year: d.getFullYear(),
      label: MONTHS[d.getMonth()] + ' ' + d.getFullYear(),
    })
  }

  const weightSum = useMemo(() => {
    return (parseFloat(weightForm.sales_weight) || 0) +
      (parseFloat(weightForm.collections_weight) || 0) +
      (parseFloat(weightForm.visits_weight) || 0) +
      (parseFloat(weightForm.new_customers_weight) || 0) +
      (parseFloat(weightForm.attendance_weight) || 0)
  }, [weightForm])

  const handleSaveWeights = useCallback(async () => {
    if (savingWeights) return
    setWeightError('')
    setWeightSuccess(false)
    const sw = parseFloat(weightForm.sales_weight) || 0
    const cw = parseFloat(weightForm.collections_weight) || 0
    const vw = parseFloat(weightForm.visits_weight) || 0
    const nw = parseFloat(weightForm.new_customers_weight) || 0
    const aw = parseFloat(weightForm.attendance_weight) || 0
    if (sw + cw + vw + nw + aw !== 100) {
      setWeightError('مجموع النسب يجب أن يساوي 100%')
      return
    }
    setSavingWeights(true)
    const token = getToken()
    if (!token) { setSavingWeights(false); return }
    const { error } = await targetService.upsertCompanyTarget(
      selMonth, selYear,
      0, 0, 0, 0,
      sw, vw, 0, nw, cw, aw, token
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
    return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  }

  return (
    <div className="p-4 space-y-6" dir="rtl">
      <div className="flex items-center gap-2">
        <button onClick={() => nav('/dashboard')} className="text-primary text-sm font-semibold hover:underline shrink-0">{'← العودة'}</button>
        <h1 className="text-xl font-bold text-text flex-1">إعدادات التقييم</h1>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={goPrevMonth} className="px-3 py-1.5 border border-border rounded-lg text-xs font-semibold text-text bg-white active:bg-surface shrink-0">{'‹ السابق'}</button>
        <select value={`${selMonth}-${selYear}`} onChange={e => {
          const [m, y] = e.target.value.split('-').map(Number)
          setSelMonth(m); setSelYear(y)
        }}
          className="flex-1 border border-border rounded-lg px-3 py-1.5 text-sm font-semibold text-text bg-white cursor-pointer text-center">
          {monthOptions.map(opt => (
            <option key={`${opt.month}-${opt.year}`} value={`${opt.month}-${opt.year}`}>{opt.label}</option>
          ))}
        </select>
        <button onClick={goNextMonth} className="px-3 py-1.5 border border-border rounded-lg text-xs font-semibold text-text bg-white active:bg-surface shrink-0">{'التالي ›'}</button>
      </div>

      {topEmployee && (
        <div className="bg-white rounded-xl border border-border p-4">
          <h3 className="text-sm font-bold text-text mb-3">ملخص الأداء</h3>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-surface rounded-lg p-3">
              <p className="text-[9px] text-text-secondary">عدد الموظفين</p>
              <p className="text-sm font-bold text-text mt-1">{totalEmployees}</p>
            </div>
            <div className="bg-surface rounded-lg p-3">
              <p className="text-[9px] text-text-secondary">متوسط الإنجاز</p>
              <p className={`text-sm font-bold mt-1 ${totalAchievement !== null && totalAchievement >= 50 ? 'text-success' : 'text-red-500'}`}>
                {totalAchievement !== null ? totalAchievement.toFixed(1) + '%' : 'غير متوفر'}
              </p>
            </div>
            <div className="bg-surface rounded-lg p-3">
              <p className="text-[9px] text-text-secondary">الأفضل</p>
              <p className="text-xs font-bold text-primary mt-1 truncate">{topEmployee.name}</p>
              <p className="text-[10px] font-semibold text-success">{topEmployee.score.toFixed(1)}%</p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold text-text mb-2">أوزان التقييم السنوية</h3>
        <p className="text-[10px] text-text-secondary mb-4">تطبق هذه الأوزان على جميع الموظفين. يمكن تجاوزها لكل موظف من شاشة أهداف الموظفين.</p>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] text-text-secondary block mb-1">المبيعات %</label>
            <input type="number" value={weightForm.sales_weight}
              onChange={e => handleChange('sales_weight', e.target.value)}
              className="w-full border border-border rounded-lg p-2 text-sm text-text text-right bg-white" />
          </div>
          <div>
            <label className="text-[10px] text-text-secondary block mb-1">التحصيل %</label>
            <input type="number" value={weightForm.collections_weight}
              onChange={e => handleChange('collections_weight', e.target.value)}
              className="w-full border border-border rounded-lg p-2 text-sm text-text text-right bg-white" />
          </div>
          <div>
            <label className="text-[10px] text-text-secondary block mb-1">الزيارات %</label>
            <input type="number" value={weightForm.visits_weight}
              onChange={e => handleChange('visits_weight', e.target.value)}
              className="w-full border border-border rounded-lg p-2 text-sm text-text text-right bg-white" />
          </div>
          <div>
            <label className="text-[10px] text-text-secondary block mb-1">العملاء الجدد %</label>
            <input type="number" value={weightForm.new_customers_weight}
              onChange={e => handleChange('new_customers_weight', e.target.value)}
              className="w-full border border-border rounded-lg p-2 text-sm text-text text-right bg-white" />
          </div>
          <div>
            <label className="text-[10px] text-text-secondary block mb-1">الحضور والانضباط %</label>
            <input type="number" value={weightForm.attendance_weight}
              onChange={e => handleChange('attendance_weight', e.target.value)}
              className="w-full border border-border rounded-lg p-2 text-sm text-text text-right bg-white" />
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <span className="text-xs text-text-secondary">المجموع:</span>
          <span className={`text-xs font-bold ${weightSum === 100 ? 'text-success' : 'text-red-500'}`}>
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
          className="mt-3 w-full py-2.5 bg-primary text-white rounded-xl text-xs font-semibold active:opacity-80 disabled:opacity-50 transition-colors">
          {savingWeights ? 'جاري الحفظ...' : 'حفظ الأوزان'}
        </button>
      </div>
    </div>
  )
}
