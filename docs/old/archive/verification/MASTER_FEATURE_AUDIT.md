# MASTER_FEATURE_AUDIT.md — تقرير الحالة التنفيذية للأقسام الخمسة

> تاريخ التقرير: 2026-06-03  
> النطاق: الأهرام للتجارة والتوزيع — منصة الطلبات B2B  
> الملف الوحيد المعتمد للتقييم التنفيذي

---

## جدول ملخص الأقسام

| القسم | Frontend | Backend | Database | Workflow | Governance | نسبة الاكتمال |
| ----- | -------- | ------- | -------- | -------- | ---------- | ------------- |
| 1- صفقة اليوم | واجهة + صفحة + سيرفس | لا RPCs (Direct DB) | جدول كامل (packages) | ناقص | لا يوجد | 40% |
| 2- عرض الساعة | واجهة + صفحة + سيرفس | لا RPCs (Direct DB) | جدول كامل (packages) | ناقص | لا يوجد | 40% |
| 3- المزاد | صفحتين + سيرفس | لا RPCs (Direct DB) | 4 جداول كاملة | ناقص | Employees only | 35% |
| 4- اختر شريحتك | كامل (Selector + Pricing + Cart) | لا RPCs (Direct DB) | جدولين + قيود | مكتمل | لا حوكمة | 85% |
| 5- الائتمان | 4 صفحات + Dashboard | 17 RPC (خارج الـ Repo) | جداول مفقودة من Repo | قيد التشغيل | credit.manage/view/review | 60% |

---

# 1. صفقة اليوم (Deal of the Day)

## A) الواجهة الأمامية Frontend

| العنصر | الملف | المسار |
|--------|-------|--------|
| بطاقة الاختصار | `BusinessShortcuts.tsx` | `src/components/storefront/` |
| صفحة العروض | `DealsPage.tsx` | `src/pages/deals/` |
| خدمة البيانات | `deals.ts` | `src/services/` |
| المسار | `/deals` | `src/routes/index.tsx` السطر 90 |
| النوع | `PackageDealRecord` | `src/services/deals.ts` السطر 3 |
| تصدير الخدمة | `services/index.ts` السطر 9 | `export { dealService }` |

**ما يعمل فعلياً:**
- بطاقة "صفقة اليوم" تظهر في `BusinessShortcuts` كعنصر مرئي فقط (لا يوجد `onClick`).
- صفحة `/deals` موجودة، تقوم باستدعاء `dealService.getActive()` → `supabase.from('packages').select('*').eq('status', 'active')`.
- عند عدم وجود بيانات (جدول `packages` فارغ أو الخطأ `PGRST116`)، تظهر رسالة "قريباً — سيتم تفعيل العروض والباقات قريباً".
- عند وجود بيانات، تعرض بطاقات العروض مع السعر والحالة والكمية المتبقية.

**الـ Forms/أزرار:**
- لا توجد نماذج إضافة أو تعديل في الواجهة العامة.
- لا توجد صفحة إدارة للعروض (إنشاء/تعديل/إيقاف).
- `ModuleCard` في `SuperAdminWorkspace.tsx` السطر 179 يشير إلى `/auctions` وليس `/deals` — لا يوجد مدخل للعروض من لوحة التحكم.

## B) قاعدة البيانات Database

| الجدول | ملف الإنشاء | الأعمدة المهمة |
|--------|------------|----------------|
| `packages` | `20260531_phase9_packages.sql` | `id, package_type (daily_deal\|flash_offer), name, description, price, available_quantity, original_quantity, start_time, end_time, status (active\|paused\|expired\|ended\|cancelled), is_manual_stop, created_by (FK→employees)` |
| `package_items` | `20260531_phase9_packages.sql` | `id, package_id (FK→packages CASCADE), product_id (FK→products), unit_type, quantity` |
| `package_orders` | `20260531_phase9_packages.sql` | `id, package_id (FK→packages), order_id (FK→orders), quantity` — UNIQUE(package_id, order_id) |

**العلاقات:** `packages.created_by → employees.id`، `package_items.product_id → products.id`، `package_orders.order_id → orders.id`  
**القيود:** CHECK على `package_type` (فقط daily_deal/flash_offer)، CHECK على `status` (5 حالات)، CHECK على `price >= 0`، CHECK على `available_quantity/original_quantity >= 0`  
**Enums:** لا يوجد — يستخدم VARCHAR مع CHECK  
**Views:** لا يوجد  
**أنواع TypeScript:** `DealType = 'daily_deal' | 'flash_offer'` في `domain.ts` السطر 31 و `storefront.ts` السطر 204

## C) Backend / RPC

| RPC | الحالة |
|-----|--------|
| لا يوجد أي RPC للـ packages/Deals | غير موجود |

**الوصول المباشر:** تستخدم الـ service `supabase.from('packages').select('*')` — وصول مباشر بدون حوكمة.

## D) دورة العمل Workflow

**الحالية (ناقصة):**
```
إنشاء → [لا توجد واجهة] → تطبيق (يدوي عبر DB) → انتهاء (بانتهاء المدة أو الإيقاف)
```

