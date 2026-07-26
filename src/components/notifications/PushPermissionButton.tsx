import { useEffect, useState } from 'react'
import { notificationInboxService } from '../../services/notifications'

export function PushPermissionButton() {
  const [supported, setSupported] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission>('default')
  const [subscribed, setSubscribed] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const isSupported = notificationInboxService.isPushSupported()
    setSupported(isSupported)
    if (isSupported) {
      setPermission(Notification.permission)
      notificationInboxService.getExistingSubscription().then((sub) => {
        setSubscribed(!!sub)
      })
    }
  }, [])

  const handleEnable = async () => {
    setLoading(true)
    try {
      const success = await notificationInboxService.subscribeToPush()
      if (success) {
        setPermission('granted')
        setSubscribed(true)
      } else {
        setPermission(Notification.permission)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleDisable = async () => {
    setLoading(true)
    try {
      await notificationInboxService.unsubscribeFromPush()
      setSubscribed(false)
    } finally {
      setLoading(false)
    }
  }

  if (!supported) return null

  // Already denied — show explanation
  if (permission === 'denied') {
    return (
      <div className="p-3 rounded-xl bg-surface text-text-secondary text-xs">
        <div className="flex items-center gap-2">
          <span>🔕</span>
          <span>إشعارات الهاتف معطلة. فعّلها من إعدادات المتصفح.</span>
        </div>
      </div>
    )
  }

  // Subscribed — show disable option
  if (subscribed) {
    return (
      <button
        onClick={handleDisable}
        disabled={loading}
        className="w-full p-3 rounded-xl bg-success/10 border border-success/20 text-success text-sm font-medium flex items-center justify-between transition-colors active:scale-[0.98]"
      >
        <div className="flex items-center gap-2">
          <span>🔔</span>
          <span>إشعارات الهاتف مفعلة</span>
        </div>
        <span className="text-xs opacity-70">تعطيل</span>
      </button>
    )
  }

  // Not subscribed — show enable button
  return (
    <button
      onClick={handleEnable}
      disabled={loading}
      className="w-full p-3 rounded-xl bg-primary/5 border border-primary/20 text-primary text-sm font-medium flex items-center justify-between transition-colors active:scale-[0.98] disabled:opacity-50"
    >
      <div className="flex items-center gap-2">
        <span>🔕</span>
        <span>تفعيل إشعارات الهاتف</span>
      </div>
      {loading && <span className="text-xs">...</span>}
    </button>
  )
}
