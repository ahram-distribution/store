import { Sidebar } from './Sidebar'
import { Toolbar } from './Toolbar'
import { StatusBar } from './StatusBar'
import { FutureReservedArea } from './FutureReservedArea'
import { ContextMenu } from '../components/ContextMenu'
import { KeyboardShortcuts } from '../components/KeyboardShortcuts'
import { CopySupport } from '../components/CopySupport'
import { WorkspaceManager } from '../workspace/WorkspaceManager'

export function DesktopLayout() {
  return (
    <div className="desktop-shell" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <KeyboardShortcuts />
      <CopySupport />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Toolbar />
          <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <WorkspaceManager />
          </main>
          <StatusBar />
        </div>
      </div>
      <FutureReservedArea />
      <ContextMenu />
    </div>
  )
}
