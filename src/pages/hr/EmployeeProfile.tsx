import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import toast from 'react-hot-toast'
import {
  User, Briefcase, Clock, Wallet, ArrowRight, UserPlus, UserMinus,
  Building2, MapPin,
} from 'lucide-react'
import {
  getEmployeeHRSettings, saveEmployeeHRSettings, auditFieldChanges,
  ATTENDANCE_METHOD_LABELS, WORK_TYPE_LABELS,
  hrControlService, type AttendanceMethod, type WorkType, type EmployeeHRSettings,
} from '../../services/hrControl'
import { SectionCard, Row, Input, Select, FieldLabel, Toggle, ReasonBar, SaveBar } from './profileUi'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface Policy {
  employee_id: string
  job_title?: string | null
  work_location?: string | null
  schedule_type?: string | null
  tracking_required?: boolean
  attendance_enabled?: boolean
  required_daily_hours?: number | null
  shift_start_time?: string | null
  shift_end_time?: string | null
  late_threshold_minutes?: number | null
  early_departure_threshold_minutes?: number | null
}

function fmt(val: unknown): string {
  if (val === null || val === undefined || val === '') return ''
  return String(val)
}

function WorkTypeBadge({ t }: { t?: WorkType }) {
  if (!t) return <span className="text-text-muted font-normal">--</span>
  const cls = t === 'office' ? 'bg-blue-100 text-blue-700' : t === 'field' ? 'bg-amber-100 text-amber-700' : 'bg-purple-100 text-purple-700'
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${cls}`}>{WORK_TYPE_LABELS[t]}</span>
}

function MethodBadge({ m }: { m?: AttendanceMethod }) {
  if (!m) return <span className="text-text-muted font-normal">--</span>
  const cls = m === 'premises' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${cls}`}>{ATTENDANCE_METHOD_LABELS[m]}</span>
}