**الدورة الكاملة المطلوبة:**
```
إنشاء (موظف مأذون) → مراجعة → تفعيل → عرض في المتجر → طلب (ربط مع package_orders) → خصم المخزون → انتهاء
```

**الواقع:**
- لا توجد واجهة لإنشاء العروض (لا Create/Update/Toggle).
- لا يوجد ربط بين `packages` و `orders` في التطبيق (جدول `package_orders` موجود في SQL لكن لا يستخدم في الكود).
- لا يوجد تكامل مع `governed_create_order` لإضافة items من الباقات.

## E) الحوكمة والصلاحيات

| الإجراء | الصلاحية | الحالة |
|---------|---------|--------|
| رؤية الاختصار في المتجر | عامة (بدون تسجيل دخول) | ✓ |
| رؤية صفحة العروض | موظفون فقط (`employeeOnly`) | ✓ (في الـ Route) |
| إنشاء عرض | غير متاح | ✗ |
| تعديل عرض | غير متاح | ✗ |
| إيقاف عرض | غير متاح | ✗ |

**ملاحظة:** لا يوجد capability مخصصة للـ Deals.

## F) التكامل مع بقية النظام

| النظام | الحالة |
|--------|--------|
| المنتجات | جدول `package_items.product_id` موجود لكن لا يستخدم في التطبيق |
| الأسعار | سعر مستقل في `packages.price` — غير مرتبط بأسعار المنتجات |
| الشرائح | لا تكامل |
| الطلبات | جدول `package_orders.order_id` موجود لكن لا يستخدم |
| العملاء | لا تكامل |
| الائتمان | لا تكامل |
| المخزون | `packages.available_quantity` موجود لكن لا يتم تحديثه تلقائياً |
| الزيارات | لا تكامل |
| التحصيلات | لا تكامل |

## G) حالة التنفيذ الحقيقية

| البند | النسبة |
|-------|--------|
| **نسبة الاكتمال التقديرية** | **40%** |
| تم تنفيذه فعلاً | هيكل الجدول الكامل (packages, package_items, package_orders)، واجهة عرض للقارئ، خدمة بيانات، مسار `/deals` |
| لم يتم تنفيذه | واجهة إنشاء/إدارة، ربط الطلبات، تحديث المخزون، `onClick` للاختصار، حوكمة (capabilities)، RPCs |
| ما هو مكسور | لا يوجد — لكن غير متكامل |
| ما هو ناقص | اختصار "صفقة اليوم" لا ينقل لأي مكان، لا يوجد مدخل من لوحة التحكم |
| ما هو موجود شكلياً فقط | الاختصار في `BusinessShortcuts` (مكون مرئي بدون وظيفة) |

---

# 2. عرض الساعة (Flash Offer / Hourly Offer)

## A) الواجهة الأمامية Frontend

| العنصر | الملف | المسار |
|--------|-------|--------|
| بطاقة الاختصار | `BusinessShortcuts.tsx` | `src/components/storefront/` |
| صفحة العروض | `DealsPage.tsx` (نفس صفحة صفقة اليوم) | `src/pages/deals/` |
| المسار | `/deals` (نفس المسار) | `src/routes/index.tsx` السطر 90 |
| النوع | `PackageDealRecord.packageType = 'flash_offer'` | `src/services/deals.ts` |

**ما يعمل:** نفس آلية "صفقة اليوم" — تعرض في `DealsPage` مع تصنيف "عرض محدود". الفرق الوحيد هو `package_type`.

**ما لا يعمل:**
- عرض الساعة يفترض أن يكون محدوداً زمنياً (عرض الساعة)، لكن لا توجد آلية عد عكسي أو مؤقت في الواجهة.
- لا توجد فلترة للعروض حسب `package_type` في `DealsPage` — تعرض كل العروض معاً.

## B) قاعدة البيانات Database

نفس جداول `packages` و `package_items` و `package_orders` مع `package_type = 'flash_offer'`. لا توجد جداول إضافية.

## C) Backend / RPC

لا يوجد RPCs — وصول مباشر `supabase.from('packages').select('*')`.

## D) دورة العمل Workflow

نفس دورة "صفقة اليوم". الفرق: `package_type = 'flash_offer'` ويجب أن تكون محدودة بمدة زمنية قصيرة (ساعات).

## E) الحوكمة والصلاحيات

نفس آلية "صفقة اليوم" — لا حوكمة خاصة.

## F) التكامل مع بقية النظام

نفس "صفقة اليوم" — لا تكامل فعلي.

## G) حالة التنفيذ الحقيقية

| البند | النسبة |
|-------|--------|
| **نسبة الاكتمال التقديرية** | **40%** |
| تم تنفيذه فعلاً | هيكل الجدول، واجهة عرض، خدمة بيانات |
| لم يتم تنفيذه | عداد زمني، إدارة منفصلة، ربط الطلبات |
| ما هو موجود شكلياً فقط | الاختصار في `BusinessShortcuts` (بدون `onClick`) |

