import { supabase } from '../lib/supabase'
import { trackingQueue } from './trackingQueue'
import { trackingEngine } from './trackingEngine'
import { failureLogger } from './failureLogger'

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
      failureLogger.log('life_signal_failed', `touch_session_activity error: ${error.message}`, { sessionId })
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

export const lifeSignalService = {
  async handleAppOpen() {
    const sessionId = await getSessionId()
    if (!sessionId) return
    await touchActivity(sessionId, 'app_open')
    await flushQueuedSignals()
  },

  async handleAppResume() {
    const sessionId = await getSessionId()
    if (!sessionId) return
    await touchActivity(sessionId, 'app_resume')
    await flushQueuedSignals()
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
