import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function UserPermissionsPage() {
  const nav = useNavigate()
  const currentEmpId = useAuthStore((s) => s.user?.employee_id)
  const [loading, setLoading] = useState(true)
  const [employee, setEmployee] = useState<any>(null)
  const [roles, setRoles] = useState<any[]>([])
  const [allCapabilities, setAllCapabilities] = useState<any[]>([])
  const [empCapabilities, setEmpCapabilities] = useState<any[]>([])

  useEffect(() => {
    if (!currentEmpId) { setLoading(false); return }
    const token = getToken()
    if (!token) { setLoading(false); return }
    Promise.all([
      supabase.rpc('get_governed_employees', { p_token: token }),
      supabase.rpc('get_governed_roles', { p_token: token }),
      supabase.rpc('get_all_capabilities', { p_token: token }),
      supabase.rpc('get_employee_capabilities', { p_token: token, p_employee_id: currentEmpId }),
    ]).then(([empRes, roleRes, capsRes, empCapsRes]) => {
      const empList = Array.isArray(empRes.data) ? empRes.data : []
      setEmployee(empList.find((e: any) => e.id === currentEmpId) || null)
      if (roleRes.data) setRoles(Array.isArray(roleRes.data) ? roleRes.data : [])
      if (capsRes.data) setAllCapabilities(Array.isArray(capsRes.data) ? capsRes.data : [])
      if (empCapsRes.data) setEmpCapabilities(Array.isArray(empCapsRes.data) ? empCapsRes.data : [])
      setLoading(false)
    })
  }, [currentEmpId])

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  if (!employee) return <div className="text-center py-12 text-text-secondary text-sm">لا توجد بيانات</div>

  const grouped: Record<string, any[]> = allCapabilities.reduce((acc: Record<string, any[]>, c: any) => {
    const g = c.group || 'أخرى'
    if (!acc[g]) acc[g] = []
    acc[g].push(c)
    return acc
  }, {} as Record<string, any[]>)

  const userGrouped = empCapabilities.reduce((acc: Record<string, any[]>, c: any) => {
    const g = c.group || 'أخرى'
    if (!acc[g]) acc[g] = []
    acc[g].push(c)
    return acc
  }, {} as Record<string, any[]>)

  const directCaps = empCapabilities.filter((c: any) => !c.from_role)
  const roleCaps = empCapabilities.filter((c: any) => c.from_role)

  const userRoles = employee.roles || []

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center gap-3">
        <button onClick={() => nav('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">الصلاحيات</h1>
      </div>

      {/* User Info */}
      <div className="bg-white rounded-xl border border-border p-4">
        <div className="flex items-center justify-between">
          <div>
            <span className="font-bold text-text">{employee.full_name}</span>
            <span className="text-xs text-text-secondary mr-2">{employee.code}</span>
          </div>
        </div>
      </div>

      {/* Roles */}
      <div className="bg-white rounded-xl border border-border p-4">
        <h2 className="text-sm font-bold mb-3">الأدوار ({userRoles.length})</h2>
        {userRoles.length === 0 ? (
          <p className="text-xs text-text-secondary text-center py-3">لا توجد أدوار</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {userRoles.map((r: any) => (
              <span key={r.id} className="bg-primary/10 text-primary text-[11px] px-2.5 py-1 rounded-full font-semibold">{r.name}</span>
            ))}
          </div>
        )}
      </div>

      {/* Capabilities from Roles */}
      {roleCaps.length > 0 && (
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold">الصلاحيات الممنوحة عبر الأدوار</h2>
            <span className="text-[10px] text-text-secondary bg-surface px-2 py-0.5 rounded">{roleCaps.length}</span>
          </div>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {roleCaps.map((c: any) => (
              <div key={c.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-surface/50">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">{c.name}</span>
                  <span className="text-[9px] text-text-secondary">{c.code}</span>
                </div>
                <span className={`text-[9px] px-1.5 py-0.5 rounded ${c.grant_type === 'deny' ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'}`}>
                  {c.grant_type === 'deny' ? 'ممنوع' : 'مسموح'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Direct Capabilities */}
      {directCaps.length > 0 && (
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold">الصلاحيات المباشرة (تجاوز)</h2>
            <span className="text-[10px] text-text-secondary bg-surface px-2 py-0.5 rounded">{directCaps.length}</span>
          </div>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {directCaps.map((c: any) => (
              <div key={c.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-warning/5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">{c.name}</span>
                  <span className="text-[9px] text-text-secondary">{c.code}</span>
                </div>
                <span className={`text-[9px] px-1.5 py-0.5 rounded ${c.grant_type === 'deny' ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'}`}>
                  {c.grant_type === 'deny' ? 'ممنوع' : 'مسموح'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All Capabilities Summary by Group */}
      <div className="bg-white rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold">جميع الصلاحيات المتاحة</h2>
          <span className="text-[10px] text-text-secondary bg-surface px-2 py-0.5 rounded">{allCapabilities.length}</span>
        </div>
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {(Object.entries(grouped) as [string, any[]][]).map(([group, caps]) => {
            const userCaps: any[] = userGrouped[group] || []
            return (
              <div key={group}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[11px] font-bold text-text bg-surface px-2 py-0.5 rounded">{group}</span>
                  <span className="text-[9px] text-text-secondary">{userCaps.filter((c: any) => c.grant_type === 'grant').length}/{caps.length}</span>
                </div>
                <div className="grid grid-cols-1 gap-0.5">
                  {caps.map((c: any) => {
                    const granted = empCapabilities.find((ec: any) => ec.id === c.id && ec.grant_type === 'grant')
                    const denied = empCapabilities.find((ec: any) => ec.id === c.id && ec.grant_type === 'deny')
                    return (
                      <div key={c.id} className="flex items-center justify-between py-1 px-2 rounded hover:bg-surface/50">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${granted ? 'bg-success' : denied ? 'bg-danger' : 'bg-gray-300'}`} />
                          <span className="text-[11px] text-text">{c.name}</span>
                          <span className="text-[8px] text-text-secondary">{c.code}</span>
                        </div>
                        <span className="text-[8px] text-text-secondary">
                          {granted ? 'مسموح' : denied ? 'ممنوع' : '—'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
