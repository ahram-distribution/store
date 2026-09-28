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

/**
 * Dynamic collection loaders.
 *
 * These receive the SAME paging/search inputs as the static catalog path, so
 * a dynamic collection paginates and searches on the server exactly like a
 * static one and never downloads the whole collection.
 *
 * `get_recently_available_products` (single argument, no LIMIT/OFFSET) is
 * intentionally no longer used here: it always returned the entire collection
 * in a single response. The governed paged variant applies the identical
 * recently-available business rule while adding mandatory pagination, search,
 * authoritative count and server-side governorate visibility.
 */
const COLLECTION_LOADERS: Record<
  CollectionStrategy,
  (args: {
    token: string
    page: number
    perPage: number
    search: string | null
    governorateId: string | null
    countOnly: boolean
  }) => Promise<{ data: any; error: any }>
> = {
  [CollectionStrategy.RecentlyAvailable]: ({ token, page, perPage, search, governorateId, countOnly }) =>
    supabase.rpc('get_recently_available_products_paged', {
      p_token: token,
      p_governorate_id: governorateId,
      p_search: search,
      p_page: page,
      p_per_page: perPage,
      p_count_only: countOnly,
    }),
}

export async function loadCollection(
  strategy: CollectionStrategy,
  args: {
    token: string
    page: number
    perPage: number
    search: string | null
    governorateId: string | null
    countOnly: boolean
  },
) {
  const loader = COLLECTION_LOADERS[strategy]
  if (!loader) throw new Error(`Unknown collection strategy: ${strategy}`)
  return loader(args)
}
