import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface EmpPermInfo {
  employee_id: string
  employee_code: string
  employee_name: string
  role_name: string
  role_id: string
  is_active: boolean
  capabilities: { id: string; code: string; name: string; from_role: boolean; grant_type: string }[]
}

const SCOPE_OPTIONS = [
  { value: 'self', label: 'الذات فقط' },
  { value: 'subtree', label: 'الفريق التابع' },
  { value: 'customer', label: 'عملاء محددون' },
  { value: 'all', label: 'الكل' },
]

export function PermissionsTab() {
  const navigate = useNavigate()
  const [employees, setEmployees] = useState<any[]>([])
  const [roles, setRoles] = useState<any[]>([])
  const [allCapabilities, setAllCapabilities] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [selectedEmp, setSelectedEmp] = useState<string | null>(null)
  const [empCaps, setEmpCaps] = useState<any[]>([])
  const [empRoleCaps, setEmpRoleCaps] = useState<any[]>([])
  const [editMode, setEditMode] = useState(false)
  const [sourceFilter, setSourceFilter] = useState<string>('all')

  async function load() {
    const token = getToken()
    if (!token) { setLoading(false); return }
    const [eRes, rRes, cRes] = await Promise.all([
      supabase.rpc('get_governed_employees', { p_token: token }),
      supabase.rpc('get_governed_roles', { p_token: token }),
      supabase.rpc('get_all_capabilities', { p_token: token }),
    ])
    if (eRes.data) setEmployees(Array.isArray(eRes.data) ? eRes.data : [])
    if (rRes.data) setRoles(Array.isArray(rRes.data) ? rRes.data : [])
    if (cRes.data) setAllCapabilities(Array.isArray(cRes.data) ? cRes.data : [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const roleOptions = useMemo(() => {
    const names = new Set<string>()
    employees.forEach((e: any) => {
      if (e.role_names) e.role_names.split(', ').forEach((r: string) => names.add(r.trim()))
    })
    return Array.from(names).sort()
  }, [employees])

  const filteredEmps = useMemo(() => {
    let list = employees
    const q = searchTerm.trim().toLowerCase()
    if (q) list = list.filter((e: any) =>
      (e.full_name || '').toLowerCase().includes(q) ||
      (e.code || '').toLowerCase().includes(q) ||
      (e.phone || '').toLowerCase().includes(q)
    )
    if (roleFilter) list = list.filter((e: any) =>
      (e.role_names || '').toLowerCase().includes(roleFilter.toLowerCase())
    )
    return list
  }, [employees, searchTerm, roleFilter])

  async function selectEmployee(empId: string) {
    setSelectedEmp(empId)
    setEditMode(false)
    const token = getToken()
    const [capsRes, roleCapsRes] = await Promise.all([
      supabase.rpc('get_employee_capabilities', { p_token: token, p_employee_id: empId }),
      supabase.rpc('get_all_capabilities', { p_token: token }),
    ])
    if (capsRes.data) setEmpCaps(Array.isArray(capsRes.data) ? capsRes.data : [])
    if (roleCapsRes.data) setEmpRoleCaps(Array.isArray(roleCapsRes.data) ? roleCapsRes.data : [])
  }

  const filteredCaps = useMemo(() => {
    if (sourceFilter === 'role') return empCaps.filter((c: any) => c.from_role)
    if (sourceFilter === 'direct') return empCaps.filter((c: any) => !c.from_role)
    return empCaps
  }, [empCaps, sourceFilter])

  const capabilityGroups = useMemo(() => {
    const groups: Record<string, typeof allCapabilities> = {}
    for (const cap of allCapabilities) {
      const grp = cap.group || 'عام'
      if (!groups[grp]) groups[grp] = []
      groups[grp].push(cap)
    }
    return groups
  }, [allCapabilities])

  async function toggleDirectCapability(empId: string, capId: string, currentGrantType: string | null) {
    const token = getToken()
    const currentDirect = empCaps.filter((c: any) => !c.from_role && c.grant_type)
    let newCaps: { capability_id: string; grant_type: string }[]
    if (currentGrantType === 'grant') {
      newCaps = currentDirect
        .filter((c: any) => c.id !== capId)
        .map((c: any) => ({ capability_id: c.id, grant_type: c.grant_type }))
    } else {
      const exists = currentDirect.find((c: any) => c.id === capId)
      newCaps = exists
        ? currentDirect.map((c: any) => ({
            capability_id: c.id,
            grant_type: c.id === capId ? (c.grant_type === 'deny' ? 'grant' : 'deny') : c.grant_type,
          }))
        : [
            ...currentDirect.map((c: any) => ({ capability_id: c.id, grant_type: c.grant_type })),
            { capability_id: capId, grant_type: 'grant' },
          ]
    }
    const { error } = await supabase.rpc('governed_update_employee_capabilities', {
      p_token: token,
      p_id: empId,
      p_capabilities: newCaps,
    })
    if (error) { toast.error(error.message); return }
    toast.success('تم تحديث الصلاحية')
    const capsRes = await supabase.rpc('get_employee_capabilities', { p_token: token, p_employee_id: empId })
    if (capsRes.data) setEmpCaps(Array.isArray(capsRes.data) ? capsRes.data : [])
  }

  if (loading) return <div className="text-center py-8 text-text-secondary text-sm">جاري التحميل...</div>

  return (
    <div className="space-y-4">
      <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
        placeholder="بحث عن موظف..." className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />

      <div className="flex gap-2">
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
          className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white">
          <option value="">كل الأدوار</option>
          {roleOptions.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      <div className="space-y-2">
        {filteredEmps.map((emp: any) => (
          <div key={emp.id}
            onClick={() => selectEmployee(emp.id)}
            className={`bg-white rounded-xl border p-3 cursor-pointer transition-colors ${
              selectedEmp === emp.id ? 'border-primary ring-1 ring-primary' : 'border-border'
            }`}>
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-bold text-text">{emp.full_name}</span>
                <div className="text-[10px] text-text-secondary">{emp.code} | {emp.phone}</div>
              </div>
              <div className="text-left">
                <span className="text-[10px] text-primary">{emp.role_names}</span>
                {!emp.is_active && <span className="text-[10px] text-danger mr-2">موقوف</span>}
              </div>
            </div>
          </div>
        ))}
        {filteredEmps.length === 0 && (
          <p className="text-center py-8 text-text-secondary text-xs">لا يوجد موظفون</p>
        )}
      </div>

      {selectedEmp && (
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold">الصلاحيات التفصيلية</h3>
            <div className="flex gap-1">
              {['all', 'role', 'direct'].map((opt) => (
                <button key={opt} onClick={() => setSourceFilter(opt)}
                  className={`text-[10px] px-2 py-1 rounded ${
                    sourceFilter === opt ? 'bg-primary text-white' : 'bg-surface text-text-secondary'
                  }`}>
                  {opt === 'all' ? 'الكل' : opt === 'role' ? 'من الدور' : 'مباشرة'}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1 max-h-96 overflow-y-auto">
            {filteredCaps.map((cap: any) => (
              <div key={cap.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-surface/50">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">{cap.name}</span>
                  <span className="text-[9px] text-text-secondary">{cap.code}</span>
                </div>
                <div className="flex items-center gap-1">
                  {cap.from_role ? (
                    <span className="text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">من الدور</span>
                  ) : (
                    <button onClick={() => toggleDirectCapability(selectedEmp, cap.id, cap.grant_type)}
                      className="text-[9px] bg-accent/10 text-accent px-1.5 py-0.5 rounded cursor-pointer hover:bg-accent/20">
                      مباشرة
                    </button>
                  )}
                  <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                    cap.grant_type === 'deny' ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'
                  }`}>
                    {cap.grant_type === 'deny' ? 'ممنوع' : 'مسموح'}
                  </span>
                </div>
              </div>
            ))}
            {filteredCaps.length === 0 && (
              <p className="text-center py-4 text-text-secondary text-xs">لا توجد صلاحيات</p>
            )}
          </div>

          {!editMode && (
            <button onClick={() => setEditMode(true)}
              className="mt-3 w-full text-center text-[11px] text-primary font-semibold py-2 border-t border-border/50">
              + إضافة صلاحية مباشرة
            </button>
          )}

          {editMode && (
            <div className="mt-3 border-t border-border pt-3 space-y-2 max-h-80 overflow-y-auto">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold">كل الصلاحيات</span>
                <button onClick={() => setEditMode(false)} className="text-[10px] text-text-secondary">إغلاق</button>
              </div>
              {Object.entries(capabilityGroups).map(([group, caps]) => (
                <div key={group}>
                  <h4 className="text-[10px] font-bold text-text-secondary mb-1">{group}</h4>
                  <div className="grid grid-cols-2 gap-1">
                    {caps.map((cap: any) => {
                      const existing = empCaps.find((ec: any) => ec.id === cap.id && !ec.from_role && ec.grant_type)
                      const hasDirectGrant = !!existing
                      return (
                        <label key={cap.id}
                          className={`flex items-center gap-1.5 py-1 px-1.5 rounded cursor-pointer ${
                            hasDirectGrant ? 'bg-primary/5' : 'hover:bg-surface'
                          }`}>
                          <input type="checkbox" checked={hasDirectGrant}
                            onChange={() => toggleDirectCapability(selectedEmp, cap.id, existing?.grant_type || null)}
                            className="w-3 h-3 accent-primary" />
                          <span className="text-[10px] text-text">{cap.name}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
