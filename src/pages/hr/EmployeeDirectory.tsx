import { useMemo, useState } from 'react'
import { Search, UserPlus, Users, UserCheck, UserX, ChevronLeft } from 'lucide-react'
import { getEmployeeHRSettings, ATTENDANCE_METHOD_LABELS, WORK_TYPE_LABELS } from '../../services/hrControl'

export function EmployeeDirectory({ employees, onOpen, onAdd }: {
  employees: any[]
  onOpen: (emp: any) => void
  onAdd: () => void
}) {
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [roleFilter, setRoleFilter] = useState('')

  const roleOptions = useMemo(() => {
    const names = new Set<string>()
    employees.forEach((e: any) => {
      if (e.role_names) e.role_names.split(', ').forEach((r: string) => names.add(r.trim()))
    })
    return Array.from(names).sort()
  }, [employees])

  const filtered = useMemo(() => {
    let list = employees
    if (statusFilter === 'active') list = list.filter((e: any) => e.is_active)
    if (statusFilter === 'inactive') list = list.filter((e: any) => !e.is_active)
    const s = q.trim().toLowerCase()
    if (s) {
      list = list.filter((e: any) =>
        (e.full_name || '').toLowerCase().includes(s) ||
        (e.code || '').toLowerCase().includes(s) ||
        (e.phone || '').toLowerCase().includes(s)
      )
    }
    if (roleFilter) {
      list = list.filter((e: any) => (e.role_names || '').toLowerCase().includes(roleFilter.toLowerCase()))
    }
    return list
  }, [employees, q, statusFilter, roleFilter])

  const activeCount = employees.filter((e: any) => e.is_active).length

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <SummaryCard icon={<Users className="w-4 h-4" />} label="الإجمالي" value={employees.length} tone="text-primary bg-blue-50" />
        <SummaryCard icon={<UserCheck className="w-4 h-4" />} label="نشط" value={activeCount} tone="text-success bg-green-50" />
        <SummaryCard icon={<UserX className="w-4 h-4" />} label="موقوف" value={employees.length - activeCount} tone="text-danger bg-red-50" />
      </div>

      <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <div className="flex items-center gap-2 bg-surface rounded-xl px-3 py-2 flex-1">
            <Search className="w-4 h-4 text-text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="بحث بالاسم أو الكود أو الهاتف..."
              className="flex-1 bg-transparent text-sm text-text focus:outline-none placeholder:text-text-muted" />
          </div>
          <button onClick={onAdd} className="flex items-center gap-1 bg-primary text-white rounded-xl px-3 py-2 text-xs font-bold active:bg-blue-800 whitespace-nowrap">
            <UserPlus className="w-3.5 h-3.5" />
            إضافة موظف
          </button>
        </div>
        <div className="px-4 py-2 flex gap-2 border-b border-border">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}
            className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white text-text">
            <option value="all">كل الحالات</option>
            <option value="active">نشط</option>
            <option value="inactive">موقوف</option>
          </select>
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
            className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white text-text flex-1 min-w-0">
            <option value="">كل الأدوار</option>
            {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-3xl mb-2">👥</div>
            <div className="text-sm font-bold text-text-secondary">لا يوجد موظفون</div>
            <div className="text-xs text-text-muted mt-1">لم يتم العثور على موظفين مطابقين</div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((e: any) => {
              const hr = getEmployeeHRSettings(e.id)
              return (
                <button key={e.id || e.code} onClick={() => onOpen(e)}
                  className="w-full px-4 py-3 flex items-center gap-3 text-right hover:bg-surface/60 transition-colors active:bg-surface">
                  <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-extrabold shrink-0">
                    {(e.full_name || '?').slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-text truncate">{e.full_name}</span>
                      {!e.is_active && <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-bold shrink-0">موقوف</span>}
                    </div>
                    <div className="text-[10px] text-text-muted mt-0.5">
                      {e.code} {e.role_names ? `• ${e.role_names}` : ''}
                    </div>
                    <div className="text-[10px] text-text-secondary mt-0.5 flex items-center gap-1 flex-wrap">
                      {hr?.work_type && <span>{WORK_TYPE_LABELS[hr.work_type as keyof typeof WORK_TYPE_LABELS] ?? hr.work_type}</span>}
                      {hr?.attendance_method && <span className="text-primary">{ATTENDANCE_METHOD_LABELS[hr.attendance_method as keyof typeof ATTENDANCE_METHOD_LABELS] ?? hr.attendance_method}</span>}
                      {hr?.job_title && <span>• {hr.job_title}</span>}
                    </div>
                  </div>
                  <ChevronLeft className="w-4 h-4 text-text-muted shrink-0" />
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: string }) {
  return (
    <div className="bg-white rounded-2xl border border-border shadow-sm p-3">
      <div className={`inline-flex w-8 h-8 rounded-xl items-center justify-center ${tone}`}>{icon}</div>
      <div className="text-xl font-extrabold text-text mt-1">{value}</div>
      <div className="text-[10px] text-text-muted">{label}</div>
    </div>
  )
}
