import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useCapability } from '../../hooks/useCapability'
import { formatCurrencyShort, formatDateTime } from '../../utils/format'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { getCustomerState, getCustomerStateLabel, CUSTOMER_STATE_LABELS } from '../../utils/systemStates'
import { VisitCard } from '../../components/visits/VisitCard'
import CustomerIntelligencePanel from '../../components/customers/CustomerIntelligencePanel'
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
import { locationService } from '../../services/location'
import { LocationDisplay } from '../../components/shared/LocationDisplay'
import { getCurrentLocation } from '../../services/gpsService'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function CustomerProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const canEdit = useCapability('customers.update')
  const canManage = useCapability('customers.manage')
  const [customer, setCustomer] = useState<any>(null)
  const [orders, setOrders] = useState<any[]>([])
  const [visits, setVisits] = useState<any[]>([])
  const [collections, setCollections] = useState<any[]>([])
  const [contacts, setContacts] = useState<any[]>([])
  const [location, setLocation] = useState<any>(null)
  const [ownershipHistory, setOwnershipHistory] = useState<any[]>([])
  const [employees, setEmployees] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'info' | 'orders' | 'collections' | 'visits' | 'analytics' | 'history'>('info')

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

  const [locating, setLocating] = useState(false)

  const [showOwnership, setShowOwnership] = useState(false)
  const [newOwnerId, setNewOwnerId] = useState('')
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (!id) return
    const token = getToken()
    if (!token) return

    Promise.all([
      supabase.rpc('get_governed_customer', { p_token: token, p_id: id }),
      supabase.rpc('get_customer_orders', { p_token: token, p_customer_id: id }),
      supabase.rpc('get_customer_collections', { p_token: token, p_customer_id: id }),
      supabase.rpc('get_customer_visits', { p_token: token, p_customer_id: id }),
      supabase.rpc('get_governed_customer_contacts', { p_token: token, p_customer_id: id }),
      supabase.rpc('get_governed_customer_ownership_history', { p_token: token, p_customer_id: id }),
      supabase.rpc('get_governed_employees', { p_token: token }),
    ]).then(async ([custRes, ordRes, colRes, visRes, contRes, ownRes, empRes]) => {
      if (custRes.data) {
        setCustomer(custRes.data)
        const c = Array.isArray(custRes.data) ? custRes.data[0] : custRes.data
        if (c.location_id) {
          const loc = await locationService.fetchLocation(c.location_id)
          if (loc) setLocation(loc)
        }
      }
      if (ordRes.data) setOrders(Array.isArray(ordRes.data) ? ordRes.data : [])
      if (colRes.data) setCollections(Array.isArray(colRes.data) ? colRes.data : [])
      if (visRes.data) setVisits(Array.isArray(visRes.data) ? visRes.data : [])
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
        const loc = await locationService.fetchLocation(c.location_id)
        if (loc) setLocation(loc)
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
    if (customer?.location_id) {
      const loc = await locationService.fetchLocation(customer.location_id)
      if (loc) setLocation(loc)
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

  const tabs = [
    { key: 'info', label: 'المعلومات' },
    { key: 'orders', label: `الطلبات (${orders.length})` },
    { key: 'collections', label: `التحصيلات (${collections.length})` },
    { key: 'visits', label: `الزيارات (${visits.length})` },
    { key: 'analytics', label: 'تحليلات' },
    { key: 'history', label: 'السجل' },
  ] as const

  const methodLabels: Record<string, string> = {
    cash: 'نقداً', bank_transfer: 'تحويل بنكي', cheque: 'شيك', deposit: 'إيداع',
  }

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
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white rounded-xl border border-border p-3 text-center">
              <div className="text-lg font-bold text-primary">{formatCurrencyShort(monthlySales)}</div>
              <div className="text-[10px] text-text-secondary">مبيعات الشهر</div>
            </div>
            <div className="bg-white rounded-xl border border-border p-3 text-center">
              <div className="text-lg font-bold text-accent">{lastOrderDays !== null ? `منذ ${lastOrderDays} يوم` : 'غير متوفر'}</div>
              <div className="text-[10px] text-text-secondary">آخر طلب</div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-border p-4 space-y-3">
            <div className="flex justify-between"><span className="text-xs text-text-secondary">الكود</span><span className="text-sm font-semibold">{customer.code}</span></div>
            <div className="flex justify-between"><span className="text-xs text-text-secondary">اسم المسؤول</span><span className="text-sm font-semibold">{customer.responsible_name || 'غير متوفر'}</span></div>
            <div className="flex justify-between"><span className="text-xs text-text-secondary">نوع النشاط</span><span className="text-sm font-semibold">{customer.business_type ? BUSINESS_TYPES.find(bt => bt.value === customer.business_type)?.label || customer.business_type : 'غير متوفر'}</span></div>
            <div className="flex justify-between"><span className="text-xs text-text-secondary">رقم الهاتف</span><span className="text-sm font-semibold" dir="ltr">{customer.phone || 'غير متوفر'}</span></div>
            <div className="flex justify-between"><span className="text-xs text-text-secondary">البريد الإلكتروني</span><span className="text-sm font-semibold" dir="ltr">{customer.email || 'غير متوفر'}</span></div>
            <div className="flex justify-between"><span className="text-xs text-text-secondary">الموظف المسؤول</span>
              <span className="text-sm font-semibold">{customer.owner_name || 'غير متوفر'}</span>
            </div>
            <div className="flex justify-between"><span className="text-xs text-text-secondary">الحد الائتماني</span><span className="text-sm font-semibold">{formatCurrencyShort(customer.credit_limit || 0)}</span></div>
            <div className="flex justify-between"><span className="text-xs text-text-secondary">فترة الائتمان</span><span className="text-sm font-semibold">{customer.credit_days || 0} يوم</span></div>
            <div className="flex justify-between"><span className="text-xs text-text-secondary">تاريخ التسجيل</span><span className="text-sm font-semibold">{customer.created_at ? formatDateTime(customer.created_at) : 'غير متوفر'}</span></div>
          </div>

          {contacts.length > 0 && (
            <div className="bg-white rounded-xl border border-border p-4">
              <h2 className="text-sm font-bold mb-2">جهات الاتصال</h2>
              {contacts.map((c: any) => (
                <div key={c.id} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
                  <span className="text-xs">{c.full_name}</span>
                  <span className="text-xs text-text-secondary" dir="ltr">{c.phone}</span>
                </div>
              ))}
            </div>
          )}

          {location && (
            <div className="bg-white rounded-xl border border-border p-4">
              <h2 className="text-sm font-bold mb-2 flex items-center gap-1.5">
                <span className="text-primary">📍</span>
                الموقع
              </h2>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs">
                  <LocationDisplay lat={location.latitude} lng={location.longitude} size="md" className="text-text" />
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-text-secondary">دقة الموقع:</span>
                  <span className={locationService.formatAccuracy(location.accuracy_meters).className}>
                    {locationService.formatAccuracy(location.accuracy_meters).label}
                    {' ('}{locationService.formatAccuracy(location.accuracy_meters).detail}{')'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-text-secondary">تاريخ التقاط الموقع:</span>
                  <span>{formatDateTime(location.captured_at)}</span>
                </div>
                <button
                  onClick={handleUpdateLocation}
                  disabled={locating}
                  className="w-full mt-2 bg-accent/10 text-accent text-sm py-2.5 rounded-lg font-semibold hover:bg-accent/20 active:bg-accent/30 transition-colors disabled:opacity-50"
                >
                  {locating ? 'جاري التحديد...' : 'تحديث الموقع الحالي'}
                </button>
              </div>
            </div>
          )}

          {location?.formatted_address && (
            <div className="bg-white rounded-xl border border-border p-4">
              <h2 className="text-sm font-bold mb-2">العنوان</h2>
              <p className="text-xs">{location.formatted_address}</p>
            </div>
          )}

          {(canEdit || canManage) && (
            <div className="flex gap-2 flex-wrap">
              {canEdit && (
                <button onClick={() => { setShowEdit(true); setEditName(customer.company_name); setEditPhone(customer.phone || ''); setEditResponsibleName(customer.responsible_name || ''); setEditBusinessType(customer.business_type || ''); setEditCreditLimit(String(customer.credit_limit || '')); setEditCreditDays(String(customer.credit_days || '')); setEditPassword(''); setEditConfirmPassword(''); setEditFormattedAddress(location?.formatted_address || ''); const pc = contacts.find((c: any) => c.is_primary); setEditContactName(pc?.full_name || ''); setEditContactPhone(pc?.phone || ''); }}
                  className="flex-1 bg-primary/10 text-primary text-xs py-2 rounded-lg font-semibold">تعديل البيانات</button>
              )}
              {canManage && (
                <>
                  <button onClick={handleToggleActive}
                    className={`flex-1 text-xs py-2 rounded-lg font-semibold ${customer.is_active ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'}`}>
                    {customer.is_active ? 'إيقاف العميل' : 'تفعيل العميل'}
                  </button>
                  <button onClick={() => setShowOwnership(true)}
                    className="flex-1 bg-accent/10 text-accent text-xs py-2 rounded-lg font-semibold">نقل الملكية</button>
                </>
              )}
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
                <p className="text-[10px] text-text-secondary mb-2 font-semibold">العنوان</p>
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

      {activeTab === 'orders' && (
        <div className="space-y-2">
          {orders.length === 0 ? (
            <div className="text-center py-8 text-text-secondary text-sm">لا توجد طلبات</div>
          ) : orders.map((o: any) => (
            <div key={o.id} onClick={() => navigate(`/orders/${o.id}`)}
              className="bg-white rounded-xl border border-border p-3 cursor-pointer active:bg-surface transition-colors">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-bold text-text">{o.order_number}</span>
                <StatusBadge status={o.status} />
              </div>
              <div className="flex items-center justify-between text-xs text-text-secondary">
                <span>{formatDateTime(o.created_at)}</span>
                {o.total_amount > 0 && <span className="font-semibold text-text">{formatCurrencyShort(o.total_amount)}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'collections' && (
        <div className="space-y-2">
          {collections.length === 0 ? (
            <div className="text-center py-8 text-text-secondary text-sm">لا توجد تحصيلات</div>
          ) : collections.map((c: any) => (
            <div key={c.id} className="bg-white rounded-xl border border-border p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-bold text-text">{c.code}</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-success/10 text-success">{methodLabels[c.method] || c.method}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-secondary">{c.collected_at ? formatDateTime(c.collected_at) : ''}</span>
                <span className="font-bold text-success">{formatCurrencyShort(c.amount)}</span>
              </div>
              {c.reference_number && <div className="text-[10px] text-text-secondary mt-0.5">مرجع: {c.reference_number}</div>}
              <div className="text-[10px] text-text-secondary mt-0.5">الحالة: {c.status === 'approved' ? 'معتمد' : c.status === 'pending' ? 'معلق' : c.status}</div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'visits' && (
        <div className="space-y-3">
          {visits.length === 0 ? (
            <div className="text-center py-8 text-text-secondary text-sm">لا توجد زيارات</div>
          ) : visits.map((v: any) => (
            <VisitCard
              key={v.id}
              visit={v}
              customerName={customer?.company_name || ''}
              employeeName={v.employee_name || ''}
              onClick={() => navigate(`/visits/${v.id}`)}
            />
          ))}
        </div>
      )}

      {activeTab === 'analytics' && (
        <CustomerIntelligencePanel customerId={id || ''} customerName={customer?.company_name} />
      )}

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
