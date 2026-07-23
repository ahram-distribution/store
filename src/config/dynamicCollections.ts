import { supabase } from '../lib/supabase'

export const CollectionStrategy = {
  RecentlyAvailable: 'recently_available',
} as const

export type CollectionStrategy = (typeof CollectionStrategy)[keyof typeof CollectionStrategy]

interface DynamicCollectionConfig {
  strategy: CollectionStrategy
}

export const DYNAMIC_COLLECTIONS: Record<string, DynamicCollectionConfig> = {
  '6666': { strategy: CollectionStrategy.RecentlyAvailable },
}

const COLLECTION_LOADERS: Record<CollectionStrategy, (token: string) => Promise<{ data: any; error: any }>> = {
  [CollectionStrategy.RecentlyAvailable]: async (token) =>
    supabase.rpc('get_recently_available_products', { p_token: token }),
}

export async function loadCollection(strategy: CollectionStrategy, token: string) {
  const loader = COLLECTION_LOADERS[strategy]
  if (!loader) throw new Error(`Unknown collection strategy: ${strategy}`)
  return loader(token)
}
