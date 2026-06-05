import { create } from 'zustand'
import type { VisitRecord } from '../types/storefront'

interface VisitsState {
  visits: VisitRecord[]
  activeVisit: VisitRecord | null
  setVisits: (visits: VisitRecord[]) => void
  setActiveVisit: (visit: VisitRecord | null) => void
  addVisit: (visit: VisitRecord) => void
  updateVisit: (id: string, updates: Partial<VisitRecord>) => void
}

export const useVisitsStore = create<VisitsState>((set) => ({
  visits: [],
  activeVisit: null,
  setVisits: (visits) => set({ visits }),
  setActiveVisit: (visit) => set({ activeVisit: visit }),
  addVisit: (visit) => set((s) => ({ visits: [visit, ...s.visits] })),
  updateVisit: (id, updates) => set((s) => ({
    visits: s.visits.map((v) => v.id === id ? { ...v, ...updates } : v),
    activeVisit: s.activeVisit?.id === id ? { ...s.activeVisit, ...updates } : s.activeVisit,
  })),
}))
