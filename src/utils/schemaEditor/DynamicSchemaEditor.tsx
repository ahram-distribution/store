import type { ColumnDef } from './columnDefs'

interface Props {
  title: string
  columns: ColumnDef[]
  data: Record<string, any>
  onChange: (key: string, value: any) => void
  readonly?: boolean
}

export function DynamicSchemaEditor({ title, columns, data, onChange, readonly }: Props) {
  const visible = columns.filter((c) => !c.hidden)

  return (
    <div className="bg-white rounded-xl border border-border p-4 space-y-3">
      <h2 className="text-sm font-bold">{title}</h2>
      {visible.map((col) => {
        if (col.readonly && col.key === 'id') {
          return (
            <div key={col.key}>
              <label className="text-[10px] text-text-secondary block mb-0.5">{col.label}</label>
              <input type="text" value={data[col.key] || ''} readOnly
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface/50 text-text-secondary" dir="ltr" />
            </div>
          )
        }

        const isReadonly = readonly || col.readonly

        switch (col.inputType) {
          case 'boolean':
            return (
              <div key={col.key}>
                <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                  <input type="checkbox" checked={!!data[col.key]}
                    disabled={isReadonly}
                    onChange={(e) => onChange(col.key, e.target.checked)} />
                  <span className={data[col.key] ? 'text-success font-semibold' : 'text-text-secondary'}>
                    {col.label}
                  </span>
                </label>
              </div>
            )

          case 'textarea':
            return (
              <div key={col.key}>
                <label className="text-[10px] text-text-secondary block mb-0.5">{col.label}</label>
                <textarea value={data[col.key] ?? ''}
                  onChange={(e) => onChange(col.key, e.target.value)}
                  readOnly={isReadonly}
                  rows={3}
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white resize-none" />
              </div>
            )

          case 'select':
            return (
              <div key={col.key}>
                <label className="text-[10px] text-text-secondary block mb-0.5">{col.label}</label>
                <select value={data[col.key] ?? ''}
                  disabled={isReadonly}
                  onChange={(e) => onChange(col.key, e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white">
                  {col.options?.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            )

          case 'color':
            return (
              <div key={col.key}>
                <label className="text-[10px] text-text-secondary block mb-0.5">{col.label}</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={data[col.key] || '#000000'}
                    disabled={isReadonly}
                    onChange={(e) => onChange(col.key, e.target.value)}
                    className="w-10 h-10 rounded border border-border cursor-pointer" />
                  <input type="text" value={data[col.key] || ''}
                    onChange={(e) => onChange(col.key, e.target.value)}
                    readOnly={isReadonly}
                    placeholder="#000000"
                    className="flex-1 border border-border rounded-lg px-3 py-2 text-xs bg-white" dir="ltr" maxLength={7} />
                </div>
              </div>
            )

          case 'datetime-local':
            return (
              <div key={col.key}>
                <label className="text-[10px] text-text-secondary block mb-0.5">{col.label}</label>
                <input type="datetime-local" value={data[col.key] ? toDatetimeLocal(data[col.key]) : ''}
                  onChange={(e) => onChange(col.key, e.target.value)}
                  readOnly={isReadonly}
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
              </div>
            )

          default:
            return (
              <div key={col.key}>
                <label className="text-[10px] text-text-secondary block mb-0.5">{col.label}</label>
                <input type={col.inputType} value={data[col.key] ?? ''}
                  onChange={(e) => onChange(col.key, col.inputType === 'number' ? e.target.value : e.target.value)}
                  readOnly={isReadonly}
                  placeholder={col.placeholder}
                  min={col.min}
                  max={col.max}
                  step={col.step}
                  maxLength={col.maxLength}
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" dir={col.inputType === 'url' || col.inputType === 'text' && col.readonly ? 'ltr' : undefined} />
              </div>
            )
        }
      })}
    </div>
  )
}

function toDatetimeLocal(v: string | number | Date): string {
  if (!v) return ''
  const d = new Date(v)
  if (isNaN(d.getTime())) return String(v)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
