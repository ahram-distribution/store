# Screens & UI Blueprint

**Last Updated:** 2026-06-05 (Phase 2.6 — إضافة شاشة النشاط الموحد وربط Route)

> Reference document for all screens, UI flows, runtime state, and approved design rules.
>
> This is the single source of truth for UI/UX decisions. All future development must reference this document before creating new screens or modifying existing ones.

---

## Part I: Current Runtime Reality Report

Describes the actual current state of every module as it exists in code and database. No speculation, no recommendations.

---

### 1. المتجر Store

| الحالة | موجود ويعمل |
|---|---|
| Frontend Route | `/storefront`, `/storefront/products` |
| الملفات الرئيسية | `src/pages/storefront/CompaniesPage.tsx`, `src/pages/storefront/StorefrontPage.tsx`, `src/components/storefront/`, `src/store/cart.ts`, `src/engine/pricing.ts` |
| الجداول المستخدمة | `companies`, `products`, `product_units`, `inventory`, `tiers`, `customers`, `order_daily_deals`, `order_flash_offers`, `orders`, `order_items` |
| Views المستخدمة | لا يوجد |
| RPCs المستخدمة | `get_governed_products`, `get_governed_customers`, `get_governed_active_daily_deals`, `get_governed_active_flash_offers`, `governed_create_order`, `governed_add_order_flash_offers`, `governed_add_order_daily_deals`, `governed_submit_order`, `governed_create_location` |
| هل تظهر للمستخدم؟ | نعم — عامة بدون تسجيل دخول، وتعرض كامل مع تسجيل الدخول |
| بيانات حقيقية أم تجريبية؟ | حقيقية |

---

### 2. السلة Cart

| الحالة | موجود ويعمل |
|---|---|
| Frontend Route | `/cart`, `/order-review` |
| الملفات الرئيسية | `src/pages/storefront/CartPage.tsx`, `src/pages/storefront/OrderReviewPage.tsx`, `src/store/cart.ts`, `src/engine/pricing.ts` |
| الجداول المستخدمة | (حالة محلية — لا استعلام مباشر) |
| Views المستخدمة | لا يوجد |
| RPCs المستخدمة | `governed_create_order`, `governed_add_order_flash_offers`, `governed_add_order_daily_deals`, `governed_submit_order`, `governed_create_location` (عند تأكيد الطلب فقط) |
| هل تظهر للمستخدم؟ | نعم — بعد تسجيل الدخول |
| بيانات حقيقية أم تجريبية؟ | حقيقية (تحتوي على بيانات من قاعدة البيانات لحظة add to cart) |

---

### 3. الطلبات Orders

| الحالة | موجود ويعمل |
|---|---|
| Frontend Route | `/orders`, `/orders/:id`, `/orders/:id/edit`, `/orders/new`, `/orders/approval-queue` |
| الملفات الرئيسية | `src/pages/orders/OrdersPage.tsx`, `src/pages/orders/OrderDetailPage.tsx`, `src/pages/orders/OrderEditPage.tsx`, `src/pages/orders/OrderNewPage.tsx`, `src/pages/orders/ApprovalQueuePage.tsx` |
| الجداول المستخدمة | `orders`, `order_items`, `order_status_history`, `order_modification_history`, `order_daily_deals`, `order_flash_offers`, `delivery_tracking`, `preparation_records`, `customers`, `employees` |
| Views المستخدمة | لا يوجد |
| RPCs المستخدمة | `get_governed_orders`, `get_governed_order`, `get_governed_order_items`, `get_governed_order_history`, `get_governed_order_daily_deals`, `get_governed_order_flash_offers`, `governed_create_order`, `governed_submit_order`, `governed_approve_order`, `governed_cancel_order`, `governed_defer_order`, `governed_reject_order`, `governed_change_order_status`, `governed_delete_order`, `get_order_status_counts` |
| هل تظهر للمستخدم؟ | نعم — بعد تسجيل الدخول (للموظفين فقط مع صلاحيات) |
| بيانات حقيقية أم تجريبية؟ | حقيقية — 42 طلبًا متبقيًا بعد تنظيف يونيو 2026 |

---

### 4. الشرائح Pricing Tiers

| الحالة | موجود ويعمل |
|---|---|
| Frontend Route | `/tiers` (عام وخاص), `/daily-deals/manage`, `/flash-offers/manage` |
| الملفات الرئيسية | `src/pages/tiers/TierSystemPage.tsx`, `src/services/tiers.ts`, `src/engine/pricing.ts`, `src/store/cart.ts` |
| الجداول المستخدمة | `tiers`, `tier_company_exceptions`, `tier_product_exceptions` |
| Views المستخدمة | لا يوجد |
| RPCs المستخدمة | `get_governed_tiers`, `governed_create_tier`, `governed_update_tier`, `governed_set_tier_company_exception`, `governed_remove_tier_company_exception`, `governed_set_tier_product_exception`, `governed_remove_tier_product_exception` |
| هل تظهر للمستخدم؟ | نعم — كصفحة اختيار شريحة في المتجر وأيضًا كصفحة إدارة للمديرين |
| بيانات حقيقية أم تجريبية؟ | حقيقية (جداول `tiers` فيها 4 شرائح نشطة) |

---

### 5. العروض اليومية Daily Deals

| الحالة | موجود ويعمل |
|---|---|
| Frontend Route | `/daily-deals`, `/daily-deals/:id`, `/daily-deals/manage` |
| الملفات الرئيسية | `src/pages/daily-deals/DailyDealsPage.tsx`, `src/pages/daily-deals/DailyDealDetailPage.tsx`, `src/pages/daily-deals/DailyDealsManagementPage.tsx`, `src/store/cart.ts` |
| الجداول المستخدمة | `daily_deals`, `daily_deal_items`, `products`, `order_daily_deals` |
| Views المستخدمة | لا يوجد |
| RPCs المستخدمة | `get_governed_active_daily_deals`, `get_governed_daily_deals`, `governed_create_daily_deal`, `governed_update_daily_deal`, `governed_activate_daily_deal`, `governed_cancel_daily_deal`, `governed_add_order_daily_deals` |
| هل تظهر للمستخدم؟ | نعم — كصفحة عامة بدون تسجيل وكصفحة إدارة |
| بيانات حقيقية أم تجريبية؟ | حقيقية (لا يوجد عروض حالياً — كل العروض مُلغاة أو منتهية) |

---

### 6. عرض الساعة Flash Offers / Hour Deal

| الحالة | موجود ويعمل |
|---|---|
| Frontend Route | `/flash-offers`, `/flash-offers/:id`, `/flash-offers/manage` |
| الملفات الرئيسية | `src/pages/flash-offers/FlashOffersPage.tsx`, `src/pages/flash-offers/FlashOfferDetailPage.tsx`, `src/pages/flash-offers/FlashOffersManagementPage.tsx`, `src/store/cart.ts` |
| الجداول المستخدمة | `flash_offers`, `flash_offer_items`, `products`, `order_flash_offers` |
| Views المستخدمة | لا يوجد |
| RPCs المستخدمة | `get_governed_active_flash_offers`, `get_governed_flash_offers`, `governed_create_flash_offer`, `governed_update_flash_offer`, `governed_activate_flash_offer`, `governed_cancel_flash_offer`, `governed_add_order_flash_offers` |
| هل تظهر للمستخدم؟ | نعم — كصفحة عامة بدون تسجيل وكصفحة إدارة |
| بيانات حقيقية أم تجريبية؟ | حقيقية (لا يوجد عروض حالياً — كلها منتهية) |

---

### 7. المزاد Auction

| الحالة | موجود ويعمل |
|---|---|
| Frontend Route | `/auctions`, `/auctions/:id` |
| الملفات الرئيسية | `src/pages/auctions/AuctionsPage.tsx`, `src/pages/auctions/AuctionDetailPage.tsx` |
| الجداول المستخدمة | `auctions`, `auction_items`, `auction_participants`, `auction_bids`, `auction_activity`, `auction_awards` |
| Views المستخدمة | لا يوجد |
| RPCs المستخدمة | `get_governed_auctions`, `get_governed_auction_detail`, `governed_request_auction_participation`, `governed_approve_participant`, `governed_place_bid`, `governed_end_auction` |
| هل تظهر للمستخدم؟ | نعم — كصفحة عامة بدون تسجيل وكصفحة مزايدة مع تسجيل |
| بيانات حقيقية أم تجريبية؟ | حقيقية (يوجد مزادات في قاعدة البيانات) |

---

### 8. المنتجات Products

| الحالة | موجود ويعمل |
|---|---|
| Frontend Route | `/products` (إدارة), `/storefront/products` (متجر) |
| الملفات الرئيسية | `src/pages/products/ProductsPage.tsx`, `src/services/products.ts` |
| الجداول المستخدمة | `products`, `product_units`, `inventory`, `companies` |
| Views المستخدمة | لا يوجد |
| RPCs المستخدمة | `get_governed_products`, `get_governed_companies`, `governed_create_product`, `governed_update_product`, `governed_change_product_company`, `governed_update_product_pricing`, `governed_update_product_units`, `governed_deactivate_product`, `governed_activate_product` |
| هل تظهر للمستخدم؟ | نعم — صفحة إدارة للموظفين، وصفحة متجر للجميع |
| بيانات حقيقية أم تجريبية؟ | حقيقية |

---

### 9. الشركات Brands / Companies

| الحالة | موجود ويعمل |
|---|---|
| Frontend Route | `/companies` (إدارة), `/companies/:id`, `/storefront` (عام) |
| الملفات الرئيسية | `src/pages/companies/CompaniesPage.tsx`, `src/pages/companies/CompanyProfilePage.tsx`, `src/pages/storefront/CompaniesPage.tsx`, `src/services/companies.ts` |
| الجداول المستخدمة | `companies` |
| Views المستخدمة | لا يوجد |
| RPCs المستخدمة | `get_governed_companies`, `get_company_products`, `get_company_analytics`, `governed_create_company`, `governed_update_company`, `governed_deactivate_company`, `governed_activate_company` |
| هل تظهر للمستخدم؟ | نعم — عامة (شبكة شعارات) وإدارة (CRUD كامل) |
| بيانات حقيقية أم تجريبية؟ | حقيقية |

---

### 10. التسعير Pricing

| الحالة | موجود ويعمل (حساب client-side في محرك pricing, التخزين server-side في جداول) |
|---|---|
| Frontend Route | لا يوجد route مستقل — مدمج في `/storefront/products`, `/cart`, `/tiers` |
| الملفات الرئيسية | `src/engine/pricing.ts`, `src/store/cart.ts`, `src/services/tiers.ts` |
| الجداول المستخدمة | `products` (سعر الكرتونة), `tiers` (نسبة الخصم), `tier_product_exceptions`, `tier_company_exceptions`, `daily_deals` (سعر ثابت), `flash_offers` (سعر ثابت) |
| Views المستخدمة | لا يوجد |
| RPCs المستخدمة | `_calc_base_unit_price` (دالة مساعدة), `_get_effective_tier_discount` (دالة مساعدة), `get_governed_tiers`, `governed_update_product_pricing`, `governed_set_tier_company_exception`, `governed_set_tier_product_exception` |
| هل تظهر للمستخدم؟ | نعم — كأسعار محسوبة على بطاقات المنتجات وفي ملخص السلة |
| بيانات حقيقية أم تجريبية؟ | حقيقية (أسعار من `products.carton_price` وخصومات من `tiers.discount_percent`) |

---

### 11. العملاء Customers

