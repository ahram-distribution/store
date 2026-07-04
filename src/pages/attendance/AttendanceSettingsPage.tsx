import { useState, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import toast from 'react-hot-toast'
import { Settings, Users, Save, Search, CheckSquare, X, Edit2, MapPin, Building2, Satellite, Smartphone, ShieldAlert, Clock, Gauge, Radio } from 'lucide-react'

interface SettingsData {
  official_start_time: string
  official_end_time: string
  late_threshold_minutes: number
  early_departure_threshold_minutes: number
  location_interval_seconds: number
  retention_days: number
  auto_cleanup_enabled: boolean
  tracking_mode: string
}

interface WorkPolicy {
  policy_id?: string
  employee_id: string
  employee_code: string
  employee_name: string
  is_active: boolean
  has_policy?: boolean
  work_location: string
  schedule_type: string
  tracking_required: boolean
  attendance_enabled: boolean
  required_daily_hours: number | null
  shift_start_time: string | null
  shift_end_time: string | null
  late_threshold_minutes: number | null
  early_departure_threshold_minutes: number | null
}

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export default function AttendanceSettingsPage() {
  const location = useLocation()
  const [activeTab, setActiveTab] = useState<'general' | 'work_policies'>(() => {
    if (location.hash === '#work-policies') return 'work_policies'
    return 'general'
  })
  const [settings, setSettings] = useState<SettingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [policies, setPolicies] = useState<WorkPolicy[]>([])
  const [policiesLoading, setPoliciesLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<WorkPolicy>>({})
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showBulkPanel, setShowBulkPanel] = useState(false)
  const [bulkForm, setBulkForm] = useState({
    work_location: 'field',
    schedule_type: 'flexible',
    tracking_required: true,
    attendance_enabled: true,
    required_daily_hours: 8,
  })
  const [saveSingleLoading, setSaveSingleLoading] = useState(false)
  const [saveBulkLoading, setSaveBulkLoading] = useState(false)

  const token = getToken()

  useEffect(() => {
    if (!token) return
    fetchSettings().then(() => setLoading(false))
  }, [token, fetchSettings])

  const fetchPolicies = useCallback(async () => {
    if (!token) return
    setPoliciesLoading(true)
    const [{ data: policiesData }, { data: unassignedData }] = await Promise.all([
      supabase.rpc('list_work_policies', { p_token: token }),
      supabase.rpc('list_employees_without_policies', { p_token: token }),
    ])
    const merged: WorkPolicy[] = []
    if (policiesData?.policies) {
      for (const p of policiesData.policies) {
        merged.push({
          policy_id: p.policy_id,
          employee_id: p.employee_id,
          employee_code: p.employee_code,
          employee_name: p.employee_name,
          is_active: p.is_active,
          has_policy: true,
          work_location: p.work_location,
          schedule_type: p.schedule_type,
          tracking_required: p.tracking_required,
          attendance_enabled: p.attendance_enabled ?? true,
          required_daily_hours: p.required_daily_hours,
          shift_start_time: p.shift_start_time,
          shift_end_time: p.shift_end_time,
          late_threshold_minutes: p.late_threshold_minutes,
          early_departure_threshold_minutes: p.early_departure_threshold_minutes,
        })
      }
    }
    if (unassignedData?.employees) {
      for (const e of unassignedData.employees) {
        merged.push({
          employee_id: e.employee_id,
          employee_code: e.employee_code,
          employee_name: e.employee_name,
          is_active: e.is_active,
          has_policy: false,
          work_location: 'field',
          schedule_type: 'flexible',
          tracking_required: true,
          attendance_enabled: true,
          required_daily_hours: 8,
          shift_start_time: null,
          shift_end_time: null,
          late_threshold_minutes: null,
          early_departure_threshold_minutes: null,
        })
      }
    }
    merged.sort((a, b) => a.employee_name.localeCompare(b.employee_name))
    setPolicies(merged)
    setPoliciesLoading(false)
  }, [token])

  useEffect(() => {
    if (activeTab === 'work_policies') fetchPolicies()
  }, [activeTab, fetchPolicies])

  const fetchSettings = useCallback(async () => {
    if (!token) return
    const { data } = await supabase.rpc('get_workday_settings', { p_token: token })
    if (data) setSettings(data as SettingsData)
  }, [token])

  const handleSave = async () => {
    if (!settings) return
    setSaving(true)
    const { error } = await supabase.rpc('update_workday_settings', {
      p_token: token,
      p_fields: settings,
    })
    if (error) { toast.error(error.message); setSaving(false); return }
    toast.success('تم حفظ الإعدادات العامة بنجاح')
    await fetchSettings()
    setSaving(false)
  }

  const startEdit = (policy: WorkPolicy) => {
    setEditingId(policy.employee_id)
    setEditForm({
      work_location: policy.work_location,
      schedule_type: policy.schedule_type,
      tracking_required: policy.tracking_required,
      attendance_enabled: policy.attendance_enabled,
      required_daily_hours: policy.required_daily_hours,
      shift_start_time: policy.shift_start_time,
      shift_end_time: policy.shift_end_time,
      late_threshold_minutes: policy.late_threshold_minutes,
      early_departure_threshold_minutes: policy.early_departure_threshold_minutes,
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditForm({})
  }

  const saveIndividual = async (employeeId: string) => {
    if (!token) return
    setSaveSingleLoading(true)
    const { error } = await supabase.rpc('upsert_employee_work_policy', {
      p_token: token,
      p_employee_id: employeeId,
      p_work_location: editForm.work_location,
      p_schedule_type: editForm.schedule_type,
      p_tracking_required: editForm.tracking_required,
      p_attendance_enabled: editForm.attendance_enabled ?? true,
      p_required_daily_hours: editForm.required_daily_hours ?? null,
      p_shift_start_time: editForm.shift_start_time ?? null,
      p_shift_end_time: editForm.shift_end_time ?? null,
      p_late_threshold_minutes: editForm.late_threshold_minutes ?? null,
      p_early_departure_threshold_minutes: editForm.early_departure_threshold_minutes ?? null,
    })
    if (error) { toast.error(error.message); setSaveSingleLoading(false); return }
    toast.success('تم حفظ سياسة العمل')
    setEditingId(null)
    setEditForm({})
    await fetchPolicies()
    setSaveSingleLoading(false)
  }

  const toggleSelect = (employeeId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(employeeId)) next.delete(employeeId)
      else next.add(employeeId)
      return next
    })
  }

  const selectAll = () => {
    if (selectedIds.size === filteredPolicies.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredPolicies.map(p => p.employee_id)))
    }
  }

  const applyBulk = async () => {
    if (selectedIds.size === 0) { toast.error('اختر موظفاً واحداً على الأقل'); return }
    if (!token) return
    setSaveBulkLoading(true)
    const policiesPayload = Array.from(selectedIds).map(empId => ({
      employee_id: empId,
      work_location: bulkForm.work_location,
      schedule_type: bulkForm.schedule_type,
      tracking_required: bulkForm.tracking_required,
      attendance_enabled: bulkForm.attendance_enabled,
      required_daily_hours: bulkForm.required_daily_hours,
    }))
    const { error } = await supabase.rpc('batch_upsert_work_policies', {
      p_token: token,
      p_policies: JSON.stringify(policiesPayload),
    })
    if (error) { toast.error(error.message); setSaveBulkLoading(false); return }
    toast.success(`تم تطبيق السياسة على ${selectedIds.size} موظف`)
    setSelectedIds(new Set())
    setShowBulkPanel(false)
    await fetchPolicies()
    setSaveBulkLoading(false)
  }

  const stats = {
    total: policies.length,
    field: policies.filter(p => p.has_policy && p.work_location === 'field' && p.attendance_enabled).length,
    office: policies.filter(p => p.has_policy && p.work_location === 'office' && p.attendance_enabled).length,
    tracking_required: policies.filter(p => p.has_policy && p.tracking_required && p.attendance_enabled).length,
    tracking_disabled: policies.filter(p => p.has_policy && !p.tracking_required && p.attendance_enabled).length,
    exempt: policies.filter(p => p.has_policy && !p.attendance_enabled).length,
    needs_review: policies.filter(p => !p.has_policy).length,
  }

  const filteredPolicies = policies.filter(p =>
    p.employee_name.includes(searchQuery) ||
    p.employee_code.includes(searchQuery)
  )

  const scheduleTypeLabel = (s: string) =>
    s === 'fixed_shift' ? 'دوام ثابت' : s === 'flexible' ? 'دوام مرن' : 'بالساعة'

  const workLocationLabel = (w: string) => w === 'field' ? 'ميداني' : 'مكتبي'

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen" dir="rtl">
        <p className="text-gray-500">جاري التحميل...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-5" dir="rtl">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Settings className="w-7 h-7 text-blue-600" />
          <h1 className="text-2xl font-bold text-gray-800">إعدادات الحضور والانصراف</h1>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('general')}
            className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold transition-all ${
              activeTab === 'general' ? 'bg-blue-600 text-white shadow-lg' : 'bg-white text-gray-600 shadow-sm'
            }`}
          >
            <Settings className="w-5 h-5" />
            الإعدادات العامة
          </button>
          <button
            onClick={() => setActiveTab('work_policies')}
            className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold transition-all ${
              activeTab === 'work_policies' ? 'bg-blue-600 text-white shadow-lg' : 'bg-white text-gray-600 shadow-sm'
            }`}
          >
            <Users className="w-5 h-5" />
            سياسات العمل
          </button>
        </div>

        {/* Tab: General Settings */}
        {activeTab === 'general' && settings && (
          <div className="space-y-5 max-w-2xl">
            {/* Card 1: Official Times */}
            <div className="bg-white rounded-2xl shadow-sm p-6">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center"><Clock className="w-5 h-5 text-blue-600" /></div>
                <div><h3 className="font-bold text-gray-800">المواعيد الرسمية</h3><p className="text-xs text-gray-400">تحديد بداية ونهاية الدوام الرسمي للشركة</p></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1.5">وقت بدء العمل</label>
                  <input type="time" value={settings.official_start_time?.slice(0, 5) ?? '09:00'}
                    onChange={(e) => setSettings({ ...settings, official_start_time: e.target.value + ':00' })}
                    className="w-full p-3 border border-gray-200 rounded-xl text-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1.5">وقت انتهاء العمل</label>
                  <input type="time" value={settings.official_end_time?.slice(0, 5) ?? '17:00'}
                    onChange={(e) => setSettings({ ...settings, official_end_time: e.target.value + ':00' })}
                    className="w-full p-3 border border-gray-200 rounded-xl text-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                </div>
              </div>
            </div>

            {/* Card 2: Tolerance Rules */}
            <div className="bg-white rounded-2xl shadow-sm p-6">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center"><Gauge className="w-5 h-5 text-amber-600" /></div>
                <div><h3 className="font-bold text-gray-800">قواعد السماحية</h3><p className="text-xs text-gray-400">تطبق فقط على الموظفين بنظام الدوام الثابت (fixed_shift)</p></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1.5">سماحية التأخير (بالدقائق)</label>
                  <input type="number" value={settings.late_threshold_minutes ?? 0}
                    onChange={(e) => setSettings({ ...settings, late_threshold_minutes: Number(e.target.value) || 0 })}
                    className="w-full p-3 border border-gray-200 rounded-xl text-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" min="0" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1.5">سماحية الانصراف المبكر (بالدقائق)</label>
                  <input type="number" value={settings.early_departure_threshold_minutes ?? 0}
                    onChange={(e) => setSettings({ ...settings, early_departure_threshold_minutes: Number(e.target.value) || 0 })}
                    className="w-full p-3 border border-gray-200 rounded-xl text-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" min="0" />
                </div>
              </div>
            </div>

            {/* Card 3: System & Tracking Settings */}
            <div className="bg-white rounded-2xl shadow-sm p-6">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center"><Radio className="w-5 h-5 text-purple-600" /></div>
                <div><h3 className="font-bold text-gray-800">إعدادات النظام والتتبع</h3><p className="text-xs text-gray-400">فترات تسجيل المواقع، الاحتفاظ بالبيانات، والتنظيف التلقائي</p></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1.5">فترة تسجيل المواقع (بالثواني)</label>
                  <input type="number" value={settings.location_interval_seconds ?? 300}
                    onChange={(e) => setSettings({ ...settings, location_interval_seconds: Number(e.target.value) || 60 })}
                    className="w-full p-3 border border-gray-200 rounded-xl text-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" min="30" step="30" />
                  <p className="text-xs text-gray-400 mt-1">زيادة العدد لتوفير البطارية (300 = 5 دقائق)</p>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1.5">الاحتفاظ بالبيانات (أيام)</label>
                  <select value={settings.retention_days ?? 90}
                    onChange={(e) => setSettings({ ...settings, retention_days: Number(e.target.value) })}
                    className="w-full p-3 border border-gray-200 rounded-xl text-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                    <option value={7}>7 أيام</option>
                    <option value={30}>30 يوماً</option>
                    <option value={90}>90 يوماً</option>
                    <option value={180}>180 يوماً</option>
                    <option value={365}>سنة</option>
                  </select>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between p-4 bg-gray-50 rounded-xl">
                <div>
                  <div className="font-bold text-sm text-gray-700">التنظيف التلقائي للبيانات القديمة</div>
                  <div className="text-xs text-gray-400">عند التفعيل، يتم حذف بيانات المواقع الأقدم من فترة الاحتفاظ تلقائياً</div>
                </div>
                <button onClick={() => setSettings({ ...settings, auto_cleanup_enabled: !settings.auto_cleanup_enabled })}
                  className={`relative w-14 h-7 rounded-full transition-all ${settings.auto_cleanup_enabled ? 'bg-blue-600' : 'bg-gray-300'}`}>
                  <span className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-all ${settings.auto_cleanup_enabled ? 'right-0.5' : 'right-7'}`} />
                </button>
              </div>
            </div>

            {/* Save Button */}
            <button onClick={handleSave} disabled={saving}
              className="w-full py-4 bg-blue-600 text-white rounded-2xl text-lg font-bold shadow-lg hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-3">
              {saving ? <span className="inline-block w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save className="w-5 h-5" />}
              حفظ الإعدادات العامة
            </button>
          </div>
        )}

        {/* Tab: Work Policies */}
        {activeTab === 'work_policies' && (
          <div className="space-y-4">
            {/* Stats Counters */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
              <div className="bg-white rounded-xl shadow-sm p-4 text-center border-r-4 border-blue-500">
                <div className="text-2xl font-bold text-gray-800">{stats.total}</div>
                <div className="text-xs text-gray-500 mt-1">إجمالي الموظفين</div>
              </div>
              <div className="bg-white rounded-xl shadow-sm p-4 text-center border-r-4 border-green-500">
                <div className="text-2xl font-bold text-green-700">{stats.field}</div>
                <div className="text-xs text-gray-500 mt-1">
                  <MapPin className="w-3 h-3 inline ml-1" />ميداني
                </div>
              </div>
              <div className="bg-white rounded-xl shadow-sm p-4 text-center border-r-4 border-blue-600">
                <div className="text-2xl font-bold text-blue-700">{stats.office}</div>
                <div className="text-xs text-gray-500 mt-1">
                  <Building2 className="w-3 h-3 inline ml-1" />مكتبي
                </div>
              </div>
              <div className="bg-white rounded-xl shadow-sm p-4 text-center border-r-4 border-amber-500">
                <div className="text-2xl font-bold text-amber-700">{stats.tracking_required}</div>
                <div className="text-xs text-gray-500 mt-1">
                  <Satellite className="w-3 h-3 inline ml-1" />يحتاج تتبع
                </div>
              </div>
              <div className="bg-white rounded-xl shadow-sm p-4 text-center border-r-4 border-gray-400">
                <div className="text-2xl font-bold text-gray-500">{stats.tracking_disabled}</div>
                <div className="text-xs text-gray-500 mt-1">
                  <Smartphone className="w-3 h-3 inline ml-1" />لا يحتاج تتبع
                </div>
              </div>
              <div className="bg-white rounded-xl shadow-sm p-4 text-center border-r-4 border-gray-600">
                <div className="text-2xl font-bold text-gray-600">{stats.exempt}</div>
                <div className="text-xs text-gray-500 mt-1">
                  <ShieldAlert className="w-3 h-3 inline ml-1" />معفي من الحضور
                </div>
              </div>
              <div className="bg-white rounded-xl shadow-sm p-4 text-center border-r-4 border-red-500">
                <div className="text-2xl font-bold text-red-700">{stats.needs_review}</div>
                <div className="text-xs text-gray-500 mt-1">
                  <ShieldAlert className="w-3 h-3 inline ml-1" />بحاجة لمراجعة
                </div>
              </div>
            </div>

            {/* Search + Bulk bar */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="بحث بالاسم أو الكود..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pr-10 p-3 border border-gray-200 rounded-xl text-lg"
                />
              </div>
              <button
                onClick={() => { setShowBulkPanel(!showBulkPanel); if (!showBulkPanel && selectedIds.size === 0) setSelectedIds(new Set(filteredPolicies.map(p => p.employee_id))) }}
                className="flex items-center gap-2 px-4 py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-all"
              >
                <CheckSquare className="w-5 h-5" />
                تعيين جماعي
              </button>
              <button
                onClick={fetchPolicies}
                disabled={policiesLoading}
                className="px-4 py-3 bg-gray-200 text-gray-700 rounded-xl font-bold hover:bg-gray-300 transition-all"
              >
                {policiesLoading ? '...' : 'تحديث'}
              </button>
            </div>

            {/* Bulk Assignment Panel */}
            {showBulkPanel && (
              <div className="bg-white rounded-2xl shadow-sm p-5 border-2 border-green-200">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-gray-800 text-lg">
                    تعيين جماعي لـ {selectedIds.size} موظف
                  </h3>
                  <button onClick={() => setShowBulkPanel(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                    <X className="w-5 h-5 text-gray-500" />
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">موقع العمل</label>
                    <select
                      value={bulkForm.work_location}
                      onChange={(e) => setBulkForm(f => ({ ...f, work_location: e.target.value }))}
                      className="w-full p-2.5 border border-gray-200 rounded-xl"
                    >
                      <option value="field">ميداني</option>
                      <option value="office">مكتبي</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">نظام الدوام</label>
                    <select
                      value={bulkForm.schedule_type}
                      onChange={(e) => setBulkForm(f => ({ ...f, schedule_type: e.target.value }))}
                      className="w-full p-2.5 border border-gray-200 rounded-xl"
                    >
                      <option value="fixed_shift">دوام ثابت</option>
                      <option value="flexible">دوام مرن</option>
                      <option value="hourly">بالساعة</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">تتبع GPS</label>
                    <select
                      value={bulkForm.tracking_required ? 'true' : 'false'}
                      onChange={(e) => setBulkForm(f => ({ ...f, tracking_required: e.target.value === 'true' }))}
                      className="w-full p-2.5 border border-gray-200 rounded-xl"
                    >
                      <option value="true">مطلوب</option>
                      <option value="false">غير مطلوب</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">ساعات العمل اليومية</label>
                    <input
                      type="number"
                      value={bulkForm.required_daily_hours}
                      onChange={(e) => setBulkForm(f => ({ ...f, required_daily_hours: parseFloat(e.target.value) || 0 }))}
                      className="w-full p-2.5 border border-gray-200 rounded-xl"
                      min="0"
                      max="24"
                      step="0.5"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">حالة الحضور</label>
                    <select
                      value={bulkForm.attendance_enabled ? 'true' : 'false'}
                      onChange={(e) => setBulkForm(f => ({ ...f, attendance_enabled: e.target.value === 'true' }))}
                      className="w-full p-2.5 border border-gray-200 rounded-xl"
                    >
                      <option value="true">فعال</option>
                      <option value="false">معفي من الحضور</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={applyBulk}
                    disabled={saveBulkLoading || selectedIds.size === 0}
                    className="px-6 py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-all disabled:opacity-50"
                  >
                    {saveBulkLoading ? '...' : `تطبيق على ${selectedIds.size} موظف`}
                  </button>
                  <button
                    onClick={() => { setShowBulkPanel(false); setSelectedIds(new Set()) }}
                    className="px-4 py-3 bg-gray-200 text-gray-700 rounded-xl font-bold hover:bg-gray-300 transition-all"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            )}

            {/* Policies Table */}
            <div className="bg-white rounded-2xl shadow-sm overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="p-3 text-right">
                      <input
                        type="checkbox"
                        checked={filteredPolicies.length > 0 && selectedIds.size === filteredPolicies.length}
                        onChange={selectAll}
                        className="w-4 h-4"
                      />
                    </th>
                    <th className="p-3 text-right font-bold text-gray-700">الكود</th>
                    <th className="p-3 text-right font-bold text-gray-700">الاسم</th>
                    <th className="p-3 text-right font-bold text-gray-700">موقع العمل</th>
                    <th className="p-3 text-right font-bold text-gray-700">نظام الدوام</th>
                    <th className="p-3 text-right font-bold text-gray-700">تتبع GPS</th>
                    <th className="p-3 text-right font-bold text-gray-700">ساعات/يوم</th>
                    <th className="p-3 text-center font-bold text-gray-700">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {policiesLoading ? (
                    <tr><td colSpan={8} className="p-6 text-center text-gray-400">جاري التحميل...</td></tr>
                  ) : filteredPolicies.length === 0 ? (
                    <tr><td colSpan={8} className="p-6 text-center text-gray-400">لا يوجد موظفون</td></tr>
                  ) : filteredPolicies.map(policy => (
                    <tr key={policy.employee_id} className={`border-b hover:bg-gray-50 ${!policy.is_active ? 'opacity-50' : ''}`}>
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(policy.employee_id)}
                          onChange={() => toggleSelect(policy.employee_id)}
                          className="w-4 h-4"
                        />
                      </td>
                      <td className="p-3 text-gray-600 font-mono">{policy.employee_code}</td>
                      <td className="p-3 font-medium text-gray-800">{policy.employee_name}</td>

                      {editingId === policy.employee_id ? (
                        <td colSpan={5} className="p-4">
                          <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                            <div className="flex items-center justify-between mb-3">
                              <h4 className="font-bold text-blue-800">اختيار قالب دور الموظف</h4>
                              <button onClick={cancelEdit} className="p-1 hover:bg-blue-100 rounded-lg"><X className="w-4 h-4 text-blue-500" /></button>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                              {[
                                { id: 'exempt', label: 'الإدارة العليا', sub: 'معفي من الحضور', icon: '🛡️',
                                  vals: { attendance_enabled: false, work_location: 'office', schedule_type: 'flexible', tracking_required: false, required_daily_hours: null } },
                                { id: 'office', label: 'موظف مكتبي', sub: 'مواعيد ثابتة', icon: '🏢',
                                  vals: { attendance_enabled: true, work_location: 'office', schedule_type: 'fixed_shift', tracking_required: false, required_daily_hours: 8 } },
                                { id: 'field', label: 'مندوب مبيعات', sub: 'مواعيد مرنة + تتبع', icon: '📍',
                                  vals: { attendance_enabled: true, work_location: 'field', schedule_type: 'flexible', tracking_required: true, required_daily_hours: 8 } },
                                { id: 'manager', label: 'مدير بيع', sub: 'مواعيد مرنة بدون تتبع', icon: '📋',
                                  vals: { attendance_enabled: true, work_location: 'office', schedule_type: 'flexible', tracking_required: false, required_daily_hours: 8 } },
                              ].map(tpl => {
                                const isSelected =
                                  (editForm.attendance_enabled === false && tpl.id === 'exempt') ||
                                  (editForm.attendance_enabled !== false &&
                                    editForm.work_location === tpl.vals.work_location &&
                                    editForm.schedule_type === tpl.vals.schedule_type &&
                                    editForm.tracking_required === tpl.vals.tracking_required)
                                return (
                                  <button
                                    key={tpl.id}
                                    onClick={async () => {
                                      setEditForm(f => ({ ...f, ...tpl.vals }))
                                      if (!token) return
                                      setSaveSingleLoading(true)
                                      const { error } = await supabase.rpc('upsert_employee_work_policy', {
                                        p_token: token,
                                        p_employee_id: policy.employee_id,
                                        p_work_location: tpl.vals.work_location,
                                        p_schedule_type: tpl.vals.schedule_type,
                                        p_tracking_required: tpl.vals.tracking_required,
                                        p_attendance_enabled: tpl.vals.attendance_enabled,
                                        p_required_daily_hours: tpl.vals.required_daily_hours,
                                        p_shift_start_time: null,
                                        p_shift_end_time: null,
                                        p_late_threshold_minutes: null,
                                        p_early_departure_threshold_minutes: null,
                                      })
                                      setSaveSingleLoading(false)
                                      if (error) { toast.error(error.message); return }
                                      toast.success('تم حفظ سياسة العمل')
                                      setEditingId(null)
                                      setEditForm({})
                                      await fetchPolicies()
                                    }}
                                    className={`relative flex flex-col items-center p-4 rounded-xl border-2 text-center transition-all ${
                                      isSelected ? 'border-blue-500 bg-white shadow-md' : 'border-gray-200 bg-white hover:border-blue-300'
                                    }`}
                                  >
                                    <span className="text-2xl mb-1">{tpl.icon}</span>
                                    <div className="font-bold text-sm text-gray-800">{tpl.label}</div>
                                    <div className="text-xs text-gray-500">{tpl.sub}</div>
                                  </button>
                                )
                              })}
                            </div>
                            {saveSingleLoading && <p className="text-xs text-blue-600 mt-2 text-center">جاري الحفظ...</p>}
                          </div>
                        </td>
                      ) : (
                        <>
                          <td className="p-3">
                            {!policy.has_policy ? (
                              <span className="px-2 py-0.5 rounded-lg text-xs font-bold bg-red-100 text-red-700">
                                بحاجة لمراجعة
                              </span>
                            ) : !policy.attendance_enabled ? (
                              <span className="px-2 py-0.5 rounded-lg text-xs font-bold bg-gray-600 text-white">
                                معفي من الحضور
                              </span>
                            ) : (
                              <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${
                                policy.work_location === 'field' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                              }`}>
                                {workLocationLabel(policy.work_location)}
                              </span>
                            )}
                          </td>
                          <td className="p-3">
                            {!policy.has_policy || !policy.attendance_enabled ? (
                              <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${
                                !policy.has_policy ? 'bg-red-100 text-red-700' : 'bg-gray-200 text-gray-500'
                              }`}>
                                —
                              </span>
                            ) : (
                              <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${
                                policy.schedule_type === 'fixed_shift' ? 'bg-purple-100 text-purple-700'
                                : policy.schedule_type === 'flexible' ? 'bg-orange-100 text-orange-700'
                                : 'bg-pink-100 text-pink-700'
                              }`}>
                                {scheduleTypeLabel(policy.schedule_type)}
                              </span>
                            )}
                          </td>
                          <td className="p-3">
                            {!policy.has_policy || !policy.attendance_enabled ? (
                              <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${
                                !policy.has_policy ? 'bg-red-100 text-red-700' : 'bg-gray-200 text-gray-500'
                              }`}>
                                —
                              </span>
                            ) : (
                              <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${
                                policy.tracking_required ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                              }`}>
                                {policy.tracking_required ? 'مطلوب' : 'غير مطلوب'}
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-gray-600">{!policy.attendance_enabled ? '—' : (policy.required_daily_hours ?? '-')}</td>
                          <td className="p-3">
                            <div className="flex items-center justify-center">
                              <button
                                onClick={() => startEdit(policy)}
                                className={`p-1.5 rounded-lg transition-all ${
                                  !policy.has_policy ? 'text-green-600 hover:bg-green-50 font-bold' : 'text-blue-600 hover:bg-blue-50'
                                }`}
                                title={policy.has_policy ? 'تعديل' : 'تعيين سياسة'}
                              >
                                {!policy.has_policy ? 'تعيين' : <Edit2 className="w-4 h-4" />}
                              </button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Summary */}
            <div className="text-sm text-gray-500">
              إجمالي الموظفين: {policies.length} | معروض: {filteredPolicies.length}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
