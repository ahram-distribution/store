import { useState, useEffect, useMemo } from 'react'
import { sectorsService } from '../../services/sectors'
import { SearchableSelect } from '../../components/shared/SearchableSelect'
import { useCapability } from '../../hooks/useCapability'
import { supabase } from '../../lib/supabase'
import toast from 'react-hot-toast'
import type { EmployeeGeographicAssignment, SectorGovernorate } from '../../types/sectors'

interface Employee {
  id: string
  full_name: string
  phone: string | null
  code: string | null
  role_names: string | null
}

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function RepDistributionScreen() {
  const canManage = useCapability('sectors.manage')

  const [employees, setEmployees] = useState<Employee[]>([])
  const [governorates, setGovernorates] = useState<{ id: string; name_ar: string }[]>([])
  const [sectors, setSectors] = useState<SectorGovernorate[]>([])
  const [assignments, setAssignments] = useState<Record<string, EmployeeGeographicAssignment[]>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [assigningId, setAssigningId] = useState<string | null>(null)
  const [selectedGovId, setSelectedGovId] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const SALES_REP_ROLE = 'مندوب مبيعات'

  async function loadData() {
    setLoading(true)
    try {
      const token = getToken()
      if (!token) throw new Error('NO_SESSION')

      const [empResult, govResult, sectorsData] = await Promise.all([
        supabase.rpc('get_governed_employees', { p_token: token }),
        supabase.from('reference_governorates').select('id, name_ar').order('name_ar'),
        sectorsService.getSectors(),
      ])

      if (empResult.data) setEmployees(empResult.data as Employee[])
      if (govResult.data) setGovernorates(govResult.data as { id: string; name_ar: string }[])
      setSectors(sectorsData)

      const reps = ((empResult.data || []) as Employee[]).filter(
        emp => emp.role_names && emp.role_names.includes(SALES_REP_ROLE)
      )

      const assignmentMap: Record<string, EmployeeGeographicAssignment[]> = {}
      await Promise.all(
        reps.map(async emp => {
          try {
            const a = await sectorsService.getEmployeeAssignments(emp.id)
            assignmentMap[emp.id] = Array.isArray(a) ? a : []
          } catch {
            assignmentMap[emp.id] = []
          }
        })
      )
      setAssignments(assignmentMap)
    } catch (e: any) {
      toast.error(e?.message || 'فشل تحميل البيانات')
    }
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  const salesReps = useMemo(() => {
    const filtered = employees.filter(emp => emp.role_names && emp.role_names.includes(SALES_REP_ROLE))
    if (!search.trim()) return filtered
    const q = search.trim().toLowerCase()
    return filtered.filter(emp =>
      emp.full_name.toLowerCase().includes(q) ||
      (emp.code || '').toLowerCase().includes(q) ||
      (emp.phone || '').includes(q)
    )
  }, [employees, search])

  const govNameById = useMemo(() => {
    const map = new Map<string, string>()
    governorates.forEach(g => map.set(g.id, g.name_ar))
    return map
  }, [governorates])

  const sectorByGovId = useMemo(() => {
    const map = new Map<string, string>()
    sectors.forEach(s => map.set(s.governorate_id, s.sector_name))
    return map
  }, [sectors])

  const govOptions = useMemo(
    () => governorates.map(g => ({ id: g.id, name: g.name_ar })),
    [governorates]
  )

  async function handleAssign(empId: string) {
    if (!selectedGovId) { toast.error('اختر محافظة'); return }
    setSubmitting(true)
    try {
      await sectorsService.assignEmployeeGeographic({
        employee_id: empId,
        assignment_type: 'governorate',
        governorate_id: selectedGovId,
      })
      toast.success('تمت الإضافة')
      setAssigningId(null)
      setSelectedGovId('')
      const a = await sectorsService.getEmployeeAssignments(empId)
      setAssignments(prev => ({ ...prev, [empId]: Array.isArray(a) ? a : [] }))
    } catch (e: any) {
      toast.error(e?.message || 'فشل التعيين')
    }
    setSubmitting(false)
  }

  async function handleRemove(empId: string, assignmentId: string) {
    try {
      await sectorsService.removeEmployeeGeographic(assignmentId)
      toast.success('تمت الإزالة')
      setAssignments(prev => ({
        ...prev,
        [empId]: (prev[empId] || []).filter(a => a.id !== assignmentId),
      }))
    } catch (e: any) {
      toast.error(e?.message || 'فشل الإزالة')
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-text">توزيع المناديب</h1>

      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="بحث بالاسم أو الكود أو الهاتف..."
        className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white"
      />

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : salesReps.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">لا يوجد مناديب مبيعات</div>
      ) : (
        <div className="space-y-3">
          {salesReps.map(emp => {
            const empAssignments = assignments[emp.id] || []
            const govAssignments = empAssignments.filter(a => a.assignment_type === 'governorate')

            return (
              <div key={emp.id} className="bg-white rounded-xl border border-border p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm font-bold text-text">{emp.full_name}</div>
                    <div className="text-[11px] text-text-secondary mt-0.5">
                      {emp.phone && <span>{emp.phone}</span>}
                      {emp.phone && emp.code && <span> · </span>}
                      {emp.code && <span>#{emp.code}</span>}
                    </div>
                  </div>
                </div>

                {govAssignments.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {govAssignments.map(a => (
                      <span key={a.id} className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded flex items-center gap-1">
                        {a.governorate_name}
                        {sectorByGovId.get(a.governorate_id || '') && (
                          <span className="text-[9px] text-text-secondary">({sectorByGovId.get(a.governorate_id || '')})</span>
                        )}
                        {canManage && (
                          <button onClick={() => handleRemove(emp.id, a.id)} className="text-danger font-bold leading-none">&times;</button>
                        )}
                      </span>
                    ))}
                  </div>
                )}

                {canManage && (
                  <>
                    {assigningId === emp.id ? (
                      <div className="mt-3 space-y-2">
                        <SearchableSelect
                          items={govOptions}
                          value={selectedGovId}
                          onChange={setSelectedGovId}
                          placeholder="اختر المحافظة"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleAssign(emp.id)}
                            disabled={submitting}
                            className="bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold"
                          >
                            {submitting ? 'جاري...' : 'تأكيد'}
                          </button>
                          <button
                            onClick={() => { setAssigningId(null); setSelectedGovId('') }}
                            className="px-3 border border-border rounded-lg text-xs text-text-secondary"
                          >
                            إلغاء
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setAssigningId(emp.id); setSelectedGovId('') }}
                        className="mt-2 bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold"
                      >
                        إضافة تعيين
                      </button>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