| الحالة | موجود ويعمل |
|---|---|
| Frontend Route | `/customers`, `/customers/:id`, `/customers/new`, `/customers/:id/analytics` |
| الملفات الرئيسية | `src/pages/customers/CustomersPage.tsx`, `src/pages/customers/CustomerProfilePage.tsx`, `src/pages/customers/NewCustomerPage.tsx`, `src/services/customers.ts` |
| الجداول المستخدمة | `customers`, `customer_contacts`, `customer_addresses`, `customer_ownership_history`, `customer_credit_accounts` |
| Views المستخدمة | لا يوجد |
| RPCs المستخدمة | `get_governed_customers`, `get_governed_customer`, `get_governed_customer_addresses`, `get_governed_customer_contacts`, `get_governed_customer_ownership_history`, `get_governed_customer_credit_account`, `get_customer_orders`, `get_customer_collections`, `get_customer_visits`, `governed_create_customer`, `governed_update_customer`, `governed_deactivate_customer`, `governed_activate_customer`, `governed_change_customer_ownership` |
| هل تظهر للمستخدم؟ | نعم — للموظفين مع صلاحية `customers.read` |
| بيانات حقيقية أم تجريبية؟ | حقيقية — 30 عميلاً في قاعدة البيانات |

---

### 12. الزيارات Visits

| الحالة | موجود ويعمل |
|---|---|
| Frontend Route | `/visits`, `/visits/new`, `/visits/:id`, `/visits/screen` |
| الملفات الرئيسية | `src/pages/visits/VisitsPage.tsx`, `src/pages/visits/NewVisitPage.tsx`, `src/pages/visits/VisitDetailPage.tsx`, `src/pages/visits/VisitScreen.tsx`, `src/store/visits.ts` |
| الجداول المستخدمة | `visits`, `employees`, `customers`, `unified_locations` |
| Views المستخدمة | لا يوجد |
| RPCs المستخدمة | `get_governed_visits`, `get_governed_visit`, `governed_create_visit`, `governed_update_visit`, `governed_checkin_visit`, `governed_checkout_visit`, `governed_create_location` |
| هل تظهر للمستخدم؟ | نعم — للموظفين مع صلاحية `visits.create` |
| بيانات حقيقية أم تجريبية؟ | تم مسح جميع الزيارات — 0 حاليًا |

---

### الجدول النهائي

| Feature | Current State | Route | DB Objects |
|---|---|---|---|
| Store | موجود ويعمل | `/storefront`, `/storefront/products` | `companies`, `products`, `product_units`, `inventory`, `get_governed_products` |
| Cart | موجود ويعمل | `/cart`, `/order-review` | (حالة محلية — RPCs عند الإرسال فقط: `governed_create_order`, `governed_submit_order`) |
| Orders | موجود ويعمل | `/orders`, `/orders/:id`, `/orders/:id/edit`, `/orders/new`, `/orders/approval-queue` | `orders`, `order_items`, `order_status_history`, `order_modification_history`, `delivery_tracking`, `preparation_records`, `get_governed_orders`, `get_governed_order` |
| Pricing Tiers | موجود ويعمل | `/tiers` | `tiers`, `tier_company_exceptions`, `tier_product_exceptions`, `get_governed_tiers`, `_get_effective_tier_discount` |
| Daily Deals | موجود ويعمل | `/daily-deals`, `/daily-deals/:id`, `/daily-deals/manage` | `daily_deals`, `daily_deal_items`, `get_governed_active_daily_deals` |
| Flash Offers | موجود ويعمل | `/flash-offers`, `/flash-offers/:id`, `/flash-offers/manage` | `flash_offers`, `flash_offer_items`, `get_governed_active_flash_offers` |
| Auction | موجود ويعمل | `/auctions`, `/auctions/:id` | `auctions`, `auction_items`, `auction_participants`, `auction_bids`, `auction_activity`, `auction_awards`, `get_governed_auctions` |
| Products | موجود ويعمل | `/products` (إدارة), `/storefront/products` (متجر) | `products`, `product_units`, `inventory`, `get_governed_products`, `governed_create_product` |
| Brands/Companies | موجود ويعمل | `/companies`, `/companies/:id`, `/storefront` | `companies`, `get_governed_companies`, `governed_create_company` |
| Pricing | موجود ويعمل (client-side engine) | (مدمج في store/cart/tiers) | `products.carton_price`, `tiers.discount_percent`, `tier_product_exceptions`, `tier_company_exceptions`, `_calc_base_unit_price`, `_get_effective_tier_discount` |
| Customers | موجود ويعمل | `/customers`, `/customers/:id`, `/customers/new` | `customers`, `customer_contacts`, `customer_addresses`, `customer_ownership_history`, `get_governed_customers` |
| Visits | موجود ويعمل | `/visits`, `/visits/new`, `/visits/:id`, `/visits/screen` | `visits`, `get_governed_visits`, `governed_create_visit`, `governed_checkin_visit`, `governed_checkout_visit` |

---

### Store Runtime Flow

#### التدفق الفعلي (دخول المتجر ← اختيار الشريحة ← السلة ← إرسال الطلب)

```
[1] CompaniesPage (/storefront)
    │
    ├── استعلام: supabase.from('companies').select('id, company_name, logo_url').eq('is_active', true)
    │     (استعلام مباشر، ليس RPC)
    │
    ├── يعرض شبكة شعارات الشركات النشطة
    │
    └── ينقر المستخدم على شركة → /storefront/products?companyId=X

[2] StorefrontPage (/storefront/products)
    │
    ├── RPC: get_governed_products(p_token, p_company_id)
    │     └── يرجع: products + product_units + inventory (منضمة في الـ RPC)
    │
    ├── استعلام: supabase.from('tiers').select('*').eq('is_active', true).eq('is_visible', true)
    │     └── يرجع: قائمة الشرائح المتاحة (استعلام مباشر)
    │
    ├── RPC: get_governed_customers(p_token) [إذا كان المستخدم موظفًا]
    │
    ├── المستخدم يختار شريحة سعرية
    │     └── cartStore.selectTier(tierId) → recalculateAll()
    │           └── pricing engine يعيد حساب أسعار كل item في السلة
    │
    ├── المستخدم يضيف منتج إلى السلة
    │     └── cartStore.addItem(product, unitType, quantity)
    │           └── engine/pricing.ts: computeProductPrices() + getEffectiveUnitPrice()
    │                 └── computeTierPrice(basePrice, selectedTier)
    │                       └── basePrice * (1 - tier.discountPercent / 100)
    │
    └── المستخدم يضيف عرض يومي/عرض ساعة
          └── cartStore.addDeal(deal) / addFlashOffer(offer)
                └── سعر ثابت (fixedPrice) لا يتأثر بالشريحة

[3] CartPage (/cart)
    │
    ├── يعرض: items (سلة), dealItems, flashOfferItems
    ├── يعرض: TierSelector, TierMinimumNotice, CartSummary
    ├── computeCartTotals(items, tier, dealItems, flashOfferItems)
    │     └── productSubtotal = sum(item.totalPrice)
    │     └── dealTotal = sum(deal.fixedPrice * quantity)
    │     └── tierDiscount = reverse-engineered من totalPrice إلى basePrice
    │     └── netTotal = productSubtotal - tierDiscount + dealTotal
    │
    └── المستخدم يضغط "متابعة الطلب" → /order-review

[4] OrderReviewPage (/order-review)
    │
    ├── التقاط GPS:
    │     └── locationService.captureAndStoreLocation()
    │           ├── navigator.geolocation.watchPosition (high accuracy, 15s timeout)
    │           └── RPC: governed_create_location(p_token, lat, lng, accuracy)
    │
    ├── إنشاء الطلب:
    │     └── RPC: governed_create_order(p_token, customer_id, tier_id, items[], location, ...)
    │           └── يُنشئ سجل في جدول orders + order_items
    │           └── الأسعار مجمدة (frozen) في وقت الإنشاء
    │
    ├── إرفاق عروض الساعة (إن وجدت):
    │     └── RPC: governed_add_order_flash_offers(p_token, order_id, offers[])
    │
    ├── إرفاق العروض اليومية (إن وجدت):
    │     └── RPC: governed_add_order_daily_deals(p_token, order_id, deals[])
    │
    ├── إرسال الطلب:
    │     └── RPC: governed_submit_order(p_token, order_id)
    │           └── يغير حالة الطلب من draft إلى submitted
    │
    ├── إشعار واتساب:
    │     └── sendFullOrderToWhatsApp() → يفتح wa.me link
    │
    ├── cartStore.clearCart()
    │
    └── Navigate إلى /orders
```

**ملاحظة:** يوجد مسار بديل (`/checkout`, `CheckoutPage.tsx`) يعمل 100% client-side بدون RPC. لا يستخدم حاليًا في التدفق الرئيسي.

---

### Pricing Runtime Flow

#### كيف يتم حساب الأسعار فعليًا داخل النظام

##### 1. السعر الأساسي (Base Price)

| المصدر | المنتج |
|---|---|
| **DB** | `products.carton_price` + `products.carton_quantity` |
| **JS Engine** | `engine/pricing.ts`: `computePiecePrice(cartonPrice / cartonQuantity)`, `computeDozenPrice(piecePrice * 12)`, `getUnitPrice(cartonPrice, cartonQuantity, unitType)` |
| **DB Helper** | `_calc_base_unit_price(p_carton_price, p_carton_quantity, p_unit_type)` — نفس المنطق في PLPGSQL (IMMUTABLE) |

**التدفق:**
```
products.carton_price = 120, products.carton_quantity = 12
  → piece = 120/12 = 10.00
  → dozen = 10 × 12 = 120.00
  → carton = 120.00
```

##### 2. الشرائح (Tier Discount)

| المصدر | المنتج |
|---|---|
| **DB** | `tiers.discount_percent` (الخصم الافتراضي للشريحة) |
| **DB** | `tier_product_exceptions.discount_percent` (استثناء لكل منتج) |
| **DB** | `tier_company_exceptions.discount_percent` (استثناء لكل شركة) |
| **DB Helper** | `_get_effective_tier_discount(tier_id, product_id, company_id)` — ترجع أعلى أولوية |
| **JS Engine** | `engine/pricing.ts`: `computeEffectiveDiscountPercent(tier, exceptionLookup?)` |

**ترتيب الأولوية (موحد في JS و DB):**
1. استثناء المنتج (`tier_product_exceptions`) — أعلى أولوية
2. استثناء الشركة (`tier_company_exceptions`)
3. الخصم الافتراضي للشريحة (`tiers.discount_percent`)

**التدفق:**
```
tier.discount_percent = 10
Tier price = carton_price × (1 - 10/100) = 120 × 0.9 = 108.00
```

##### 3. العروض اليومية (Daily Deals)

| المصدر | المنتج |
|---|---|
| **DB** | `daily_deals.fixed_price` — سعر ثابت للحزمة كاملة |
| **DB** | `daily_deal_items` — المنتجات المكونة للحزمة وكمياتها |
| **JS** | `cartStore.addDeal(deal)` — يضيف `deal.fixedPrice` مباشرة دون حساب tiers |
| **RPC** | `get_governed_active_daily_deals()` — ترجع `fixed_price` و `is_purchasable` |

**لا يتأثر بخصم الشريحة** — سعر ثابت مستقل.

##### 4. عرض الساعة (Flash Offers)

| المصدر | المنتج |
|---|---|
| **DB** | `flash_offers.fixed_price` — سعر ثابت للحزمة |
| **DB** | `flash_offer_items` — المنتجات المكونة |
| **JS** | `cartStore.addFlashOffer(offer)` — يضيف `offer.fixedPrice` مباشرة |
| **RPC** | `get_governed_active_flash_offers()` — ترجع `fixed_price` مع `is_purchasable` |

**لا يتأثر بخصم الشريحة** — سعر ثابت مستقل.

