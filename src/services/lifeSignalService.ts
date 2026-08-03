import { supabase } from '../lib/supabase'
import { trackingQueue } from './trackingQueue'
import { trackingEngine } from './trackingEngine'
import { failureLogger } from './failureLogger'
import * as gpsService from './gpsService'

export type LifeSignalType =
  | 'app_open'
  | 'app_resume'
  | 'visit_checkin'
  | 'visit_checkout'
  | 'order_created'
  | 'collection_created'
  | 'customer_created'

async function getSessionId(): Promise<string | null> {
  const engId = trackingEngine.sessionId
  if (engId) return engId
  return trackingQueue.getSessionId()
}

async function touchActivity(sessionId: string, signalType: LifeSignalType) {
  if (navigator.onLine) {
    const { error } = await supabase.rpc('touch_session_activity', {
      p_session_id: sessionId,
    })
    if (error) {
      failureLogger.log({ category: 'life_signal_failed', detail: `touch_session_activity error: ${error.message}`, sessionId })
      await queueSignal(sessionId, signalType)
    }
  } else {
    await queueSignal(sessionId, signalType)
  }
}

async function queueSignal(sessionId: string, signalType: LifeSignalType) {
  const employeeId = trackingEngine.employeeId || undefined
  await trackingQueue.addSignal({
    type: signalType,
    session_id: sessionId,
    employee_id: employeeId,
    recorded_at: new Date().toISOString(),
  })
}

async function flushQueuedSignals() {
  if (!navigator.onLine) return
  const signals = await trackingQueue.getSignals()
  if (signals.length === 0) return
  const ids: number[] = []
  for (const s of signals) {
    const { error } = await supabase.rpc('touch_session_activity', {
      p_session_id: s.session_id,
    })
    if (!error && s.id != null) ids.push(s.id)
  }
  if (ids.length > 0) await trackingQueue.removePoints(ids)
}

/**
 * Application Activity Recovery (tracking Source 3).
 * Whenever the app opens or resumes after a suspension / long inactivity and a
 * valid GPS location is obtained, record an 'app_resume' tracking point through
 * the existing tracking pipeline. Server-side deduplication prevents spam.
 */
async function recordActivityResumePoint() {
  try {
    const sessionId = await getSessionId()
    if (!sessionId) return
    const result = await gpsService.getCurrentLocation({ maxWaitMs: 8000, maxAccuracy: 200 })
    if (!result.success || !result.location) return
    await trackingEngine.recordActionPoint({
      latitude: result.location.latitude,
      longitude: result.location.longitude,
      accuracy: result.location.accuracy,
      pointType: 'app_resume',
    })
  } catch (err) {
    failureLogger.log({ category: 'resume_point_failed', detail: `recordActivityResumePoint error: ${err instanceof Error ? err.message : String(err)}` })
  }
}

export const lifeSignalService = {
  async handleAppOpen() {
    const sessionId = await getSessionId()
    if (!sessionId) return
    await touchActivity(sessionId, 'app_open')
    await flushQueuedSignals()
    void recordActivityResumePoint()
  },

  async handleAppResume() {
    const sessionId = await getSessionId()
    if (!sessionId) return
    await touchActivity(sessionId, 'app_resume')
    await flushQueuedSignals()
    void recordActivityResumePoint()
  },

  async notifyBusiness(signalType: LifeSignalType) {
    const sessionId = await getSessionId()
    if (!sessionId) return
    await touchActivity(sessionId, signalType)
  },

  async flushNow() {
    await flushQueuedSignals()
  },
}
