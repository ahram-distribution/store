import { useEffect, useState } from 'react'
import { useNotificationStore } from '../../store/notifications'
import { NotificationItem } from './NotificationItem'
import { PushPermissionButton } from './PushPermissionButton'

export function NotificationInbox() {
  const { notifications, loading, hasMore, unreadCount, fetchInitial, fetchMore, markAllRead, refresh, deleteNotifications, deleteAllNotifications } = useNotificationStore()
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetchInitial()
  }, [fetchInitial])

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const cancelSelection = () => {
    setSelectMode(false)
    setSelected(new Set())
  }

  const handleClearAll = async () => {
    if (!window.confirm('هل تريد مسح جميع الإشعارات؟')) return
    await deleteAllNotifications()
    cancelSelection()
  }

  const handleDeleteSelected = async () => {
    if (selected.size === 0) return
    if (!window.confirm(`هل تريد مسح الإشعارات المحددة (${selected.size})؟`)) return
    await deleteNotifications([...selected])
    cancelSelection()
  }

  return (
    <div className="max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-text">الإشعارات</h1>
          {unreadCount > 0 && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary text-white">
              {unreadCount}
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="text-xs text-primary font-medium px-3 py-1.5 rounded-full border border-primary/20 hover:bg-primary/5 transition-colors"
          >
            قراءة الكل
          </button>
        )}
      </div>

      {/* Push permission */}
      <div className="mb-4">
        <PushPermissionButton />
      </div>

      {/* Delete actions */}
      {notifications.length > 0 && !selectMode && (
        <div className="flex gap-2 mb-3">
          <button
            onClick={handleClearAll}
            className="flex-1 py-2 text-xs font-medium text-danger rounded-xl border border-danger/30 bg-danger/5 hover:bg-danger/10 transition-colors"
          >
            🗑️ مسح الكل
          </button>
          <button
            onClick={() => setSelectMode(true)}
            className="flex-1 py-2 text-xs font-medium text-primary rounded-xl border border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors"
          >
            ☑️ مسح متعدد
          </button>
        </div>
      )}

      {/* Selection action bar */}
      {selectMode && (
        <div className="flex items-center justify-between gap-2 mb-3 p-3 rounded-xl border border-border bg-white">
          <span className="text-xs font-medium text-text">
            {selected.size > 0 ? `تم اختيار ${selected.size}` : 'اختر الرسائل للمسح'}
          </span>
          <div className="flex gap-2">
            <button
              onClick={handleDeleteSelected}
              disabled={selected.size === 0}
              className="px-3 py-1.5 text-xs font-medium text-white bg-danger rounded-full disabled:opacity-40 transition-colors"
            >
              مسح المحدد
            </button>
            <button
              onClick={cancelSelection}
              className="px-3 py-1.5 text-xs font-medium text-text-secondary rounded-full border border-border hover:bg-surface transition-colors"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && notifications.length === 0 && (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!loading && notifications.length === 0 && (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">🔔</div>
          <p className="text-sm text-text-secondary">لا توجد إشعارات بعد</p>
        </div>
      )}

      {/* Notification list */}
      <div className="flex flex-col gap-2">
        {notifications.map((n) => (
          <NotificationItem
            key={n.id}
            notification={n}
            selectMode={selectMode}
            selected={selected.has(n.id)}
            onToggleSelect={() => toggleSelect(n.id)}
          />
        ))}
      </div>

      {/* Load more */}
      {hasMore && notifications.length > 0 && (
        <button
          onClick={fetchMore}
          disabled={loading}
          className="w-full mt-4 py-2.5 text-sm text-primary font-medium rounded-xl border border-primary/20 hover:bg-primary/5 transition-colors disabled:opacity-50"
        >
          {loading ? 'جاري التحميل...' : 'عرض المزيد'}
        </button>
      )}

      {/* Pull to refresh hint */}
      {!loading && notifications.length > 0 && (
        <button
          onClick={refresh}
          className="w-full mt-2 py-2 text-xs text-text-secondary hover:text-text transition-colors"
        >
          ↻ تحديث
        </button>
      )}
    </div>
  )
}
