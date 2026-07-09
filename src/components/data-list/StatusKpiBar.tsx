import type { StatusKpiBarProps } from '../../types/data-list'

export function StatusKpiBar({ chips, selectedId, onToggle, className = '' }: StatusKpiBarProps) {
  if (chips.length === 0) return null

  return (
    <div className={'flex gap-1.5 overflow-x-auto pb-1 scrollbar-none ' + className}>
      {chips.map((chip) => {
        const isSelected = chip.id === selectedId
        const containerClass = isSelected ? chip.activeChipClass : chip.chipClass

        return (
          <button
            key={chip.id}
            onClick={() => onToggle(chip.id)}
            className={'shrink-0 flex items-center gap-1.5 border rounded-lg px-2.5 py-1.5 text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer ' + containerClass}
          >
            <span className={'w-2 h-2 rounded-full shrink-0 ' + chip.dotClass} />
            <span>{chip.label}</span>
            <span className="text-[10px] opacity-60 rtl:mr-0.5 ltr:ml-0.5">({chip.count})</span>
          </button>
        )
      })}
    </div>
  )
}