##### 5. الاستثناءات (Exceptions)

| Exception | التخزين | الأولوية | يستخدم في |
|---|---|---|---|
| Tier-Product | `tier_product_exceptions` | الأعلى | خصم محدد لمنتج معين في شريحة معينة |
| Tier-Company | `tier_company_exceptions` | وسط | خصم محدد لشركة كاملة في شريحة معينة |
| `applies_to_all_tiers` | `tier_product_exceptions.applies_to_all_tiers` | خاص | منتج بنفس الخصم عبر كل الشرائح |

##### 6. ملخص التدفق الكامل لحساب سعر منتج في السلة

```
1. products.carton_price ÷ products.carton_quantity → سعر القطعة الأساسي
2. _get_effective_tier_discount(tier_id, product_id, company_id) → نسبة الخصم النهائية
     ↑ 3 أولويات (product exception > company exception > tier default)
3. Tier price = base price × (1 - discountPercent / 100)
4. cartStore.addItem() يخزن السعر المجمد (unitPrice, totalPrice) في حالة السلة
5. عند إرسال الطلب: الأسعار المجمدة تُرسل إلى governed_create_order RPC
6. الـ RPC يخزن الأسعار في order_items (unit_price, total_price)
```

**الفارق الجوهري:** كل حسابات التسعير تحدث **client-side** في `src/engine/pricing.ts`. قاعدة البيانات تخزن فقط الأسعار الخام (`carton_price`) ونسب الخصم (`discount_percent`). الأسعار النهائية تُجمد (frozen) عند إنشاء الطلب ولا تتغير بعدها.

---

### Repository Paths

| الوحدة | المسار الأساسي |
|---|---|
| **Store** | `src/pages/storefront/CompaniesPage.tsx`, `src/pages/storefront/StorefrontPage.tsx`, `src/components/storefront/` |
| **Cart** | `src/pages/storefront/CartPage.tsx`, `src/pages/storefront/OrderReviewPage.tsx`, `src/store/cart.ts` |
| **Orders** | `src/pages/orders/` (6 صفحات), `src/services/orders.ts` |
| **Pricing Tiers** | `src/pages/tiers/TierSystemPage.tsx`, `src/services/tiers.ts`, `src/engine/pricing.ts` |
| **Daily Deals** | `src/pages/daily-deals/` (3 صفحات) |
| **Flash Offers** | `src/pages/flash-offers/` (3 صفحات) |
| **Auction** | `src/pages/auctions/` (صفحتان) |
| **Products** | `src/pages/products/ProductsPage.tsx`, `src/services/products.ts` |
| **Brands/Companies** | `src/pages/companies/` (صفحتان), `src/pages/storefront/CompaniesPage.tsx`, `src/services/companies.ts` |
| **Pricing Engine** | `src/engine/pricing.ts` |
| **Customers** | `src/pages/customers/` (3 صفحات), `src/services/customers.ts` |
| **Visits** | `src/pages/visits/` (4 صفحات), `src/store/visits.ts` |
| **Auth** | `src/pages/auth/`, `src/store/auth.ts`, `src/services/auth.ts`, `src/lib/supabase.ts` |
| **Checkout** | `src/pages/checkout/CheckoutPage.tsx`, `src/pages/checkout/OrderSuccessPage.tsx` |
| **Routes** | `src/routes/index.tsx` |
| **Location Service** | `src/services/location.ts` |
| **WhatsApp** | `src/lib/whatsapp.ts` |
| **Formatting** | `src/utils/format.ts` |
| **Types** | `src/types/` |
| **Supabase Migrations** | `supabase/migrations/` |
| **Docs** | `docs/` |

---

## Part II: Upper Management Reality Report

Describes the actual current state of upper-management-related screens and modules.

---

### Dashboard

| الحالة | موجود ويعمل (متعدد الأدوار) |
|---|---|
| Route | `/dashboard` |
| الملفات الرئيسية | `src/pages/dashboard/DashboardPage.tsx` (موجه), `src/pages/dashboard/SuperAdminWorkspace.tsx`, `src/pages/dashboard/AdminWorkspace.tsx`, `src/pages/dashboard/ChairmanWorkspace.tsx`, `src/pages/dashboard/ManagementDashboard.tsx`, `src/pages/dashboard/SalesDashboard.tsx`, `src/pages/dashboard/SalesDirectorWorkspace.tsx`, `src/pages/dashboard/SupervisorWorkspace.tsx`, `src/pages/dashboard/WarehouseDashboard.tsx`, `src/pages/dashboard/WarehouseManagerWorkspace.tsx`, `src/pages/dashboard/CollectorWorkspace.tsx`, `src/pages/dashboard/AccountantWorkspace.tsx`, `src/pages/dashboard/PurchasingManagerWorkspace.tsx`, `src/pages/dashboard/SecretaryWorkspace.tsx`, `src/pages/dashboard/SecurityWorkspace.tsx`, `src/pages/dashboard/BuffetWorkspace.tsx`, `src/pages/dashboard/DataEntryWorkspace.tsx`, `src/pages/dashboard/DeliveryWorkspace.tsx` |

#### Data Sources & RPCs

| RPC | Parameters | Purpose | Used By |
|---|---|---|---|
| `get_dashboard_management` | `{ p_token }` | Orders/customers/visits/collections/returns stats | ManagementDashboard, AdminWorkspace, SuperAdminWorkspace, ChairmanWorkspace, SupervisorWorkspace |
| `get_dashboard_sales` | `{ p_token }` | Today orders, pending followup, inactive customers, today visits, today collections | SalesDashboard |
| `get_credit_dashboard_stats` | `{ p_token }` | Credit application counts by status | ManagementDashboard, SuperAdminWorkspace |
| `get_governed_dashboard_counts` | `{ p_token }` | Employee count, company count | AdminWorkspace, SuperAdminWorkspace |
| `get_governed_products` | `{ p_token, p_count_only: true }` | Product count | AdminWorkspace |
| `get_order_status_counts` | `{ p_token }` | Order counts per status | SuperAdminWorkspace |
| `get_governed_orders` | `{ p_token }` | Full order list (scoped) | ChairmanWorkspace, SalesDirectorWorkspace, SupervisorWorkspace |
| `get_governed_visits` | `{ p_token }` | Visit list (scoped) | SalesDirectorWorkspace |
| `get_governed_employees` | `{ p_token }` | Employee list (scoped) | SalesDirectorWorkspace |

#### Capabilities

- Dashboard itself has no capability gate — route uses `ProtectedRoute employeeOnly` (any employee can access)
- Role-based workspace routing happens inside DashboardPage via `user.roles`

#### ماذا يعرض حاليًا

| Role | Component | Key Content |
|---|---|---|
| super_admin | SuperAdminWorkspace | Full command center: order KPIs, queue, status counters, quick actions, credit stats, module workspace cards, today's performance |
| admin / administrator | AdminWorkspace | 8 KPIs (orders, customers, employees, products, companies, visits), quick actions, pending collections/returns |
| chairman | ChairmanWorkspace | 4 KPIs (total orders, total sales, month sales, total customers), pending counts, recent orders list |
| sales director | SalesDirectorWorkspace | Pending approval count, ready for dispatch, today's visits, active reps, pending approval orders list |
| sales manager / sales | SalesDashboard | 5 KPIs (today orders, pending followup, inactive customers, today visits, today collections) |
| supervisor / general_supervisor | SupervisorWorkspace | Total orders, pending approval, total customers, active visits, pending orders list |
| warehouse manager | WarehouseManagerWorkspace | (specific warehouse dashboard) |
| warehouse | WarehouseDashboard | (specific warehouse dashboard) |
| transport / delivery | DeliveryWorkspace | (delivery dashboard) |
| collector | CollectorWorkspace | (collector dashboard) |
| accountant | AccountantWorkspace | (accounting dashboard) |
| sales rep | SalesRepWorkDay | (daily work view for sales rep) |
| *(fallback)* | ManagementDashboard | Generic management KPIs + credit stats + today's status |

---

### Customers Page

| الحالة | موجود ويعمل |
|---|---|
| Route | `/customers` |
| الملفات الرئيسية | `src/pages/customers/CustomersPage.tsx` |

#### Data Sources & RPCs

| RPC | Parameters | Purpose |
|---|---|---|
| `get_governed_customers` | `{ p_token }` | Fetch governed customer list |
| `get_governed_customer_contacts` | `{ p_token }` | Fetch contacts (for primary phone) |
| `get_governed_locations` | `{ p_token, p_ids }` (via `locationService.fetchLocations`) | Fetch location data |

#### Capabilities

- Route: `ProtectedRoute` (no specific capability — أي موظف مسجل دخول)
- Internal toggle: "الكل" (all customers) / "عملائي" (my customers) — filters client-side by `owner_id` or `created_by`

#### ماذا يعرض حاليًا

- Header: back button + "العملاء" + "إضافة عميل" button (if `customers.create` capability)
- Toggle bar: الكل / عملائي
- Search input (filters by company name, phone, address)
- Customer cards list: company name, phone, address, "فتح الموقع" button (Google Maps link), location accuracy badge
- Tapping card → `/customers/:id`

---

### Customer Profile

| الحالة | موجود ويعمل |
|---|---|
| Route | `/customers/:id` |
| الملفات الرئيسية | `src/pages/customers/CustomerProfilePage.tsx` |

#### Data Sources & RPCs

| RPC | Parameters | Purpose |
|---|---|---|
| `get_governed_customer` | `{ p_token, p_id }` | Single customer details |
| `get_customer_orders` | `{ p_token, p_customer_id }` | Customer orders |
| `get_customer_collections` | `{ p_token, p_customer_id }` | Customer collections |
| `get_customer_visits` | `{ p_token, p_customer_id }` | Customer visits |
| `get_governed_customer_addresses` | `{ p_token }` | Addresses |
| `get_governed_customer_contacts` | `{ p_token }` | Contacts |
| `get_governed_customer_ownership_history` | `{ p_token }` | Ownership change history |
| `get_governed_employees` | `{ p_token }` | Employee list (for ownership transfer) |
| `governed_update_customer` | `{ p_token, p_id, ... }` | Update customer |
| `governed_deactivate_customer` | `{ p_token, p_id }` | Deactivate |
| `governed_activate_customer` | `{ p_token, p_id }` | Reactivate |
| `governed_change_customer_ownership` | `{ p_token, p_id, p_new_owner_id }` | Transfer ownership |

#### Capabilities

- Route: `ProtectedRoute` (no specific capability)
- Edit/activate/deactivate/transfer: governed by server-side capability checks in RPCs

#### ماذا يعرض حاليًا

- Status badge: جديد / نشط / يحتاج متابعة / غير نشط / متوقف (computed from last order date)
- **Info tab:** Monthly sales, days since last order, customer details (code, email, responsible employee, credit limit, credit period, registration date), contacts, location, addresses, actions (edit, activate/deactivate, transfer ownership)
- **Orders tab:** Order list with number, status badge, date, total amount
- **Collections tab:** Collection entries with code, method, amount, reference, status
- **Visits tab:** Visit entries with code, status, check-in time, result, employee name
- **History tab:** Ownership change history

---

### Employees

| الحالة | موجود ويعمل |
|---|---|
| Route | `/employees`, `/employees/:id`, `/hierarchy` |
| الملفات الرئيسية | `src/pages/employees/EmployeesPage.tsx`, `src/pages/employees/EmployeeProfilePage.tsx`, `src/pages/employees/HierarchyPage.tsx` |

#### Data Sources & RPCs

