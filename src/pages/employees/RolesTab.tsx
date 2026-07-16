import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const ROLE_TEMPLATES: Record<string, string[]> = {
  'مدير البيع': ['orders.create', 'orders.read', 'orders.update', 'orders.approve', 'customers.create', 'customers.read', 'customers.update', 'collections.create', 'collections.read', 'collections.update', 'returns.create', 'returns.read', 'returns.approve', 'visits.create', 'visits.read', 'visits.update', 'products.read', 'employees.read', 'reports.read', 'attendance.live_monitor', 'attendance.view_timeline', 'attendance.view_history', 'attendance.view_reports', 'attendance.view_alerts', 'attendance.view_team_map'],
  'سوبر فايزر': ['orders.create', 'orders.read', 'orders.update', 'customers.create', 'customers.read', 'customers.update', 'collections.create', 'collections.read', 'visits.create', 'visits.read', 'products.read', 'employees.read', 'attendance.live_monitor', 'attendance.view_alerts'],
}

export function RolesTab() {
  const [roles, setRoles] = useState<any[]>([])
  const [employees, setEmployees] = useState<any[]>([])
  const [capabilities, setCapabilities] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newTemplate, setNewTemplate] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [showDelete, setShowDelete] = useState<string | null>(null)
  const [expandedRole, setExpandedRole] = useState<string | null>(null)
  const [roleCaps, setRoleCaps] = useState<any[]>([])
  const [editCapIds, setEditCapIds] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)

  async function load() {
    const token = getToken()
    if (!token) return
    const [rRes, eRes, cRes] = await Promise.all([
      supabase.rpc('get_governed_roles', { p_token: token }),
      supabase.rpc('get_governed_employees', { p_token: token }),
      supabase.rpc('get_all_capabilities', { p_token: token }),
    ])
    if (rRes.data) setRoles(Array.isArray(rRes.data) ? rRes.data : [])
    if (eRes.data) setEmployees(Array.isArray(eRes.data) ? eRes.data : [])
    if (cRes.data) setCapabilities(Array.isArray(cRes.data) ? cRes.data : [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function employeeCount(roleId: string): number {
    return employees.filter((e: any) => {
      if (!e.role_names) return false
      return e.role_names.split(', ').includes(roles.find((r: any) => r.id === roleId)?.name)
    }).length
  }

  async function handleCreate() {
    if (!newName.trim()) { toast.error('اسم الدور مطلوب'); return }
    setSubmitting(true)
    const token = getToken()
    const { data, error } = await supabase.rpc('governed_create_role', {
      p_token: token,
      p_name: newName.trim(),
      p_description: newDesc.trim() || null,
    })
    if (error) { toast.error(error.message); setSubmitting(false); return }
    const result = data as any
    if (result?.error) { toast.error(result.error); setSubmitting(false); return }
    const roleId = result?.id || result?.role_id
    if (roleId && newTemplate && ROLE_TEMPLATES[newTemplate]) {
      const templateCaps = ROLE_TEMPLATES[newTemplate]
      const capIds = capabilities.filter((c: any) => templateCaps.includes(c.code)).map((c: any) => c.id)
      if (capIds.length > 0) {
        await supabase.rpc('governed_update_role_capabilities', {
          p_token: token,
          p_role_id: roleId,
          p_capability_ids: capIds,
        })
      }
    }
    toast.success('تم إنشاء الدور')
    setShowCreate(false); setNewName(''); setNewDesc(''); setNewTemplate('')
    setSubmitting(false)
    load()
  }

  async function handleUpdate() {
    if (!editingId || !editName.trim()) return
    setSubmitting(true)
    const token = getToken()
    const { error } = await supabase.rpc('governed_update_role', {
      p_token: token,
      p_role_id: editingId,
      p_name: editName.trim(),
      p_description: editDesc.trim() || null,
    })
    if (error) { toast.error(error.message); setSubmitting(false); return }
    toast.success('تم تحديث الدور')
    setEditingId(null)
    setSubmitting(false)
    load()
  }

  async function handleDelete(roleId: string) {
    setSubmitting(true)
    const token = getToken()
    const { data, error } = await supabase.rpc('governed_delete_role', {
      p_token: token,
      p_role_id: roleId,
    })
    if (error) { toast.error(error.message); setSubmitting(false); return }
    const result = data as any
    if (result?.error) { toast.error(result.error); setSubmitting(false); return }
    toast.success('تم حذف الدور')
    setShowDelete(null)
    setSubmitting(false)
    load()
  }

  async function toggleExpand(roleId: string) {
    if (expandedRole === roleId) {
      setExpandedRole(null)
      return
    }
    const token = getToken()
    const { data } = await supabase.rpc('get_role_capabilities', {
      p_token: token,
      p_role_id: roleId,
    })
    const caps = Array.isArray(data) ? data : []
    setRoleCaps(caps)
    setEditCapIds(new Set(caps.filter((c: any) => c.is_granted).map((c: any) => c.capability_id)))
    setExpandedRole(roleId)
  }

  async function saveCapabilities(roleId: string) {
    setSubmitting(true)
    const token = getToken()
    const { error } = await supabase.rpc('governed_update_role_capabilities', {
      p_token: token,
      p_role_id: roleId,
      p_capability_ids: Array.from(editCapIds),
    })
    if (error) { toast.error(error.message); setSubmitting(false); return }
    toast.success('تم تحديث صلاحيات الدور')
    setExpandedRole(null)
    setSubmitting(false)
  }

  const roleGroups = [
    { label: 'أدوار النظام', filter: (r: any) => ['الإدارة العليا'].includes(r.name) },
    { label: 'أدوار الإدارة', filter: (r: any) => ['مدير البيع', 'مشرف تنفيذي', 'سوبر فايزر'].includes(r.name) },
    { label: 'أدوار البيع', filter: (r: any) => ['مندوب مبيعات'].includes(r.name) },
    { label: 'أدوار أخرى', filter: (r: any) => !['الإدارة العليا', 'مدير البيع', 'مشرف تنفيذي', 'سوبر فايزر', 'مندوب مبيعات'].includes(r.name) },
  ]

  if (loading) return <div className="text-center py-8 text-text-secondary text-sm">جاري التحميل...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-secondary">{roles.length} دور</p>
        <button onClick={() => setShowCreate(true)}
          className="bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold">+ دور جديد</button>
      </div>

      {showCreate && (
        <div className="bg-white rounded-xl border border-border p-4 space-y-3">
          <h3 className="text-sm font-bold">دور جديد</h3>
          <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
            placeholder="اسم الدور *" className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white" />
          <input type="text" value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
            placeholder="وصف الدور" className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white" />
          <select value={newTemplate} onChange={(e) => setNewTemplate(e.target.value)}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white">
            <option value="">بدون قالب صلاحيات</option>
            {Object.entries(ROLE_TEMPLATES).map(([name]) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={submitting}
              className="flex-1 bg-primary text-white text-xs py-2 rounded-lg font-semibold">
              {submitting ? 'جاري...' : 'إنشاء'}
            </button>
            <button onClick={() => setShowCreate(false)}
              className="px-4 border border-border rounded-lg text-xs text-text-secondary">إلغاء</button>
          </div>
        </div>
      )}

      {roleGroups.map((group) => {
        const groupRoles = roles.filter(group.filter)
        if (groupRoles.length === 0) return null
        return (
          <div key={group.label}>
            <h3 className="text-xs font-bold text-text-secondary mb-2">{group.label}</h3>
            <div className="space-y-2">
              {groupRoles.map((role: any) => {
                const empCount = employeeCount(role.id)
                const isSystem = ['الإدارة العليا'].includes(role.name)
                return (
                  <div key={role.id} className="bg-white rounded-xl border border-border overflow-hidden">
                    <div className="p-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-text">{role.name}</span>
                            {isSystem && <span className="text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">نظام</span>}
                          </div>
                          {role.description && <p className="text-[10px] text-text-secondary mt-0.5">{role.description}</p>}
                          <div className="flex gap-3 mt-1">
                            <span className="text-[10px] text-text-secondary">{empCount} موظف</span>
                            <span className="text-[10px] text-text-secondary">منذ {new Date(role.created_at).toLocaleDateString('ar-EG')}</span>
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <button onClick={() => toggleExpand(role.id)}
                            className="text-[10px] bg-primary/10 text-primary px-2 py-1 rounded">الصلاحيات</button>
                          {!isSystem && (
                            <>
                              <button onClick={() => { setEditingId(role.id); setEditName(role.name); setEditDesc(role.description || '') }}
                                className="text-[10px] bg-surface text-text-secondary px-2 py-1 rounded">تعديل</button>
                              <button onClick={() => setShowDelete(role.id)}
                                className="text-[10px] bg-danger/10 text-danger px-2 py-1 rounded">حذف</button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {expandedRole === role.id && (
                      <div className="border-t border-border p-3 bg-surface/30 max-h-80 overflow-y-auto">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-bold">صلاحيات الدور</span>
                          <button onClick={() => saveCapabilities(role.id)} disabled={submitting}
                            className="text-[10px] bg-primary text-white px-3 py-1 rounded font-semibold">
                            {submitting ? 'جاري...' : 'حفظ'}
                          </button>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                          {capabilities.map((cap: any) => {
                            const isGranted = editCapIds.has(cap.id) || (!expandedRole) // show all as editable
                            return (
                              <label key={cap.id} className="flex items-center gap-1.5 py-1 px-1.5 rounded hover:bg-white cursor-pointer">
                                <input type="checkbox" checked={isGranted}
                                  onChange={() => {
                                    setEditCapIds(prev => {
                                      const next = new Set(prev)
                                      if (next.has(cap.id)) next.delete(cap.id)
                                      else next.add(cap.id)
                                      return next
                                    })
                                  }}
                                  className="w-3 h-3 accent-primary" />
                                <span className="text-[10px] text-text">{cap.name}</span>
                                <span className="text-[8px] text-text-secondary">{cap.code}</span>
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {editingId === role.id && (
                      <div className="border-t border-border p-3 space-y-2">
                        <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                          placeholder="اسم الدور" className="w-full border border-border rounded-lg px-3 py-1.5 text-xs bg-white" />
                        <input type="text" value={editDesc} onChange={(e) => setEditDesc(e.target.value)}
                          placeholder="وصف الدور" className="w-full border border-border rounded-lg px-3 py-1.5 text-xs bg-white" />
                        <div className="flex gap-2">
                          <button onClick={handleUpdate} disabled={submitting}
                            className="flex-1 bg-primary text-white text-xs py-1.5 rounded-lg">حفظ</button>
                          <button onClick={() => setEditingId(null)}
                            className="px-4 border border-border rounded-lg text-xs text-text-secondary">إلغاء</button>
                        </div>
                      </div>
                    )}

                    {showDelete === role.id && (
                      <div className="border-t border-border p-3 bg-danger/5">
                        <p className="text-xs text-danger font-semibold mb-2">
                          {empCount > 0
                            ? `لا يمكن حذف هذا الدور، يوجد ${empCount} موظف يستخدمونه`
                            : 'هل أنت متأكد من حذف هذا الدور؟'}
                        </p>
                        {empCount === 0 && (
                          <div className="flex gap-2">
                            <button onClick={() => handleDelete(role.id)} disabled={submitting}
                              className="flex-1 bg-danger text-white text-xs py-1.5 rounded-lg">تأكيد الحذف</button>
                            <button onClick={() => setShowDelete(null)}
                              className="px-4 border border-border rounded-lg text-xs text-text-secondary">إلغاء</button>
                          </div>
                        )}
                        {empCount > 0 && (
                          <button onClick={() => setShowDelete(null)}
                            className="text-xs text-text-secondary">إلغاء</button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
