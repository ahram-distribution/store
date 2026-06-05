import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAccountStore } from '../../store/account'
import { formatCurrencyShort } from '../../utils/format'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface CustomerData {
  id: string
  code: string
  name: string
  phone: string
  type: string
  status: string
  balance: number
  credit_limit: number
  credit_days: number
  owner_id: string | null
}

export function AccountPage() {
  const navigate = useNavigate()
  const [activeSection, setActiveSection] = useState('overview')
  const [customers, setCustomers] = useState<CustomerData[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    supabase.rpc('get_governed_customers', { p_token: token }).then(({ data }) => {
      const d = (data as CustomerData[]) || []
      if (d.length > 0) {
        setCustomers(d)
        setSelectedId(d[0].id)
      }
      setLoading(false)
    })
  }, [])

  const customer = customers.find((c) => c.id === selectedId)

  const sections = [
    { key: 'overview', label: 'الملخص' },
    { key: 'addresses', label: 'العناوين' },
    { key: 'orders', label: 'الطلبات' },
    { key: 'statement', label: 'كشف الحساب' },
    { key: 'profile', label: 'الملف الشخصي' },
  ]

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-text">حسابي</h1>

      {/* Customer selector */}
      {loading ? (
        <div className="text-center text-xs text-text-secondary py-4">جاري التحميل...</div>
      ) : customers.length === 0 ? (
        <div className="bg-white rounded-lg border border-border p-4 text-center text-xs text-text-secondary">
          لا توجد بيانات للعملاء
        </div>
      ) : (
        <>
          <select
            value={selectedId ?? ''}
            onChange={(e) => setSelectedId(e.target.value)}
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white"
          >
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
            ))}
          </select>

          {customer && (
            <>
              <div className="bg-white rounded-lg border border-border p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="text-lg text-primary font-bold">{(customer.name || '?')[0]}</span>
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-text">{customer.name}</h2>
                    <p className="text-xs text-text-secondary">{customer.code}</p>
                    <p className="text-xs text-text-secondary">{customer.phone} · {customer.type === 'pharmacy' ? 'صيدلية' : customer.type === 'wholesale' ? 'جملة' : customer.type === 'retail' ? 'تجزئة' : customer.type === 'clinic' ? 'عيادة' : customer.type}</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-surface rounded-lg p-2"><div className="text-xs text-text-secondary">الرصيد</div><div className="text-sm font-bold text-danger">{formatCurrencyShort(customer.balance)}</div></div>
                  <div className="bg-surface rounded-lg p-2"><div className="text-xs text-text-secondary">الحد الائتماني</div><div className="text-sm font-bold text-text">{formatCurrencyShort(customer.credit_limit)}</div></div>
                  <div className="bg-surface rounded-lg p-2"><div className="text-xs text-text-secondary">مدة الائتمان</div><div className="text-sm font-bold text-text">{customer.credit_days} يوم</div></div>
                </div>
              </div>

              <div className="flex gap-1 overflow-x-auto pb-1">
                {sections.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setActiveSection(s.key)}
                    className={`text-xs px-3 py-2 rounded-lg whitespace-nowrap transition-colors ${
                      activeSection === s.key ? 'bg-primary text-white' : 'bg-white text-text-secondary border border-border'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {activeSection === 'overview' && (
                <div className="space-y-2">
                  <button onClick={() => navigate('/orders')} className="w-full bg-white border border-border rounded-lg p-3 text-right">
                    <span className="text-sm font-semibold text-text">الطلبات</span>
                    <span className="text-xs text-text-secondary block mt-0.5">عرض وتتبع طلباتك</span>
                  </button>
                  <button onClick={() => navigate('/storefront')} className="w-full bg-white border border-border rounded-lg p-3 text-right">
                    <span className="text-sm font-semibold text-text">طلب جديد</span>
                    <span className="text-xs text-text-secondary block mt-0.5">تصفح المنتجات وإنشاء طلب</span>
                  </button>
                  <div className="w-full bg-white border border-border rounded-lg p-3 text-right">
                    <span className="text-sm font-semibold text-text">كشف الحساب</span>
                    <span className="text-xs text-text-secondary block mt-0.5">عرض الحركات والرصيد</span>
                  </div>
                  <div className="w-full bg-white border border-border rounded-lg p-3 text-right">
                    <span className="text-sm font-semibold text-text">التواصل مع المبيعات</span>
                    <span className="text-xs text-text-secondary block mt-0.5">التواصل مع مندوب المبيعات</span>
                  </div>
                  <div className="w-full bg-white border border-border rounded-lg p-3 text-right">
                    <span className="text-sm font-semibold text-text">دعم العملاء</span>
                    <span className="text-xs text-text-secondary block mt-0.5">مساعدة ودعم فني</span>
                  </div>
                </div>
              )}

              {activeSection === 'addresses' && (
                <AddressSection customerId={customer.id} />
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

function AddressSection({ customerId }: { customerId: string }) {
  const [addresses, setAddresses] = useState<any[]>([])

  useEffect(() => {
    supabase
      .from('customer_addresses')
      .select('*')
      .eq('customer_id', customerId)
      .then(({ data }) => {
        if (data) setAddresses(data)
      })
  }, [customerId])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">العناوين</h3>
      </div>
      {addresses.length === 0 && (
        <p className="text-xs text-text-secondary text-center py-4">لا توجد عناوين مسجلة</p>
      )}
      {addresses.map((addr) => (
        <div key={addr.id} className="bg-white border border-border rounded-lg p-3">
          <span className="text-sm font-semibold text-text">{addr.label || addr.address_type || 'عنوان'}</span>
          <p className="text-xs text-text-secondary mt-1">{addr.address_line1}{addr.city ? `, ${addr.city}` : ''}{addr.governorate ? `, ${addr.governorate}` : ''}</p>
        </div>
      ))}
    </div>
  )
}