| RPC | Parameters | Purpose |
|---|---|---|
| `get_governed_employees` | `{ p_token }` | Employee list (scoped) |
| `get_governed_roles` | `{ p_token }` | Role list |
| `get_employee_activity` | `{ p_token, p_employee_id, p_limit }` | Activity feed (profile page only) |
| `governed_create_employee` | `{ p_token, ... }` | Create employee |
| `governed_update_employee` | `{ p_token, p_id, ... }` | Update employee |
| `governed_activate_employee` | `{ p_token, p_id }` | Activate |
| `governed_deactivate_employee` | `{ p_token, p_id }` | Deactivate |
| `governed_change_employee_manager` | `{ p_token, p_id, p_manager_id }` | Change manager |
| `governed_change_employee_role` | `{ p_token, p_id, p_role_id }` | Change role |
| `governed_reset_employee_password` | `{ p_token, p_id, p_new_password }` | Reset password |

#### Capabilities

- `/employees` and `/hierarchy`: `requireCapability="employees.manage"`
- `/employees/:id`: `employeeOnly`

#### ماذا يعرض حاليًا

- **Employees list:** Name, code, phone, role_names, active status, search/filter, inline edit, manager picker, role picker, password reset
- **Employee profile:** Profile card (editable fields), role selector, manager selector, manager info, subordinates list, recent activity feed (orders/visits/collections)
- **Hierarchy:** Tree/org chart view built in-memory from flat employee list, expandable/collapsible nodes, inline actions (edit, add subordinate, toggle active, move, change role, reset password)

---

### Supervisors

| الحالة | موجود جزئيًا (لا شاشة منفصلة للسوبر فايزر — يُستخدم Dashboard>SupervisorWorkspace فقط) |
|---|---|
| Route | لا يوجد route مخصص للسوبر فايزر |
| الملفات الرئيسية | `src/pages/dashboard/SupervisorWorkspace.tsx` |

#### Data Sources & RPCs

| RPC | Parameters | Purpose |
|---|---|---|
| `get_dashboard_management` | `{ p_token }` | Summary stats |
| `get_governed_orders` | `{ p_token }` | Pending orders list |

#### Capabilities

- لا يوجد شاشة مخصصة — السوبر فايزر يدخل `/dashboard` ويشوف `SupervisorWorkspace` بناءً على دور `supervisor` أو `general_supervisor`

#### ماذا يعرض حاليًا

- 4 summary cards: Orders, Pending Approval, Customers, Active Visits
- Pending orders list (top 5, status=submitted)
- Quick actions: Approve Orders, All Orders, Customers, Collections

#### ملاحظة

- Type `EmployeeRole` تتضمن `sales_supervisor` لكن هذا الدور **غير مستخدم** في أي routing أو مكون حالي
- لا يوجد صفحة "Supervisor" منفصلة لإدارة المندوبين أو متابعة أدائهم

---

### Visits

| الحالة | موجود ويعمل |
|---|---|
| Route | `/visits`, `/visits/new`, `/visits/:id`, `/visits/screen` |
| الملفات الرئيسية | `src/pages/visits/VisitsPage.tsx`, `src/pages/visits/NewVisitPage.tsx`, `src/pages/visits/VisitDetailPage.tsx`, `src/pages/visits/VisitScreen.tsx`, `src/store/visits.ts` |

#### Data Sources & RPCs

| RPC | Parameters | Purpose |
|---|---|---|
| `get_governed_visits` | `{ p_token }` | Visit list (scoped) |
| `get_governed_visit` | `{ p_token, p_id }` | Single visit detail |
| `governed_create_visit` | `{ p_token, ... }` | Create visit |
| `governed_update_visit` | `{ p_token, p_id, ... }` | Update visit |
| `governed_checkin_visit` | `{ p_token, p_id, ... }` | Check-in with GPS |
| `governed_checkout_visit` | `{ p_token, p_id, ... }` | Check-out with GPS |
| `governed_create_location` | `{ p_token, ... }` | Store GPS location |

#### Capabilities

- All visit routes: `requireCapability="visits.create"`

#### ماذا يعرض حاليًا

- **Visits list:** Visit cards with customer name, status, check-in/out times, visit result
- **New visit:** Customer selection, visit creation
- **Visit detail:** Full visit info, GPS check-in/out, visit result, notes
- **Visit screen:** Location-based check-in/out interface

---

### Reports

| الحالة | موجود ويعمل |
|---|---|
| Route | `/reports` |
| الملفات الرئيسية | `src/pages/reports/ReportsPage.tsx` |

#### Data Sources & RPCs

| RPC | Parameters | Purpose |
|---|---|---|
| `get_sales_by_rep` | `{ p_token, p_date_from, p_date_to }` | Sales grouped by sales rep |
| `get_sales_by_manager` | `{ p_token, p_date_from, p_date_to }` | Sales grouped by manager |
| `get_sales_by_customer` | `{ p_token, p_date_from, p_date_to }` | Sales grouped by customer |
| `get_sales_by_product` | `{ p_token, p_date_from, p_date_to }` | Sales grouped by product |
| `get_sales_by_company` | `{ p_token, p_date_from, p_date_to }` | Sales grouped by company/brand |
| `get_sales_by_time` | `{ p_token, p_date_from, p_date_to, p_grouping }` | Sales grouped by time (day/month) |
| `get_order_report` | `{ p_token, p_date_from, p_date_to }` | Order report data |
| `get_collection_report` | `{ p_token, p_date_from, p_date_to, p_grouping }` | Collection report (day/week/month) |
| `get_visit_report` | `{ p_token, p_date_from, p_date_to, p_report_type }` | Visit report (rep_activity / customer_coverage) |

#### Capabilities

- Route: `employeeOnly` (any employee)

#### ماذا يعرض حاليًا

- 9 tabbed report sections: sales by rep/manager/customer/product/company/time, order report, collection report, visit report
- Date range filter (from/to) for all reports
- Aggregation options (time grouping, report type)
- Auto-loads on section change + manual "Update Report" button
- Total amount summary box
- Auto-mapped Arabic column headers, formatted currency/date columns

---

### Upper Management Summary Table

| Feature | Current State | Route | Data Source | Relevance To New Blueprint |
|---|---|---|---|---|
| Dashboard | موجود ويعمل (17 workspace components) | `/dashboard` | 9 RPCs (governed + dashboard-specific) | |
| Customers Page | موجود ويعمل | `/customers` | `get_governed_customers`, `get_governed_customer_contacts`, `get_governed_locations` | |
| Customer Profile | موجود ويعمل (5 tabs) | `/customers/:id` | 7 governed RPCs + customer-specific RPCs | |
| Employees | موجود ويعمل (3 صفحات + إدارة كاملة) | `/employees`, `/employees/:id`, `/hierarchy` | `get_governed_employees`, `get_governed_roles`, `get_employee_activity` + 7 mutation RPCs | |
| Supervisors | موجود جزئيًا (Dashboard فقط, لا شاشة منفصلة) | لا يوجد route مخصص | `get_dashboard_management`, `get_governed_orders` | |
| Visits | موجود ويعمل (4 صفحات) | `/visits`, `/visits/new`, `/visits/:id`, `/visits/screen` | `get_governed_visits`, `governed_create_visit`, `governed_checkin_visit`, `governed_checkout_visit` | |
| Reports | موجود ويعمل (9 تقارير) | `/reports` | 9 report RPCs | |

---

## Part III: Approved Operating Rules

The following rules are permanently approved and must be followed in all future UI/UX development.

### Screen Evolution Policy

#### Keep

إذا كانت الشاشة الحالية تحقق الرؤية المعتمدة بالفعل:

- تبقى كما هي.
- يسمح فقط بالتحسينات البسيطة.

#### Transform

إذا كانت الشاشة موجودة ولكن لا تحقق الرؤية المعتمدة بالكامل:

- يتم تطوير الشاشة الحالية.
- يتم تعديل الشاشة الحالية.
- يتم إعادة تشكيل الشاشة الحالية.

ممنوع إنشاء شاشة جديدة تؤدي نفس الوظيفة.

#### Deprecate

إذا كانت الشاشة أو المكون أو الـ Workflow لا يتوافق مع الرؤية المعتمدة:

- يتم توثيقه كـ Deprecated.
- يتم تحديد البديل الرسمي.

#### Remove

بعد اعتماد البديل وتشغيله بنجاح:

- يتم حذف العنصر القديم.

#### Cleanup

أي عنصر يتم استبداله يجب مراجعة:

- Routes
- Components
- RPCs
- Views
- Permissions
- Navigation Links

وحذف ما لم يعد مستخدمًا.

#### Replace Before Create

ممنوع إنشاء:

- Dashboard V2
- Customers V2
- Orders V2
- Customer Profile V2
- Supervisor V2

أو أي شاشة جديدة تؤدي وظيفة شاشة قائمة.

يسمح بإنشاء شاشة جديدة فقط إذا كانت الوظيفة غير موجودة أصلًا داخل النظام.

### Capability Driven UI

الهدف ليس إخفاء الأزرار فقط. الهدف أن كل مستخدم يرى فقط ما يحتاجه لأداء عمله.

#### Representative

إذا كان المندوب لا يستطيع رؤية إلا عملائه، فلا تظهر له: فلتر "الكل"، أي اختيار لفرق أخرى، أي عناصر لا يمكنه الوصول إليها. إذا كانت النتيجة دائمًا هي نفس بياناته فلا تعرض الفلتر أصلًا.

#### Navigation

لا تظهر: شاشة، أيقونة، زر، عنصر قائمة، تبويب لمستخدم لا يملك الوصول الفعلي إليه.

#### Footer / More Menu

إذا كان المستخدم لا يحتاج إدارة: الموظفين، الصلاحيات، الإدارة العليا، التقارير العليا — فلا تظهر له هذه العناصر داخل التنقل.

#### General Rule

المستخدم يجب أن يرى أقل واجهة ممكنة تسمح له بأداء عمله. وجود عناصر غير قابلة للاستخدام أو غير مرتبطة بصلاحياته يعتبر ضوضاء تشغيلية.

#### Preferred Approach

عند إعادة بناء أو تطوير أي شاشة مستقبلًا: الأولوية لتجربة المستخدم، ثم الصلاحيات، ثم إظهار العناصر. وليس العكس.

---

### Visibility From Source

The system MUST derive visibility from the source tables (`customers.customer_id`, `orders.customer_id` → `customer.owner_id`) rather than implicit logic. No hardcoded filter arrays.

### Permission + Scope

Every screen MUST check two dimensions: **permission** (can the user do this action?) and **scope** (which records can they see?). The `governed_*` RPCs handle scope. Capabilities handle permission.

### Ownership Governance

Records belong to employees through `customers.owner_id`. An employee sees records for customers they own. Managers see records of their subordinates (hierarchy-based). This applies to orders, visits, collections, and returns.

### Everything Clickable

Every card, badge, number, and actionable item on screen MUST be clickable and navigate somewhere meaningful. No dead UI.

### Human Readable Location

Location must be displayed as a human-readable formatted address (not raw coordinates). The `unified_locations.formatted_address` field stores this. A "فتح الموقع" button links to Google Maps.

### Geographic Search

Searching for customers must support geographic search (by location) in addition to name, phone, and address.

### Active Runtime Context

Every screen must be aware of who the user is (employee/customer), when they're viewing (today/this week/date range), and what state the data is in (active/inactive/pending). This context affects what is shown.

### One Open Visit Per User

A user (sales rep) can have at most one open visit at any time. If they navigate away without checking out, the visit remains open and must be explicitly closed before starting a new one.

### One Open Cart Per User

A user can have at most one open cart. The cart survives page refreshes (persisted via Zustand persist middleware). The cart is cleared when an order is submitted.

### Cart Revalidation

