import { create } from 'zustand'

interface CatalogState {
  products: any[]
  setProducts: (rows: any[]) => void
  updateProduct: (id: string, patch: Partial<any>) => void
  removeProduct: (id: string) => void
}

export const useCatalogStore = create<CatalogState>((set) => ({
  products: [],
  setProducts: (rows) => set({ products: Array.isArray(rows) ? rows : [] }),
  updateProduct: (id, patch) =>
    set((s) => ({ products: s.products.map((p) => (p && p.id === id ? { ...p, ...patch } : p)) })),
  removeProduct: (id) =>
    set((s) => ({ products: s.products.filter((p) => !p || p.id !== id) })),
}))
