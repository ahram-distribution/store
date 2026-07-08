import { create } from 'zustand'
import type { GlobalFilters, WorkspaceState } from '../workspace/types'

export interface ContextMenuItem {
  label: string
  icon?: string
  shortcut?: string
  disabled?: boolean
  divider?: boolean
  action: () => void
}

export type RefreshLevel = 'current' | 'visible' | 'all'

interface WorkspaceMemory {
  filters: Record<string, string>
  sortKey: string | null
  sortDir: 'asc' | 'desc' | null
  scrollPosition: number
  selection: string[]
  columnWidths?: Record<string, number>
  columnOrder?: string[]
  columnVisibility?: Record<string, boolean>
}

interface DesktopState {
  sidebarCollapsed: boolean
  sidebarOpen: boolean
  quickSearchOpen: boolean
  contextMenu: { x: number; y: number; items: ContextMenuItem[] } | null
  selectedRows: Set<string>

  workspaceState: WorkspaceState[]
  activeTab: string | null
  dragTabId: string | null

  globalFilters: GlobalFilters
  workspaceMemory: Record<string, WorkspaceMemory>
  refreshLevel: RefreshLevel
  notificationCount: number

  togglesidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setQuickSearchOpen: (open: boolean) => void
  showContextMenu: (x: number, y: number, items: ContextMenuItem[]) => void
  hideContextMenu: () => void
  setSelectedRows: (rows: Set<string>) => void
  clearSelectedRows: () => void

  setWorkspaceState: (state: WorkspaceState[]) => void
  addWorkspace: (ws: WorkspaceState) => void
  closeWorkspace: (id: string) => void
  setActiveTab: (id: string | null) => void
  pinTab: (id: string) => void
  reorderTabs: (fromIdx: number, toIdx: number) => void
  setDragTabId: (id: string | null) => void
  updateWorkspaceState: (id: string, patch: Partial<WorkspaceState>) => void

  setGlobalFilters: (filters: Partial<GlobalFilters>) => void
  resetGlobalFilters: () => void
  saveWorkspaceMemory: (id: string, memory: Partial<WorkspaceMemory>) => void
  getWorkspaceMemory: (id: string) => WorkspaceMemory | null
  setRefreshLevel: (level: RefreshLevel) => void
  triggerRefresh: (level: RefreshLevel) => void
  setNotificationCount: (count: number) => void
}

const defaultGlobalFilters: GlobalFilters = {
  companyId: null,
  companyName: null,
  branchId: null,
  branchName: null,
  warehouseId: null,
  warehouseName: null,
  dateFrom: null,
  dateTo: null,
  datePreset: null,
}

export const useDesktopStore = create<DesktopState>((set, get) => ({
  sidebarCollapsed: false,
  sidebarOpen: true,
  quickSearchOpen: false,
  contextMenu: null,
  selectedRows: new Set(),
  workspaceState: [],
  activeTab: null,
  dragTabId: null,

  globalFilters: { ...defaultGlobalFilters },
  workspaceMemory: {},
  refreshLevel: 'current',
  notificationCount: 0,

  togglesidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setQuickSearchOpen: (open) => set({ quickSearchOpen: open }),

  showContextMenu: (x, y, items) => set({ contextMenu: { x, y, items } }),
  hideContextMenu: () => set({ contextMenu: null }),
  setSelectedRows: (rows) => set({ selectedRows: rows }),
  clearSelectedRows: () => set({ selectedRows: new Set() }),

  setWorkspaceState: (state) => set({ workspaceState: state }),

  addWorkspace: (ws) =>
    set((s) => {
      if (ws.type === 'command-center') return { activeTab: s.workspaceState[0]?.id ?? ws.id }
      const exists = s.workspaceState.find((t) => t.type === ws.type && !t.pinned)
      if (exists) return { activeTab: exists.id }
      return {
        workspaceState: [...s.workspaceState, ws],
        activeTab: ws.id,
      }
    }),

  closeWorkspace: (id) =>
    set((s) => {
      const tab = s.workspaceState.find((t) => t.id === id)
      if (tab?.type === 'command-center' || tab?.pinned) return {}
      const tabs = s.workspaceState.filter((t) => t.id !== id)
      let activeTab = s.activeTab
      if (s.activeTab === id) {
        const closedIdx = s.workspaceState.findIndex((t) => t.id === id)
        activeTab = tabs[Math.min(closedIdx, tabs.length - 1)]?.id || null
      }
      return { workspaceState: tabs, activeTab }
    }),

  setActiveTab: (id) => set({ activeTab: id }),

  pinTab: (id) =>
    set((s) => {
      const tab = s.workspaceState.find((t) => t.id === id)
      if (tab?.type === 'command-center') return {}
      return {
        workspaceState: s.workspaceState.map((t) =>
          t.id === id ? { ...t, pinned: !t.pinned } : t
        ),
      }
    }),

  reorderTabs: (fromIdx, toIdx) =>
    set((s) => {
      const next = [...s.workspaceState]
      if (next[0]?.type === 'command-center' && (fromIdx === 0 || toIdx === 0)) return {}
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      return { workspaceState: next }
    }),

  setDragTabId: (id) => set({ dragTabId: id }),

  updateWorkspaceState: (id, patch) =>
    set((s) => ({
      workspaceState: s.workspaceState.map((t) =>
        t.id === id ? { ...t, ...patch } : t
      ),
    })),

  setGlobalFilters: (filters) =>
    set((s) => ({
      globalFilters: { ...s.globalFilters, ...filters },
    })),

  resetGlobalFilters: () => set({ globalFilters: { ...defaultGlobalFilters } }),

  saveWorkspaceMemory: (id, memory) =>
    set((s) => ({
      workspaceMemory: {
        ...s.workspaceMemory,
        [id]: { ...s.workspaceMemory[id], ...memory } as WorkspaceMemory,
      },
    })),

  getWorkspaceMemory: (id) => get().workspaceMemory[id] ?? null,

  setRefreshLevel: (level) => set({ refreshLevel: level }),

  triggerRefresh: (_level) => {
    set((s) => {
      const newLevel = _level === s.refreshLevel ? 'current' : _level
      return { refreshLevel: newLevel }
    })
  },

  setNotificationCount: (count) => set({ notificationCount: count }),
}))