When the user returns to the cart screen, all items must be revalidated:
- Is the product still active?
- Is the unit type still available?
- Is the tier still valid?
- Has the price changed?

### Return Order To Cart

A submitted order in certain statuses (e.g., `returned_for_revision`) can be returned to the cart for editing. This reopens the cart with the original items and prices.

### Dashboard From Real Data

Every dashboard screen MUST display real data from the database. No hardcoded mock values. All aggregation should happen server-side in RPCs, not client-side.

### Smart Search

جميع الشاشات التشغيلية في النظام يجب أن تدعم بحثًا موحدًا وذكيًا.

#### Customers

البحث بواسطة: اسم العميل، كود العميل، رقم الهاتف، اسم المندوب، اسم السوبر فايزر، العنوان.

#### Orders

البحث بواسطة: رقم الطلب، اسم العميل، كود العميل، اسم المندوب.

#### Visits

البحث بواسطة: العميل، المندوب، نتيجة الزيارة، المنطقة.

#### Products

البحث بواسطة: اسم المنتج، كود المنتج، الشركة.

#### General Rule

يجب أن يبحث المستخدم بالطريقة الطبيعية المتوقعة دون الحاجة لمعرفة الحقل المحدد مسبقًا.

### Unified Date Range Filter

جميع الشاشات التحليلية والتقارير و Dashboards تستخدم نفس منطق الفترات الزمنية.

#### الفترة الافتراضية

الشهر الحالي.

#### الفترات الجاهزة

- اليوم
- أمس
- آخر 7 أيام
- الشهر الحالي
- الشهر السابق
- هذا العام
- فترة مخصصة

#### الفترة المخصصة

- من تاريخ
- إلى تاريخ

#### General Rule

أي KPI أو تقرير أو ترتيب أو تحليل يجب أن يكون مرتبطًا بالفترة الزمنية المحددة.

### Mobile First

All screens MUST be designed for mobile-first rendering. The current UI framework (Zustand + Supabase + Tailwind) supports responsive design. Desktop is secondary.

### Unified Screens

Do not create separate screens for employees vs customers unless absolutely necessary. Use the same screen with different data contexts based on `identity_type`.

### Human Readable First

Display human-readable labels and descriptions before codes or IDs. For example, show customer name not customer ID, role name not role code.

### Visit Distance Validation

On visit check-in, validate that the GPS location is within a reasonable distance of the customer's registered location. If too far, warn the user.

### Keep Same Order Number

When an order is returned to cart and resubmitted, it MUST retain the same order number. Do not generate a new order number for revised orders.

### Immutable After Review

Once a manager has reviewed an order (status changes to `reviewing` or beyond), the prices and items in that order become immutable. Any changes must go through the order modification/revision system.

### Upper Management Full Edit Rights

Users with `admin`, `super_admin`, `chairman`, or `general_supervisor` roles have full edit rights over all records regardless of ownership boundaries. The governed RPCs should be bypassed for these roles.

### Ownership Visibility Matrix

#### Upper Management

- يرى جميع العملاء
- يرى جميع المناديب
- يرى جميع السوبر فايزر
- يرى جميع الطلبات
- يرى جميع الزيارات
- يستطيع تعديل جميع البيانات

#### Supervisor

- يرى فريقه فقط
- يرى عملاء فريقه فقط
- ينشئ مندوبين داخل نطاقه فقط
- ينشئ عملاء لنفسه أو لفريقه فقط
- لا يرى فرق السوبر فايزر الآخرين

#### Representative

- يرى عملاءه فقط
- لا يرى عملاء غيره
- لا ينشئ إلا ضمن صلاحياته
- لا يغير حالات الطلبات التشغيلية

#### Customer

- يرى بياناته فقط
- يرى طلباته فقط
- يرى زياراته فقط

#### Cross-Cutting Rules

- Visibility From Source
- Permission + Scope
- Ownership Governance
- Everything Clickable

---

## Part IV: Approved Screens

### Customers Screen

| Status | معتمد — قيد التطوير |
|---|---|
| Summary | شاشة عرض قائمة العملاء مع بحث وتصفية، زر إضافة عميل، اختيار "كل العملاء" أو "عملائي" |
| Key Actions | إضافة عميل، بحث، تصفية بالحالة/المندوب، فتح الموقع، الانتقال لملف العميل |
| Key Metrics | عدد العملاء (الإجمالي, النشطاء, الغير نشطين), عدد زيارات اليوم |
| Navigation Targets | `/customers/:id`, `/customers/new`, `/visits/new?customerId=...` |

---

### Customer Profile

| Status | معتمد — قيد التطوير |
|---|---|
| Summary | ملف كامل للعميل بخمس تبويبات: المعلومات، الطلبات، التحصيلات، الزيارات، السجل |
| Key Actions | تعديل بيانات العميل، تنشيط/إيقاف، نقل ملكية، فتح الموقع، عرض الطلبات، عرض التحصيلات |
| Key Metrics | مبيعات الشهر، آخر طلب، حالة العميل (جديد/نشط/غير نشط/متوقف), رصيد ائتماني |
| Navigation Targets | `/orders/?customerId=...`, `/collections/?customerId=...`, `/visits/?customerId=...` |

---

### Orders Screen

| Status | معتمد — قيد التطوير |
|---|---|
| Summary | شاشة عرض قائمة الطلبات مع حالة كل طلب، بحث، تصفية |
| Key Actions | عرض التفاصيل، فلترة بالحالة، بحث برقم الطلب أو اسم العميل |
| Key Metrics | عدد الطلبات (كل, pending, approved, cancelled, delivered) |
| Navigation Targets | `/orders/:id`, `/orders/new` |

---

### Order Details

| Status | معتمد — قيد التطوير |
|---|---|
| Summary | تفاصيل الطلب: المنتجات, الحالة, السعر, الخصم, تاريخ التسليم, المرفقات |
| Key Actions | اعتماد, إلغاء, تأجيل, إعادة للسلة, تعديل (للمديرين), طباعة, إرسال واتساب |
| Key Metrics | إجمالي الطلب, عدد المنتجات, الخصم, الحالة الحالية |
| Navigation Targets | `/orders`, `/orders/:id/edit`, `/warehouse/prep/:id`, `/delivery/:id` |

---

### Visits Screen

| Status | معتمد — قيد التطوير |
|---|---|
| Summary | شاشة عرض الزيارات مع حالة كل زيارة، إمكانية بدء زيارة جديدة |
| Key Actions | بدء زيارة, تسجيل دخول (check-in) بخاصية GPS, تسجيل خروج (check-out), عرض تفاصيل الزيارة |
| Key Metrics | زيارات اليوم, زيارات نشطة حالياً, زيارات اليوم للمستخدم الحالي |
| Navigation Targets | `/visits/new`, `/visits/screen`, `/visits/:id`, `/customers/:id` |

---

### Representative Profile

| Status | معتمد — قيد التطوير |
|---|---|
| Summary | ملف المندوب: معلومات شخصية, المدير المباشر, المرؤوسين (إن وجد), نشاط حديث (طلبات/زيارات/تحصيلات) |
| Key Actions | تعديل بيانات, تغيير مدير, تغيير دور, إعادة تعيين كلمة المرور, تنشيط/إيقاف |
| Key Metrics | عدد الطلبات, عدد الزيارات, عدد التحصيلات, الحالة (نشط/غير نشط) |
| Navigation Targets | `/employees/:id/manager`, `/employees/:id/subordinates`, `/orders?rep=...`, `/visits?rep=...` |

---

### Supervisor Profile

| Status | معتمد — قيد التطوير |
|---|---|
| Summary | ملف السوبر فايزر (حاليًا Dashboard فقط، لا شاشة منفصلة). سيعرض معلومات المدير التنفيذي مع إمكانية الإشراف على المندوبين واعتماد الطلبات. |
| Key Actions | اعتماد الطلبات, عرض المندوبين, عرض العملاء, عرض الزيارات |
| Key Metrics | الطلبات المعلقة, العملاء النشطاء, زيارات اليوم, عدد المندوبين تحت الإشراف |
| Navigation Targets | `/orders/approval-queue`, `/orders`, `/customers`, `/visits` |

---

### Upper Management Dashboard

| Status | Approved |
|---|---|
| Summary | لوحة تحكم موحدة للإدارة العليا تعرض مؤشرات الأداء الرئيسية والإجراءات السريعة والتنقل إلى جميع أقسام النظام. تخضع لقاعدة Ownership Governance (صلاحية كاملة لجميع البيانات). |
| Key Metrics | الطلبات الجديدة، الطلبات المعلقة، الزيارات الجارية، زيارات اليوم، العملاء الجدد، العملاء الراكدون، المبيعات اليومية، المبيعات الشهرية، أفضل مندوب، أضعف مندوب، عدد العملاء، عدد المناديب |
| Key Actions | العملاء، الطلبات، الزيارات، المناديب، السوبر فايزر، الموظفين، التقارير، المخزون، النشاط الموحد |
| Navigation Targets | `/customers`, `/orders`, `/visits`, `/employees`, `/reports`, `/products`, `/collections`, `/returns`, `/activity` |
| Operating Rules | Everything Clickable, Dashboard From Real Data, Ownership Governance, Permission + Scope, Mobile First |

---

### Sales Leaderboard & Performance Ranking

| Status | Planned |
|---|---|
| Summary | شاشة تحليل وترتيب الأداء البيعي والتحفيزي |
| Visible To | Representative, Supervisor, Upper Management |
| Scoring Formula | Sales = 70%, Visits = 15%, Orders = 15% (قابلة للتعديل من الإدارة العليا) |
| Representative View | ترتيبه الحالي، نسبة تحقيق الهدف، نقاطه الحالية، أفضل المناديب، مركزه بين الجميع |
| Supervisor View | ترتيب فريقه، أفضل مندوب، أضعف مندوب، نسبة تحقيق هدف الفريق |
| Upper Management View | الترتيب العام، الترتيب الشهري، الترتيب الأسبوعي، أداء جميع المناديب، أداء جميع الفرق |
| Operating Rules | Capability Driven UI, Ownership Governance, Dashboard From Real Data |

---

### Unified Activity Feed

| Status | Approved — Initial |
|---|---|
| Summary | شاشة عرض آخر الأحداث التشغيلية المهمة من مكان واحد. مخصصة للإدارة العليا. |
| Route | `/activity` |
| File | `src/pages/activity/ActivityPage.tsx` (الصفحة الأولية — 6 عناصر وهمية) |
| Key Actions | رجوع إلى اللوحة السابقة |
| Future Data Sources | الطلبات، الزيارات، التحصيلات، العملاء الجدد، تغييرات الملكية، العمليات التشغيلية المهمة |
| Current State | الصفحة الأولية تعمل مع 6 عناصر توضيحية (PlaceholderCards). ربط مصادر البيانات الحقيقية في تحديث قادم. |
| Navigation Targets | (داخلية) العودة إلى `/dashboard` |
| Operating Rules | Dashboard From Real Data (عند اكتمال مصادر البيانات) |

---

## Implementation Governance

### Mandatory Rule

أي تعديل مستقبلي على الكود أو قاعدة البيانات أو الشاشات أو الصلاحيات أو الـ RPCs لا يعتبر مكتملًا حتى يتم تسجيله داخل SCREENS_AND_UI_BLUEPRINT.md

### Registration Template

```
Date:
Task:
Files Changed:
Database Objects Changed:
RPCs Changed:
Screens Affected:
Summary:
```

---

## Customer Profile Reality Gap Report

### Current State

The current Customer Profile screen (`src/pages/customers/CustomerProfilePage.tsx`) as of 2026-06-07:

