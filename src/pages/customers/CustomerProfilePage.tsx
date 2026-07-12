import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useCapability } from '../../hooks/useCapability'
import { formatCurrencyShort, formatDate, formatDateTime } from '../../utils/format'
import { getCustomerState, getCustomerStateLabel, CUSTOMER_STATE_LABELS } from '../../utils/systemStates'
import { LocationRepository, LocationNormalizationService } from '../../domain/location'
import { getCurrentLocation } from '../../services/gpsService'
import { SearchableSelect } from '../../components/shared/SearchableSelect'
import { CustomerAddressCard } from '../../components/customers/CustomerAddressCard'
import toast from 'react-hot-toast'

const BUSINESS_TYPES: { value: string; label: string }[] = [
  { value: 'wholesaler', label: 'تاجر جملة' },
  { value: 'distributor', label: 'موزع' },
  { value: 'cosmetics_store', label: 'متجر مستحضرات تجميل' },
  { value: 'supermarket', label: 'سوبر ماركت' },
  { value: 'hypermarket', label: 'هايبر ماركت' },
  { value: 'perfume_store', label: 'متجر عطور / عطار' },
  { value: 'pharmacy', label: 'صيدلية' },
  { value: 'warehouse', label: 'مخزن' },
  { value: 'other', label: 'أخرى' },
]

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const fmt = (n: number) => Number.isFinite(n) ? n.toLocaleString('en-EG') : '0'
const fmtPct = (n: number) => Number.isFinite(n) ? n.toFixed(1) + '%' : '0.0%'

function safeNum(v: unknown, fallback = 0): number {
  return typeof v === 'number' && !isNaN(v) ? v : fallback
}

function safeStr(v: unknown, fallback = 'غير متوفر'): string {
  if (v === null || v === undefined || v === '') return fallback
  return String(v)
}

function safeDate(v: unknown): string {
  if (!v) return 'غير متوفر'
  const d = new Date(v as string)
  return isNaN(d.getTime()) ? 'غير متوفر' : d.toLocaleDateString('ar-EG-u-nu-latn')
}

type Tab = 'info' | 'overview' | 'products' | 'companies' | 'visits' | 'behavior' | 'history'