---

# 3. المزاد (Auction)

## A) الواجهة الأمامية Frontend

| العنصر | الملف | المسار |
|--------|-------|--------|
| بطاقة الاختصار | `BusinessShortcuts.tsx` | `src/components/storefront/` |
| صفحة قائمة المزادات | `AuctionsPage.tsx` | `src/pages/auctions/` |
| صفحة تفاصيل المزاد | `AuctionDetailPage.tsx` | `src/pages/auctions/` |
| خدمة البيانات | `auctions.ts` | `src/services/` |
| المسارات | `/auctions`, `/auctions/:id` | `src/routes/index.tsx` السطر 91-92 |
| أيقونة Dashboard | `SuperAdminWorkspace.tsx` السطر 179 | `ModuleCard(label="المزادات", path="/auctions")` |
| أنواع TypeScript | `AuctionStatus`, `AuctionItem`, `BidEntry`, `AuctionRecord`, `BidRecord` | `src/types/storefront.ts` و `src/types/domain.ts` |

**ما يعمل فعلياً:**
- صفحة `/auctions` تعرض قائمة المزادات (إن وجدت)، أو رسالة "قريباً — سيتم تفعيل المزادات قريباً".
- صفحة `/auctions/:id` تعرض تفاصيل المزاد مع السعر الابتدائي، أعلى عرض، الحد الأدنى للزيادة، المشاركون، وقت البداية/النهاية.
- خدمة `auctionService` تدعم `getAll()`، `getById()`، `getLive()`، `placeBid()` — جميعها وصول مباشر للجداول.
- `onClick` في قائمة المزادات ينقل إلى صفحة التفاصيل.

**ما لا يعمل (Placeholder/Mock):**
- اختصار "المزاد" في `BusinessShortcuts` لا يوجد له `onClick` (مرئي فقط).
- زر "شارك الآن" في `AuctionsPage` مرئي فقط — لا ينفذ أي إجراء مزاد فعلي.
- دالة `placeBid()` معرفة في السيرفس ولكن لا تستخدم في أي واجهة (لا يوجد form تقديم عرض).
- لا توجد مشاركة/تسجيل في المزادات (لا واجهة لـ `auction_participants`).
- لا يوجد عرض حي/real-time للمزايدات.
- الحوكمة `employeeOnly` تمنع العملاء من رؤية المزادات رغم أنها يجب أن تكون متاحة للجمهور.

## B) قاعدة البيانات Database

| الجدول | ملف الإنشاء | الأعمدة المهمة |
|--------|------------|----------------|
| `auctions` | `20260531_phase10_auctions.sql` | `code, title, description, product_id, starting_price, current_price, bid_increment, deposit_amount, password, start_time, end_time, status (pending\|live\|ended\|awarded\|cancelled), winner_id (FK→auction_participants), winner_amount` |
| `auction_participants` | `20260531_phase10_auctions.sql` | `auction_id (FK→auctions CASCADE), participant_type (employee\|customer), participant_id, status (pending\|approved\|rejected\|blocked), deposit_paid, approved_by (FK→employees)` |
| `auction_bids` | `20260531_phase10_auctions.sql` | `auction_id (FK→auctions CASCADE), participant_id (FK→auction_participants), amount, is_winning, placed_at` |
| `auction_awards` | `20260531_phase10_auctions.sql` | `auction_id (FK→auctions), participant_id (FK→auction_participants), amount, status (pending\|awarded\|converted), order_id (FK→orders), awarded_by (FK→employees)` |

**العلاقات:** اكتمال العلاقات مع `employees` و `products` و `orders`  
**القيود:** CHECK شامل لكل الجداول  
**Enums:** لا — كلها VARCHAR مع CHECK  
**Views:** لا يوجد

## C) Backend / RPC

| RPC | الحالة |
|-----|--------|
| لا يوجد أي RPC للمزادات | غير موجود |

**ملاحظة خطيرة:** `auctionService` يستخدم وصولاً مباشراً `supabase.from('auctions').select(...)` بدون أي حوكمة. هذا يعني أن أي مستخدم مصرح له (employee) يمكنه تعديل أو حذف بيانات المزادات إذا كانت RLS غير مفعلة.

## D) دورة العمل Workflow

**الحالية (ناقصة):**
```
إنشاء (يدوي عبر DB) → عرض (في AuctionsPage) → [لا يوجد مزايدة] → [لا يوجد اعتماد]
```

**الدورة الكاملة المطلوبة:**
```
إنشاء مزاد → تسجيل مشاركين → دفع تأمين → بدء المزاد (live) → مزايدة حية → انتهاء → منح الجائزة → إنشاء طلب (order) → دفع
```

## E) الحوكمة والصلاحيات

| الإجراء | الصلاحية | الحالة |
|---------|---------|--------|
| رؤية الاختصار في المتجر | عامة | ✓ (مرئي في BusinessShortcuts) |
| رؤية صفحة المزادات | موظفون فقط (`employeeOnly`) | ✗ (يجب أن تكون عامة للتجارة B2B) |
| رؤية تفاصيل المزاد | موظفون فقط (`employeeOnly`) | ✗ |
| المشاركة في المزاد | غير متاح | ✗ |
| إنشاء مزاد | غير متاح (لا واجهة) | ✗ |