- **Route:** `/customers/:id`
- **5 tabs:** المعلومات, الطلبات, التحصيلات, الزيارات, السجل
- **Info tab content:**
  - Two summary cards: مبيعات الشهر (monthly sales total), آخر طلب (days since last order)
  - Customer details table: الكود, البريد الإلكتروني, الموظف المسؤول (owner_name), الحد الائتماني (credit_limit), فترة الائتمان (credit_days), تاريخ التسجيل
  - جهات الاتصال section: list of contacts with name and phone
  - الموقع section: formatted address, accuracy badge, capture date, "فتح الموقع" button
  - العناوين section: list of addresses with city and default flag
  - Action buttons: تعديل البيانات (edit name/email/credit_limit/credit_days), إيقاف/تفعيل العميل, نقل الملكية
- **Orders tab:** Lists orders with order_number, status badge, created_at, total_amount. Each item clickable → `/orders/:id`
- **Collections tab:** Lists collections with code, method label, collected_at, amount, reference_number, status. Not clickable.
- **Visits tab:** Lists visits with code, status badge, check_in_at, visit_result, employee_name. Each item clickable → `/visits/:id`
- **History tab:** Ownership change log with previous→new owner, date/time, reason, changer name
- **RPCs used on load:** `get_governed_customer`, `get_customer_orders`, `get_customer_collections`, `get_customer_visits`, `get_governed_customer_addresses`, `get_governed_customer_contacts`, `get_governed_customer_ownership_history`, `get_governed_employees`
- **RPCs used on mutation:** `governed_update_customer`, `governed_deactivate_customer` / `governed_activate_customer`, `governed_change_customer_ownership`
- **Capabilities consumed:** `customers.update` (edit), `customers.manage` (activate/deactivate, transfer ownership)
- **Status labels:** جديد, نشط, يحتاج متابعة, غير نشط, متوقف — computed client-side from last order date and `is_active` flag
- **No credit account data displayed** (only credit limit from customer record)
- **No "add order" or "add visit" quick action**

### Approved State

As defined in this document (Part IV — Approved Screens > Customer Profile):

- **Route:** `/customers/:id`
- **Summary:** ملف كامل للعميل بخمس تبويبات: المعلومات، الطلبات، التحصيلات، الزيارات، السجل
- **Key Actions:** تعديل بيانات العميل، تنشيط/إيقاف، نقل ملكية، فتح الموقع، عرض الطلبات، عرض التحصيلات
- **Key Metrics:** مبيعات الشهر، آخر طلب، حالة العميل (جديد/نشط/غير نشط/متوقف), رصيد ائتماني
- **Navigation Targets:** `/orders/?customerId=...`, `/collections/?customerId=...`, `/visits/?customerId=...`

### Gap List

1. **رصيد ائتماني (Credit Balance)** — approved as a key metric but not currently displayed. Current shows only `credit_limit` from customer record, not actual outstanding/reserved/available credit from `customer_credit_accounts`.

2. **Navigation target `/orders/?customerId=...`** — approved but not implemented. Current orders tab only navigates to individual order detail (`/orders/:id`), not a filtered orders list scoped to this customer.

3. **Navigation target `/collections/?customerId=...`** — approved but not implemented. Current collections tab shows an inline list with no navigation to a filtered collections page.

4. **Navigation target `/visits/?customerId=...`** — approved but not implemented. Current visits tab navigates to individual visit detail (`/visits/:id`), not a filtered visits list scoped to this customer.

5. **Quick action "إضافة طلب جديد"** — not present in current screen.

6. **Quick action "إضافة زيارة جديدة"** — not present in current screen.

---

## Customers Screen Reality Gap Report

### Current State

The current Customers screen (`src/pages/customers/CustomersPage.tsx`) as of 2026-06-07:

- **Route:** `/customers`
- **File:** `src/pages/customers/CustomersPage.tsx`
- **RPCs used:** `get_governed_customers`, `get_governed_customer_contacts`
- **Data Sources:** governed customers, customer contacts, unified locations (fetched via `locationService.fetchLocations`)
- **Capabilities consumed:** `customers.create` (add customer button visibility)
- **Current UI Elements:**
  - Header: back button (→ `/dashboard`) + title "العملاء" + "إضافة عميل" button (conditional on canCreate → `/customers/new`)
  - Toggle bar: "الكل" / "عملائي" — filters client-side by `owner_id === currentEmpId || created_by === currentEmpId`
  - Search input — filters client-side by `company_name`, `phone`, or `address` (case-insensitive substring match)
  - Customer cards: `company_name` (bold), `phone` + `address` / `formatted_address` below, "فتح الموقع" button + accuracy badge (if location exists)
  - Tapping a card navigates to `/customers/:id`
  - Empty state messages: "لا توجد نتائج" / "لا يوجد عملاء تابعين لك" / "لا يوجد عملاء"
  - No summary bar showing customer counts
  - No status or role filter (only the binary الكل/عملائي toggle)

### Approved State

As defined in this document (Part IV — Approved Screens > Customers Screen):

- **Route:** `/customers`
- **Summary:** شاشة عرض قائمة العملاء مع بحث وتصفية، زر إضافة عميل، اختيار "كل العملاء" أو "عملائي"
- **Key Actions:** إضافة عميل، بحث، تصفية بالحالة/المندوب، فتح الموقع، الانتقال لملف العميل
- **Key Metrics:** عدد العملاء (الإجمالي, النشطاء, الغير نشطين), عدد زيارات اليوم
- **Navigation Targets:** `/customers/:id`, `/customers/new`, `/visits/new?customerId=...`

### Gap List

1. **تصفية بالحالة (Status Filter)** — approved but not implemented. Current screen has no filter for customer status (نشط / غير نشط / الكل).

2. **تصفية بالمندوب (Rep Filter)** — approved but not implemented. Current screen only has a binary "الكل" vs "عملائي" toggle. No employee selector to filter customers by a specific sales rep.

3. **Key Metric: عدد العملاء الإجمالي** — approved but not displayed. No summary or count bar showing total customer count anywhere on the screen.

4. **Key Metric: عدد العملاء النشطاء** — approved but not displayed. No count of active customers shown.

5. **Key Metric: عدد العملاء الغير نشطين** — approved but not displayed. No count of inactive customers shown.

6. **Key Metric: عدد زيارات اليوم** — approved but not displayed. No visits-related metric on the customers list screen.

7. **Navigation target `/visits/new?customerId=...`** — approved but not implemented. No way to start a new visit from the customers list.

---

## Supervisor Profile Reality Gap Report

### Current State

The current Supervisor representation is a dashboard workspace component (`src/pages/dashboard/SupervisorWorkspace.tsx`) embedded in `/dashboard`, not a standalone profile page. There is no dedicated supervisor profile screen in the system.

- **Route:** `/dashboard` (not a dedicated route — embedded via role-based routing in DashboardPage)
- **Files:** `src/pages/dashboard/SupervisorWorkspace.tsx`
- **RPCs used:** `get_dashboard_management`, `get_governed_orders`
- **Data Sources:** aggregated management stats (orders, customers, visits), governed orders list
- **Capabilities:** No capability check — routed purely by role strings (`supervisor`, `general_supervisor`, `مشرف`, `مشرف تنفيذي`) in DashboardPage
- **Current UI Elements:**
  - Gradient header: "مشرف" with subtitle "لوحة التحكم"
  - 4 KPI cards in a 2x2 grid: الطلبات (→ `/orders`), بانتظار الاعتماد (→ `/orders/approval-queue`), العملاء (→ `/customers`), زيارات نشطة (→ `/visits`)
  - Pending approval orders section: list of up to 5 submitted orders (order_number + amount), each clickable → `/orders/:id`
  - Quick actions grid (2x2): اعتماد الطلبات, كل الطلبات, العملاء, التحصيلات
  - Loading state: "جاري التحميل..."
- **Current Team Management Features:**
  - None. No list of supervised reps, no rep performance metrics, no hierarchy view.
- **Current Customer Management Features:**
  - Only navigation links to `/customers` (full list). No customer KPI breakdown, no active/inactive counts, no filtered views.

### Approved State

As defined in this document (Part IV — Approved Screens > Supervisor Profile):

- **Route:** Not yet assigned (currently Dashboard only, no separate screen)
- **Summary:** ملف السوبر فايزر (حاليًا Dashboard فقط، لا شاشة منفصلة). سيعرض معلومات المدير التنفيذي مع إمكانية الإشراف على المندوبين واعتماد الطلبات.
- **Key Actions:** اعتماد الطلبات, عرض المندوبين, عرض العملاء, عرض الزيارات
- **Key Metrics:** الطلبات المعلقة, العملاء النشطاء, زيارات اليوم, عدد المندوبين تحت الإشراف
- **Navigation Targets:** `/orders/approval-queue`, `/orders`, `/customers`, `/visits`

### Gap List

1. **No dedicated supervisor profile screen** — approved as a standalone profile screen but currently exists only as a dashboard workspace component. No dedicated route, no profile page.

2. **عرض المندوبين (View Reps)** — approved key action not implemented. Current workspace has no rep list, no rep selection, no rep performance overview, and no way to manage supervised employees.

3. **عدد المندوبين تحت الإشراف (Reps Under Supervision)** — approved key metric not displayed. No count of supervised subordinates anywhere on the workspace.

4. **العملاء النشطاء (Active Customers)** — approved key metric not displayed. Current KPI shows only `total_customers`, not a breakdown of active vs inactive.