function OverviewTab({ customerId }: { customerId: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const token = getToken()

  const today = new Date()
  const yearAgo = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000)
  const [from, setFrom] = useState(yearAgo.toISOString().split('T')[0])
  const [to, setTo] = useState(today.toISOString().split('T')[0])

  const fetchData = async () => {
    if (!token || !customerId) return
    setLoading(true)
    const { data: result, error } = await supabase.rpc('get_customer_full_profile', {
      p_token: token, p_customer_id: customerId, p_from: from, p_to: to,
    })
    if (result && !error && !(result as any).error) setData(result as Record<string, unknown>)
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [customerId])

  if (loading) return <div className="text-center py-8 text-text-secondary text-sm">جاري التحميل...</div>
  if (!data) return <div className="text-center py-8 text-text-secondary text-sm">لا توجد بيانات</div>

  const stats = (data.stats || {}) as Record<string, unknown>
  const customer = (data.customer || {}) as Record<string, unknown>

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-border p-3">
        <div className="flex gap-2">
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white" />
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white" />
          <button onClick={fetchData} disabled={loading}
            className="bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50">
            {loading ? '...' : 'تحديث'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border p-3 space-y-1.5">
        <h3 className="text-sm font-bold text-text mb-1.5">بيانات العميل</h3>
        <div className="flex justify-between text-xs"><span className="text-text-secondary">الكود</span><span className="font-semibold">{safeStr(customer.code)}</span></div>
        <div className="flex justify-between text-xs"><span className="text-text-secondary">الهاتف</span><span className="font-semibold" dir="ltr">{safeStr(customer.phone)}</span></div>
        <div className="flex justify-between text-xs"><span className="text-text-secondary">المسؤول</span><span className="font-semibold">{safeStr(customer.responsible_name)}</span></div>
        <div className="flex justify-between text-xs"><span className="text-text-secondary">الموظف</span><span className="font-semibold">{safeStr(customer.owner_name)}</span></div>
        <div className="flex justify-between text-xs"><span className="text-text-secondary">التصنيف</span><span className="font-semibold">{safeStr(customer.tier_name)}</span></div>
        <div className="flex justify-between text-xs"><span className="text-text-secondary">آخر طلب</span><span className="font-semibold">{safeDate(stats.last_order_date)}</span></div>
        <div className="flex justify-between text-xs"><span className="text-text-secondary">آخر زيارة</span><span className="font-semibold">{safeDate(stats.last_visit_date)}</span></div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'إجمالي الطلبات', value: fmt(safeNum(stats.total_orders)), color: 'text-primary' },
          { label: 'إجمالي المشتريات', value: formatCurrencyShort(safeNum(stats.total_sales)), color: 'text-success' },
          { label: 'متوسط الطلب', value: formatCurrencyShort(safeNum(stats.avg_order_value)), color: 'text-accent' },
          { label: 'عدد الزيارات', value: fmt(safeNum(stats.visit_count)), color: 'text-blue-600' },
          { label: 'الزيارات الناجحة', value: fmt(safeNum(stats.successful_visits)), color: 'text-success' },
          { label: 'أيام نشطة', value: fmt(safeNum(stats.active_days)), color: 'text-text' },
        ].map(item => (
          <div key={item.label} className="bg-white rounded-xl border border-border p-2.5 text-center">
            <div className={`text-sm font-bold ${item.color}`}>{item.value}</div>
            <div className="text-[8px] text-text-secondary mt-0.5">{item.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ProductsTab({ customerId }: { customerId: string }) {
  const [products, setProducts] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const token = getToken()

  const today = new Date()
  const yearAgo = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000)
  const [from, setFrom] = useState(yearAgo.toISOString().split('T')[0])
  const [to, setTo] = useState(today.toISOString().split('T')[0])

  const fetchData = async () => {
    if (!token || !customerId) return
    setLoading(true)
    const { data, error } = await supabase.rpc('get_customer_products_analysis', {
      p_token: token, p_customer_id: customerId, p_from: from, p_to: to,
    })
    if (data && !error && !(data as any).error) {
      setProducts((data as any).products || [])
    }
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [customerId])

  const display = expanded ? products : products.slice(0, 10)

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-border p-3">
        <div className="flex gap-2">
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white" />
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white" />
          <button onClick={fetchData} disabled={loading}
            className="bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50">
            {loading ? '...' : 'تحديث'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-text-secondary text-sm">جاري التحميل...</div>
      ) : products.length === 0 ? (
        <div className="text-center py-8 text-text-secondary text-xs">لا توجد منتجات في هذه الفترة</div>
      ) : (
        <div className="bg-white rounded-xl border border-border p-3">
          <h3 className="text-sm font-bold text-text mb-2">المنتجات</h3>
          <div className="space-y-1.5">
            {display.map((p, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-text truncate">{safeStr(p.product_name)}</div>
                  <div className="text-[9px] text-text-secondary">{safeStr(p.company_name)} | {safeStr(p.unit_type)}</div>
                </div>
                <div className="text-right shrink-0 mr-2">
                  <div className="text-xs font-bold text-primary">{formatCurrencyShort(safeNum(p.total_value))}</div>
                  <div className="text-[9px] text-text-secondary">
                    {fmt(safeNum(p.total_quantity))} | {fmt(safeNum(p.total_orders_count))} طلب
                  </div>
                </div>
              </div>
            ))}
          </div>
          {products.length > 10 && (
            <button onClick={() => setExpanded(!expanded)}
              className="w-full text-center text-[10px] text-primary font-semibold py-1.5 mt-1">
              {expanded ? 'عرض أقل' : `عرض الكل (${products.length})`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function CompaniesTab({ customerId }: { customerId: string }) {
  const [companies, setCompanies] = useState<Record<string, unknown>[]>([])
  const [totalValue, setTotalValue] = useState(0)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const token = getToken()

  const today = new Date()
  const yearAgo = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000)
  const [from, setFrom] = useState(yearAgo.toISOString().split('T')[0])
  const [to, setTo] = useState(today.toISOString().split('T')[0])

  const fetchData = async () => {
    if (!token || !customerId) return
    setLoading(true)
    const { data, error } = await supabase.rpc('get_customer_companies_analysis', {
      p_token: token, p_customer_id: customerId, p_from: from, p_to: to,
    })
    if (data && !error && !(data as any).error) {
      setCompanies((data as any).companies || [])
      setTotalValue(safeNum((data as any).total_value))
    }
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [customerId])
  const display = expanded ? companies : companies.slice(0, 10)

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-border p-3">
        <div className="flex gap-2">
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white" />
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white" />
          <button onClick={fetchData} disabled={loading}
            className="bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50">
            {loading ? '...' : 'تحديث'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-text-secondary text-sm">جاري التحميل...</div>
      ) : companies.length === 0 ? (
        <div className="text-center py-8 text-text-secondary text-xs">لا توجد شركات في هذه الفترة</div>
      ) : (
        <div className="bg-white rounded-xl border border-border p-3">
          <h3 className="text-sm font-bold text-text mb-2">الشركات الموردة</h3>
          <div className="space-y-1.5">
            {display.map((c, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] font-bold text-text-secondary w-5">{i + 1}</span>
                  <div>
                    <div className="text-xs font-semibold text-text truncate">{safeStr(c.company_name)}</div>
                    <div className="text-[9px] text-text-secondary">{fmt(safeNum(c.orders_count))} طلبات</div>
                  </div>
                </div>
                <div className="text-right shrink-0 mr-2">
                  <div className="text-xs font-bold text-primary">{formatCurrencyShort(safeNum(c.total_value))}</div>
                  <div className="text-[9px] text-text-secondary">{fmtPct(safeNum(c.percentage_share))} من الإجمالي</div>
                </div>
              </div>
            ))}
          </div>
          {companies.length > 10 && (
            <button onClick={() => setExpanded(!expanded)}
              className="w-full text-center text-[10px] text-primary font-semibold py-1.5 mt-1">
              {expanded ? 'عرض أقل' : `عرض الكل (${companies.length})`}
            </button>
          )}
          {totalValue > 0 && (
            <div className="mt-2 pt-2 border-t border-border/30 text-[10px] text-text-secondary text-center">
              إجمالي المشتريات: {formatCurrencyShort(totalValue)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function VisitsTab({ customerId }: { customerId: string }) {
  const [visits, setVisits] = useState<Record<string, unknown>[]>([])
  const [stats, setStats] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(true)
  const token = getToken()

  const today = new Date()
  const yearAgo = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000)
  const [from, setFrom] = useState(yearAgo.toISOString().split('T')[0])
  const [to, setTo] = useState(today.toISOString().split('T')[0])

  const fetchData = async () => {
    if (!token || !customerId) return
    setLoading(true)
    const { data, error } = await supabase.rpc('get_customer_visits_analysis', {
      p_token: token, p_customer_id: customerId, p_from: from, p_to: to,
    })
    if (data && !error && !(data as any).error) {
      setVisits((data as any).visits || [])
      setStats((data as any).stats || {})
    }
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [customerId])

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-border p-3">
        <div className="flex gap-2">
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white" />
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white" />
          <button onClick={fetchData} disabled={loading}
            className="bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50">
            {loading ? '...' : 'تحديث'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-text-secondary text-sm">جاري التحميل...</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'إجمالي الزيارات', value: fmt(safeNum(stats.total_visits)), color: 'text-primary' },
              { label: 'ناجحة', value: fmt(safeNum(stats.successful_visits)), color: 'text-success' },
              { label: 'متوسط المدة', value: fmt(safeNum(stats.avg_duration_minutes)) + ' د', color: 'text-accent' },
            ].map(item => (
              <div key={item.label} className="bg-white rounded-xl border border-border p-2.5 text-center">
                <div className={`text-sm font-bold ${item.color}`}>{item.value}</div>
                <div className="text-[8px] text-text-secondary mt-0.5">{item.label}</div>
              </div>
            ))}
          </div>
          <div className="bg-white rounded-xl border border-border p-3">
            <div className="flex justify-between text-xs mb-2">
              <span className="text-text-secondary">نسبة النجاح</span>
              <span className="font-bold text-success">{fmtPct(safeNum(stats.success_rate))}</span>
            </div>
            <div className="flex justify-between text-xs mb-2">
              <span className="text-text-secondary">آخر زيارة</span>
              <span className="font-semibold">{safeDate(stats.last_visit_date)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-text-secondary">أول زيارة</span>
              <span className="font-semibold">{safeDate(stats.first_visit_date)}</span>
            </div>
          </div>
          {visits.length === 0 ? (
            <div className="text-center py-6 text-text-secondary text-xs">لا توجد زيارات</div>
          ) : (
            <div className="space-y-1.5 max-h-80 overflow-y-auto">
              {visits.map((v, i) => (
                <div key={i} className="bg-white rounded-lg border border-border p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-text">{safeStr(v.code)}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${v.status === 'completed' ? 'bg-success/10 text-success' : 'bg-amber-10 text-amber-600'}`}>
                      {v.status === 'completed' ? 'مكتملة' : safeStr(v.status)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-1 text-[10px] text-text-secondary">
                    <span>{safeDate(v.check_in_at)}</span>
                    {v.duration_minutes != null && <span>{fmt(safeNum(v.duration_minutes))} دقيقة</span>}
                  </div>
                  <div className="text-[9px] text-text-secondary mt-0.5">الموظف: {safeStr(v.employee_name)} | النتيجة: {safeStr(v.visit_result)}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function BehaviorTab({ customerId }: { customerId: string }) {
  const [insights, setInsights] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const token = getToken()

  const today = new Date()
  const yearAgo = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000)
  const [from, setFrom] = useState(yearAgo.toISOString().split('T')[0])
  const [to, setTo] = useState(today.toISOString().split('T')[0])

  const fetchData = async () => {
    if (!token || !customerId) return
    setLoading(true)
    const { data, error } = await supabase.rpc('get_customer_behavior_insights', {
      p_token: token, p_customer_id: customerId, p_from: from, p_to: to,
    })
    if (data && !error && !(data as any).error) {
      setInsights((data as any).insights as Record<string, unknown> | null)
    }
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [customerId])

  if (loading) return <div className="text-center py-8 text-text-secondary text-sm">جاري التحميل...</div>
  if (!insights || Object.keys(insights).length === 0) return <div className="text-center py-8 text-text-secondary text-xs">لا توجد بيانات كافية للتحليل</div>

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-border p-3">
        <div className="flex gap-2">
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white" />
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white" />
          <button onClick={fetchData} disabled={loading}
            className="bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50">
            {loading ? '...' : 'تحديث'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border p-3 space-y-3">
        <h3 className="text-sm font-bold text-text">تحليل سلوك العميل</h3>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-surface rounded-lg p-2.5 text-center">
            <div className="text-lg font-bold text-accent">{insights.repeat_customer ? '🔄 نعم' : '🆕 لا'}</div>
            <div className="text-[9px] text-text-secondary">عميل متكرر</div>
          </div>
          <div className="bg-surface rounded-lg p-2.5 text-center">
            <div className="text-lg font-bold text-primary">{safeStr(insights.most_active_day as string, '-')}</div>
            <div className="text-[9px] text-text-secondary">أيام الذروة</div>
          </div>
          <div className="bg-surface rounded-lg p-2.5 text-center">
            <div className="text-sm font-bold text-text">{insights.avg_days_between_orders ? fmt(safeNum(insights.avg_days_between_orders as number)) + ' يوم' : '-'}</div>
            <div className="text-[9px] text-text-secondary">متوسط الفترة بين الطلبات</div>
          </div>
          <div className="bg-surface rounded-lg p-2.5 text-center">
            <div className={`text-sm font-bold ${insights.growth_trend === 'زيادة' ? 'text-success' : insights.growth_trend === 'انخفاض' ? 'text-danger' : 'text-text'}`}>
              {safeStr(insights.growth_trend as string, '-')}
            </div>
            <div className="text-[9px] text-text-secondary">اتجاه الشراء</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex justify-between bg-surface rounded-lg px-2.5 py-2">
            <span className="text-text-secondary">درجة الاحتفاظ</span>
            <span className="font-bold">{fmt(safeNum(insights.retention_score as number))}/5</span>
          </div>
          <div className="flex justify-between bg-surface rounded-lg px-2.5 py-2">
            <span className="text-text-secondary">أشهر النشاط</span>
            <span className="font-bold">{fmt(safeNum(insights.months_active as number))} شهر</span>
          </div>
        </div>
        <div className="text-xs">
          <div className="flex justify-between bg-surface rounded-lg px-2.5 py-2">
            <span className="text-text-secondary">معدل التكرار (أيام)</span>
            <span className="font-bold">{insights.purchase_frequency ? fmt(safeNum(insights.purchase_frequency as number)) + ' يوم' : '-'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function CustomerProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const canEdit = useCapability('customers.update')
  const canManage = useCapability('customers.manage')
  const [customer, setCustomer] = useState<any>(null)
  const [orders, setOrders] = useState<any[]>([])
  const [contacts, setContacts] = useState<any[]>([])
  const [location, setLocation] = useState<any>(null)
  const [ownershipHistory, setOwnershipHistory] = useState<any[]>([])
  const [employees, setEmployees] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('info')

  const [showEdit, setShowEdit] = useState(false)
  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editResponsibleName, setEditResponsibleName] = useState('')
  const [editBusinessType, setEditBusinessType] = useState('')
  const [editCreditLimit, setEditCreditLimit] = useState('')
  const [editCreditDays, setEditCreditDays] = useState('')
  const [editPassword, setEditPassword] = useState('')
  const [editConfirmPassword, setEditConfirmPassword] = useState('')
  const [editFormattedAddress, setEditFormattedAddress] = useState('')
  const [editContactName, setEditContactName] = useState('')
  const [editContactPhone, setEditContactPhone] = useState('')

  const [governorates, setGovernorates] = useState<{ id: string; name_ar: string }[]>([])
  const [cities, setCities] = useState<{ id: string; governorate_id: string; name_ar: string }[]>([])
  const [editGovernorateId, setEditGovernorateId] = useState('')
  const [editCityId, setEditCityId] = useState('')
  const [editStreet, setEditStreet] = useState('')
  const [editLandmark, setEditLandmark] = useState('')

  useEffect(() => {
    supabase.from('reference_governorates').select('id, name_ar').order('name_ar', { ascending: true }).then(({ data }) => {
      if (data) setGovernorates(data as any[])
    })
  }, [])

  useEffect(() => {
    if (!editGovernorateId) { setCities([]); return }
    supabase.from('reference_cities').select('id, governorate_id, name_ar').eq('governorate_id', editGovernorateId).order('name_ar', { ascending: true }).then(({ data }) => {
      if (data) setCities(data as any[])
    })
  }, [editGovernorateId])

  const [locating, setLocating] = useState(false)

  const [showOwnership, setShowOwnership] = useState(false)
  const [newOwnerId, setNewOwnerId] = useState('')
  const [reason, setReason] = useState('')

  function getLocationRepo() {
    const t = getToken()
    return t ? new LocationRepository(t) : null
  }

  useEffect(() => {
    if (!id) return
    const token = getToken()
    if (!token) return

    Promise.all([
      supabase.rpc('get_governed_customer', { p_token: token, p_id: id }),
      supabase.rpc('get_customer_orders', { p_token: token, p_customer_id: id, p_limit: 50 }),
      supabase.rpc('get_governed_customer_contacts', { p_token: token, p_customer_id: id }),
      supabase.rpc('get_governed_customer_ownership_history', { p_token: token, p_customer_id: id }),
      supabase.rpc('get_governed_employees', { p_token: token }),
    ]).then(async ([custRes, ordRes, contRes, ownRes, empRes]) => {
      if (custRes.data) {
        setCustomer(custRes.data)
        const c = Array.isArray(custRes.data) ? custRes.data[0] : custRes.data
        if (c.location_id) {
          const repo = getLocationRepo()
          if (repo) { const loc = await repo.fetchLocation(c.location_id); if (loc) setLocation(loc) }
          LocationNormalizationService.enrichLocationIfNeeded(c.location_id)
            .then(async (ok) => {
              if (ok) {
                const repo2 = getLocationRepo()
                if (repo2) {
                  const loc2 = await repo2.fetchLocation(c.location_id)
                  if (loc2) setLocation(loc2)
                }
              }
            })
        }
      }
      if (ordRes.data) setOrders(Array.isArray(ordRes.data) ? ordRes.data : [])
      if (contRes.data) setContacts(Array.isArray(contRes.data) ? contRes.data : [])
      if (ownRes.data) setOwnershipHistory(Array.isArray(ownRes.data) ? ownRes.data : [])
      if (empRes.data) setEmployees(Array.isArray(empRes.data) ? empRes.data : [])
      setLoading(false)
    })
  }, [id])

  const monthlySales = useMemo(() => {
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
    return orders.filter((o) => o.created_at >= monthStart).reduce((sum, o) => sum + Number(o.total_amount || 0), 0)
  }, [orders])

  const lastOrderDays = useMemo(() => {
    if (orders.length === 0) return null
    const last = [...orders].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0]
    if (!last?.created_at) return null
    const lastTime = new Date(last.created_at).getTime()
    if (isNaN(lastTime)) return null
    return Math.floor((Date.now() - lastTime) / (1000 * 60 * 60 * 24))
  }, [orders])

  const state = useMemo(() => {
    if (!customer) return null
    return getCustomerState(customer.is_active, lastOrderDays)
  }, [customer, lastOrderDays])

  const statusColors: Record<string, string> = {
    [CUSTOMER_STATE_LABELS.complete]: 'bg-primary/10 text-primary',
    [CUSTOMER_STATE_LABELS.partial]: 'bg-accent/10 text-accent',
    [CUSTOMER_STATE_LABELS.blocked]: 'bg-danger/20 text-danger',
    [CUSTOMER_STATE_LABELS.new]: 'bg-success/10 text-success',
  }

  async function handleEdit() {
    const token = getToken()
    if (editPassword && editPassword !== editConfirmPassword) { toast.error('كلمة المرور غير متطابقة'); return }
    const { data, error } = await supabase.rpc('governed_update_customer', {
      p_token: token, p_id: id,
      p_company_name: editName || null,
      p_phone: editPhone || null,
      p_responsible_name: editResponsibleName || null,
      p_business_type: editBusinessType || null,
      p_credit_limit: editCreditLimit ? parseFloat(editCreditLimit) : null,
      p_credit_days: editCreditDays ? parseInt(editCreditDays) : null,
      p_password: editPassword || null,
      p_formatted_address: editFormattedAddress || null,
      p_contact_name: editContactName || null,
      p_contact_phone: editContactPhone || null,
      p_governorate_id: editGovernorateId || null,
      p_city_id: editCityId || null,
      p_street_address: editStreet.trim() || null,
      p_landmark: editLandmark.trim() || null,
    })
    if (error) { toast.error(error.message); return }
    const result = data as any
    if (result.error) { toast.error(result.error); return }
    toast.success('تم تحديث بيانات العميل')
    setShowEdit(false); setEditPassword(''); setEditConfirmPassword('')
    const custRes = await supabase.rpc('get_governed_customer', { p_token: token, p_id: id })
    if (custRes.data) {
      setCustomer(custRes.data)
      const c = Array.isArray(custRes.data) ? custRes.data[0] : custRes.data
      if (c?.location_id) {
        const repo = getLocationRepo()
        if (repo) { const loc = await repo.fetchLocation(c.location_id); if (loc) setLocation(loc) }
      }
    }
  }

  async function handleUpdateLocation() {
    setLocating(true)
    const result = await getCurrentLocation()
    setLocating(false)
    if (!result.success || !result.location) {
      toast.error(result.error?.message || 'تعذر الحصول على الموقع')
      return
    }
    const { latitude, longitude, accuracy } = result.location
    const token = getToken()
    if (!token) { toast.error('جلسة منتهية'); return }
    const { data, error } = await supabase.rpc('governed_update_customer', {
      p_token: token, p_id: id,
      p_latitude: latitude,
      p_longitude: longitude,
      p_accuracy_meters: accuracy,
    })
    if (error) { toast.error(error.message); return }
    const r = data as any
    if (r?.error) { toast.error(r.error); return }
    toast.success('تم تحديث الموقع (' + accuracy + 'م)')
    // Re-fetch customer to get the (possibly new) location_id
    const custRes = await supabase.rpc('get_governed_customer', { p_token: token, p_id: id })
    if (custRes.data) {
      setCustomer(custRes.data)
      const c = Array.isArray(custRes.data) ? custRes.data[0] : custRes.data
      if (c?.location_id) {
        LocationNormalizationService.enrichLocationIfNeeded(c.location_id)
          .then(async (ok) => {
            if (ok) {
              const repo2 = getLocationRepo()
              if (repo2) {
                const loc2 = await repo2.fetchLocation(c.location_id)
                if (loc2) setLocation(loc2)
              }
            }
          })
      }
    }
  }

  async function handleToggleActive() {
    const token = getToken()
    const fn = customer.is_active ? 'governed_deactivate_customer' : 'governed_activate_customer'
    const { data, error } = await supabase.rpc(fn, { p_token: token, p_id: id })
    if (error) { toast.error(error.message); return }
    const result = data as any
    if (result.error) { toast.error(result.error); return }
    toast.success(customer.is_active ? 'تم إيقاف العميل' : 'تم تفعيل العميل')
    const custRes = await supabase.rpc('get_governed_customer', { p_token: token, p_id: id })
    if (custRes.data) setCustomer(custRes.data)
  }

  async function handleChangeOwnership() {
    if (!newOwnerId) { toast.error('اختر الموظف الجديد'); return }
    const token = getToken()
    const { data, error } = await supabase.rpc('governed_change_customer_ownership', {
      p_token: token, p_customer_id: id, p_new_owner_id: newOwnerId, p_reason: reason || null,
    })
    if (error) { toast.error(error.message); return }
    const result = data as any
    if (result.error) { toast.error(result.error); return }
    toast.success('تم نقل ملكية العميل')
    setShowOwnership(false); setNewOwnerId(''); setReason('')
    const custRes = await supabase.rpc('get_governed_customer', { p_token: token, p_id: id })
    if (custRes.data) setCustomer(custRes.data)
    const ownRes = await supabase.rpc('get_governed_customer_ownership_history', { p_token: token, p_customer_id: id })
    if (ownRes.data) setOwnershipHistory(Array.isArray(ownRes.data) ? ownRes.data : [])
  }

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  if (!customer) return <div className="text-center py-12 text-text-secondary text-sm">العميل غير موجود</div>

  const tabs: { key: Tab; label: string }[] = [
    { key: 'info', label: 'المعلومات' },
    { key: 'overview', label: 'ملخص' },
    { key: 'products', label: 'منتجات' },
    { key: 'companies', label: 'شركات' },
    { key: 'visits', label: 'زيارات' },
    { key: 'behavior', label: 'سلوك' },
    { key: 'history', label: 'السجل' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/customers')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">{customer.company_name}</h1>
        <span className={`text-[10px] px-2 py-0.5 rounded ${state ? statusColors[getCustomerStateLabel(state)] || '' : ''}`}>{state ? getCustomerStateLabel(state) : 'غير متوفر'}</span>
      </div>

      <div className="flex gap-1 bg-white rounded-lg border border-border p-1 overflow-x-auto">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`whitespace-nowrap flex-1 text-xs py-1.5 rounded-md font-semibold transition-colors ${activeTab === t.key ? 'bg-primary text-white' : 'text-text-secondary'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'info' && (
        <>
          <div className="bg-white rounded-xl border border-border p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-text">بيانات العميل</h3>
              {(canEdit || canManage) && (
                <button onClick={() => { setShowEdit(true); setEditName(customer.company_name); setEditPhone(customer.phone || ''); setEditResponsibleName(customer.responsible_name || ''); setEditBusinessType(customer.business_type || ''); setEditCreditLimit(String(customer.credit_limit || '')); setEditCreditDays(String(customer.credit_days || '')); setEditPassword(''); setEditConfirmPassword(''); setEditFormattedAddress(location?.formatted_address || ''); const pc = contacts.find((c: any) => c.is_primary); setEditContactName(pc?.full_name || ''); setEditContactPhone(pc?.phone || ''); setEditGovernorateId(customer.governorate_id || ''); setEditCityId(customer.city_id || ''); setEditStreet(customer.street_address || ''); setEditLandmark(customer.landmark || ''); }}
                  className="text-[10px] text-primary font-semibold bg-primary/10 px-2.5 py-1 rounded-lg">تعديل البيانات</button>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2.5">
              <div>
                <div className="text-[10px] text-text-secondary">الكود</div>
                <div className="text-sm font-semibold">{customer.code}</div>
              </div>
              <div>
                <div className="text-[10px] text-text-secondary">الموظف المسؤول</div>
                <div className="text-sm font-semibold">{customer.owner_name || 'غير متوفر'}</div>
              </div>
              <div>
                <div className="text-[10px] text-text-secondary">نوع النشاط</div>
                <div className="text-sm font-semibold">{customer.business_type ? BUSINESS_TYPES.find(bt => bt.value === customer.business_type)?.label || customer.business_type : 'غير متوفر'}</div>
              </div>
              <div>
                <div className="text-[10px] text-text-secondary">المسؤول عن العميل</div>
                <div className="text-sm font-semibold">{customer.responsible_name || 'غير متوفر'}</div>
              </div>
              <div>
                <div className="text-[10px] text-text-secondary">رقم الهاتف</div>
                <div className="text-sm font-semibold" dir="ltr">{customer.phone || 'غير متوفر'}</div>
              </div>
              <div>
                <div className="text-[10px] text-text-secondary">تاريخ الإنشاء</div>
                <div className="text-sm font-semibold">{customer.created_at ? formatDate(customer.created_at) : 'غير متوفر'}</div>
              </div>
              {customer.registered_at && customer.created_at !== customer.registered_at && (
                <div>
                  <div className="text-[10px] text-text-secondary">تاريخ التسجيل</div>
                  <div className="text-sm font-semibold">{formatDate(customer.registered_at)}</div>
                </div>
              )}
            </div>
          </div>



          <div className="bg-white rounded-xl border border-border p-3">
            <h3 className="text-xs font-bold text-text mb-2">جهات الاتصال</h3>
            {contacts.length === 0 ? (
              <div className="text-[10px] text-text-secondary text-center py-2">لا توجد جهات اتصال</div>
            ) : (
              <div className="space-y-2">
                {contacts.map((c: any) => (
                  <div key={c.id} className="bg-surface rounded-lg p-2">
                    <div className="text-[11px] font-semibold text-text">{c.full_name}</div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[10px] text-text-secondary" dir="ltr">{c.phone}</span>
                      <div className="flex gap-1">
                        <a href={`tel:${c.phone}`} className="text-[9px] text-primary bg-primary/10 px-1.5 py-0.5 rounded">اتصال</a>
                        <a href={`https://wa.me/${c.phone.replace(/^\+/, '')}`} target="_blank" rel="noopener noreferrer" className="text-[9px] text-success bg-success/10 px-1.5 py-0.5 rounded">واتساب</a>
                        <button onClick={() => { navigator.clipboard.writeText(c.phone); toast.success('تم نسخ الرقم') }} className="text-[9px] text-accent bg-accent/10 px-1.5 py-0.5 rounded">نسخ</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <CustomerAddressCard type="gps" gpsData={location ? {
              formatted_address: location.formatted_address,
              latitude: location.latitude,
              longitude: location.longitude,
              accuracy_meters: location.accuracy_meters,
              enrichment_status: location.enrichment_status,
              governorate_name: location.governorate_name,
              city_name: location.city_name,
              road: location.road,
            } : null} onUpdateLocation={handleUpdateLocation} />
            <CustomerAddressCard type="manual" manualData={customer ? {
              governorate: customer.governorate_name,
              city: customer.city_name,
              address_line1: customer.street_address,
              address_line2: customer.landmark,
            } : null} />
          </div>

          {(canManage) && (
            <div className="flex gap-2 flex-wrap">
              <button onClick={handleToggleActive}
                className={`flex-1 text-xs py-2 rounded-lg font-semibold ${customer.is_active ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'}`}>
                {customer.is_active ? 'إيقاف العميل' : 'تفعيل العميل'}
              </button>
              <button onClick={() => setShowOwnership(true)}
                className="flex-1 bg-accent/10 text-accent text-xs py-2 rounded-lg font-semibold">نقل الملكية</button>
            </div>
          )}

          {showEdit && (
            <div className="bg-white rounded-xl border border-border p-4 space-y-3">
              <h2 className="text-sm font-bold">تعديل بيانات العميل</h2>
              <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
              <input type="text" value={editResponsibleName} onChange={(e) => setEditResponsibleName(e.target.value)} placeholder="اسم المسؤول" className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
              <select value={editBusinessType} onChange={(e) => setEditBusinessType(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">-- اختر نوع النشاط --</option>
                {BUSINESS_TYPES.map((bt) => (
                  <option key={bt.value} value={bt.value}>{bt.label}</option>
                ))}
              </select>
              <input type="tel" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="رقم الهاتف" className="w-full border border-border rounded-lg px-3 py-2 text-sm" dir="ltr" />
              <input type="number" value={editCreditLimit} onChange={(e) => setEditCreditLimit(e.target.value)} placeholder="الحد الائتماني" className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
              <input type="number" value={editCreditDays} onChange={(e) => setEditCreditDays(e.target.value)} placeholder="فترة الائتمان (أيام)" className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
              <div className="border-t border-border/50 pt-3 mt-1">
                <p className="text-[10px] text-text-secondary mb-2 font-semibold">العنوان المسجل</p>
                <div className="space-y-2">
                  <SearchableSelect label="المحافظة" options={governorates.map(g => ({ value: g.id, label: g.name_ar }))} value={editGovernorateId} onChange={setEditGovernorateId} placeholder="اختر المحافظة..." />
                  <SearchableSelect label="المدينة" options={cities.map(c => ({ value: c.id, label: c.name_ar }))} value={editCityId} onChange={setEditCityId} placeholder={editGovernorateId ? 'اختر المدينة...' : 'اختر المحافظة أولاً'} disabled={!editGovernorateId} />
                  <input type="text" value={editStreet} onChange={(e) => setEditStreet(e.target.value)} placeholder="الشارع (اختياري)" className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
                  <input type="text" value={editLandmark} onChange={(e) => setEditLandmark(e.target.value)} placeholder="علامة مميزة (اختياري)" className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="border-t border-border/50 pt-3 mt-1">
                <p className="text-[10px] text-text-secondary mb-2 font-semibold">العنوان (وصف حر)</p>
                <textarea value={editFormattedAddress} onChange={(e) => setEditFormattedAddress(e.target.value)} placeholder="العنوان" className="w-full border border-border rounded-lg px-3 py-2 text-sm resize-none" rows={2} />
              </div>
              <div className="border-t border-border/50 pt-3">
                <p className="text-[10px] text-text-secondary mb-2 font-semibold">جهة الاتصال الأساسية</p>
                <input type="text" value={editContactName} onChange={(e) => setEditContactName(e.target.value)} placeholder="الاسم" className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
                <input type="tel" value={editContactPhone} onChange={(e) => setEditContactPhone(e.target.value)} placeholder="رقم الهاتف" className="w-full border border-border rounded-lg px-3 py-2 text-sm mt-2" dir="ltr" />
              </div>
              <input type="password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder="كلمة المرور الجديدة (اختياري)" className="w-full border border-border rounded-lg px-3 py-2 text-sm" maxLength={6} />
              <input type="password" value={editConfirmPassword} onChange={(e) => setEditConfirmPassword(e.target.value)} placeholder="تأكيد كلمة المرور الجديدة" className="w-full border border-border rounded-lg px-3 py-2 text-sm" maxLength={6} />
              <div className="flex gap-2">
                <button onClick={handleEdit} className="flex-1 bg-primary text-white text-xs py-2 rounded-lg">حفظ</button>
                <button onClick={() => setShowEdit(false)} className="px-4 border border-border rounded-lg text-xs">إلغاء</button>
              </div>
            </div>
          )}

          {showOwnership && (
            <div className="bg-white rounded-xl border border-border p-4 space-y-3">
              <h2 className="text-sm font-bold">نقل ملكية العميل</h2>
              <select value={newOwnerId} onChange={(e) => setNewOwnerId(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">اختر الموظف الجديد</option>
                {employees.filter((e: any) => e.is_active).map((e: any) => (
                  <option key={e.id} value={e.id}>{e.full_name} ({e.code})</option>
                ))}
              </select>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="سبب النقل" className="w-full border border-border rounded-lg px-3 py-2 text-sm" rows={2} />
              <div className="flex gap-2">
                <button onClick={handleChangeOwnership} className="flex-1 bg-accent text-white text-xs py-2 rounded-lg">تأكيد النقل</button>
                <button onClick={() => setShowOwnership(false)} className="px-4 border border-border rounded-lg text-xs">إلغاء</button>
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === 'overview' && <OverviewTab customerId={id || ''} />}
      {activeTab === 'products' && <ProductsTab customerId={id || ''} />}
      {activeTab === 'companies' && <CompaniesTab customerId={id || ''} />}
      {activeTab === 'visits' && <VisitsTab customerId={id || ''} />}
      {activeTab === 'behavior' && <BehaviorTab customerId={id || ''} />}

      {activeTab === 'history' && (
        <div className="bg-white rounded-xl border border-border p-4">
          <h2 className="text-sm font-bold mb-3">سجل تغيير الملكية</h2>
          {ownershipHistory.length === 0 ? (
            <p className="text-xs text-text-secondary text-center py-4">لا توجد تغييرات</p>
          ) : (
            <div className="space-y-2">
              {ownershipHistory.map((h: any) => {
                const prev = employees.find((e: any) => e.id === h.previous_owner_id)
                const next = employees.find((e: any) => e.id === h.new_owner_id)
                const changer = employees.find((e: any) => e.id === h.changed_by)
                return (
                  <div key={h.id} className="text-xs py-2 border-b border-border/50 last:border-0">
                    <div className="flex justify-between">
                      <span>{prev?.full_name || 'غير متوفر'} → {next?.full_name}</span>
                      <span className="text-text-secondary">{formatDateTime(h.changed_at)}</span>
                    </div>
                    {h.reason && <div className="text-text-secondary mt-0.5">السبب: {h.reason}</div>}
                    <div className="text-text-secondary">بواسطة: {changer?.full_name || 'غير متوفر'}</div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
