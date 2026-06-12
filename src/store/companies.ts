import { create } from 'zustand'

interface CompaniesState {
  refreshKey: number
  triggerRefresh: () => void
}

export const useCompaniesStore = create<CompaniesState>((set) => ({
  refreshKey: 0,
  triggerRefresh: () => set((state) => ({ refreshKey: state.refreshKey + 1 })),
}))
