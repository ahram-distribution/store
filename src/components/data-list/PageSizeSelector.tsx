import { type PageSizeSelectorProps, PAGE_SIZE_OPTIONS } from '../../types/data-list'

export function PageSizeSelector({ value, onChange, options }: PageSizeSelectorProps) {
  const opts = options || PAGE_SIZE_OPTIONS

  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value) as typeof value)}
      className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white text-text-secondary"
    >
      {opts.map((size) => (
        <option key={size} value={size}>
          {size} لكل صفحة
        </option>
      ))}
    </select>
  )
}
