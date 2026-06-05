import { create } from 'zustand'
import type { Address } from '../types/storefront'

interface AccountState {
  addresses: Address[]
  defaultAddressId: string | null
  setAddresses: (addresses: Address[]) => void
  setDefaultAddress: (id: string) => void
  addAddress: (address: Address) => void
}

export const useAccountStore = create<AccountState>((set) => ({
  addresses: [],
  defaultAddressId: null,
  setAddresses: (addresses) => set({ addresses, defaultAddressId: addresses.find((a) => a.isDefault)?.id ?? null }),
  setDefaultAddress: (id) => set((s) => ({ defaultAddressId: id, addresses: s.addresses.map((a) => ({ ...a, isDefault: a.id === id })) })),
  addAddress: (address) => set((s) => ({ addresses: [...s.addresses, address] })),
}))
