import { useState } from 'react'
import { Search, ChevronDown } from 'lucide-react'

interface FilterBarProps {
  departments: string[]
  areas: string[]
  onDepartmentChange: (dept: string) => void
  onAreaChange: (area: string) => void
  onStatusChange: (status: string) => void
  onSearchChange: (query: string) => void
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'الحالة: الكل' },
  { value: 'working', label: 'يعمل' },
  { value: 'on_break', label: 'في استراحة' },
  { value: 'on_visit', label: 'في زيارة' },
  { value: 'lost', label: 'منقطع' },
]

export default function FilterBar({
  departments, areas,
  onDepartmentChange, onAreaChange, onStatusChange, onSearchChange,
}: FilterBarProps) {
  const [deptOpen, setDeptOpen] = useState(false)
  const [areaOpen, setAreaOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [selectedDept, setSelectedDept] = useState('الكل')
  const [selectedArea, setSelectedArea] = useState('الكل')
  const [selectedStatus, setSelectedStatus] = useState('all')

  return (
    <div className="mb-4 flex flex-wrap gap-2 items-center">
      <div className="relative">
        <button
          onClick={() => { setDeptOpen(!deptOpen); setAreaOpen(false); setStatusOpen(false) }}
          className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
        >
          <span>القسم: {selectedDept}</span>
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
        {deptOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setDeptOpen(false)} />
            <div className="absolute top-full right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 min-w-[160px] max-h-48 overflow-y-auto">
              <button
                onClick={() => { setSelectedDept('الكل'); setDeptOpen(false); onDepartmentChange('') }}
                className="block w-full text-right px-3 py-2 text-sm hover:bg-gray-50 text-gray-700"
              >
                الكل
              </button>
              {departments.map((d) => (
                <button
                  key={d}
                  onClick={() => { setSelectedDept(d); setDeptOpen(false); onDepartmentChange(d) }}
                  className="block w-full text-right px-3 py-2 text-sm hover:bg-gray-50 text-gray-700"
                >
                  {d}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="relative">
        <button
          onClick={() => { setAreaOpen(!areaOpen); setDeptOpen(false); setStatusOpen(false) }}
          className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
        >
          <span>المنطقة: {selectedArea}</span>
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
        {areaOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setAreaOpen(false)} />
            <div className="absolute top-full right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 min-w-[160px] max-h-48 overflow-y-auto">
              <button
                onClick={() => { setSelectedArea('الكل'); setAreaOpen(false); onAreaChange('') }}
                className="block w-full text-right px-3 py-2 text-sm hover:bg-gray-50 text-gray-700"
              >
                الكل
              </button>
              {areas.map((a) => (
                <button
                  key={a}
                  onClick={() => { setSelectedArea(a); setAreaOpen(false); onAreaChange(a) }}
                  className="block w-full text-right px-3 py-2 text-sm hover:bg-gray-50 text-gray-700"
                >
                  {a}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="relative">
        <button
          onClick={() => { setStatusOpen(!statusOpen); setDeptOpen(false); setAreaOpen(false) }}
          className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
        >
          <span>{STATUS_OPTIONS.find((o) => o.value === selectedStatus)?.label}</span>
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
        {statusOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setStatusOpen(false)} />
            <div className="absolute top-full right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 min-w-[160px]">
              {STATUS_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  onClick={() => { setSelectedStatus(o.value); setStatusOpen(false); onStatusChange(o.value) }}
                  className={`block w-full text-right px-3 py-2 text-sm hover:bg-gray-50 ${
                    selectedStatus === o.value ? 'text-blue-600 font-bold' : 'text-gray-700'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex-1 min-w-[120px] relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="ابحث عن موظف..."
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full bg-white border border-gray-200 rounded-xl pr-9 pl-3 py-1.5 text-sm text-gray-700 placeholder-gray-400 outline-none focus:border-blue-300"
        />
      </div>
    </div>
  )
}
