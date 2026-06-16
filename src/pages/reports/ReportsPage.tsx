import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort } from '../../utils/format'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

type ReportSection = 'sales_rep' | 'sales_manager' | 'sales_customer' | 'sales_product' | 'sales_company' | 'sales_time' | 'orders' | 'collections' | 'visits'

const SECTIONS: { key: ReportSection; label: string }[] = [
  { key: 'sales_rep', label: 'المبيعات حسب المندوب' },
  { key: 'sales_manager', label: 'المبيعات حسب المدير' },
  { key: 'sales_customer', label: 'المبيعات حسب العميل' },
  { key: 'sales_product', label: 'المبيعات حسب المنتج' },
  { key: 'sales_company', label: 'المبيعات حسب الشركة' },
  { key: 'sales_time', label: 'المبيعات حسب الفترة' },
  { key: 'orders', label: 'تقرير الطلبات' },
  { key: 'collections', label: 'تقرير التحصيلات' },
  { key: 'visits', label: 'تقرير الزيارات' },
]

export function ReportsPage() {
  const navigate = useNavigate()
  const [activeSection, setActiveSection] = useState<ReportSection>('sales_rep')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<any[] | any>(null)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [timeGrouping, setTimeGrouping] = useState('day')
  const [collectionGrouping, setCollectionGrouping] = useState('day')
  const [visitReportType, setVisitReportType] = useState('rep_activity')

  const rpcMap: Record<ReportSection, string> = {
    sales_rep: 'get_sales_by_rep',
    sales_manager: 'get_sales_by_manager',
    sales_customer: 'get_sales_by_customer',
    sales_product: 'get_sales_by_product',
    sales_company: 'get_sales_by_company',
    sales_time: 'get_sales_by_time',
    orders: 'get_order_report',
    collections: 'get_collection_report',
    visits: 'get_visit_report',
  }

  function loadReport(section: ReportSection) {
    setLoading(true); setError(null); setData(null)
    const token = getToken()
    if (!token) { setLoading(false); return }

    const rpcName = rpcMap[section]
    const params: any = { p_token: token }

    if (dateFrom) params.p_date_from = dateFrom
    if (dateTo) params.p_date_to = dateTo
    if (section === 'sales_time') params.p_grouping = timeGrouping
    if (section === 'collections') params.p_grouping = collectionGrouping
    if (section === 'visits') params.p_report_type = visitReportType

    supabase.rpc(rpcName, params).then(({ data: result, error: err }) => {
      if (err) { setError(err.message); setLoading(false); return }
      setData(result)
      setLoading(false)
    })
  }

  useEffect(() => { loadReport(activeSection) }, [activeSection])

  const totalAmount = useMemo(() => {
    if (!data || !Array.isArray(data)) return 0
    return data.reduce((sum, row) => sum + Number(row.total_amount || row.totalAmount || 0), 0)
  }, [data])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">التقارير</h1>
      </div>

      <div className="flex gap-1 bg-white rounded-lg border border-border p-1 overflow-x-auto">
        {SECTIONS.map((s) => (
          <button key={s.key} onClick={() => setActiveSection(s.key)}
            className={`whitespace-nowrap text-[10px] px-2 py-1.5 rounded-md font-semibold transition-colors ${activeSection === s.key ? 'bg-primary text-white' : 'text-text-secondary'}`}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-border p-3 space-y-2">
        <div className="flex gap-2">
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white" />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white" />
          {(activeSection === 'sales_time') && (
            <select value={timeGrouping} onChange={(e) => setTimeGrouping(e.target.value)}
              className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white">
              <option value="day">يومي</option>
              <option value="month">شهري</option>
            </select>
          )}
          {(activeSection === 'collections') && (
            <select value={collectionGrouping} onChange={(e) => setCollectionGrouping(e.target.value)}
              className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white">
              <option value="day">يومي</option>
              <option value="week">أسبوعي</option>
              <option value="month">شهري</option>
            </select>
          )}
          {(activeSection === 'visits') && (
            <select value={visitReportType} onChange={(e) => setVisitReportType(e.target.value)}
              className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white">
              <option value="rep_activity">نشاط المندوبين</option>
              <option value="customer_coverage">تغطية العملاء</option>
            </select>
          )}
        </div>
        <button onClick={() => loadReport(activeSection)}
          className="w-full bg-primary text-white text-xs py-2 rounded-lg font-semibold">تحديث التقرير</button>
      </div>

      {totalAmount > 0 && (
        <div className="bg-success/10 border border-success/20 rounded-lg p-3 text-center">
          <span className="text-xs text-text-secondary">الإجمالي</span>
          <div className="text-lg font-bold text-success">{formatCurrencyShort(totalAmount)}</div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : error ? (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 text-sm text-danger">{error}</div>
      ) : !data || (Array.isArray(data) && data.length === 0) ? (
        <div className="text-center py-12 text-text-secondary text-sm">لا توجد بيانات</div>
      ) : (
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          {Array.isArray(data) && data.length > 0 && (
            <table className="w-full text-xs">
              <thead className="bg-surface">
                <tr>
                  {Object.keys(data[0]).filter(k => k !== 'id' && k !== 'product_id' && k !== 'customer_id' && k !== 'employee_id' && k !== 'company_id').map((key) => (
                    <th key={key} className="px-2 py-2 text-right font-semibold text-text-secondary">
                      {key === 'employee_name' || key === 'employee_code' ? 'المندوب' :
                       key === 'manager_name' ? 'المدير' :
                       key === 'customer_name' ? 'العميل' :
                       key === 'product_name' ? 'المنتج' :
                       key === 'company_name' ? 'الشركة' :
                       key === 'total_orders' ? 'عدد الطلبات' :
                       key === 'total_amount' ? 'الإجمالي' :
                       key === 'total_quantity' ? 'الكمية' :
                       key === 'order_count' ? 'عدد الطلبات' :
                       key === 'customer_count' ? 'عدد العملاء' :
                       key === 'rep_count' ? 'عدد المندوبين' :
                       key === 'product_count' ? 'عدد المنتجات' :
                       key === 'period' ? 'الفترة' :
                       key === 'status' ? 'الحالة' :
                       key === 'count' ? 'العدد' :
                       key === 'total_visits' ? 'عدد الزيارات' :
                       key === 'completed_visits' ? 'مكتملة' :
                       key === 'active_visits' ? 'نشطة' :
                       key === 'last_visit' ? 'آخر زيارة' :
                       key === 'owner_name' ? 'المسؤول' :
                       key === 'total_revenue' ? 'الإيرادات' :
                       key === 'total_order_items' ? 'عدد عناصر الطلبات' :
                       key}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((row: any, i: number) => (
                  <tr key={i} className="border-t border-border/50">
                    {Object.entries(row).filter(([k]) => k !== 'id' && k !== 'product_id' && k !== 'customer_id' && k !== 'employee_id' && k !== 'company_id').map(([key, val]) => (
                      <td key={key} className="px-2 py-2">
                        {typeof val === 'number' && (key.includes('amount') || key.includes('total') || key.includes('revenue') || key.includes('price'))
                          ? formatCurrencyShort(val as number)
                          : key.includes('at') && val
                            ? new Date(val as string).toLocaleDateString('ar-EG-u-nu-latn')
                            : String(val ?? 'غير متوفر')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!Array.isArray(data) && (
            <div className="p-4">
              {Object.entries(data as any).map(([key, val]) => (
                <div key={key} className="flex justify-between py-1 border-b border-border/50 last:border-0">
                  <span className="text-xs text-text-secondary">{key}</span>
                  <span className="text-xs font-semibold">{String(val ?? 'غير متوفر')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