5. **زيارات اليوم (Today's Visits)** — approved key metric not displayed. Current KPI shows only `active_visits` (currently ongoing visits), not the total number of visits made today.

6. **Navigation target `/visits`** — approved but absent from quick actions. Current quick actions include اعتماد الطلبات, كل الطلبات, العملاء, التحصيلات — no visits shortcut.

7. **No supervisor identity info** — workspace shows only a generic header "مشرف" with no supervisor name, role title, team name, or hierarchy position.

8. **No rep performance data** — no sales targets, visit completion rates, order approval rates, or any team performance metrics.

---

## Upper Management Dashboard Reality Gap Report

### Current State

There is no single unified "Upper Management Dashboard" in the system. Instead, there are **4 separate workspace components** routed by role through `DashboardPage.tsx`. The roles documented below are the only upper management roles that physically exist in the codebase:

**Super Admin (`/dashboard` → SuperAdminWorkspace)**

- **File:** `src/pages/dashboard/SuperAdminWorkspace.tsx` (245 lines)
- **RPCs:** `get_dashboard_management`, `get_credit_dashboard_stats`, `get_governed_dashboard_counts`, `get_order_status_counts`
- **Capabilities:** None — routed by role string only (`superadmin`, `super_admin`, `سوبر أدمن`, `سوبرادمن`)
- **Current UI:** Purple gradient header "مركز القيادة والتشغيل / لوحة السوبر أدمن", 6 top KPIs (3-col grid), queue list, full order status counters (13 statuses), 6 quick actions, today's performance section (4 metrics), credit stats, 8 module workspace cards, 2 quick links
- **Data:** All from server-side RPCs, no client-side aggregation

**Admin (`/dashboard` → AdminWorkspace)**

- **File:** `src/pages/dashboard/AdminWorkspace.tsx` (125 lines)
- **RPCs:** `get_dashboard_management`, `get_governed_dashboard_counts`, `get_governed_products` (`p_count_only: true`)
- **Capabilities:** None — routed by role string (`admin`, `administrator`, `أدمن`, `ادمن`)
- **Current UI:** Blue gradient header "لوحة التحكم / الإدارة", 8 KPIs (2-col grid), 5 quick actions (طلب جديد, إدارة العملاء, المنتجات, اعتماد الطلبات, تحليلات), bottom widgets (تحصيلات معلقة, مرتجعات معلقة)
- **Data:** All from server-side RPCs

**Chairman (`/dashboard` → ChairmanWorkspace)**

- **File:** `src/pages/dashboard/ChairmanWorkspace.tsx` (84 lines)
- **RPCs:** `get_dashboard_management`, `get_governed_orders`
- **Capabilities:** None — routed by role string (`chairman`, `رئيس مجلس الإدارة`, `رئيس مجلس الادارة`)
- **Current UI:** Green gradient header "لوحة التحكم / مجلس الإدارة", 4 KPIs (2-col grid, **non-clickable** divs), 2 secondary widgets (بانتظار الاعتماد, تحصيلات معلقة), recent orders list (last 5)
- **Data:** `totalSales` and `monthSales` computed **client-side** from `get_governed_orders` response (sum of `total_amount`), not from a dedicated server-side RPC
- **Known issue:** 4 KPIs are non-clickable `<div>` elements, violating "Everything Clickable" rule

**Fallback (/dashboard → ManagementDashboard)**

- **File:** `src/pages/dashboard/ManagementDashboard.tsx` (147 lines)
- **RPCs:** `get_dashboard_management`, `get_credit_dashboard_stats`
- **Capabilities:** None — used as fallback when no other role matches
- **Current UI:** Blue gradient header "لوحة التحكم / إدارة النظام", 4 primary KPIs, customers analytics button, credit stats section (6 counters), company settings button, today's status section (5 metrics)
- **Data:** All from server-side RPCs

**Roles NOT found in codebase:**
- `executive_manager` — does not exist as a role string, type, or workspace
- `general_manager` — does not exist as a role string, type, or workspace

### Approved State

There is **no formal approved screen definition** for an "Upper Management Dashboard" in Part IV (Approved Screens) of this document. The closest approved guidance comes from the Approved Operating Rules (Part III):

- **Dashboard From Real Data** — all aggregation must be server-side
- **Everything Clickable** — every KPI must navigate to a meaningful destination
- **Upper Management Full Edit Rights** — admin/super_admin/chairman bypass ownership scoping
- **Mobile First** — responsive design required
- **Unified Screens** — avoid separate screens when the same screen can adapt by context

No formal approval exists for:
- Which KPIs an upper management dashboard must show
- Whether there should be one unified dashboard or role-specific workspaces
- Layout, navigation structure, or quick action standardization
- Executive Manager or General Manager role definitions or workspaces

### Gap List

1. **No approved Upper Management Dashboard screen in Part IV** — the document has no formal definition for what an upper management dashboard should contain, making it impossible to verify alignment.

2. **4 separate workspace components with no standardized structure** — SuperAdminWorkspace, AdminWorkspace, ChairmanWorkspace, and ManagementDashboard each have different layouts, different RPC sets, different KPI selections, and different navigation patterns. No unified design system for management dashboards.

3. **ChairmanWorkspace has non-clickable KPIs** — 4 KPIs (إجمالي الطلبات, إجمالي المبيعات, مبيعات الشهر, إجمالي العملاء) are rendered as `<div>` elements with no navigation, violating the "Everything Clickable" rule.

4. **Client-side sales calculation in ChairmanWorkspace** — `totalSales` and `monthSales` are computed client-side by iterating all orders from `get_governed_orders`, violating the "Dashboard From Real Data" rule which requires server-side aggregation.

5. **`executive_manager` role does not exist** — no role string, no EmployeeRole type, no workspace component, no route mapping for this role anywhere in the system.

6. **`general_manager` role does not exist** — no role string, no EmployeeRole type, no workspace component, no route mapping for this role anywhere in the system.

7. **Inconsistent KPI coverage across workspaces** — SuperAdmin has order status breakdown by 13 statuses, Admin has 8 KPIs, Chairman has 4 KPIs (2 non-clickable), ManagementDashboard has 9 metrics split across two sections. No standardized set of upper management KPIs.

8. **No cross-role data consistency** — Admin fetches `get_governed_products` for product count but SuperAdmin does not. Chairman fetches `get_governed_orders` for client-side calculations but Admin does not. No shared data contract for upper management views.

---

## Unified Upper Management Dashboard Execution Plan

### Current State

- 4 separate dashboard workspaces: SuperAdminWorkspace (245 lines), AdminWorkspace (125 lines), ChairmanWorkspace (84 lines), ManagementDashboard (147 lines)
- Files: `SuperAdminWorkspace.tsx`, `AdminWorkspace.tsx`, `ChairmanWorkspace.tsx`, `ManagementDashboard.tsx`
- Key gaps: ChairmanWorkspace has 4 non-clickable KPIs (divs), client-side sales calculation from `get_governed_orders`, 4 different RPC sets with no shared contract, no `executive_manager` or `general_manager` role exists, inconsistent KPI coverage across all 4 workspaces

### Target State

- Single unified `UpperManagementDashboard.tsx` component serving all upper management roles (super_admin, admin, chairman, plus executive_manager and general_manager when added)
- Adapts content by role via props/context without requiring separate components
- Displays all 12 approved KPIs sourced from server-side RPCs
- All KPIs are clickable and navigate to approved destinations
- 9 key actions rendered as quick action buttons
- Header adapts role title and gradient color per role
- Follows Mobile First layout (2-col grid, scrollable)

### Implementation Phases

**Phase 1 — Data Layer**
- Target: Create a single unified RPC that returns all 12 KPIs for any upper management role
- Files affected: (RPC — no TS file yet)
- Needs new RPC: Yes — one unified RPC replacing `get_dashboard_management`, `get_credit_dashboard_stats`, `get_governed_dashboard_counts`, `get_order_status_counts` for upper management
- Needs DB changes: No

**Phase 2 — Unified Dashboard Component**
- Target: Build `UpperManagementDashboard.tsx` with all 12 KPIs, 9 actions, role-adaptive header
- Files affected: `src/pages/dashboard/UpperManagementDashboard.tsx` (new)
- Needs new RPC: No (uses Phase 1 RPC)
- Needs DB changes: No

**Phase 3 — Route & Role Integration**
- Target: Update `DashboardPage.tsx` route mapping to route all upper management roles to the single component; add `executive_manager` and `general_manager` role strings and EmployeeRole type entries
- Files affected: `src/pages/dashboard/DashboardPage.tsx`, `src/types/employee.ts` (or equivalent type file)
- Needs new RPC: No
- Needs DB changes: No (roles already exist in DB or can be added via seed)
- **Ready For Phase 3: ✅ YES** — العائق الوحيد (`/activity` route) تم حله في Phase 2.6. شاشة `ActivityPage.tsx` موجودة، Route `/activity` مسجل، زر "النشاط الموحد" في `UpperManagementDashboard.tsx` يعمل الآن.

**Phase 4 — Cleanup**
- Target: Remove the 4 obsolete workspace components and their imports
- Files affected: Delete `SuperAdminWorkspace.tsx`, `AdminWorkspace.tsx`, `ChairmanWorkspace.tsx`, `ManagementDashboard.tsx`; update any remaining imports
- Needs new RPC: No
- Needs DB changes: No

### Required Data Sources

| Metric | Current Source | Missing Source |
|---|---|---|
| الطلبات الجديدة | `get_dashboard_management.total_orders` (partial) | Dedicated new-orders metric |
| الطلبات المعلقة | `get_dashboard_management.pending_orders` | — |
| الزيارات الجارية | `get_dashboard_management.active_visits` | — |
| زيارات اليوم | `get_dashboard_management.today_visits` (AdminWorkspace only) | Unified today-visits metric for all roles |
| العملاء الجدد | None | New RPC field or separate RPC |
| العملاء الراكدون | None | New RPC field or separate RPC |
| المبيعات اليومية | Client-side calc (ChairmanWorkspace only) | Server-side aggregation RPC |
| المبيعات الشهرية | Client-side calc (ChairmanWorkspace only) | Server-side aggregation RPC |
| أفضل مندوب | None | New RPC for rep ranking |
| أضعف مندوب | None | New RPC for rep ranking |
| عدد العملاء | `get_dashboard_management.total_customers` | — |
| عدد المناديب | `get_governed_dashboard_counts.employees_count` (AdminWorkspace only) | Unified employee count for all roles |

### Risks

1. **Non-clickable KPIs (ChairmanWorkspace)** — Chairman's 4 KPIs are divs; full component replacement required, not a patch
2. **Client-side sales calculation** — Chairman's `totalSales`/`monthSales` must be replaced server-side before removing the client calc, creating a dependency between Phase 1 and Phase 2
3. **Missing roles** — `executive_manager` and `general_manager` do not exist in EmployeeRole type, role strings, or DB seed; adding them touches type system, DB seed, and auth flow beyond just the dashboard
4. **4 different RPC sets** — currently 4 dashboards call different combinations of RPCs; a unified RPC must cover all 12 KPIs without breaking existing callers during transition

### Out Of Scope

- Store
- Cart
- Pricing Engine
- Auction
- Daily Deals
- Flash Offers
- SMS Screen
- Login / Registration
- Visit check-in / check-out logic
- Order approval workflow
- Customer management screen
- Employee management screen
- Supervisor profile screen
- Representative profile screen
- Collections screen
- Returns screen
- Product management screen
- Company management screen

---

## Implementation Log

All actual code/database/RPC changes executed are recorded here.

| Date | Phase | What Was Executed | Files Changed | RPCs Changed/Added | DB Objects Changed/Added | Not Executed |
|---|---|---|---|---|---|---|
| 2026-06-07 | Phase 1 — Data Layer | Create unified `get_upper_management_dashboard` RPC returning all 12 approved KPIs for upper management roles (سوبر أدمن, رئيس مجلس الإدارة, أدمن). Replaces `get_dashboard_management`, `get_credit_dashboard_stats`, `get_governed_dashboard_counts`, `get_order_status_counts` for upper management. Role-restricted (returns FORBIDDEN for non-upper-management). No ownership filtering (upper management sees all data per Ownership Visibility Matrix). | `supabase/migrations/20260607_upper_management_dashboard_rpc.sql` (new) | Added: `get_upper_management_dashboard(p_token uuid)` RETURNS jsonb | None | Phases 3-4 (route integration, cleanup) not started |
| 2026-06-07 | Customer Policy Verification | التحقق من سياسة العملاء الحالية لـ 4 أنواع (مسجل ذاتيًا, مباشر, تابع لمندوب, تابع لسوبر فايزر). النتيجة: السياسة متوافقة مع القاعدة "جميع العملاء يشترون بنفس طريقة المتجر، ويختلف فقط نطاق الرؤية والملكية الإدارية". 9 نقاط متوافقة، 0 نقاط غير متوافقة. | `src/pages/auth/RegistrationPage.tsx`, `src/pages/customers/NewCustomerPage.tsx`, `src/pages/storefront/*`, `src/pages/auctions/*`, `src/pages/tiers/*`, `src/pages/daily-deals/*`, `src/pages/flash-offers/*`, `src/routes/index.tsx`, `src/components/auth/ProtectedRoute.tsx`, `supabase/migrations/20260605_customer_direct_ownership.sql`, `supabase/migrations/20260604_unified_identity_location.sql`, `supabase/migrations/20260604_governance_rpcs.sql`, `supabase/migrations/20260606_customer_visibility_fix.sql`, `supabase/migrations/20260607_recovery_missing_functions.sql` | None (read-only verification) | `public.customers` (owner_id, owner_type, identity_id), `public.orders` (owner_type, owner_id, created_by, customer_id), `app.sessions` (identity_type) | لا يوجد |
| 2026-06-07 | Phase 1 — Bug Fix (best_rep/weakest_rep JOIN) | إصلاح 3 أخطاء في RPC `get_upper_management_dashboard`: (1) `o.owner_id = e.id` → `o.owner_id IN (e.id, e.identity_id)` للتوافق مع البيانات القديمة (owner_id = employees.id) والجديدة (owner_id = employees.identity_id بعد ترحيل 20260605). (2) `e.name` → `e.full_name` (العمود الفعلي). (3) أدوار الصلاحية من `SUPER_ADMIN, CHAIRMAN, ADMIN` إلى `سوبر أدمن, رئيس مجلس الإدارة, أدمن` (أسماء الأدوار الفعلية في قاعدة البيانات). | `supabase/migrations/20260607_upper_management_dashboard_rpc.sql` (تعديل) | Modified: `get_upper_management_dashboard(p_token uuid)` (JOIN, column, role names) | None | Phases 3-4 لم تبدأ |
| 2026-06-07 | Phase 2 — UI Component | إنشاء `UpperManagementDashboard.tsx` يعرض 12 KPI (قابلة للنقر مع روابط) + 9 إجراءات سريعة — شاشة موحدة بالكامل لجميع أدوار الإدارة العليا. يستخدم RPC `get_upper_management_dashboard` من Phase 1. | `src/pages/dashboard/UpperManagementDashboard.tsx` (جديد) | None | None | Pending Queues, Order Status, Operational Modules لم تضف بعد |
| 2026-06-07 | Phase 2.5 — UI Completion | إضافة 3 أقسام تشغيلية إلى `UpperManagementDashboard.tsx`: (1) قوائم الانتظار بأعداد حقيقية من `get_order_status_counts` + `get_dashboard_management`. (2) حالة الطلبات — جميع الحالات مع ترميز ألوان وأعداد. (3) وحدات التشغيل — 8 بطاقات (المخزن، التوصيل، المنتجات، الموظفين، الشركات، التقارير، الهيكل البيعي، المزادات). | `src/pages/dashboard/UpperManagementDashboard.tsx` (تعديل) | None | None | Phases 3-4 (route integration, cleanup) لم تبدأ |
| 2026-06-05 | Phase 2.6 — /activity Route Resolution | إنشاء صفحة `ActivityPage.tsx` أولية لعرض الأحداث التشغيلية من مكان واحد. إضافة Route `/activity` إلى `routes/index.tsx`. أصبح زر "النشاط الموحد" في `UpperManagementDashboard.tsx` يعمل الآن. إزالة العائق الوحيد الذي كان يمنع Phase 3. | `src/pages/activity/ActivityPage.tsx` (جديد), `src/routes/index.tsx` (تعديل — إضافة import + route) | None | None | ربط مصادر البيانات الحقيقية للـ Activity Feed (طلبات، زيارات، تحصيلات، عملاء جدد، تغييرات ملكية) — المرحلة الحالية: 6 عناصر توضيحية فقط |

---

## Upper Management Data Requirements

Data elements that are approved but not yet supported by the current database schema or RPCs.

### Target Performance

| Property | Value |
|---|---|
| الهدف العام الافتراضي الحالي | 5,000,000 |
| مطلوب | أن يكون قابلاً للتعديل من الإدارة العليا |
| الاستخدام | لوحة الإدارة العليا، تحليلات Target Performance Bar، ترتيب المندوبين |
| الدعم الحالي | غير مدعوم — لا يوجد جدول إعدادات أو RPC للـ target |

**البيانات المطلوبة مستقبلاً:** قيمة الهدف العام (عدد صحيح)، قابلية التعديل (آخر من عدل، تاريخ التعديل)، أهداف فردية للمندوبين (اختياري).

**الجداول أو الإعدادات المنطقية المطلوبة:** جدول `app_settings` أو `upper_management_settings` يحتوي على `target_amount` مع سجل تدقيق التعديلات. أو RPCs: `get_upper_management_settings`, `set_upper_management_target`.

**العناصر غير المدعومة حالياً:** الهدف العام 5M غير مخزن في قاعدة البيانات، ولا يوجد RPC يعيده. Target Performance Bar لا يمكن تنفيذه بدون هذه البيانات.

---

### Representative Evaluation Weights

| Property | Value |
|---|---|
| Sales % الافتراضي | 70% |
| Visits % الافتراضي | 15% |
| Orders % الافتراضي | 15% |
| مطلوب | أن تكون قابلة للتعديل من الإدارة العليا |
| الاستخدام | Sales Leaderboard & Performance Ranking |
| الدعم الحالي | غير مدعوم — لا يوجد تخزين للأوزان ولا RPC |

**البيانات المطلوبة مستقبلاً:** الأوزان الثلاثة (Sales, Visits, Orders) كقيم百分比 قابلة للتعديل.

**الجداول أو الإعدادات المنطقية المطلوبة:** جدول `evaluation_weights` أو حقل JSON في `app_settings`. RPCs: `get_evaluation_weights`, `set_evaluation_weights`.

**العناصر غير المدعومة حالياً:** الأوزان غير موجودة في قاعدة البيانات. Sales Leaderboard Score غير قابل للحساب بدونها.

---

### Unified Date Range Support

| Property | Value |
|---|---|
| الفترات المطلوبة | اليوم، أمس، آخر 7 أيام، الشهر الحالي، الشهر السابق، هذا العام، من/إلى |
| الفترة الافتراضية | الشهر الحالي |
| الاستخدام | جميع KPIs، التحليلات، الترتيبات، التقارير |
| الدعم الحالي | غير مدعوم — RPC `get_upper_management_dashboard` لا يقبل `date_from`/`date_to` ويعيد بيانات ثابتة (اليوم، الشهر الحالي) |

**البيانات المطلوبة مستقبلاً:** معاملات `p_date_from timestamptz`, `p_date_to timestamptz` في RPC.

**الجداول أو الإعدادات المنطقية المطلوبة:** تعديل RPC `get_upper_management_dashboard` ليأخذ parameters الفترة وتصفية جميع KPIs بناءً عليها.

**العناصر غير المدعومة حالياً:** RPC الحالي لا يدعم الفترات. جميع الـ 12 KPI ثابتة (CURRENT_DATE / date_trunc month). Target Performance Bar لا يستجيب للفترة.

---

## Part V: Change Log

All significant approvals and decisions are recorded here in reverse chronological order.

| Date | Change | Notes |
|---|---|---|
| 2026-06-07 | إنشاء وثيقة SCREENS_AND_UI_BLUEPRINT.md | الوثيقة المرجعية الرسمية للشاشات والواجهات |
| 2026-06-07 | اعتماد GPS Rules | قاعدة Visit Distance Validation + Human Readable Location + Geographic Search |
| 2026-06-07 | اعتماد Active Runtime Context | كل شاشة تدرك من هو المستخدم ومتى وأي حالة |
| 2026-06-07 | اعتماد نظام الشرائح (Tiers) | 4 شرائح نشطة مع استثناءات لكل منتج/شركة، حساب client-side |
| 2026-06-07 | اعتماد إعادة الطلب للسلة (Return Order To Cart) | يحتفظ بنفس رقم الطلب عند إعادة الإرسال |
| 2026-06-07 | اعتماد شاشة الزيارات (Visits Screen) | GPS check-in/out, زيارة واحدة مفتوحة لكل مستخدم |
| 2026-06-07 | اعتماد ملف السوبر فايزر (Supervisor Profile) | Dashboard route + إدارة المندوبين واعتماد الطلبات |
| 2026-06-07 | اعتماد ملف المندوب (Representative Profile) | نشاط حديث + معلومات شخصية + تسلسل هرمي |
| 2026-06-07 | اعتماد ملف العميل (Customer Profile) | 5 تبويبات (المعلومات, الطلبات, التحصيلات, الزيارات, السجل) |
| 2026-06-07 | إضافة Implementation Governance + Customer Profile Reality Gap Report | قاعدة إلزامية للتسجيل + توثيق الفجوة بين الحالي والمعتمد لملف العميل |
| 2026-06-07 | إضافة Customers Screen Reality Gap Report | توثيق الفجوة بين الحالي والمعتمد لشاشة العملاء — 7 فجوات |
| 2026-06-07 | إضافة Supervisor Profile Reality Gap Report | توثيق الفجوة بين الحالي (Dashboard workspace) والمعتمد (شاشة منفصلة) — 8 فجوات |
| 2026-06-07 | إضافة Upper Management Dashboard Reality Gap Report | توثيق 4 لوحات حالية مقابل عدم وجود تعريف معتمد — 8 فجوات |
| 2026-06-07 | إضافة Upper Management Dashboard إلى Part IV — Approved Screens | توثيق الشاشة المعتمدة: 12 KPI, 9 إجراءات, 5 قواعد تشغيل |
| 2026-06-07 | إضافة Ownership Visibility Matrix إلى Part III — Approved Operating Rules | توثيق قواعد الرؤية والملكية لـ 4 أدوار + قواعد شاملة |
| 2026-06-07 | إضافة Unified Upper Management Dashboard Execution Plan | خطة تنفيذ الشاشة الموحدة: 4 مراحل، 12 KPI، 6 مخاطر |
| 2026-06-07 | Phase 1 — Data Layer (Upper Management Dashboard) | إنشاء RPC موحد `get_upper_management_dashboard` يعيد 12 KPI للأدوار العليا |
| 2026-06-07 | Customer Policy Verification | التحقق من سياسة 4 أنواع عملاء — متوافقة بالكامل مع القاعدة المعتمدة |
| 2026-06-07 | إضافة Screen Evolution Policy إلى Part III | 6 سياسات لتطور الشاشات: Keep, Transform, Deprecate, Remove, Cleanup, Replace Before Create |
| 2026-06-07 | إضافة Capability Driven UI إلى Part III | قاعدة التصميم والتشغيل: المستخدم يرى فقط ما يحتاجه لأداء عمله |
| 2026-06-07 | إضافة Sales Leaderboard & Performance Ranking إلى Part IV | شاشة تحليل وترتيب الأداء البيعي والتحفيزي — معتمدة (Planned) |
| 2026-06-07 | إصلاح Phase 1 RPC (best_rep/weakest_rep + role names + column name) | 3 أخطاء: JOIN backward compatibility, `e.name`→`e.full_name`, أدوار صلاحية عربية بدل إنجليزية. Verification ناجح — يعيد بيانات فعلية غير NULL. |
| 2026-06-07 | إضافة Smart Search إلى Part III | قاعدة بحث موحد وذكي لجميع الشاشات التشغيلية — حقول البحث لكل شاشة + قاعدة عامة |
| 2026-06-07 | إضافة Unified Date Range Filter إلى Part III | قاعدة فترات زمنية موحدة لجميع الشاشات التحليلية والتقارير و Dashboards — 7 فترات جاهزة + فترة مخصصة |
| 2026-06-07 | Phase 2 — UI Component (Upper Management Dashboard) | إنشاء `UpperManagementDashboard.tsx` — 12 KPI قابلة للنقر + 9 إجراءات سريعة، شاشة موحدة لجميع أدوار الإدارة العليا |
| 2026-06-07 | إضافة Upper Management Data Requirements | توثيق 3 عناصر بيانات غير مدعومة حالياً: Target Performance (5M), Representative Evaluation Weights (70/15/15), Unified Date Range Support |
| 2026-06-07 | Phase 2.5 — UI Completion | إضافة قوائم الانتظار، حالة الطلبات، وحدات التشغيل إلى `UpperManagementDashboard.tsx` |
| 2026-06-05 | Phase 2.6 — /activity Route Resolution | إنشاء `ActivityPage.tsx` + ربط Route `/activity`. إزالة العائق الوحيد لـ Phase 3. |

---

*End of SCREENS_AND_UI_BLUEPRINT.md*
