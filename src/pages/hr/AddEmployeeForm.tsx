import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import toast from 'react-hot-toast'
import { ArrowRight, UserPlus } from 'lucide-react'
import { saveEmployeeHRSettings, hrControlService, type AttendanceMethod, type WorkType } from '../../services/hrControl'
import { FieldLabel, Input, Select, Toggle } from './profileUi'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function AddEmployeeForm({ employees, onBack, onCreated }: {
  employees: any[]
  onBack: () => void
  onCreated: (id: string | null, name: string) => void
}) {
  const user = useAuthStore((s) => s.user)
  const token = getToken()
  const cfg = hrControlService.getZoneConfig()
  const [roles, setRoles] = useState<any[]>([])
  const [submitting, setSubmitting] = useState(false)

  const [form, setForm] = useState<Record<string, any>>({
    full_name: '', phone: '', password: '', email: '', address: '',
    national_id: '', residential_location: '',
    job_title: '', department: '', hire_date: '', work_type: '',
    attendance_method: 'premises', primary_work_location_id: cfg.location_id,
    work_start_time: cfg.official_start_time, work_end_time: cfg.official_end_time,
    daily_working_hours: '8', overtime_eligible: false,
    salary_category: '', monthly_salary: '', daily_rate: '', hourly_rate: '',
    role_id: '', manager_id: '',
  })

  useEffect(() => {
    if (!token) return
    supabase.rpc('get_governed_roles', { p_token: token }).then(({ data }: any) => {
      if (data) setRoles(Array.isArray(data) ? data : [])
    })
  }, [token])

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.full_name.trim() || !form.phone.trim()) { toast.error('الاسم ورقم الهاتف مطلوبان'); return }
    setSubmitting(true)
    const { data, error } = await supabase.rpc('governed_create_employee', {
      p_token: token,
      p_full_name: form.full_name.trim(),
      p_phone: form.phone.trim(),
      p_password: form.password || null,
      p_email: form.email || null,
      p_role_id: form.role_id || null,
      p_manager_id: form.manager_id || null,
      p_address: form.address || null,
    })
    if (error) { toast.error(error.message); setSubmitting(false); return }
    const result = data as any
    if (result.error) { toast.error(result.error); setSubmitting(false); return }
    const newId: string | null = result.id ?? null

    const extended: Record<string, any> = {}
    if (form.national_id) extended.national_id = form.national_id
    if (form.residential_location) extended.residential_location = form.residential_location
    if (form.job_title) extended.job_title = form.job_title
    if (form.department) extended.department = form.department
    if (form.hire_date) extended.hire_date = form.hire_date
    if (form.work_type) extended.work_type = form.work_type as WorkType
    extended.attendance_method = form.attendance_method as AttendanceMethod
    extended.primary_work_location_id = form.primary_work_location_id
    if (form.work_start_time) extended.work_start_time = form.work_start_time
    if (form.work_end_time) extended.work_end_time = form.work_end_time
    extended.daily_working_hours = Number(form.daily_working_hours) || 8
    extended.overtime_eligible = !!form.overtime_eligible
    if (form.salary_category) extended.salary_category = form.salary_category
    if (form.monthly_salary) extended.monthly_salary = Number(form.monthly_salary)
    if (form.daily_rate) extended.daily_rate = Number(form.daily_rate)
    if (form.hourly_rate) extended.hourly_rate = Number(form.hourly_rate)

    if (newId) {
      saveEmployeeHRSettings(newId, extended, user?.full_name || '')
      await supabase.rpc('upsert_employee_work_policy', {
        p_token: token,
        p_employee_id: newId,
        p_work_location: form.work_type === 'field' ? 'field' : 'office',
        p_schedule_type: 'flexible',
        p_tracking_required: true,
        p_attendance_enabled: true,
        p_required_daily_hours: Number(form.daily_working_hours) || null,
        p_shift_start_time: form.work_start_time || null,
        p_shift_end_time: form.work_end_time || null,
        p_late_threshold_minutes: null,
        p_early_departure_threshold_minutes: null,
      })
    }

    toast.success(`تم إضافة ${result.full_name}`)
    setSubmitting(false)
    onCreated(newId, result.full_name)
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-xs font-bold text-text-secondary border border-border rounded-xl px-3 py-2 bg-white active:bg-surface">
        <ArrowRight className="w-4 h-4" />
        دليل الموظفين
      </button>

      <div className="bg-gradient-to-l from-primary to-blue-900 rounded-2xl text-white p-5 flex items-center gap-3">
        <UserPlus className="w-6 h-6" />
        <div>
          <div className="text-base font-extrabold">إضافة موظف جديد</div>
          <div className="text-xs text-white/70 mt-0.5">يُنشأ الموظف في الخادم فعلياً (governed_create_employee) ثم تُرفق الإعدادات الموسعة.</div>
        </div>
      </div>

      <Section title="أ. البيانات الشخصية">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><FieldLabel>الاسم الكامل *</FieldLabel><Input value={form.full_name} onChange={(v) => set('full_name', v)} /></div>
          <div><FieldLabel>رقم الهاتف *</FieldLabel><Input value={form.phone} onChange={(v) => set('phone', v)} ltr /></div>
          <div><FieldLabel>كلمة المرور (افتراضي: الهاتف)</FieldLabel><Input value={form.password} onChange={(v) => set('password', v)} ltr /></div>
          <div><FieldLabel>البريد الإلكتروني</FieldLabel><Input value={form.email} onChange={(v) => set('email', v)} ltr /></div>
          <div><FieldLabel>الرقم القومي</FieldLabel><Input value={form.national_id} onChange={(v) => set('national_id', v)} ltr /></div>
          <div className="col-span-2"><FieldLabel>العنوان</FieldLabel><Input value={form.address} onChange={(v) => set('address', v)} /></div>
          <div className="col-span-2"><FieldLabel>محل الإقامة</FieldLabel><Input value={form.residential_location} onChange={(v) => set('residential_location', v)} /></div>
        </div>
      </Section>

      <Section title="ب. البيانات الوظيفية">
        <div className="grid grid-cols-2 gap-3">
          <div><FieldLabel>المسمى الوظيفي</FieldLabel><Input value={form.job_title} onChange={(v) => set('job_title', v)} /></div>
          <div><FieldLabel>القسم</FieldLabel><Input value={form.department} onChange={(v) => set('department', v)} /></div>
          <div><FieldLabel>تاريخ التعيين</FieldLabel><Input type="date" value={form.hire_date} onChange={(v) => set('hire_date', v)} /></div>
          <div><FieldLabel>نوع العمل</FieldLabel><Select value={form.work_type} onChange={(v) => set('work_type', v)} placeholder="-- اختر --" options={[
            { value: 'office', label: 'مكتبي' },
            { value: 'field', label: 'ميداني' },
            { value: 'hybrid', label: 'هجين' },
          ]} /></div>
          <div><FieldLabel>الصلاحية</FieldLabel><Select value={form.role_id} onChange={(v) => set('role_id', v)} placeholder="-- اختر --" options={roles.map((r: any) => ({ value: r.id, label: r.name }))} /></div>
          <div><FieldLabel>المدير المباشر</FieldLabel><Select value={form.manager_id} onChange={(v) => set('manager_id', v)} placeholder="-- اختر --" options={employees.filter((e: any) => e.is_active).map((e: any) => ({ value: e.id, label: e.full_name }))} /></div>
        </div>
      </Section>

      <Section title="ج. إعدادات الحضور">
        <div className="grid grid-cols-2 gap-3">
          <div><FieldLabel>طريقة البصمة</FieldLabel><Select value={form.attendance_method} onChange={(v) => set('attendance_method', v)} options={[
            { value: 'premises', label: 'بصمة المقر' },
            { value: 'app', label: 'بصمة التطبيق' },
          ]} /></div>
          <div><FieldLabel>مقر العمل الأساسي</FieldLabel><Select value={form.primary_work_location_id} onChange={(v) => set('primary_work_location_id', v)} options={[
            { value: cfg.location_id, label: `${cfg.name} (نطاق ${cfg.radius_meters} متر)` },
          ]} /></div>
          <div><FieldLabel>بداية الدوام</FieldLabel><Input type="time" value={form.work_start_time} onChange={(v) => set('work_start_time', v)} /></div>
          <div><FieldLabel>نهاية الدوام (آلية)</FieldLabel><Input type="time" value={form.work_end_time} onChange={(v) => set('work_end_time', v)} /></div>
          <div><FieldLabel>ساعات العمل اليومية</FieldLabel><Input type="number" min="0" value={String(form.daily_working_hours)} onChange={(v) => set('daily_working_hours', v)} /></div>
        </div>
        <div className="mt-3"><Toggle value={!!form.overtime_eligible} onChange={(v) => set('overtime_eligible', v)} label="استحقاق العمل الإضافي (يُعتمد بموافقة الإدارة)" /></div>
      </Section>

      <Section title="د. إعدادات الراتب">
        <div className="grid grid-cols-2 gap-3">
          <div><FieldLabel>فئة الراتب</FieldLabel><Input value={form.salary_category} onChange={(v) => set('salary_category', v)} placeholder="مثال: أساسي" /></div>
          <div><FieldLabel>الراتب الشهري</FieldLabel><Input type="number" min="0" ltr value={String(form.monthly_salary)} onChange={(v) => set('monthly_salary', v)} /></div>
          <div><FieldLabel>الأجر اليومي</FieldLabel><Input type="number" min="0" ltr value={String(form.daily_rate)} onChange={(v) => set('daily_rate', v)} /></div>
          <div><FieldLabel>الأجر بالساعة</FieldLabel><Input type="number" min="0" ltr value={String(form.hourly_rate)} onChange={(v) => set('hourly_rate', v)} /></div>
        </div>
        <div className="mt-3"><Toggle value={!!form.overtime_eligible} onChange={(v) => set('overtime_eligible', v)} label="احتساب الإضافي في المستحقات" /></div>
      </Section>

      <button onClick={submit} disabled={submitting}
        className="w-full bg-gradient-to-l from-primary to-blue-900 text-white rounded-xl py-3 text-sm font-bold active:scale-95 transition-all disabled:opacity-60">
        {submitting ? 'جاري إنشاء الموظف...' : 'إنشاء الموظف'}
      </button>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
      <div className="bg-gradient-to-l from-secondary to-blue-900 px-4 py-3">
        <h3 className="text-sm font-bold text-white">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}
