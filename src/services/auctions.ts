import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import type { AuctionRecordV2, AuctionDetailRecordV2, AuctionBidRecord, AuctionActivityRecord } from '../types/storefront'

function mapRow(row: any): AuctionRecordV2 {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    description: row.description,
    image_url: row.image_url,
    starting_price: Number(row.starting_price),
    current_price: Number(row.current_price),
    bid_increment: Number(row.bid_increment),
    deposit_amount: row.deposit_amount ? Number(row.deposit_amount) : null,
    start_time: row.start_time,
    end_time: row.end_time,
    status: row.status,
    winner_id: row.winner_id,
    winner_amount: row.winner_amount ? Number(row.winner_amount) : null,
    participant_count: row.participant_count ?? 0,
    bid_count: row.bid_count ?? 0,
    items: (row.items ?? []).map((i: any) => ({ id: i.id, product_id: i.product_id, product_name: i.product_name, quantity: i.quantity })),
    created_at: row.created_at,
    updated_at: row.updated_at,
    participant_status: row.participant_status ?? { status: 'visitor' },
  }
}

function mapDetail(row: any): AuctionDetailRecordV2 {
  const base = mapRow(row)
  return {
    ...base,
    current_leader_name: row.current_leader_name ?? null,
    current_leader_bid: row.current_leader_bid ? Number(row.current_leader_bid) : null,
    bids: (row.bids ?? []).map((b: any) => ({
      id: b.id,
      participant_id: b.participant_id,
      participant_name: b.participant_name,
      amount: Number(b.amount),
      is_winning: b.is_winning,
      placed_at: b.placed_at,
    })),
    activity: (row.activity ?? []).map((a: any) => ({
      id: a.id,
      activity_type: a.activity_type,
      actor_name: a.actor_name,
      message: a.message,
      metadata: a.metadata,
      created_at: a.created_at,
    })),
  }
}

export const auctionService = {
  async getAll(): Promise<AuctionRecordV2[]> {
    const token = useAuthStore.getState().token
    const { data, error } = token
      ? await supabase.rpc('get_governed_auctions', { p_token: token })
      : await supabase.rpc('get_governed_auctions', {})
    if (error) throw error
    return (data ?? []).map(mapRow)
  },

  async getById(id: string): Promise<AuctionDetailRecordV2 | null> {
    const token = useAuthStore.getState().token
    const { data, error } = token
      ? await supabase.rpc('get_governed_auction_detail', { p_auction_id: id, p_token: token })
      : await supabase.rpc('get_governed_auction_detail', { p_auction_id: id })
    if (error) throw error
    if (!data || data.error === 'NOT_FOUND') return null
    return mapDetail(data)
  },

  async requestParticipation(auctionId: string): Promise<{ success: boolean; participant_id?: string; error?: string }> {
    const token = useAuthStore.getState().token
    if (!token) return { success: false, error: 'INVALID_SESSION' }
    const { data, error } = await supabase.rpc('governed_request_auction_participation', { p_token: token, p_auction_id: auctionId })
    if (error) return { success: false, error: error.message }
    if (data?.error) return { success: false, error: data.error, participant_id: data.participant_id }
    return { success: true, participant_id: data.participant_id }
  },

  async placeBid(auctionId: string, amount: number): Promise<{ success: boolean; bid_id?: string; new_current_price?: number; error?: string; minimum_acceptable?: number }> {
    const token = useAuthStore.getState().token
    if (!token) return { success: false, error: 'INVALID_SESSION' }
    const { data, error } = await supabase.rpc('governed_place_bid', { p_token: token, p_auction_id: auctionId, p_amount: amount })
    if (error) return { success: false, error: error.message }
    if (data?.error) return { success: false, error: data.error, minimum_acceptable: data.minimum_acceptable }
    return { success: true, bid_id: data.bid_id, new_current_price: Number(data.new_current_price) }
  },

  subscribeBids(auctionId: string, onBid: (bid: AuctionBidRecord) => void): () => void {
    const channel = supabase.channel(`auction-bids-${auctionId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'auction_bids', filter: `auction_id=eq.${auctionId}` },
        (payload: any) => {
          const r = payload.new
          onBid({
            id: r.id,
            participant_id: r.participant_id,
            participant_name: '',
            amount: Number(r.amount),
            is_winning: r.is_winning,
            placed_at: r.placed_at,
          })
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  },

  subscribeActivity(auctionId: string, onActivity: (act: AuctionActivityRecord) => void): () => void {
    const channel = supabase.channel(`auction-activity-${auctionId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'auction_activity', filter: `auction_id=eq.${auctionId}` },
        (payload: any) => {
          const r = payload.new
          onActivity({
            id: r.id,
            activity_type: r.activity_type,
            actor_name: r.actor_name,
            message: r.message,
            metadata: r.metadata,
            created_at: r.created_at,
          })
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  },

  subscribeParticipants(auctionId: string, onCount: (count: number) => void): () => void {
    const channel = supabase.channel(`auction-participants-${auctionId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'auction_participants', filter: `auction_id=eq.${auctionId}` },
        () => {
          supabase.rpc('get_governed_auction_detail', { p_auction_id: auctionId, p_token: null }).then(({ data }) => {
            if (data) onCount(data.participant_count ?? 0)
          })
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  },
}
