import { useNavigate } from 'react-router-dom'

interface GuidedErrorProps {
  title: string
  reason: string
  correctiveAction: string
  navigationTarget?: string
  navigationLabel?: string
  onRetry?: () => void
}

export function GuidedError({ title, reason, correctiveAction, navigationTarget, navigationLabel, onRetry }: GuidedErrorProps) {
  const navigate = useNavigate()

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
      <div className="flex items-start gap-3">
        <span className="text-amber-500 text-xl shrink-0 mt-0.5">!</span>
        <div>
          <h4 className="text-sm font-semibold text-amber-800">{title}</h4>
          <p className="text-xs text-amber-700 mt-1">{reason}</p>
        </div>
      </div>
      <div className="bg-amber-100/50 rounded p-2">
        <p className="text-xs text-amber-800">
          <span className="font-semibold">الإجراء المطلوب:</span> {correctiveAction}
        </p>
      </div>
      <div className="flex gap-2">
        {onRetry && (
          <button onClick={onRetry} className="text-xs bg-amber-100 text-amber-800 px-3 py-1.5 rounded-lg">
            إعادة المحاولة
          </button>
        )}
        {navigationTarget && (
          <button onClick={() => navigate(navigationTarget)} className="text-xs bg-primary text-white px-3 py-1.5 rounded-lg">
            {navigationLabel || 'انتقال'}
          </button>
        )}
      </div>
    </div>
  )
}
