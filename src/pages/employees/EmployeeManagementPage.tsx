import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import toast from 'react-hot-toast'
import { EmployeesPage } from './EmployeesPage'
import { HierarchyPage } from './HierarchyPage'
import { RolesTab } from './RolesTab'
import { PermissionsTab } from './PermissionsTab'
import { TargetsWeightsTab } from './TargetsWeightsTab'

const TABS = [
  { key: 'employees', label: 'الموظفين' },
  { key: 'roles', label: 'الأدوار' },
  { key: 'permissions', label: 'الصلاحيات' },
  { key: 'hierarchy', label: 'الهيكل التنظيمي' },
  { key: 'targets', label: 'الأهداف والأوزان' },
  { key: 'work_policies', label: 'سياسات العمل', external: true },
] as const

type TabKey = (typeof TABS)[number]['key']

const HASH_MAP: Record<string, TabKey> = {
  '#roles': 'roles',
  '#permissions': 'permissions',
  '#hierarchy': 'hierarchy',
  '#targets': 'targets',
  '#work-policies': 'work_policies',
}

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function EmployeeManagementPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const hash = location.hash.toLowerCase()
    return HASH_MAP[hash] || 'employees'
  })
  const [wpStats, setWpStats] = useState<{ total: number; field: number; office: number; exempt: number; needs_review: number } | null>(null)

  useEffect(() => {
    const hash = location.hash.toLowerCase()
    const mapped = HASH_MAP[hash]
    if (mapped && mapped !== activeTab) {
      setActiveTab(mapped)
    }
  }, [location.hash])

  useEffect(() => {
    if (activeTab !== 'work_policies') return
    const token = getToken()
    if (!token) return
    Promise.all([
      supabase.rpc('list_work_policies', { p_token: token }),
      supabase.rpc('list_employees_without_policies', { p_token: token }),
    ]).then(([pData, uData]) => {
      const field = (pData.data?.policies ?? []).filter((p: any) => p.work_location === 'field' && p.attendance_enabled !== false).length
      const office = (pData.data?.policies ?? []).filter((p: any) => p.work_location === 'office' && p.attendance_enabled !== false).length
      const exempt = (pData.data?.policies ?? []).filter((p: any) => p.attendance_enabled === false).length
      const total = field + office + exempt + (uData.data?.employees ?? []).length
      setWpStats({ total, field, office, exempt, needs_review: (uData.data?.employees ?? []).length })
    }).catch(() => toast.error('فشل تحميل إحصائيات سياسات العمل'))
  }, [activeTab])

  function handleTabChange(key: TabKey) {
    if (key === 'work_policies') {
      navigate('/attendance/settings#work-policies')
      return
    }
    setActiveTab(key)
    if (key !== 'employees') {
      window.history.replaceState(null, '', `/employees#${key}`)
    } else {
      window.history.replaceState(null, '', '/employees')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">إدارة الموظفين</h1>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1 border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => handleTabChange(tab.key)}
            className={`shrink-0 px-4 py-2 text-xs font-semibold rounded-t-lg transition-colors ${
              activeTab === tab.key
                ? 'bg-primary text-white'
                : 'bg-surface text-text-secondary hover:text-text'
            }`}
          >
            {tab.label}
            {(tab as any).external && ' ←'}
          </button>
        ))}
      </div>

      <div>
        {activeTab === 'employees' && <EmployeesPage embedded />}
        {activeTab === 'roles' && <RolesTab />}
        {activeTab === 'permissions' && <PermissionsTab />}
        {activeTab === 'hierarchy' && <HierarchyPage embedded />}
        {activeTab === 'targets' && <TargetsWeightsTab />}
        {activeTab === 'work_policies' && (
          <div className="bg-white rounded-xl border border-border p-5 space-y-4" dir="rtl">
            <h3 className="text-sm font-bold text-text">سياسات العمل</h3>
            {wpStats ? (
              <div className="grid grid-cols-5 gap-3">
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-blue-700">{wpStats.total}</div>
                  <div className="text-[10px] text-text-secondary mt-1">إجمالي الموظفين</div>
                </div>
                <div className="bg-green-50 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-green-700">{wpStats.field}</div>
                  <div className="text-[10px] text-text-secondary mt-1">ميداني</div>
                </div>
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-blue-700">{wpStats.office}</div>
                  <div className="text-[10px] text-text-secondary mt-1">مكتبي</div>
                </div>
                <div className="bg-gray-100 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-gray-600">{wpStats.exempt}</div>
                  <div className="text-[10px] text-text-secondary mt-1">معفي من الحضور</div>
                </div>
                <div className="bg-red-50 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-red-700">{wpStats.needs_review}</div>
                  <div className="text-[10px] text-text-secondary mt-1">بحاجة لمراجعة</div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-text-secondary py-4 text-center">جاري التحميل...</div>
            )}
            <button
              onClick={() => navigate('/attendance/settings#work-policies')}
              className="w-full py-3 bg-primary text-white rounded-xl text-sm font-bold hover:opacity-90 transition-all"
            >
              فتح إدارة سياسات العمل
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
