import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface TreeNode {
  id: string
  full_name: string
  code: string
  email: string
  phone: string
  manager_id: string | null
  is_active: boolean
  address: string | null
  role_names: string
  roles: { id: string; name: string }[]
  children: TreeNode[]
  _depth: number
}

export function HierarchyPage({ embedded }: { embedded?: boolean }) {
  const navigate = useNavigate()
  const [employees, setEmployees] = useState<any[]>([])
  const [roles, setRoles] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editAddress, setEditAddress] = useState('')
  const [addingUnder, setAddingUnder] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newAddress, setNewAddress] = useState('')
  const [newRoleId, setNewRoleId] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [showManagerPicker, setShowManagerPicker] = useState<string | null>(null)
  const [showRolePicker, setShowRolePicker] = useState<string | null>(null)
  const [showResetPw, setShowResetPw] = useState<string | null>(null)
  const [resetPwValue, setResetPwValue] = useState('')

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    Promise.all([
      supabase.rpc('get_governed_employees', { p_token: token }),
      supabase.rpc('get_governed_roles', { p_token: token }),
    ]).then(([empRes, roleRes]) => {
      if (empRes.data) setEmployees(Array.isArray(empRes.data) ? empRes.data : [])
      if (roleRes.data) setRoles(Array.isArray(roleRes.data) ? roleRes.data : [])
      setLoading(false)
    })
  }, [])

  const tree = useMemo(() => {
    const map = new Map(employees.map((e: any) => [e.id, { ...e, children: [] as TreeNode[] }]))
    const roots: TreeNode[] = []
    for (const emp of map.values()) {
      if (emp.manager_id && map.has(emp.manager_id)) {
        map.get(emp.manager_id)!.children.push(emp)
      } else {
        roots.push(emp)
      }
    }
    function assignDepth(nodes: TreeNode[], depth: number) {
      for (const n of nodes) { n._depth = depth; assignDepth(n.children, depth + 1) }
    }
    assignDepth(roots, 0)
    return roots
  }, [employees])

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  useEffect(() => {
    if (tree.length > 0 && expanded.size === 0) {
      const all = new Set<string>()
      const collect = (nodes: TreeNode[]) => { for (const n of nodes) { all.add(n.id); collect(n.children) } }
      collect(tree)
      setExpanded(all)
    }
  }, [tree])

  async function handleEdit(emp: any) {
    const token = getToken()
    const { data, error } = await supabase.rpc('governed_update_employee', {
      p_token: token, p_id: emp.id,
      p_full_name: editName || null,
      p_email: editEmail || null,
      p_phone: editPhone || null,
      p_address: editAddress || null,
    })
    if (error) { toast.error(error.message); return }
    const result = data as any
    if (result.error) { toast.error(result.error); return }
    toast.success('تم التحديث')
    setEditingId(null)
    refresh()
  }

  async function handleAdd(parentId: string) {
    if (!newName || !newPhone) { toast.error('الاسم ورقم الهاتف مطلوبان'); return }
    setSubmitting(true)
    const token = getToken()
    const { data, error } = await supabase.rpc('governed_create_employee', {
      p_token: token,
      p_full_name: newName,
      p_phone: newPhone,
      p_password: newPassword || null,
      p_email: newEmail || null,
      p_role_id: newRoleId || null,
      p_manager_id: parentId,
      p_address: newAddress || null,
    })
    if (error) { toast.error(error.message); setSubmitting(false); return }
    const result = data as any
    if (result.error) { toast.error(result.error); setSubmitting(false); return }
    toast.success(`تم إضافة ${result.full_name}`)
    setAddingUnder(null); setNewName(''); setNewPhone(''); setNewPassword(''); setNewEmail(''); setNewAddress(''); setNewRoleId('')
    setSubmitting(false)
    refresh()
  }

  async function handleToggleActive(emp: any) {
    const token = getToken()
    const fn = emp.is_active ? 'governed_deactivate_employee' : 'governed_activate_employee'
    const { data, error } = await supabase.rpc(fn, { p_token: token, p_id: emp.id })
    if (error) { toast.error(error.message); return }
    const result = data as any
    if (result.error) { toast.error(result.error); return }
    toast.success(emp.is_active ? 'تم الإيقاف' : 'تم التفعيل')
    refresh()
  }

  async function handleChangeManager(empId: string, managerId: string) {
    const token = getToken()
    const { data, error } = await supabase.rpc('governed_change_employee_manager', {
      p_token: token, p_id: empId, p_manager_id: managerId,
    })
    if (error) { toast.error(error.message); return }
    const result = data as any
    if (result.error) { toast.error(result.error); return }
    toast.success('تم تغيير المدير')
    setShowManagerPicker(null)
    refresh()
  }

  async function handleChangeRole(empId: string, roleId: string) {
    const token = getToken()
    const { data, error } = await supabase.rpc('governed_change_employee_role', {
      p_token: token, p_id: empId, p_role_id: roleId,
    })
    if (error) { toast.error(error.message); return }
    const result = data as any
    if (result.error) { toast.error(result.error); return }
    toast.success('تم تغيير الصلاحية')
    setShowRolePicker(null)
    refresh()
  }

  async function handleResetPassword(empId: string) {
    const token = getToken()
    const pw = resetPwValue || '123456'
    const { data, error } = await supabase.rpc('governed_reset_employee_password', {
      p_token: token, p_id: empId, p_new_password: pw,
    })
    if (error) { toast.error(error.message); return }
    const result = data as any
    if (result.error) { toast.error(result.error); return }
    toast.success(`تم إعادة تعيين كلمة المرور إلى ${pw}`)
    setShowResetPw(null)
    setResetPwValue('')
  }

  async function refresh() {
    const token = getToken()
    const empRes = await supabase.rpc('get_governed_employees', { p_token: token })
    if (empRes.data) setEmployees(Array.isArray(empRes.data) ? empRes.data : [])
  }

  function renderNode(node: TreeNode): React.ReactNode {
    const isExpanded = expanded.has(node.id)
    const hasChildren = node.children.length > 0

    return (
      <div key={node.id}>
        <div
          className="flex items-center gap-2 py-2 px-2 rounded-lg hover:bg-surface transition-colors group"
          style={{ paddingRight: `${12 + node._depth * 20}px` }}
        >
          {hasChildren ? (
            <button onClick={() => toggleExpand(node.id)} className="text-text-secondary shrink-0 w-4 text-center text-xs">
              {isExpanded ? '−' : '+'}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}

          <div className={`w-2 h-2 rounded-full shrink-0 ${node.is_active ? 'bg-success' : 'bg-danger'}`} />

          <span className="text-xs font-semibold text-text whitespace-nowrap">{node.full_name}</span>
          <span className="text-[10px] text-text-secondary shrink-0">{node.code}</span>
          {node.role_names && (
            <span className="text-[10px] text-primary shrink-0 hidden sm:inline">{node.role_names}</span>
          )}

          <div className="mr-auto flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <button onClick={() => { setEditingId(node.id); setEditName(node.full_name); setEditEmail(node.email || ''); setEditPhone(node.phone || ''); setEditAddress(node.address || '') }}
              className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">تعديل</button>
            <button onClick={() => { setAddingUnder(node.id); setNewName(''); setNewPhone(''); setNewPassword(''); setNewEmail(''); setNewAddress(''); setNewRoleId('') }}
              className="text-[10px] bg-success/10 text-success px-1.5 py-0.5 rounded">إضافة تابع</button>
            <button onClick={() => handleToggleActive(node)}
              className={`text-[10px] px-1.5 py-0.5 rounded ${node.is_active ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'}`}>
              {node.is_active ? 'إيقاف' : 'تفعيل'}
            </button>
            <button onClick={() => setShowManagerPicker(node.id)}
              className="text-[10px] bg-accent/10 text-accent px-1.5 py-0.5 rounded">نقل</button>
            <button onClick={() => setShowRolePicker(node.id)}
              className="text-[10px] bg-surface text-text-secondary px-1.5 py-0.5 rounded">صلاحية</button>
            <button onClick={() => setShowResetPw(node.id)}
              className="text-[10px] bg-surface text-text-secondary px-1.5 py-0.5 rounded">كلمة السر</button>
          </div>
        </div>

        {/* Edit form */}
        {editingId === node.id && (
          <div className="mr-9 mb-2 border border-border rounded-lg p-2 space-y-1.5 bg-surface" style={{ marginRight: `${12 + node._depth * 20 + 36}px` }}>
            <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="الاسم"
              className="w-full border border-border rounded px-2 py-1 text-xs bg-white" />
            <input type="text" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="البريد الإلكتروني"
              className="w-full border border-border rounded px-2 py-1 text-xs bg-white" dir="ltr" />
            <input type="text" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="رقم الهاتف"
              className="w-full border border-border rounded px-2 py-1 text-xs bg-white" dir="ltr" />
            <textarea value={editAddress} onChange={(e) => setEditAddress(e.target.value)} placeholder="العنوان"
              className="w-full border border-border rounded px-2 py-1 text-xs bg-white resize-none" rows={2} />
            <div className="flex gap-2">
              <button onClick={() => handleEdit(node)} className="flex-1 bg-primary text-white text-xs py-1 rounded">حفظ</button>
              <button onClick={() => setEditingId(null)} className="px-3 border border-border rounded text-xs">إلغاء</button>
            </div>
          </div>
        )}

        {/* Add subordinate form */}
        {addingUnder === node.id && (
          <div className="mr-9 mb-2 border border-primary/30 rounded-lg p-2 space-y-1.5 bg-primary/5" style={{ marginRight: `${12 + node._depth * 20 + 36}px` }}>
            <p className="text-[10px] font-semibold text-primary">إضافة تابع لـ {node.full_name}</p>
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="الاسم *"
              className="w-full border border-border rounded px-2 py-1 text-xs bg-white" />
            <input type="text" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="رقم الهاتف *"
              className="w-full border border-border rounded px-2 py-1 text-xs bg-white" dir="ltr" />
            <input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="كلمة المرور"
              className="w-full border border-border rounded px-2 py-1 text-xs bg-white" dir="ltr" />
            <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="البريد الإلكتروني"
              className="w-full border border-border rounded px-2 py-1 text-xs bg-white" dir="ltr" />
            <textarea value={newAddress} onChange={(e) => setNewAddress(e.target.value)} placeholder="العنوان"
              className="w-full border border-border rounded px-2 py-1 text-xs bg-white resize-none" rows={2} />
            <select value={newRoleId} onChange={(e) => setNewRoleId(e.target.value)}
              className="w-full border border-border rounded px-2 py-1 text-xs bg-white">
              <option value="">اختر الصلاحية</option>
              {roles.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <div className="flex gap-2">
              <button onClick={() => handleAdd(node.id)} disabled={submitting}
                className="flex-1 bg-primary text-white text-xs py-1 rounded">
                {submitting ? 'جاري...' : 'إضافة'}
              </button>
              <button onClick={() => setAddingUnder(null)} className="px-3 border border-border rounded text-xs">إلغاء</button>
            </div>
          </div>
        )}

        {/* Manager picker */}
        {showManagerPicker === node.id && (
          <div className="mr-9 mb-2 border border-border rounded-lg p-2 bg-surface" style={{ marginRight: `${12 + node._depth * 20 + 36}px` }}>
            <select onChange={(e) => { if (e.target.value) handleChangeManager(node.id, e.target.value) }}
              className="w-full border border-border rounded px-2 py-1 text-xs bg-white">
              <option value="">نقل {node.full_name} إلى...</option>
              {employees.filter((e: any) => e.id !== node.id && e.is_active).map((e: any) => (
                <option key={e.id} value={e.id}>{e.full_name} ({e.code})</option>
              ))}
            </select>
            <button onClick={() => setShowManagerPicker(null)} className="text-xs text-text-secondary mt-1">إلغاء</button>
          </div>
        )}

        {/* Role picker */}
        {showRolePicker === node.id && (
          <div className="mr-9 mb-2 border border-border rounded-lg p-2 bg-surface" style={{ marginRight: `${12 + node._depth * 20 + 36}px` }}>
            <select onChange={(e) => { if (e.target.value) handleChangeRole(node.id, e.target.value) }}
              className="w-full border border-border rounded px-2 py-1 text-xs bg-white">
              <option value="">اختر الصلاحية الجديدة</option>
              {roles.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <button onClick={() => setShowRolePicker(null)} className="text-xs text-text-secondary mt-1">إلغاء</button>
          </div>
        )}

        {/* Reset password confirmation */}
        {showResetPw === node.id && (
          <div className="mr-9 mb-2 border border-border rounded-lg p-2 bg-surface" style={{ marginRight: `${12 + node._depth * 20 + 36}px` }}>
            <p className="text-xs text-text-secondary mb-1">كلمة المرور الجديدة لـ {node.full_name}</p>
            <input type="text" value={resetPwValue} onChange={(e) => setResetPwValue(e.target.value)}
              placeholder="اترك فارغاً لاستخدام 123456" dir="ltr"
              className="w-full border border-border rounded-lg px-3 py-1.5 text-xs mb-2" />
            <div className="flex gap-2">
              <button onClick={() => handleResetPassword(node.id)} className="flex-1 bg-accent text-white text-xs py-1 rounded">تأكيد</button>
              <button onClick={() => { setShowResetPw(null); setResetPwValue('') }} className="px-3 border border-border rounded text-xs">إلغاء</button>
            </div>
          </div>
        )}

        {isExpanded && hasChildren && (
          <div>{node.children.map((child) => renderNode(child))}</div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {!embedded && (
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
          <h1 className="text-lg font-bold text-text">الهيكل البيعي</h1>
          <span className="text-[11px] text-text-secondary">({employees.length} موظف)</span>
          <button onClick={() => navigate('/employees')} className="mr-auto bg-surface border border-border text-text text-xs px-3 py-1.5 rounded-lg font-semibold">
            عرض الموظفين
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : tree.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">لا يوجد هيكل بيعي</div>
      ) : (
        <div className="bg-white rounded-xl border border-border p-3">
          <div className="space-y-0.5">
            {tree.map((root) => renderNode(root))}
          </div>
        </div>
      )}
    </div>
  )
}
