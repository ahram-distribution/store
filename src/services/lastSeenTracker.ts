let _lastGpsAt: string | null = null
let _lastHeartbeatAt: string | null = null
let _lastSyncAt: string | null = null

export interface FullLastSeen {
  lastGpsAt: string | null
  lastHeartbeatAt: string | null
  lastSyncAt: string | null
  lastSeenAt: string | null
  minutesSinceLastSeen: number
  connectionStatus: 'connected' | 'delayed' | 'lost' | 'no_data'
}

function getMinutesSince(t: string | null): number {
  if (!t) return Infinity
  return (Date.now() - new Date(t).getTime()) / 60000
}

export const lastSeenTracker = {
  recordGps(time: string) {
    if (!_lastGpsAt || time > _lastGpsAt) _lastGpsAt = time
  },

  recordHeartbeat(time: string) {
    if (!_lastHeartbeatAt || time > _lastHeartbeatAt) _lastHeartbeatAt = time
  },

  recordSync(time: string) {
    if (!_lastSyncAt || time > _lastSyncAt) _lastSyncAt = time
  },

  getLastGps(): string | null { return _lastGpsAt },
  getLastHeartbeat(): string | null { return _lastHeartbeatAt },
  getLastSync(): string | null { return _lastSyncAt },

  getFullStatus(): FullLastSeen {
    const candidates: string[] = []
    if (_lastGpsAt) candidates.push(_lastGpsAt)
    if (_lastHeartbeatAt) candidates.push(_lastHeartbeatAt)
    if (_lastSyncAt) candidates.push(_lastSyncAt)
    const lastSeenAt = candidates.length > 0
      ? candidates.reduce((latest, t) => t > latest ? t : latest, candidates[0])
      : null
    const minutes = getMinutesSince(lastSeenAt)
    let connectionStatus: FullLastSeen['connectionStatus'] = 'no_data'
    if (minutes < 2) connectionStatus = 'connected'
    else if (minutes < 5) connectionStatus = 'delayed'
    else if (minutes < 15) connectionStatus = 'delayed'
    else connectionStatus = 'lost'
    return { lastGpsAt: _lastGpsAt, lastHeartbeatAt: _lastHeartbeatAt, lastSyncAt: _lastSyncAt, lastSeenAt, minutesSinceLastSeen: minutes, connectionStatus }
  },

  reset() {
    _lastGpsAt = null
    _lastHeartbeatAt = null
    _lastSyncAt = null
  },
}
