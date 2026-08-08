import { Edit2, ShieldAlert } from 'lucide-react'

export function SectionCard({
  title,
  icon,
  onEdit,
  editing,
  children,
  hint,
}: {
  title: string
  icon: React.ReactNode
  onEdit?: () => void
  editing?: boolean
  children: React.ReactNode
  hint?: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
      <div className="flex items-center justify-between bg-gradient-to-l from-secondary to-blue-900 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-gold-light">{icon}</span>
          <h3 className="text-sm font-bold text-white">{title}</h3>
        </div>
        {onEdit && !editing && (
          <button onClick={onEdit} className="flex items-center gap-1 text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg font-bold">
            <Edit2 className="w-3 h-3" />
            تعديل
          </button>
        )}
      </div>
      <div className="p-4">
        {hint && (
          <div className="border rounded-xl px-3 py-2.5 text-xs leading-relaxed bg-blue-50 border-blue-200 text-blue-800 mb-3">
            <ShieldAlert className="w-4 h-4 inline ml-1 align-[-2px]" />
            {hint}
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

export function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-border/60 last:border-0">
      <div className="text-xs text-text-secondary shrink-0">{label}</div>
      <div className="text-xs font-bold text-text text-left break-words">{value || <span className="text-text-muted font-normal">--</span>}</div>
    </div>
  )
}

export function Input({
  value,
  onChange,
  placeholder,
  type = 'text',
  ltr,
  step,
  min,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  ltr?: boolean
  step?: string
  min?: string
}) {
  return (
    <input
      type={type}
      step={step}
      min={min}
      value={value}
      dir={ltr ? 'ltr' : undefined}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm font-normal text-text focus:outline-none focus:ring-2 focus:ring-primary/40"
    />
  )
}

export function Select({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm font-normal text-text focus:outline-none focus:ring-2 focus:ring-primary/40"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-semibold text-text-secondary">{children}</label>
}

export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="flex items-center justify-between w-full mt-1 border border-border rounded-lg px-3 py-2 bg-white"
    >
      <span className="text-xs text-text">{label}</span>
      <span className={`w-9 h-5 rounded-full transition-colors relative ${value ? 'bg-success' : 'bg-gray-300'}`}>
        <span className="absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all" style={{ right: value ? '2px' : '18px' }} />
      </span>
    </button>
  )
}

export function ReasonBar({ reason, setReason }: { reason: string; setReason: (v: string) => void }) {
  return (
    <div className="border border-red-200 bg-red-50 rounded-xl px-3 py-2.5 space-y-2">
      <div className="text-[11px] font-bold text-red-700">
        ⚠️ التعديل اليدوي يُسجل في سجل التدقيق (لا يمحو القيمة الأصلية). سبب التعديل مطلوب.
      </div>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="سبب التعديل (مطلوب)"
        className="w-full border border-red-200 rounded-lg px-3 py-2 text-xs text-text focus:outline-none focus:ring-2 focus:ring-red-300/40"
      />
    </div>
  )
}

export function SaveBar({ saving, onSave, onCancel }: { saving: boolean; onSave: () => void; onCancel: () => void }) {
  return (
    <div className="flex gap-2 pt-2">
      <button onClick={onSave} disabled={saving}
        className="flex-1 bg-gradient-to-l from-primary to-blue-900 text-white rounded-xl py-2.5 text-sm font-bold active:scale-95 transition-all disabled:opacity-60">
        {saving ? 'جاري الحفظ...' : 'حفظ التغييرات'}
      </button>
      <button onClick={onCancel} className="px-4 border border-border rounded-xl text-sm font-bold text-text-secondary">
        إلغاء
      </button>
    </div>
  )
}
