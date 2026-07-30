import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

function getSessionToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export async function checkCartAvailability(productId: string, finalQuantity: number): Promise<boolean> {
  if (finalQuantity <= 0) return true
  const token = getSessionToken()
  if (!token) return true
  const { data } = await supabase.rpc('governed_check_product_availability', {
    p_product_id: productId,
    p_requested_quantity: finalQuantity,
  })
  if (data && typeof data === 'object' && 'available' in data && data.available === false) {
    return false
  }
  return true
}

export function showUnavailableToast() {
  toast.error('الكمية المطلوبة غير متاحة حاليًا، برجاء تقليل الكمية')
}