**لا توجد capabilities خاصة بالمزادات** في `SUPER_CAPABILITIES` في `useCapability.ts`.

## F) التكامل مع بقية النظام

| النظام | الحالة |
|--------|--------|
| المنتجات | `auctions.product_id` موجود لكن لا يستخدم في الواجهة |
| الأسعار | لا تكامل |
| الشرائح | لا تكامل |
| الطلبات | `auction_awards.order_id` موجود لكن لا يستخدم |
| العملاء | `auction_participants.participant_type = 'customer'` موجود لكن لا يستخدم |
| الائتمان | لا تكامل |
| المخزون | لا تكامل |
| الزيارات | لا تكامل |
| التحصيلات | لا تكامل |

## G) حالة التنفيذ الحقيقية

| البند | النسبة |
|-------|--------|
| **نسبة الاكتمال التقديرية** | **35%** |
| تم تنفيذه فعلاً | 4 جداول كاملة، صفحتي عرض، خدمة بيانات، مسارين |
| لم يتم تنفيذه | تسجيل المشاركين، المزايدة، العرض الحي، إنشاء المزادات، إنشاء الطلبات بعد الفوز، إيداع التأمين |
| ما هو مكسور | غير مكسور لكن غير متكامل مع أي نظام آخر |
| ما هو ناقص | اختصار المزاد لا ينقل، الصفحات `employeeOnly` تمنع العملاء، لا RPCs |
| ما هو موجود شكلياً فقط | زر "شارك الآن"، اختصار BusinessShortcuts |

---

# 4. اختر شريحتك (Choose Your Tier / Pricing Tiers)

## A) الواجهة الأمامية Frontend

| العنصر | الملف | المسار |
|--------|-------|--------|
| بطاقة الاختصار | `BusinessShortcuts.tsx` | `src/components/storefront/` |
| مكون اختيار الشريحة | `TierSelector.tsx` | `src/components/storefront/` |
| مكون تنبيه الحد الأدنى | `TierMinimumNotice.tsx` | `src/components/storefront/` |
| بطاقة المنتج (تعرض الخصم) | `ProductCard.tsx` | `src/components/storefront/` |
| ملخص السلة (خصم الشريحة) | `CartSummary.tsx` | `src/components/storefront/` |
| متجر Zustand | `cart.ts` | `src/store/` |
| محرك التسعير | `pricing.ts` | `src/engine/` |
| صفحة المنتجات (اختيار الشريحة) | `StorefrontPage.tsx` | `src/pages/storefront/` |
| صفحة السلة | `CartPage.tsx` | `src/pages/storefront/` |
| صفحة مراجعة الطلب | `OrderReviewPage.tsx` | `src/pages/storefront/` |
| صفحة الدفع (تطبيق الخصم) | `CheckoutPage.tsx` | `src/pages/checkout/` |
| صفحة تعديل الطلب | `OrderEditPage.tsx` | `src/pages/orders/` |
| صفحة إنشاء الطلب (بدون شرائح) | `OrderNewPage.tsx` | `src/pages/orders/` |

**ما يعمل فعلياً:**
- `TierSelector` يعرض أزرار الشرائح مع نسب الخصم والحد الأدنى — يعمل بشكل كامل.
- `computeProductPrices` يطبق الخصم على جميع أسعار الوحدات.
- `computeCartTotals` يحسب الخصم الإجمالي ويتحقق من الحد الأدنى.
- `getSelectedTier` و `selectTier` في cart store يعملان بشكل كامل.
- `StorefrontPage` تجلب الشرائح من `supabase.from('tiers')` وتعرض الـ `TierSelector`.
- `CheckoutPage` ترسل `tierId` و `tierName` و `discountAmount` عند إنشاء الطلب.
- `ProductCard` يعرض خصم الشريحة على كل منتج.
- `CartPage` يعرض `TierMinimumNotice` و يمنع الدفع إذا لم يتم تحقيق الحد الأدنى.

**ما لا يعمل:**
- اختصار "اختر شريحتك" في `BusinessShortcuts` لا يوجد له `onClick` (لا ينقل إلى `TierSelector`).
- `tier_exceptions` (جدول تجاوز الشريحة لكل عميل) غير مستخدم في التطبيق — لا توجد واجهة لتعيين شريحة افتراضية أو استثناء لعميل معين.
- لا توجد capability أو حوكمة للشرائح — أي موظف يمكنه تعديلها عبر الـ DB.
- لا يوجد `default_tier_id` على جدول `customers`.

## B) قاعدة البيانات Database

