import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'

interface OrderOwnershipInfoProps {
  creatorName: string | null | undefined
  creatorId: string | null | undefined
  creatorType?: string | null | undefined
  creatorRole?: string | null | undefined
  ownerId: string | null | undefined
  currentOwnerName?: string | null | undefined
  label?: string
  compact?: boolean
}

export function OrderOwnershipInfo({
  creatorName,
  creatorId,
  creatorType,
  creatorRole,
  ownerId,
  currentOwnerName,
  label = 'المنشئ:',
  compact = false,
}: OrderOwnershipInfoProps) {
  const navigate = useNavigate()

  const transferred = useMemo(
    () => !!(creatorId && ownerId && creatorId !== ownerId),
    [creatorId, ownerId]
  )

  if (!creatorName) {
    return compact ? null : <span className="text-[#6B7280]">—</span>
  }

  const creatorTarget = creatorType === 'customer'
    ? `/customers/${creatorId}`
    : `/employees/${creatorId}`

  const roleSuffix = creatorRole ? ` — ${creatorRole}` : ''

  if (compact) {
    if (!transferred) {
      return (
        <p className="text-[11px] text-text-secondary mb-0.5">
          <span className="text-text-muted">{label} </span>
          {creatorId ? (
            <span className="text-primary/80 font-medium cursor-pointer hover:opacity-70 transition-opacity" onClick={() => navigate(creatorTarget)}>
              {creatorName}
            </span>
          ) : (
            <span className="text-primary/80 font-medium">{creatorName}</span>
          )}
        </p>
      )
    }
    return (
      <div className="text-[11px] mb-0.5">
        <p className="text-text-secondary">
          <span className="text-text-muted">{label} </span>
          <span className="line-through text-[#9CA3AF]">{creatorName}</span>
        </p>
        <p className="text-[11px] text-[#059669] font-medium">
          ✓ المالك الحالى: {currentOwnerName}
        </p>
        <span className="inline-block text-[9px] text-[#059669] bg-[#ECFDF5] border border-[#D1FAE5] px-1.5 py-0.5 rounded mt-0.5">🔄 تم نقل الملكية</span>
      </div>
    )
  }

  if (!transferred) {
    return (
      <span>
        {creatorId ? (
          <span className="cursor-pointer hover:opacity-70 transition-opacity" onClick={() => navigate(creatorTarget)}>
            {creatorName}
            <span className="text-[#6B7280]">{roleSuffix}</span>
          </span>
        ) : (
          <span>{creatorName}<span className="text-[#6B7280]">{roleSuffix}</span></span>
        )}
      </span>
    )
  }

  const creatorNode = creatorId ? (
    <span className="cursor-pointer hover:opacity-70 transition-opacity" onClick={() => navigate(creatorTarget)}>
      {creatorName}
      <span className="text-[#6B7280]">{roleSuffix}</span>
    </span>
  ) : (
    <span>{creatorName}<span className="text-[#6B7280]">{roleSuffix}</span></span>
  )

  return (
    <span className="inline-flex flex-col">
      <span className="line-through text-[#9CA3AF]">{creatorNode}</span>
      <span className="text-[11px] text-[#059669] font-medium">✓ المالك الحالى: {currentOwnerName}</span>
      <span className="inline-block text-[9px] text-[#059669] bg-[#ECFDF5] border border-[#D1FAE5] px-1.5 py-0.5 rounded mt-0.5 w-fit">🔄 تم نقل الملكية</span>
    </span>
  )
}
