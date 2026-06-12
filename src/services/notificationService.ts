import { PushNotifications } from '@capacitor/push-notifications'
import { Capacitor } from '@capacitor/core'

const isNative = Capacitor.isNativePlatform()

type NotificationHandler = (data: Record<string, unknown>) => void

class NotificationService {
  private _registered = false
  private _onNotification: NotificationHandler | null = null
  private _deviceToken: string | null = null

  get deviceToken(): string | null {
    return this._deviceToken
  }

  async register() {
    if (this._registered || !isNative) return

    const permStatus = await PushNotifications.checkPermissions()
    if (permStatus.receive === 'prompt') {
      await PushNotifications.requestPermissions()
    }

    await PushNotifications.register()
    this._registered = true
  }

  async addListeners(onNotification?: NotificationHandler) {
    if (!isNative) return

    this._onNotification = onNotification ?? null

    await PushNotifications.addListener('registration', (token) => {
      this._deviceToken = token.value
      this._storeToken(token.value)
    })

    await PushNotifications.addListener('registrationError', (err) => {
      console.error('[notifications] Push registration error:', err)
    })

    await PushNotifications.addListener('pushNotificationReceived', (notification) => {
      if (this._onNotification) {
        this._onNotification(notification.data ?? {})
      }
    })

    await PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
      if (this._onNotification) {
        this._onNotification(notification.notification.data ?? {})
      }
    })
  }

  async removeAllListeners() {
    if (!isNative) return
    await PushNotifications.removeAllListeners()
    this._onNotification = null
  }

  private _storeToken(token: string) {
    try {
      localStorage.setItem('push_device_token', token)
    } catch {}
  }
}

export const notificationService = new NotificationService()
