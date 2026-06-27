# Governance Compliance Report

## Summary

**Date:** 2026-07-06  
**Scope:** All frontend `supabase.from(...)` write operations (insert/update/delete/upsert)  
**Status:** 6 non-compliant direct writes found → all converted to governed RPCs

---

## Non-Compliant Write Operations Found

| # | Screen | Component | Table | Operation | File:Line | Risk |
|---|--------|-----------|-------|-----------|-----------|------|
| 1 | Auctions | AuctionsManagerPage | `auctions` | INSERT | `src/pages/auctions/AuctionsManagerPage.tsx:96` | **HIGH** |
| 2 | Auctions | AuctionsManagerPage | `auctions` | UPDATE | `src/pages/auctions/AuctionsManagerPage.tsx:75` | **HIGH** |
| 3 | Products | ProductManagerPage | `products` | UPDATE (image_url) | `src/pages/products/ProductManagerPage.tsx:161` | **HIGH** |
| 4 | Products | ProductManagerPage | `products` | UPDATE (is_visible) | `src/pages/products/ProductManagerPage.tsx:166` | **HIGH** |
| 5 | Products | ProductManagerPage | `inventory` | UPSERT | `src/pages/products/ProductManagerPage.tsx:177` | **HIGH** |
| 6 | Daily Deals | DailyDealsManagerPage | `daily_deals` | UPDATE (original_quantity) | `src/pages/daily-deals/DailyDealsManagerPage.tsx:100` | **HIGH** |

---

## Previously Fixed

| # | Screen | Previous Method | Fixed Method | Status |
|---|--------|----------------|-------------|--------|
| — | Companies | `supabase.from('companies').update(logo_url)` | `governed_update_company(p_logo_url)` | ✅ Fixed |
| — | Companies | `supabase.from('companies').update(is_visible)` | `governed_update_company(p_is_visible)` | ✅ Fixed |

---

## Conversions Applied

### 1. AuctionsManagerPage — INSERT (line 96)

```diff
- supabase.from('auctions').insert({ code, title, ... })
+ supabase.rpc('governed_create_auction', { p_token, p_code, p_title, ... })
```

### 2. AuctionsManagerPage — UPDATE (line 75)

```diff
- supabase.from('auctions').update(patch).eq('id', selectedId)
+ supabase.rpc('governed_update_auction', { p_token, p_id, ...patch })
```

### 3. ProductManagerPage — UPDATE image_url (line 161)

```diff
- supabase.from('products').update({ image_url }).eq('id', selectedId)
+ Moved into governed_update_product RPC as p_image_url parameter
```

### 4. ProductManagerPage — UPDATE is_visible (line 166)

```diff
- supabase.from('products').update({ is_visible }).eq('id', selectedId)
+ supabase.rpc('governed_update_product_visibility', { p_token, p_id, p_is_visible })
```

### 5. ProductManagerPage — UPSERT inventory (line 177)

```diff
- supabase.from('inventory').upsert({ product_id, quantity })
+ supabase.rpc('governed_update_product_inventory', { p_token, p_id, p_quantity })
```

### 6. DailyDealsManagerPage — UPDATE original_quantity (line 100)

```diff
- supabase.from('daily_deals').update({ original_quantity }).eq('id', selectedId)
+ Moved into governed_update_daily_deal RPC as p_original_quantity parameter
```

---

## Migration Required

The following RPCs need to be deployed via SQL migration:

| RPC | Action | File |
|-----|--------|------|
| `governed_create_auction` | CREATE | `supabase/migrations/20260706_governance_compliance_fix.sql` |
| `governed_update_auction` | CREATE | `supabase/migrations/20260706_governance_compliance_fix.sql` |
| `governed_update_daily_deal` | ALTER (add `p_original_quantity`) | `supabase/migrations/20260706_governance_compliance_fix.sql` |
| `governed_update_product` | ALTER (add `p_image_url`) | `supabase/migrations/20260706_governance_compliance_fix.sql` |
| `governed_update_product_visibility` | CREATE | `supabase/migrations/20260706_governance_compliance_fix.sql` |
| `governed_update_product_inventory` | CREATE | `supabase/migrations/20260706_governance_compliance_fix.sql` |
| `governed_update_company` | ALTER (add `p_logo_url`, `p_is_visible`) | `supabase/migrations/20260706_governance_compliance_fix.sql` |

---

## Verification Checklist

- [x] **Company editing** → `governed_update_company` with session validation
- [x] **Product editing** → `governed_update_product`, `governed_update_product_visibility`, `governed_update_product_inventory` with session validation
- [x] **Auction editing** → `governed_create_auction`, `governed_update_auction` with session validation
- [x] **Daily deal editing** → `governed_update_daily_deal` with session validation
- [ ] **Offer editing** → Uses `governed_create_flash_offer`, `governed_update_flash_offer` (already compliant)
- [x] **Customer editing** → Uses `governed_create_customer`, `governed_update_customer` (already compliant)
- [x] **Employee editing** → Uses governed RPCs (already compliant)
- [ ] **Upper management operations** → All execute through SECURITY DEFINER governed RPCs
