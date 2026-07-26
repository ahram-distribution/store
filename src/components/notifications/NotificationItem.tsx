import { useNavigate } from 'react-router-dom'
import { useNotificationStore } from '../../store/notifications'
import type { Notification } from '../../services/notifications'

function typeIcon(type: string): string {
  switch (type) {
    case 'order_submitted': return '📋'
    case 'order_status_changed': return '🔄'
    case 'customer_created': return '👤'
    case 'visit_completed': return '📍'
    case 'attendance_checkin': return '✅'
    case 'attendance_checkout': return '🚪'
    case 'recently_available': return '🆕'
    default: return '🔔'
  }
}

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = Math.floor((now - then) / 1000)

  if (diff < 60) return 'الآن'
  if (diff < 3600) return `${Math.floor(diff / 60)} دقيقة`
  if (diff < 86400) return `${Math.floor(diff / 3600)} ساعة`
  if (diff < 604800) return `${Math.floor(diff / 86400)} يوم`
  return new Date(dateStr).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' })
}

interface Props {
  notification: Notification
}

export function NotificationItem({ notification }: Props) {
  const navigate = useNavigate()
  const markRead = useNotificationStore((s) => s.markRead)

  const handleClick = async () => {
    if (!notification.is_read) {
      await markRead(notification.id)
    }
    if (notification.target_path) {
      navigate(notification.target_path)
    }
  }

  return (
    <button
      onClick={handleClick}
      className={`w-full text-right p-3 rounded-xl transition-colors border ${
        notification.is_read
          ? 'bg-white border-border'
          : 'bg-primary/5 border-primary/15'
      } active:scale-[0.98]`}
    >
      <div className="flex items-start gap-2.5">
        <span className="text-lg shrink-0 mt-0.5">{typeIcon(notification.type)}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className={`text-sm font-semibold ${notification.is_read ? 'text-text-secondary' : 'text-text'}`}>
              {notification.title}
            </span>
            {!notification.is_read && (
              <span className="shrink-0 w-2 h-2 rounded-full bg-primary" />
            )}
          </div>
          <p className={`text-xs mt-0.5 line-clamp-2 ${notification.is_read ? 'text-text-secondary' : 'text-text-secondary'}`}>
            {notification.message}
          </p>
          <span className="text-[10px] text-text-secondary/60 mt-1 block">
            {timeAgo(notification.created_at)}
          </span>
        </div>
      </div>
    </button>
  )
}