export function EmployeeProfile({ employee, employees, actorName, onBack, onChanged }: {
  employee: any
  employees: any[]
  actorName: string
  onBack: () => void
  onChanged: () => void
}) {
  const user = useAuthStore((s) => s.user)
  const token = getToken()
  const [hr, setHr] = useState<EmployeeHRSettings>(() => getEmployeeHRSettings(employee.id) ?? { employee_id: employee.id })
  const [policy, setPolicy] = useState<Policy | null>(null)
  const [editSection, setEditSection] = useState<'personal' | 'job' | 'attendance' | 'salary' | null>(null)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const [draft, setDraft] = useState<Record<string, any>>({})

  const cfg = hrControlService.getZoneConfig()

  useEffect(() => {
    if (!token) return
    supabase.rpc('list_work_policies', { p_token: token }).then(({ data }: any) => {
      const list = data?.policies ?? []
      const mine = list.find((p: any) => p.employee_id === employee.id)
      if (mine) {
        setPolicy(mine)
        setHr((h) => ({ ...h, work_start_time: h.work_start_time ?? mine.shift_start_time ?? undefined, work_end_time: h.work_end_time ?? mine.shift_end_time ?? undefined, daily_working_hours: h.daily_working_hours ?? mine.required_daily_hours ?? undefined }))
      }
    })
  }, [token, employee.id])

  const startEdit = (section: 'personal' | 'job' | 'attendance' | 'salary') => {
    setEditSection(section)
    setReason('')
    const base: Record<string, any> = {
      personal: {
        full_name: employee.full_name || '',
        phone: employee.phone || '',
        email: employee.email || '',
        address: employee.address || '',
        national_id: hr.national_id || '',
        residential_location: hr.residential_location || '',
      },
      job: {
        job_title: hr.job_title || policy?.job_title || employee.job_title || '',
        department: hr.department || '',
        hire_date: hr.hire_date || '',
        work_type: hr.work_type || '',
      },
      attendance: {
        attendance_method: hr.attendance_method || 'premises',
        primary_work_location_id: hr.primary_work_location_id || cfg.location_id,
        work_start_time: hr.work_start_time || cfg.official_start_time,
        work_end_time: hr.work_end_time || cfg.official_end_time,
        daily_working_hours: hr.daily_working_hours ?? 8,
        overtime_eligible: !!hr.overtime_eligible,
      },
      salary: {
        salary_category: hr.salary_category || '',
        monthly_salary: hr.monthly_salary != null ? String(hr.monthly_salary) : '',
        daily_rate: hr.daily_rate != null ? String(hr.daily_rate) : '',
        hourly_rate: hr.hourly_rate != null ? String(hr.hourly_rate) : '',
        overtime_eligible: !!hr.overtime_eligible,
      },
    }
    setDraft(base[section])
  }

  const applySection = (section: 'personal' | 'job' | 'attendance' | 'salary') => {
    setHr((h) => ({ ...h, ...draft, updated_by: actorName }))
    setEditSection(null)
    setReason('')
    onChanged()
  }

  const savePersonal = async () => {
    if (!reason.trim()) { toast.error('سبب التعديل مطلوب'); return }
    setSaving(true)
    const changedBackend = [
      { field: 'الاسم الكامل', before: employee.full_name, after: draft.full_name, backend: employee.full_name !== draft.full_name },
      { field: 'رقم الهاتف', before: employee.phone, after: draft.phone, backend: employee.phone !== draft.phone },
      { field: 'البريد الإلكتروني', before: employee.email, after: draft.email, backend: employee.email !== draft.email },
      { field: 'العنوان', before: employee.address, after: draft.address, backend: employee.address !== draft.address },
    ].filter((c) => String(c.before ?? '') !== String(c.after ?? ''))
    const changedLocal = [
      { field: 'الرقم القومي', before: hr.national_id, after: draft.national_id },
      { field: 'محل الإقامة', before: hr.residential_location, after: draft.residential_location },
    ].filter((c) => String(c.before ?? '') !== String(c.after ?? ''))
    const hasBackend = changedBackend.some((c) => c.backend)
    if (hasBackend) {
      const { error } = await supabase.rpc('governed_update_employee', {
        p_token: token, p_id: employee.id,
        p_full_name: draft.full_name || null,
        p_phone: draft.phone || null,
        p_email: draft.email || null,
        p_address: draft.address || null,
      })
      if (error) { toast.error(error.message); setSaving(false); return }
    }
    if (changedLocal.length > 0) {
      const patch: Partial<EmployeeHRSettings> = {}
      for (const c of changedLocal) (patch as any)[c.field === 'الرقم القومي' ? 'national_id' : 'residential_location'] = c.after
      const saved = saveEmployeeHRSettings(employee.id, patch, actorName || user?.full_name || '')
      setHr(saved)
    }
    auditFieldChanges(actorName || user?.full_name || '', `${employee.full_name} (${employee.code ?? ''})`, [...changedBackend.map((c) => ({ field: c.field, before: c.before, after: c.after })), ...changedLocal])
    setSaving(false)
    toast.success('تم حفظ البيانات الشخصية')
    applySection('personal')
  }

  const saveJob = async () => {
    if (!reason.trim()) { toast.error('سبب التعديل مطلوب'); return }
    setSaving(true)
    const changes = [
      { field: 'المسمى الوظيفي', before: hr.job_title, after: draft.job_title, key: 'job_title' },
      { field: 'القسم', before: hr.department, after: draft.department, key: 'department' },
      { field: 'تاريخ التعيين', before: hr.hire_date, after: draft.hire_date, key: 'hire_date' },
      { field: 'نوع العمل', before: hr.work_type, after: draft.work_type, key: 'work_type' },
    ].filter((c) => String(c.before ?? '') !== String(c.after ?? ''))
    if (changes.length > 0) {
      const patch: Partial<EmployeeHRSettings> = {}
      for (const c of changes) (patch as any)[c.key] = c.after
      const saved = saveEmployeeHRSettings(employee.id, patch, actorName || user?.full_name || '')
      setHr(saved)
      auditFieldChanges(actorName || user?.full_name || '', `${employee.full_name} (${employee.code ?? ''})`, changes.map((c) => ({ field: c.field, before: c.before, after: c.after })))
    }
    setSaving(false)
    toast.success('تم حفظ البيانات الوظيفية')
    applySection('job')
  }

  const saveAttendance = async () => {
    if (!reason.trim()) { toast.error('سبب التعديل مطلوب'); return }
    setSaving(true)
    const policyChanges = [
      { field: 'بداية الدوام', before: policy?.shift_start_time ?? null, after: draft.work_start_time, p: 'p_shift_start_time' },
      { field: 'نهاية الدوام', before: policy?.shift_end_time ?? null, after: draft.work_end_time, p: 'p_shift_end_time' },
      { field: 'ساعات العمل اليومية', before: policy?.required_daily_hours ?? null, after: Number(draft.daily_working_hours) || null, p: 'p_required_daily_hours' },
    ].filter((c) => String(c.before ?? '') !== String(c.after ?? ''))
    if (policyChanges.length > 0) {
      const params: Record<string, any> = {
        p_token: token,
        p_employee_id: employee.id,
        p_work_location: policy?.work_location ?? null,
        p_schedule_type: policy?.schedule_type ?? null,
        p_tracking_required: policy?.tracking_required ?? true,
        p_attendance_enabled: policy?.attendance_enabled ?? true,
        p_late_threshold_minutes: policy?.late_threshold_minutes ?? null,
        p_early_departure_threshold_minutes: policy?.early_departure_threshold_minutes ?? null,
      }
      for (const c of policyChanges) params[c.p] = c.after
      const { error } = await supabase.rpc('upsert_employee_work_policy', params)
      if (error) { toast.error(error.message); setSaving(false); return }
    }
    const localChanges = [
      { field: 'طريقة البصمة', before: hr.attendance_method, after: draft.attendance_method, key: 'attendance_method' },
      { field: 'مقر العمل الأساسي', before: hr.primary_work_location_id, after: draft.primary_work_location_id, key: 'primary_work_location_id' },
      { field: 'استحقاق الإضافي', before: hr.overtime_eligible ? 'نعم' : 'لا', after: draft.overtime_eligible ? 'نعم' : 'لا', key: 'overtime_eligible' },
    ].filter((c) => String(c.before ?? '') !== String(c.after ?? ''))
    if (localChanges.length > 0) {
      const patch: Partial<EmployeeHRSettings> = {}
      for (const c of localChanges) {
        if (c.key === 'overtime_eligible') (patch as any)[c.key] = !!draft.overtime_eligible
        else (patch as any)[c.key] = c.after
      }
      const saved = saveEmployeeHRSettings(employee.id, patch, actorName || user?.full_name || '')
      setHr(saved)
      auditFieldChanges(actorName || user?.full_name || '', `${employee.full_name} (${employee.code ?? ''})`, localChanges.map((c) => ({ field: c.field, before: c.before, after: c.after })))
    }
    setSaving(false)
    toast.success('تم حفظ إعدادات الحضور')
    applySection('attendance')
  }

  const saveSalary = async () => {
    if (!reason.trim()) { toast.error('سبب التعديل مطلوب'); return }
    setSaving(true)
    const changes = [
      { field: 'فئة الراتب', before: hr.salary_category, after: draft.salary_category, key: 'salary_category' },
      { field: 'الراتب الشهري', before: hr.monthly_salary, after: draft.monthly_salary ? Number(draft.monthly_salary) : undefined, key: 'monthly_salary' },
      { field: 'الأجر اليومي', before: hr.daily_rate, after: draft.daily_rate ? Number(draft.daily_rate) : undefined, key: 'daily_rate' },
      { field: 'الأجر بالساعة', before: hr.hourly_rate, after: draft.hourly_rate ? Number(draft.hourly_rate) : undefined, key: 'hourly_rate' },
      { field: 'استحقاق الإضافي', before: hr.overtime_eligible ? 'نعم' : 'لا', after: draft.overtime_eligible ? 'نعم' : 'لا', key: 'overtime_eligible' },
    ].filter((c) => String(c.before ?? '') !== String(c.after ?? ''))
    if (changes.length > 0) {
      const patch: Partial<EmployeeHRSettings> = {}
      for (const c of changes) {
        if (c.key === 'overtime_eligible') (patch as any)[c.key] = !!draft.overtime_eligible
        else (patch as any)[c.key] = c.after
      }
      const saved = saveEmployeeHRSettings(employee.id, patch, actorName || user?.full_name || '')
      setHr(saved)
      auditFieldChanges(actorName || user?.full_name || '', `${employee.full_name} (${employee.code ?? ''})`, changes.map((c) => ({ field: c.field, before: c.before, after: c.after })))
    }
    setSaving(false)
    toast.success('تم حفظ إعدادات الراتب')
    applySection('salary')
  }

  const toggleStatus = async () => {
    const token = getToken()
    if (!token) return
    const fn = employee.is_active ? 'governed_deactivate_employee' : 'governed_activate_employee'
    const action = employee.is_active ? 'إيقاف' : 'تفعيل'
    if (!window.confirm(`تأكيد ${action} الموظف ${employee.full_name}؟`)) return
    const { error } = await supabase.rpc(fn, { p_token: token, p_id: employee.id })
    if (error) { toast.error(error.message); return }
    hrControlService.appendAudit({
      actor_name: actorName || user?.full_name || 'غير معروف',
      action: `تغيير حالة الموظف - ${action}`,
      target: `${employee.full_name} (${employee.code ?? ''})`,
      before: employee.is_active ? 'نشط' : 'موقوف',
      after: employee.is_active ? 'موقوف' : 'نشط',
    })
    toast.success(employee.is_active ? 'تم إيقاف الموظف' : 'تم تفعيل الموظف')
    onChanged()
  }

  const changeManager = async (managerId: string) => {
    const token = getToken()
    if (!token) return
    const mgr = employees.find((e: any) => e.id === managerId)
    const { error } = await supabase.rpc('governed_change_employee_manager', { p_token: token, p_id: employee.id, p_manager_id: managerId })
    if (error) { toast.error(error.message); return }
    hrControlService.appendAudit({
      actor_name: actorName || user?.full_name || 'غير معروف',
      action: 'تغيير المدير المباشر',
      target: `${employee.full_name} (${employee.code ?? ''})`,
      before: managerName ?? 'غير محدد',
      after: mgr?.full_name ?? 'غير محدد',
    })
    toast.success('تم تغيير المدير المباشر')
    onChanged()
  }

  const activeManagers = useMemo(() => employees.filter((e: any) => e.id !== employee.id && e.is_active), [employees, employee.id])

  const managerName = useMemo(() => employees.find((e: any) => e.id === employee.manager_id)?.full_name ?? null, [employees, employee])

  const geoSummary = (() => {
    const method: AttendanceMethod = hr.attendance_method ?? 'premises'
    const loc = cfg
    const isPrimary = hr.primary_work_location_id === loc.location_id || !hr.primary_work_location_id
    if (method === 'app') {
      return 'بصمة التطبيق: لا يُفرض تقييد نطاق الفرع الرئيسي على الحضور (لا توجد قيمة 50م صلبة).'
    }
    return `بصمة المقر: يتحقق الحضور داخل نطاق المقر ${isPrimary ? cfg.name : hr.primary_work_location_id} ضمن ${loc.radius_meters} متر (قابل للضبط من مقار العمل).`
  })()

  const methodDraft: AttendanceMethod = draft.attendance_method ?? 'premises'
  const geoDraftSummary = (() => {
    if (methodDraft === 'app') {
      return 'بصمة التطبيق: لا يُفرض تقييد نطاق الفرع الرئيسي.'
    }
    return `بصمة المقر: داخل نطاق ${cfg.name} (${cfg.radius_meters} متر).`
  })()

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="flex items-center gap-1 text-xs font-bold text-text-secondary border border-border rounded-xl px-3 py-2 bg-white active:bg-surface">
          <ArrowRight className="w-4 h-4" />
          دليل الموظفين
        </button>
        <div className="flex-1 text-left">
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${employee.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            {employee.is_active ? 'نشط' : 'موقوف'}
          </span>
        </div>
        <button onClick={toggleStatus}
          className={`text-xs px-3 py-2 rounded-xl font-bold border ${employee.is_active ? 'border-danger/30 text-danger bg-red-50' : 'border-success/30 text-success bg-green-50'}`}>
          {employee.is_active ? <UserMinus className="w-3.5 h-3.5 inline ml-1 align-[-2px]" /> : <UserPlus className="w-3.5 h-3.5 inline ml-1 align-[-2px]" />}
          {employee.is_active ? 'إيقاف' : 'تفعيل'}
        </button>
      </div>

      <div className="bg-gradient-to-l from-secondary to-blue-900 rounded-2xl text-white p-5 flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-white/15 flex items-center justify-center text-lg font-extrabold shrink-0">
          {(employee.full_name || '?').slice(0, 2)}
        </div>
        <div className="min-w-0">
          <div className="text-lg font-extrabold truncate">{employee.full_name}</div>
          <div className="text-xs text-white/70 mt-0.5">
            {employee.code}
            {employee.role_names ? ` • ${employee.role_names}` : ''}
          </div>
        </div>
        <div className="mr-auto text-left">
          <div className="text-[10px] text-white/60">المدير المباشر</div>
          <div className="text-xs font-bold text-gold-light truncate">{managerName ?? '--'}</div>
        </div>
      </div>

      <SystemNotice>الملف التعريفي هنا هو المصدر الموحد (Single Source of Truth) لبيانات الموظف التي ستعرضها شاشة «شؤون العاملين» للموظف نفسه. أي تعديل يدوي يُسجل دائماً في سجل التدقيق ولا يمحو القيمة الأصلية.</SystemNotice>

      {/* ===== A. PERSONAL ===== */}
      <SectionCard title="أ. البيانات الشخصية" icon={<User className="w-4 h-4" />} onEdit={() => startEdit('personal')} editing={editSection === 'personal'}>
        {editSection === 'personal' ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><FieldLabel>الاسم الكامل</FieldLabel><Input value={draft.full_name} onChange={(v) => setDraft({ ...draft, full_name: v })} /></div>
              <div><FieldLabel>كود الموظف</FieldLabel><Input value={employee.code ?? ''} onChange={() => {}} /></div>
              <div><FieldLabel>الرقم القومي</FieldLabel><Input value={draft.national_id} onChange={(v) => setDraft({ ...draft, national_id: v })} ltr /></div>
              <div><FieldLabel>رقم الهاتف</FieldLabel><Input value={draft.phone} onChange={(v) => setDraft({ ...draft, phone: v })} ltr /></div>
              <div><FieldLabel>البريد الإلكتروني</FieldLabel><Input value={draft.email} onChange={(v) => setDraft({ ...draft, email: v })} ltr /></div>
            </div>
            <div><FieldLabel>العنوان</FieldLabel><Input value={draft.address} onChange={(v) => setDraft({ ...draft, address: v })} /></div>
            <div><FieldLabel>محل الإقامة</FieldLabel><Input value={draft.residential_location} onChange={(v) => setDraft({ ...draft, residential_location: v })} /></div>
            <SystemNotice tone="warn">حقل «الرقم القومي» و«محل الإقامة» لا يوجد لهما عمود في قاعدة البيانات الحالية — يُحفظان محلياً لحين ربط الخادم (Backend Gap). بقية الحقول تُحفظ في الخادم مباشرة.</SystemNotice>
            <ReasonBar reason={reason} setReason={setReason} />
            <SaveBar saving={saving} onSave={savePersonal} onCancel={() => setEditSection(null)} />
          </div>
        ) : (
          <div>
            <Row label="الاسم الكامل" value={employee.full_name} />
            <Row label="كود الموظف" value={employee.code} />
            <Row label="الرقم القومي" value={hr.national_id} />
            <Row label="رقم الهاتف" value={employee.phone} />
            <Row label="البريد الإلكتروني" value={employee.email} />
            <Row label="العنوان" value={employee.address} />
            <Row label="محل الإقامة" value={hr.residential_location} />
          </div>
        )}
      </SectionCard>

      {/* ===== B. JOB ===== */}
      <SectionCard title="ب. البيانات الوظيفية" icon={<Briefcase className="w-4 h-4" />} onEdit={() => startEdit('job')} editing={editSection === 'job'}>
        {editSection === 'job' ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><FieldLabel>المسمى الوظيفي</FieldLabel><Input value={draft.job_title} onChange={(v) => setDraft({ ...draft, job_title: v })} /></div>
              <div><FieldLabel>القسم</FieldLabel><Input value={draft.department} onChange={(v) => setDraft({ ...draft, department: v })} /></div>
              <div><FieldLabel>تاريخ التعيين</FieldLabel><Input type="date" value={draft.hire_date} onChange={(v) => setDraft({ ...draft, hire_date: v })} /></div>
              <div><FieldLabel>نوع العمل</FieldLabel><Select value={draft.work_type} onChange={(v) => setDraft({ ...draft, work_type: v })} placeholder="-- اختر --" options={[
                { value: 'office', label: 'مكتبي' },
                { value: 'field', label: 'ميداني' },
                { value: 'hybrid', label: 'هجين' },
              ]} /></div>
            </div>
            <SystemNotice tone="warn">لا توجد أعمدة جاهزة في الخادم لحقول (المسمى/القسم/تاريخ التعيين/نوع العمل) — تُحفظ محلياً لحين ربطها (Backend Gap). المدير المباشر وحالة التوظيف يُحفظان في الخادم.</SystemNotice>
            <ReasonBar reason={reason} setReason={setReason} />
            <SaveBar saving={saving} onSave={saveJob} onCancel={() => setEditSection(null)} />
          </div>
        ) : (
          <div>
            <Row label="المسمى الوظيفي" value={hr.job_title || policy?.job_title} />
            <Row label="القسم" value={hr.department} />
            <Row label="تاريخ التعيين" value={hr.hire_date} />
            <Row label="نوع العمل" value={<WorkTypeBadge t={hr.work_type} />} />
            <Row label="حالة التوظيف" value={employee.is_active ? 'نشط' : 'موقوف'} />
            <Row label="المدير المباشر" value={managerName ?? 'غير محدد'} />
            <div className="flex gap-2 mt-3">
              <select onChange={(e) => { if (e.target.value) changeManager(e.target.value) }} value="" className="flex-1 border border-border rounded-lg px-3 py-2 text-xs text-text focus:outline-none">
                <option value="">تغيير المدير المباشر...</option>
                {activeManagers.map((m: any) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
              </select>
            </div>
          </div>
        )}
      </SectionCard>

      {/* ===== C. ATTENDANCE ===== */}
      <SectionCard title="ج. إعدادات الحضور" icon={<Clock className="w-4 h-4" />} onEdit={() => startEdit('attendance')} editing={editSection === 'attendance'}>
        {editSection === 'attendance' ? (
          <div className="space-y-3">
            <div><FieldLabel>طريقة البصمة</FieldLabel><Select value={draft.attendance_method} onChange={(v) => setDraft({ ...draft, attendance_method: v })} options={[
              { value: 'premises', label: 'بصمة المقر' },
              { value: 'app', label: 'بصمة التطبيق' },
            ]} /></div>
            <div><FieldLabel>مقر العمل الأساسي</FieldLabel><Select value={draft.primary_work_location_id} onChange={(v) => setDraft({ ...draft, primary_work_location_id: v })} options={[
              { value: cfg.location_id, label: `${cfg.name} (نطاق ${cfg.radius_meters} متر)` },
            ]} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><FieldLabel>بداية الدوام</FieldLabel><Input type="time" value={draft.work_start_time} onChange={(v) => setDraft({ ...draft, work_start_time: v })} /></div>
              <div><FieldLabel>نهاية الدوام (آلية)</FieldLabel><Input type="time" value={draft.work_end_time} onChange={(v) => setDraft({ ...draft, work_end_time: v })} /></div>
            </div>
            <div><FieldLabel>ساعات العمل اليومية</FieldLabel><Input type="number" min="0" value={String(draft.daily_working_hours)} onChange={(v) => setDraft({ ...draft, daily_working_hours: v })} /></div>
            <Toggle value={!!draft.overtime_eligible} onChange={(v) => setDraft({ ...draft, overtime_eligible: v })} label="استحقاق العمل الإضافي (يُعتمد بموافقة الإدارة)" />
            <div className="border rounded-xl px-3 py-2.5 text-xs leading-relaxed bg-green-50 border-green-200 text-green-800">
              <MapPin className="w-4 h-4 inline ml-1 align-[-2px]" />
              {geoDraftSummary}
            </div>
            <SystemNotice tone="warn">أوقات الدوام وساعات العمل تُحفظ في سياسة العمل بالخادم (upsert_employee_work_policy). طريقة البصمة ومقر العمل الأساسي واستحقاق الإضافي لا يوجد لها عمود بعد — تُحفظ محلياً (Backend Gap).</SystemNotice>
            <ReasonBar reason={reason} setReason={setReason} />
            <SaveBar saving={saving} onSave={saveAttendance} onCancel={() => setEditSection(null)} />
          </div>
        ) : (
          <div>
            <Row label="طريقة البصمة" value={<MethodBadge m={hr.attendance_method} />} />
            <Row label="مقر العمل الأساسي" value={hr.primary_work_location_id === cfg.location_id || !hr.primary_work_location_id ? <span className="flex items-center gap-1"><Building2 className="w-3 h-3 inline" /> {cfg.name}</span> : hr.primary_work_location_id} />
            <Row label="بداية الدوام" value={hr.work_start_time || cfg.official_start_time} />
            <Row label="نهاية الدوام (آلية)" value={hr.work_end_time || cfg.official_end_time} />
            <Row label="ساعات العمل اليومية" value={hr.daily_working_hours ?? '--'} />
            <Row label="استحقاق الإضافي" value={hr.overtime_eligible ? 'نعم' : 'لا'} />
            <div className={`mt-3 rounded-xl px-3 py-2.5 text-xs font-bold ${hr.attendance_method === 'app' ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700'}`}>
              <MapPin className="w-4 h-4 inline ml-1 align-[-2px]" />
              {geoSummary}
            </div>
          </div>
        )}
      </SectionCard>

      {/* ===== D. SALARY ===== */}
      <SectionCard title="د. إعدادات الراتب" icon={<Wallet className="w-4 h-4" />} onEdit={() => startEdit('salary')} editing={editSection === 'salary'}>
        {editSection === 'salary' ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><FieldLabel>فئة الراتب</FieldLabel><Input value={draft.salary_category} onChange={(v) => setDraft({ ...draft, salary_category: v })} placeholder="مثال: أساسي" /></div>
              <div><FieldLabel>الراتب الشهري</FieldLabel><Input type="number" min="0" ltr value={String(draft.monthly_salary)} onChange={(v) => setDraft({ ...draft, monthly_salary: v })} /></div>
              <div><FieldLabel>الأجر اليومي</FieldLabel><Input type="number" min="0" ltr value={String(draft.daily_rate)} onChange={(v) => setDraft({ ...draft, daily_rate: v })} /></div>
              <div><FieldLabel>الأجر بالساعة</FieldLabel><Input type="number" min="0" ltr value={String(draft.hourly_rate)} onChange={(v) => setDraft({ ...draft, hourly_rate: v })} /></div>
            </div>
            <Toggle value={!!draft.overtime_eligible} onChange={(v) => setDraft({ ...draft, overtime_eligible: v })} label="احتساب الإضافي في المستحقات" />
            <SystemNotice tone="warn">لا توجد قاعدة مسير رسمية مفعلة بعد (Payroll Rule Gap). القيم هنا تُحفظ محلياً كبنية جاهزة ولن تُستخدم في أي حساب مستحقات حالياً.</SystemNotice>
            <ReasonBar reason={reason} setReason={setReason} />
            <SaveBar saving={saving} onSave={saveSalary} onCancel={() => setEditSection(null)} />
          </div>
        ) : (
          <div>
            <Row label="فئة الراتب" value={hr.salary_category} />
            <Row label="الراتب الشهري" value={hr.monthly_salary != null ? `${hr.monthly_salary} ج.م` : undefined} />
            <Row label="الأجر اليومي" value={hr.daily_rate != null ? `${hr.daily_rate} ج.م` : undefined} />
            <Row label="الأجر بالساعة" value={hr.hourly_rate != null ? `${hr.hourly_rate} ج.م` : undefined} />
            <Row label="استحقاق الإضافي" value={hr.overtime_eligible ? 'نعم' : 'لا'} />
          </div>
        )}
      </SectionCard>
    </div>
  )
}

function SystemNotice({ children, tone = 'info' }: { children: React.ReactNode; tone?: 'info' | 'warn' }) {
  const cls = tone === 'warn'
    ? 'bg-amber-50 border-amber-200 text-amber-800'
    : 'bg-blue-50 border-blue-200 text-blue-800'
  return (
    <div className={`border rounded-xl px-3 py-2.5 text-xs leading-relaxed ${cls}`}>
      {children}
    </div>
  )
}
