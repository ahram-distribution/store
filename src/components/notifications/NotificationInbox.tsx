import { useEffect } from 'react'
import { useNotificationStore } from '../../store/notifications'
import { NotificationItem } from './NotificationItem'

export function NotificationInbox() {
  const { notifications, loading, hasMore, unreadCount, fetchInitial, fetchMore, markAllRead, refresh } = useNotificationStore()

  useEffect(() => {
    fetchInitial()
  }, [fetchInitial])

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
          <NotificationItem key={n.id} notification={n} />
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
