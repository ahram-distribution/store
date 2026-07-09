import { type SortSelectorProps } from '../../types/data-list'

export function SortSelector({ options, value, onChange }: SortSelectorProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white text-text-secondary"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}