| الجدول | ملف الإنشاء | الأعمدة المهمة |
|--------|------------|----------------|
| `tiers` | `20260531_phase4_customers.sql` + `phase4b_tier_attributes.sql` | `id, name, description, sort_order, is_active, discount_percent (0-100), minimum_order_amount, icon_url, color (hex), is_visible, starts_at, ends_at, created_at, updated_at` |
| `tier_exceptions` | `20260531_phase4_customers.sql` | `id, tier_id (FK→tiers), customer_id, is_active, expires_at, created_by, created_at` |

**العلاقات:** `tier_exceptions.tier_id → tiers.id`  
**القيود:** 
- `ck_tiers_discount_percent`: 0-100
- `ck_tiers_minimum_amount`: >= 0
- `ck_tiers_dates`: starts_at < ends_at
- `ck_tiers_color_format`: hex (#XXXXXX)
- UNIQUE INDEX على `tiers.name`
- INDEX على `tier_exceptions` حيث `is_active = true`
**أنواع TypeScript:** `TierConfig` معرفة في `storefront.ts` السطر 18 — كاملة مع جميع الحقول.

## C) Backend / RPC

| RPC | الحالة |
|-----|--------|
| لا يوجد أي RPC للـ Tiers | غير موجود |

**جميع عمليات الشرائح تتم عبر الوصول المباشر:** `supabase.from('tiers').select('*')`.

## D) دورة العمل Workflow

**الدورة الحالية (مكتملة):**
```
إنشاء شريحة (يدوي عبر DB) → تفعيل → StorefrontPage تجلب الشرائح → TierSelector يعرضها → العميل يختار ← 
→ computeProductPrices تطبق الخصم → CartTotals تحسب → CheckoutPage ترسل tierId/discountAmount → order يُنشأ مع الخصم
```

**الملاحظات:**
- إنشاء الشرائح يتم يدوياً عبر SQL — لا توجد واجهة إدارة.
- `tier_exceptions` غير مستخدم — يعني كل العملاء يرون نفس الشرائح.
- آلية انتقاء الشريحة الافتراضية للعميل غير موجودة.

## E) الحوكمة والصلاحيات

| الإجراء | الصلاحية | الحالة |
|---------|---------|--------|
| رؤية اختيار الشريحة | عام (جميع المستخدمين) | ✓ |
| اختيار شريحة وتطبيق الخصم | أي عميل مسجل | ✓ |
| إنشاء/تعديل شريحة | لا توجد واجهة | ✗ |
| تعيين شريحة افتراضية لعميل | غير متاح (tier_exceptions غير مستخدم) | ✗ |

**لا توجد capabilities خاصة بالشرائح.**

## F) التكامل مع بقية النظام

| النظام | الحالة |
|--------|--------|
| المنتجات | ✓ `computeProductPrices` يطبق على كل منتج |
| الأسعار | ✓ خصم نسبة مئوية على سعر القطعة/الدزينة/الكرتونة |
| الشرائح | ✓ (النظام نفسه) |
| الطلبات | ✓ `orders.discount_amount` يخزن قيمة الخصم، `tierId`/`tierName` في order |
| العملاء | ✗ `tier_exceptions` غير مستخدم — لا ربط عميل-شريحة |
| الائتمان | لا تكامل |
| المخزون | لا تكامل |
| الزيارات | لا تكامل |
| التحصيلات | لا تكامل |

## G) حالة التنفيذ الحقيقية

| البند | النسبة |
|-------|--------|
| **نسبة الاكتمال التقديرية** | **85%** |
| تم تنفيذه فعلاً | محرك تسعير كامل، تكامل مع السلة والطلب والدفع، واجهة اختيار، جداول كاملة مع قيود |
| لم يتم تنفيذه | واجهة إدارة الشرائح (إنشاء/تعديل في UI)، `tier_exceptions`، شريحة افتراضية للعميل |
| ما هو مكسور | لا يوجد |
| ما هو ناقص | اختصار "اختر شريحتك" لا ينقل لأي مكان، لا capabilities |
| ما هو موجود شكلياً فقط | اختصار BusinessShortcuts (بدون `onClick`) |

---

# 5. قسم الائتمان (Credit Section)

## A) الواجهة الأمامية Frontend

| العنصر | الملف | المسار |
|--------|-------|--------|
| بطاقة الاختصار | `BusinessShortcuts.tsx` | `src/components/storefront/` |
| صفحة برامج الائتمان (إدارة) | `CreditProgramsPage.tsx` | `src/pages/credit/` |
| صفحة طلبات الائتمان (قائمة) | `CreditApplicationsPage.tsx` | `src/pages/credit/` |
| صفحة مراجعة طلب ائتمان | `CreditReviewPage.tsx` | `src/pages/credit/` |
| صفحة الائتمان للعميل | `CustomerCreditPage.tsx` | `src/pages/credit/` |
| Dashboard stats (الإدارة) | `ManagementDashboard.tsx` | `src/pages/dashboard/` السطر 41، 91-122 |
| Dashboard stats (سوبر أدمن) | `SuperAdminWorkspace.tsx` | `src/pages/dashboard/` السطر 57، 154-166 |
| عرض الائتمان في حساب العميل | `AccountPage.tsx` | `src/pages/account/` السطر 19-20، 91-93 |
| عرض/تعديل في ملف العميل | `CustomerProfilePage.tsx` | `src/pages/customers/` السطر 99-100، 191-192، 223، 244-245 |
| تحليلات الائتمان | `CustomerAnalyticsPage.tsx` | `src/pages/analytics/` السطر 26-31، 109-113 |
| إشعارات الائتمان في المرتجعات | `ReturnsPage.tsx`, `ReturnDetailPage.tsx` | `src/pages/returns/` |
| المسارات | `/credit/programs`, `/credit/applications`, `/credit/applications/:id`, `/customer/credit` | `src/routes/index.tsx` السطر 93-96 |

**ما يعمل فعلياً:**
- `CustomerCreditPage`: يعرض برامج الائتمان النشطة، يسمح بتقديم طلب ائتمان جديد (`governed_create_credit_application`)، يعرض الطلبات السابقة.
- `CreditProgramsPage`: إدارة كاملة (CRUD) لبرامج الائتمان: إنشاء، تعديل، تفعيل/تعطيل.
- `CreditApplicationsPage`: قائمة طلبات الائتمان مع فلترة حسب الحالة.
- `CreditReviewPage`: دورة مراجعة كاملة: استلام المستندات، بدء المراجعة، اعتماد، رفض، تعليق، إعادة تفعيل.
- `AccountPage` و `CustomerProfilePage`: عرض `credit_limit` و `credit_days` و `balance`.
- `CustomerAnalyticsPage`: يعرض `credit_status` مع `current_balance`, `credit_limit`, `credit_utilization_pct`.

**ما لا يعمل (Placeholder/Mock):**
- اختصار "قسم الائتمان" في `BusinessShortcuts` لا يوجد له `onClick`.
- `get_credit_dashboard_stats` و 16 RPC ائتماني آخر غير موجودين في ملفات الـ Migrations في الـ Repo.
- صفحة `CreditProgramsPage` تستخدم RPCs غير موجودة في الـ Repo (`governed_get_credit_programs`, `governed_create_credit_program`, `governed_update_credit_program`, `governed_toggle_credit_program`).
- `customer_credit_ledger` (جدول دفتر الأستاذ الائتماني) غير مستخدم في أي واجهة أمامية — لا توجد صفحة لعرض حركات الائتمان أو الرصيد المتراكم.
- لا توجد capability `credit.create` بالرغم من أن `CustomerCreditPage` يحتاجها.

## B) قاعدة البيانات Database

| الجدول | ملف الإنشاء | الحالة |
|--------|------------|--------|
| `customers` (credit_limit, credit_days) | `20260531_phase2_customers.sql` | موجود بـ CHECK constraints |
| `customer_credit_ledger` | `20260531_phase2_customers.sql` | موجود في SQL لكن غير مستخدم في الكود |
| `returns` (credit_note_number, credit_note_amount) | `20260531_phase7_returns.sql` | موجود |
| `credit_programs` | **غير موجود في أي migration** | ✗ |
| `credit_applications` | **غير موجود في أي migration** | ✗ |
| `credit_contracts` | **غير موجود في أي migration** | ✗ |

**الأعمدة المهمة:**
- `customers.credit_limit decimal(12,2) NOT NULL DEFAULT 0` — CHECK >= 0
- `customers.credit_days integer NOT NULL DEFAULT 0` — CHECK >= 0
- `customer_credit_ledger` مع `transaction_type (debit|credit)`، `amount`, `running_balance`

**ملاحظة خطيرة:** جداول `credit_programs` و `credit_applications` و `credit_contracts` المذكورة في `PROJECT_CHANGELOG.md` و `SYSTEM_BLUEPRINT.md` غير موجودة في أي ملف SQL في مجلد `supabase/migrations/`. هذا يعني أن:
1. إما تم إنشاؤها يدوياً عبر Supabase Dashboard (غير موثقة في Repo)
2. أو أنها غير موجودة أساساً (سينهار التطبيق عند محاولة استدعاء RPCsها)

## C) Backend / RPC

| RPC | ملف الإنشاء | الحالة |
|-----|------------|--------|
| `governed_get_credit_programs` | غير موجود في migration | ✗ موجود فقط على السيرفر |
| `governed_create_credit_program` | غير موجود في migration | ✗ |
| `governed_update_credit_program` | غير موجود في migration | ✗ |
| `governed_toggle_credit_program` | غير موجود في migration | ✗ |
| `get_governed_credit_applications` | غير موجود في migration | ✗ |
| `get_governed_credit_application` | غير موجود في migration | ✗ |
| `governed_create_credit_application` | غير موجود في migration | ✗ |
| `governed_confirm_documents` | غير موجود في migration | ✗ |
| `governed_review_credit` | غير موجود في migration | ✗ |
| `governed_approve_credit` | غير موجود في migration | ✗ |
| `governed_reject_credit` | غير موجود في migration | ✗ |
| `governed_suspend_credit` | غير موجود في migration | ✗ |
| `governed_reactivate_credit` | غير موجود في migration | ✗ |
| `get_credit_dashboard_stats` | غير موجود في migration | ✗ |
| `get_customer_card` | غير موجود في migration | ✗ |
| `get_customer_products` | غير موجود في migration | ✗ |
| `get_customer_brands` | غير موجود في migration | ✗ |

**المجموع:** 17 RPC يتم استدعاؤها من الكود ولكن تعريفاتها SQL غير موجودة في ملفات الـ migration في الـ Repo.

## D) دورة العمل Workflow

**الدورة الحالية (موجودة في الواجهة):**
```
إنشاء برنامج ائتماني (CreditProgramsPage) ← العميل يقدم طلب (CustomerCreditPage) ← 
مراجعة المستندات (CreditReviewPage - confirmDocs) ← مراجعة الطلب (governed_review_credit) ← 
اعتماد/رفض (governed_approve_credit / governed_reject_credit) ← 
تعليق/إعادة تفعيل (governed_suspend_credit / governed_reactivate_credit)
```

**ما ينقص:**
- بعد الاعتماد: لا يتم إنشاء عقد (`credit_contracts`).
- بعد الاعتماد: لا يتم تحديث `customers.credit_limit` و `customers.credit_days` تلقائياً.
- بعد الاعتماد: لا يتم تسجيل الحركة في `customer_credit_ledger`.
- لا يتم التحقق من الحد الائتماني عند إنشاء الطلب (`governed_create_order`).
- لا توجد آلية لإنذار العميل عند تجاوز الائتمان.

## E) الحوكمة والصلاحيات

| الإجراء | الصلاحية | المصدر |
|---------|---------|--------|
| رؤية الاختصار في المتجر | عامة | `BusinessShortcuts` |
| إدارة برامج الائتمان | `credit.manage` | Route: `/credit/programs` |
| عرض طلبات الائتمان | `credit.view` | Route: `/credit/applications` |
| مراجعة طلب ائتمان | `credit.review` | Route: `/credit/applications/:id` |
| صفحة عميل الائتمان | غير محددة (بدون requireCapability) | Route: `/customer/credit` |
| إنشاء طلب ائتمان (من CustomerCreditPage) | غير محددة | الكود لا يتحقق من capability |
| تعديل credit_limit للعميل (من CustomerProfilePage) | غير محددة | يستخدم `governed_update_customer` |

**ملاحظة:** `SUPER_CAPABILITIES` في `useCapability.ts` السطر 30 تتضمن `credit.manage`, `credit.view`, `credit.review` — لكن لا توجد capability للإنشاء (`credit.create`).

## F) التكامل مع بقية النظام

| النظام | الحالة |
|--------|--------|
| المنتجات | لا تكامل مباشر |
| الأسعار | لا تكامل |
| الشرائح | لا تكامل |
| الطلبات | ✗ لا يتم التحقق من `credit_limit` عند إنشاء الطلب |
| العملاء | ✓ `credit_limit` و `credit_days` مخزنين في `customers` |
| الائتمان | ✓ (النظام نفسه) |
| المخزون | لا تكامل |
| الزيارات | لا تكامل |
| التحصيلات | لا تكامل |
| المرتجعات | ✓ `credit_note_amount` في `returns` لكن غير مربوط بالـ ledger |

## G) حالة التنفيذ الحقيقية

| البند | النسبة |
|-------|--------|
| **نسبة الاكتمال التقديرية** | **60%** |
| تم تنفيذه فعلاً | 4 صفحات واجهة كاملة، دورة مراجعة متكاملة، Dashboard stats، عرض في حساب العميل وملف العميل |
| لم يتم تنفيذه | `customer_credit_ledger` غير مستخدم، التحقق من الائتمان عند الطلب، ربط العقد، تحديث limit تلقائي |
| ما هو مكسور | يعتمد على 17 RPC غير موجودة في الـ Repo — إذا تم إعادة بناء الـ DB من الـ migrations سينهار النظام |
| ما هو ناقص | اختصار "قسم الائتمان" لا ينقل، capability `credit.create` |
| ما هو موجود شكلياً فقط | اختصار BusinessShortcuts (بدون `onClick`) |

---

# الخلاصة التنفيذية

## 1. ما الذي يعمل فعلياً الآن

- **نظام الشرائح (85%)** — الأكثر اكتمالاً. يعمل بشكل كامل من الاختيار إلى تطبيق الخصم إلى حفظه في الطلب.
- **الائتمان (60%)** — يعتمد على 17 RPC خارج الـ Repo. واجهات المستخدم تعمل إذا كانت RPCsها موجودة على السيرفر.
- **صفقة اليوم / عرض الساعة (40%)** — غير متكاملين مع دورة الطلب. واجهات العرض فقط.
- **المزاد (35%)** — الأقل اكتمالاً. هيكل DB كامل لكن لا توجد آلية مزايدة عملية.

## 2. ما الذي سيمنع الإطلاق التجاري

| المشكلة | التأثير | القسم |
|---------|---------|-------|
| لا يوجد `onClick` لأي اختصار في BusinessShortcuts | أربع من خمس بطاقات لا تفعل شيئاً | جميع الأقسام |
| 17 RPC ائتماني غير موجودين في الـ Repo | استحالة إعادة بناء الـ DB من الصفر | الائتمان |
| لا يوجد ربط بين `packages` / `auctions` والطلبات | صفقة اليوم/عرض الساعة/المزاد غير قابلين للبيع | صفقة اليوم، عرض الساعة، المزاد |
| حوكمة `employeeOnly` تمنع العملاء من رؤية المزادات | العملاء لا يمكنهم المشاركة في المزادات | المزاد |
| لا يوجد واجهة إنشاء للعروض والمزادات | لا يمكن للموظفين إنشاء عروض أو مزادات | صفقة اليوم، عرض الساعة، المزاد |
| `customer_credit_ledger` غير مستخدم | لا يتم تتبع رصيد الائتمان الفعلي | الائتمان |
| عدم التحقق من `credit_limit` عند إنشاء الطلب | يمكن للعميل تجاوز حدّه الائتماني | الائتمان |

## 3. أخطر الفجوات الحالية

| الرتبة | الفجوة | التفاصيل | الدليل |
|--------|--------|----------|--------|
| **أولوية 1** | 17 RPC غير موجودة في الـ Repo | تعريفات SQL لـ `governed_get_credit_programs` و 16 RPC أخرى غائبة عن `supabase/migrations/` | `CreditProgramsPage.tsx:19`, `CreditApplicationsPage.tsx:26`, `CreditReviewPage.tsx:43`, `CustomerCreditPage.tsx:22` |
| **أولوية 2** | بطاقات BusinessShortcuts لا تعمل | 4 من 5 اختصارات (صفقة اليوم، عرض الساعة، المزاد، اختر شريحتك، قسم الائتمان) لا تنقل المستخدم إلى أي صفحة عند الضغط | `BusinessShortcuts.tsx` — لا يوجد `onClick` |
| **أولوية 3** | `tier_exceptions` و `customer_credit_ledger` غير مستخدمين | جداول كاملة مع قيود وفهارس لكن لا يتم قراءتها أو كتابتها من أي كود Frontend | `src/` لا يحتوي على أي إشارة إلى هذين الجدولين |
| **أولوية 4** | وصول مباشر للجداول بدون حوكمة | `dealService` و `auctionService` يستخدمان `supabase.from('X').select('*')` بدون RPCs | `services/deals.ts:31`, `services/auctions.ts:56` |
| **أولوية 5** | لا Capabilities للشرائح والعروض والمزادات | `SUPER_CAPABILITIES` لا تتضمن أي capabilities لهذه الأقسام | `useCapability.ts` السطر 16-31 |

## 4. ترتيب الأولويات المقترح

| الأولوية | المهمة | المدة التقديرية | القسم |
|----------|--------|----------------|--------|
| 1 | إنشاء وتوثيق جميع RPCs الائتمانية المفقودة في migration | 1-2 يوم | الائتمان |
| 2 | إضافة `onClick` لبطاقات BusinessShortcuts للتنقل إلى الصفحات المناسبة | ساعتان | جميع الأقسام |
| 3 | إضافة capability `credit.create` وتطبيق التحقق من `credit_limit` عند إنشاء الطلب | 1 يوم | الائتمان |
| 4 | ربط `tier_exceptions` بالواجهة (شريحة افتراضية لكل عميل) | نصف يوم | اختر شريحتك |
| 5 | إزالة `employeeOnly` من مسارات المزادات وجعلها عامة + إضافة RPCs للمزادات | نصف يوم | المزاد |
| 6 | تطبيق `customer_credit_ledger` في واجهة العميل (رصيد الائتمان وحركاته) | يوم | الائتمان |
| 7 | إعادة تصميم `packages`/`deals` مع RPCs حكومية لربطها بالطلبات | يومين | صفقة اليوم، عرض الساعة |
| 8 | واجهة إنشاء العروض (Deals Management) و المزادات (Auction Management) | يومين | صفقة اليوم، عرض الساعة، المزاد |
| 9 | آلية المزايدة الحية للمزادات | 3 أيام | المزاد |

## 5. الملفات والتقارير القديمة التي يمكن حذفها

| الملف | السبب |
|-------|-------|
| لا يوجد — جميع الملفات لا تزال ذات قيمة | التقرير الحالي MASTER_FEATURE_AUDIT.md هو البديل الوحيد المعتمد |

**ملاحظة:** لا توجد ملفات تقارير قديمة يمكن حذفها في الـ Repo الحالي. جميع الملفات السابقة (`PROJECT_CHANGELOG.md`, `SYSTEM_BLUEPRINT.md`, `DATABASE_SCHEMA_V1_SQL_SPEC.md` وغيرها من ملفات المواصفات) قد تكون خارج مجلد المشروع الرئيسي أو في مجلدات منفصلة. إذا كانت موجودة، يمكن أرشفتها بعد استخراج المعلومات المطلوبة منها.
