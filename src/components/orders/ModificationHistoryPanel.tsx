import { useState } from 'react'
import { formatDateTime } from '../../utils/format'
import { ORDER_STATUS_LABELS } from '../../types/order-display'
import type { UnifiedModificationEntry } from '../../types/unified-order'

const FIELD_LABELS: Record<string, string> = {
  customer_id: 'العميل',
  customer_name: 'اسم العميل',
  tier_id: 'الشريحة السعرية',
  payment_method: 'طريقة الدفع',
  owner_id: 'مسؤول العميل',
  notes: 'الملاحظات',
  delivery_mode: 'طريقة التوصيل',
  address_line1: 'العنوان',
  address_line2: 'العنوان (تابع)',
  city: 'المدينة',
  governorate: 'المحافظة',
}

interface ModificationHistoryPanelProps {
  entries: UnifiedModificationEntry[]
  revisionNumber: number
  lastRevisedAt: string | null
}

export function ModificationHistoryPanel({ entries, revisionNumber, lastRevisedAt }: ModificationHistoryPanelProps) {
  const [expanded, setExpanded] = useState(false)

  const modificationEntries = entries.filter(e => e.revision_number > 0).sort((a, b) =>
    new Date(b.modified_at).getTime() - new Date(a.modified_at).getTime()
  )

  const snapshotEntries = modificationEntries.filter(e => e.field_name === 'REVISION_SNAPSHOT')
  const fieldChangeEntries = modificationEntries.filter(e => e.field_name !== 'REVISION_SNAPSHOT')

  if (modificationEntries.length === 0 && revisionNumber === 0) return null

  const totalEditCount = snapshotEntries.length

  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center justify-between px-5 py-3 hover:bg-[#F9FAFB] transition-colors">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-bold text-[#111827]">سجل التعديلات</span>
          <span className="text-[10px] bg-[#F3F4F6] text-[#6B7280] px-2 py-0.5 rounded-full font-medium">
            {totalEditCount} تعديل{totalEditCount !== 1 ? 'ات' : ''}
          </span>
        </div>
        <svg className={`w-4 h-4 text-[#9CA3AF] transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-3 border-t border-[#E5E7EB] pt-4">
          {snapshotEntries.map(entry => {
            const oldSnap = tryParseJSON(entry.old_value)
            const newSnap = tryParseJSON(entry.new_value)
            const changedFields = findChangedFields(oldSnap, newSnap)

            return (
              <div key={entry.id} className="bg-[#FFFBEB]/50 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-bold text-[#92400E]">
                    Revision #{entry.revision_number}
                  </span>
                  <span className="text-[11px] text-[#6B7280]">{formatDateTime(entry.modified_at)}</span>
                </div>
                {entry.reason && (
                  <p className="text-[12px] text-[#6B7280] bg-white/60 rounded px-3 py-1.5">
                    <span className="font-medium text-[#111827]">السبب: </span>{entry.reason}
                  </p>
                )}
                {changedFields.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-[11px] text-[#9CA3AF] font-medium">التغييرات:</span>
                    {changedFields.map(f => (
                      <div key={f.key} className="text-[12px] bg-white rounded px-3 py-1.5 flex items-start gap-2">
                        <span className="shrink-0 font-semibold text-[#111827] min-w-[70px]">{FIELD_LABELS[f.key] || f.key}:</span>
                        <div className="flex flex-wrap items-center gap-1">
                          {f.old !== undefined && (
                            <span className="line-through text-[#DC2626]/70">{String(f.old).substring(0, 60)}</span>
                          )}
                          {f.old !== undefined && f.new !== undefined && (
                            <svg className="w-3 h-3 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                            </svg>
                          )}
                          {f.new !== undefined && (
                            <span className="text-[#059669]">{String(f.new).substring(0, 60)}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {hasItemsDiff(entry) && (
                  <div className="text-[12px] bg-white rounded px-3 py-1.5">
                    <span className="font-semibold text-[#111827]">المنتجات: </span>
                    <span className="text-[#6B7280]">تم تعديل المنتجات والكميات</span>
                  </div>
                )}
              </div>
            )
          })}

          {fieldChangeEntries.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[11px] text-[#9CA3AF] font-medium">تغييرات الحقول المفردة:</span>
              {fieldChangeEntries.map(entry => (
                <div key={entry.id} className="text-[12px] bg-[#F9FAFB] rounded px-3 py-1.5 flex items-start gap-2">
                  <span className="shrink-0 font-semibold text-[#111827] min-w-[70px]">{FIELD_LABELS[entry.field_name] || entry.field_name}</span>
                  <div className="flex flex-wrap items-center gap-1">
                    {entry.old_value && <span className="line-through text-[#DC2626]/70">{entry.old_value.substring(0, 60)}</span>}
                    {entry.old_value && entry.new_value && (
                      <svg className="w-3 h-3 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                      </svg>
                    )}
                    {entry.new_value && <span className="text-[#059669]">{entry.new_value.substring(0, 60)}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {revisionNumber > 0 && (
            <div className="text-[11px] text-[#6B7280] pt-2 border-t border-[#E5E7EB]">
              إجمالي التعديلات: {totalEditCount}
              {lastRevisedAt && ` • آخر إعادة إرسال: ${formatDateTime(lastRevisedAt)}`}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function tryParseJSON(val: string | null): Record<string, any> | null {
  if (!val) return null
  try { return JSON.parse(val) } catch { return null }
}

function findChangedFields(oldSnap: Record<string, any> | null, newSnap: Record<string, any> | null): Array<{ key: string; old: any; new: any }> {
  if (!oldSnap && !newSnap) return []
  if (!oldSnap && newSnap) return Object.keys(newSnap).filter(k => newSnap[k] != null).map(k => ({ key: k, old: undefined, new: newSnap[k] }))
  if (oldSnap && !newSnap) return Object.keys(oldSnap).filter(k => oldSnap[k] != null).map(k => ({ key: k, old: oldSnap[k], new: undefined }))
  const changed: Array<{ key: string; old: any; new: any }> = []
  const allKeys = new Set([...Object.keys(oldSnap!), ...Object.keys(newSnap!)])
  for (const key of allKeys) {
    if (key === 'assigned_delivery_rep' || key === 'credit_program_id') continue
    const oldVal = oldSnap![key]
    const newVal = newSnap![key]
    if (key === 'customer_name' && oldVal === newVal) continue
    if (String(oldVal ?? '') !== String(newVal ?? '')) {
      changed.push({ key, old: oldVal, new: newVal })
    }
  }
  return changed
}

function hasItemsDiff(entry: UnifiedModificationEntry): boolean {
  const oldItems = entry.old_order_items
  const newItems = entry.new_order_items
  if (!oldItems && !newItems) return false
  if (!oldItems || !newItems) return true
  return JSON.stringify(oldItems) !== JSON.stringify(newItems)
}
