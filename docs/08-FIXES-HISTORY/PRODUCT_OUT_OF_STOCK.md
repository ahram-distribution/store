# Product 3-State Status: Out of Stock

## Root Cause
The product management system had only two states (`is_active` boolean) which was insufficient for the business need of marking products as "visible but temporarily out of stock." Products with zero inventory were either hidden (confusing to customers who expected to see them) or shown as active with no way to prevent ordering.

A computed `outOfStock` field existed only in the storefront based on inventory quantity, but:
- It was derived purely from inventory (no manual override)
- Out-of-stock products were **hidden** from the storefront entirely
- Admin had no way to explicitly mark a product as "out of stock" vs "discontinued/hidden"

## Design Decision
**Approach:** Added `is_out_of_stock` boolean column to `products` table.

**Alternatives considered:**
1. **New `product_status` enum** (`'active' | 'out_of_stock' | 'hidden'`) — cleaner conceptually but requires rewriting all RPCs that use `is_active` boolean, breaking change
2. **Just use inventory=0** — no manual control, can't distinguish "out of stock" from "never had inventory"
3. **✅ `is_out_of_stock` column** — minimal impact (1 column, 1 new RPC), fully backward compatible

**3-State derivation:**
| State | is_active | is_out_of_stock | Storefront | Cart/Order |
|---|---|---|---|---|
| نشط | true | false | Visible + Sellable | Allowed |
| نفذت الكمية | true | true | Visible + Badge | Blocked |
| مخفي | false | any | Hidden | Blocked |

## Database Changes
### `supabase/migrations/20260922_product_out_of_stock.sql`

1. **New column:** `products.is_out_of_stock boolean DEFAULT false`
2. **New RPC:** `governed_set_product_out_of_stock(p_token, p_id, p_is_out_of_stock)`
3. **Updated:** `governed_activate_product()` now also resets `is_out_of_stock = false`
4. **Updated:** `get_governed_products()` returns `is_out_of_stock` field in JSON
5. **Updated:** `governed_create_order()` rejects orders containing out-of-stock products with `ORDER_CONTAINS_OUT_OF_STOCK_PRODUCTS` exception

## Business Rules
- **Storefront**: Out-of-stock products appear in search/browse with a yellow `نفذت الكمية` badge. Add-to-cart controls are hidden. Inactive (`is_active=false`) products remain hidden.
- **Cart**: Out-of-stock products cannot be added (blocked by `salesBlocked` check in cart store).
- **Order Review**: Re-checks `salesBlocked` before submission (already existed).
- **Order Creation (server)**: `governed_create_order` now validates and rejects out-of-stock items server-side.
- **Admin / Product Manager**: Status filter has 4 options: الكل | نشط | نفذت الكمية | مخفي. Edit modal uses a 3-state selector (radio button group).
- **Toggle behavior:** Card toggle button cycles: Active → Out of Stock → Active (back to active). Inactive → Active (via activate_product which resets out_of_stock).

## Files Changed
- `supabase/migrations/20260922_product_out_of_stock.sql` (NEW)
- `src/types/database.ts` — added `is_out_of_stock` to products Row/Insert/Update
- `src/services/products.ts` — added `isOutOfStock` to `ProductWithDetails`, updated `salesBlocked`
- `src/pages/storefront/StorefrontPage.tsx` — `mapProduct()` reads `is_out_of_stock`, filter shows active products (including out_of_stock)
- `src/pages/orders/OrderNewPage.tsx` — `mapProduct()` sets `outOfStock` from `is_out_of_stock`
- `src/components/storefront/ProductCard.tsx` — yellow badge for out_of_stock
- `src/components/products/ProductCard.tsx` — badge, toggle label for 3 states
- `src/pages/products/ProductManagerPage.tsx` — 3-state selector in edit modal, updated filter, updated toggle handler
- `src/pages/products/ProductsPage.tsx` — out_of_stock filter option + badge
- `src/pages/products/ProductProfilePage.tsx` — 3-state display

## Commit Hash
`5b064cd` — `feat(products): add is_out_of_stock for 3-state product status`

## Screenshots
(Before/After — add manually after deploy)
