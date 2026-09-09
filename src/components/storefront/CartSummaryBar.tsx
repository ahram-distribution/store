import { useNavigate } from 'react-router-dom'
import { useCartStore } from '../../store/cart'
import { formatInteger, formatSmartMoney } from '../../utils/numbers'

/** Shared storefront Cart Summary Bar.
 *
 * Rendered above the search bar on BOTH Storefront Home (/storefront) and the
 * Products screen (/storefront/products). Shows exactly three values sourced
 * from the existing cart state/totals — no duplicated calculations:
 *
 *   1. إجمالي السلة   → totals.netTotal (existing final cart total)
 *   2. عدد المنتجات   → totals.itemCount (existing product-line count)
 *   3. benefit value  → Bonus Tiers active: bonusCredit (إجمالي البونص)
 *                       otherwise: totals.totalDiscount (إجمالي الخصم)
 *
 * Sticky under the app TopBar (top-14 = its 56px height), z-40 < TopBar z-50,
 * so it stays visible while scrolling without covering the header or becoming
 * a competing sticky container. Returns null when the cart is empty so no empty
 * sticky area is left behind. Clicking opens the cart (existing behavior). */
export function CartSummaryBar() {
  const navigate = useNavigate()
  const items = useCartStore((s) => s.items)
  const bonusMode = useCartStore((s) => s.bonusMode)
  const bonusCredit = useCartStore((s) => s.bonusCredit)
  const getTotals = useCartStore((s) => s.getTotals)

  const totals = getTotals()

  if (items.length === 0) return null

  return (
    <button
      onClick={() => navigate('/cart')}
      className="sticky top-14 z-40 w-full rounded-lg bg-primary text-white px-2 py-2 shadow-sm active:opacity-90 transition-opacity"
    >
      <div className="flex items-stretch gap-1 text-center">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] opacity-80">إجمالي السلة</div>
          <div className="text-xs sm:text-sm font-bold truncate" dir="ltr">{formatSmartMoney(totals.netTotal)}</div>
        </div>
        <div className="flex-1 min-w-0 border-s border-white/25">
          <div className="text-[10px] opacity-80">عدد المنتجات</div>
          <div className="text-xs sm:text-sm font-bold truncate">{formatInteger(totals.itemCount)}</div>
        </div>
        <div className="flex-1 min-w-0 border-s border-white/25">
          <div className="text-[10px] opacity-80">{bonusMode ? 'إجمالي البونص' : 'إجمالي الخصم'}</div>
          <div className={`text-xs sm:text-sm font-bold truncate ${bonusMode ? 'text-amber-200' : ''}`} dir="ltr">
            {formatSmartMoney(bonusMode ? bonusCredit : totals.totalDiscount)}
          </div>
        </div>
      </div>
    </button>
  )
}