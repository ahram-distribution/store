import { create } from 'zustand'
import type { CollectionRecord } from '../types/storefront'

interface CollectionsState {
  collections: CollectionRecord[]
  setCollections: (collections: CollectionRecord[]) => void
  addCollection: (collection: CollectionRecord) => void
}

export const useCollectionsStore = create<CollectionsState>((set) => ({
  collections: [],
  setCollections: (collections) => set({ collections }),
  addCollection: (collection) => set((s) => ({ collections: [collection, ...s.collections] })),
}))
