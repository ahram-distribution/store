import { Play, Coffee, LogOut, FileText, ArrowLeftFromLine } from 'lucide-react'

interface RuntimeActionsProps {
  status: string | null
  onBreak: boolean
  actionLoading: string | null
  onStart: () => void
  onEnd: () => void
  onStartBreak: () => void
  onEndBreak: () => void
  onShowSummary: () => void
}

export default function RuntimeActions({
  status, onBreak, actionLoading,
  onStart, onEnd, onStartBreak, onEndBreak, onShowSummary,
}: RuntimeActionsProps) {
  if (status === null || status === 'completed') {
    return (
      <div className="space-y-3">
        <button
          onClick={onStart}
          disabled={actionLoading === 'start'}
          className="w-full py-4 px-6 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-2xl text-lg font-bold shadow-lg hover:from-green-600 hover:to-green-700 active:scale-[0.97] transition-all disabled:opacity-50 flex items-center justify-center gap-3"
        >
          {actionLoading === 'start' ? (
            <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <Play className="w-5 h-5" />
          )}
          بدء يوم العمل
        </button>
      </div>
    )
  }

  const isActive = status === 'active'

  return (
    <div className="space-y-2.5">
      <div className="text-center">
        <span className={`inline-flex items-center gap-1.5 text-sm font-bold px-3 py-1 rounded-full ${
          onBreak ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
        }`}>
          <span className={`w-2 h-2 rounded-full ${onBreak ? 'bg-amber-500 animate-pulse' : 'bg-green-500 animate-pulse'}`} />
          {onBreak ? 'في استراحة' : 'يعمل'}
        </span>
      </div>

      {onBreak ? (
        <button
          onClick={onEndBreak}
          disabled={actionLoading === 'resume'}
          className="w-full py-4 px-6 bg-gradient-to-r from-amber-500 to-amber-600 text-white rounded-2xl text-lg font-bold shadow-lg hover:from-amber-600 hover:to-amber-700 active:scale-[0.97] transition-all disabled:opacity-50 flex items-center justify-center gap-3"
        >
          {actionLoading === 'resume' ? (
            <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <ArrowLeftFromLine className="w-5 h-5" />
          )}
          مواصلة العمل
        </button>
      ) : (
        <button
          onClick={onStartBreak}
          disabled={actionLoading === 'break'}
          className="w-full py-4 px-6 bg-gradient-to-r from-amber-500 to-amber-600 text-white rounded-2xl text-lg font-bold shadow-lg hover:from-amber-600 hover:to-amber-700 active:scale-[0.97] transition-all disabled:opacity-50 flex items-center justify-center gap-3"
        >
          {actionLoading === 'break' ? (
            <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <Coffee className="w-5 h-5" />
          )}
          أخذ استراحة
        </button>
      )}

      <button
        onClick={onShowSummary}
        disabled={actionLoading === 'summary'}
        className="w-full py-3.5 px-6 bg-indigo-50 text-indigo-700 rounded-2xl text-base font-bold hover:bg-indigo-100 active:scale-[0.97] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
      >
        <FileText className="w-4 h-4" />
        ملخص اليوم
      </button>

      <button
        onClick={onEnd}
        disabled={actionLoading === 'end'}
        className="w-full py-4 px-6 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-2xl text-lg font-bold shadow-lg hover:from-red-600 hover:to-red-700 active:scale-[0.97] transition-all disabled:opacity-50 flex items-center justify-center gap-3"
      >
        {actionLoading === 'end' ? (
          <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
        ) : (
          <LogOut className="w-5 h-5" />
        )}
        إنهاء يوم العمل
      </button>
    </div>
  )
}
