import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { sectorsService } from '../../services/sectors'
import { SearchableSelect } from '../../components/shared/SearchableSelect'
import { useCapability } from '../../hooks/useCapability'
import toast from 'react-hot-toast'
import type { EmployeeGeographicAssignment, Sector } from '../../types/sectors'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface Employee {
  id: string
  full_name: string
  code: string
  phone: string
  role_names: string
  is_active: boolean
}

const SALES_MANAGER_ROLES = ['مدير البيع', 'مدير مبيعات', 'مدير المبيعات']

function isSalesManager(emp: Employee): boolean {
  if (!emp.role_names) return false
  const roles = emp.role_names
  return SALES_MANAGER_ROLES.some(r => roles.includes(r))
}

export function ManagerDistributionScreen() {
  const canManage = useCapability('sectors.manage')
  const [loading, setLoading] = useState(true)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [sectors, setSectors] = useState<Sector[]>([])
  const [assignments, setAssignments] = useState<Record<string, EmployeeGeographicAssignment[]>>({})
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [selectedSectorId, setSelectedSectorId] = useState('')
  const [assigning, setAssigning] = useState(false)

  async function loadData() {
    setLoading(true)
    try {
      const token = getToken()
      if (!token) { toast.error('لا توجد جلسة'); return }
      const [empRes, sectorsData] = await Promise.all([
        supabase.rpc('get_governed_employees', { p_token: token }),
        sectorsService.getSectors(),
      ])
      if (Array.isArray(empRes.data)) {
        const allEmps = empRes.data as Array<{
          id: string; full_name: string; code: string; phone?: string;
          role_names?: string; is_active?: boolean
        }>
        const managers = (allEmps
          .filter(e => e.is_active !== false)
          .map(e => ({ ...e, role_names: e.role_names || '', phone: e.phone || '' })) as Employee[])
          .filter(isSalesManager)
        setEmployees(managers)
        const map: Record<string, EmployeeGeographicAssignment[]> = {}
        for (const m of managers) {
          try {
            const data = await sectorsService.getEmployeeAssignments(m.id)
            map[m.id] = Array.isArray(data) ? data.filter(a => a.assignment_type === 'sector') : []
          } catch { map[m.id] = [] }
        }
        setAssignments(map)
      }
      setSectors(sectorsData)
    } catch (e: any) {
      toast.error(e?.message || 'فشل تحميل البيانات')
    }
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  const filtered = useMemo(() => {
    if (!search) return employees
    const q = search.toLowerCase()
    return employees.filter(e =>
      e.full_name.toLowerCase().includes(q) || e.code.toLowerCase().includes(q)
    )
  }, [employees, search])

  const sectorItems = useMemo(() =>
    sectors.map(s => ({ id: s.id, name: s.name_ar || s.name })),
    [sectors]
  )

  async function handleAssign(empId: string) {
    if (!selectedSectorId) { toast.error('اختر قطاعاً'); return }
    setAssigning(true)
    try {
      await sectorsService.assignEmployeeGeographic({
        employee_id: empId, assignment_type: 'sector', sector_id: selectedSectorId,
      })
      toast.success('تم التعيين')
      setSelectedSectorId('')
      const data = await sectorsService.getEmployeeAssignments(empId)
      setAssignments(prev => ({
        ...prev,
        [empId]: Array.isArray(data) ? data.filter(a => a.assignment_type === 'sector') : [],
      }))
    } catch (e: any) {
      toast.error(e?.message || 'فشل التعيين')
    }
    setAssigning(false)
  }

  async function handleRemove(empId: string, assignmentId: string) {
    try {
      await sectorsService.removeEmployeeGeographic(assignmentId)
      toast.success('تم الإزالة')
      const data = await sectorsService.getEmployeeAssignments(empId)
      setAssignments(prev => ({
        ...prev,
        [empId]: Array.isArray(data) ? data.filter(a => a.assignment_type === 'sector') : [],
      }))
    } catch (e: any) {
      toast.error(e?.message || 'فشل الإزالة')
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-text">توزيع مديري البيع</h1>

      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="بحث بالاسم أو الكود..."
        className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white"
      />

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">لا يوجد مديري بيع</div>
      ) : (
        <div className="space-y-2">
          {filtered.map(emp => (
            <div key={emp.id} className="bg-white rounded-xl border border-border p-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-bold text-text">{emp.full_name}</div>
                  <div className="text-[11px] text-text-secondary">{emp.code} {emp.phone ? `• ${emp.phone}` : ''}</div>
                </div>
              </div>

              {assignments[emp.id] && assignments[emp.id].length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {assignments[emp.id].map(a => (
                    <span key={a.id} className="inline-flex items-center gap-1 text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded">
                      {a.sector_name}
                      {canManage && (
                        <button onClick={() => handleRemove(emp.id, a.id)} className="hover:text-danger">&times;</button>
                      )}
                    </span>
                  ))}
                </div>
              )}

              {canManage && (
                <div className="mt-2">
                  {expandedId === emp.id ? (
                    <div className="space-y-2 bg-surface rounded-lg p-2">
                      <SearchableSelect
                        items={sectorItems}
                        value={selectedSectorId}
                        onChange={setSelectedSectorId}
                        placeholder="اختر القطاع"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleAssign(emp.id)}
                          disabled={assigning || !selectedSectorId}
                          className="bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50"
                        >
                          {assigning ? 'جاري...' : 'تأكيد'}
                        </button>
                        <button
                          onClick={() => { setExpandedId(null); setSelectedSectorId('') }}
                          className="px-3 border border-border rounded-lg text-xs text-text-secondary"
                        >
                          إلغاء
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setExpandedId(emp.id)}
                      className="bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold"
                    >
                      إضافة تعيين
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
