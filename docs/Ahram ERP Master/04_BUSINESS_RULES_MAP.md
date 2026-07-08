# 04 – Business Rules Map

**التصنيف:** خريطة قواعد الأعمال  
**الغرض:** توثيق كل مكان توجد فيه قواعد أعمال في النظام  
**تاريخ المسح:** 5 يوليو 2026

---

## 1. مواقع قواعد الأعمال (4 طبقات)

| الطبقة | الموقع | درجة التركيز |
|--------|--------|-------------|
| **PostgreSQL RPCs** | `supabase/migrations/*.sql` | **عالية جداً** — أكثر من 150 Function |
| **Pricing Engine** | `src/engine/pricing.ts` | مركزة — ملف واحد |
| **Services** | `src/services/*.ts` | **مبعثرة** — مخلوطة مع استدعاءات البيانات |
| **Pages / Components** | `src/pages/*.tsx` | **مبعثرة** — قواعد عرضية |

---

## 2. قواعد التسعير (Pricing Engine)

**الملف:** `src/engine/pricing.ts`

| القاعدة | الوصف |
|---------|-------|
| `computePieceQuantity(product, unitType, unitQuantity)` | تحويل كمية الوحدة إلى قطع |
| `computeProductPrices(product, tier, companyId)` | حساب سعر المنتج مع خصم الشريحة |
| `getEffectiveDiscountPercent(tier, companyId)` | خصم الشريحة مع استثناءات الشركة |
| `getEffectiveUnitPrice(product, tier, companyId)` | سعر الوحدة الفعلي بعد الخصم |
| `applyTierProductExceptions(tier, productId)` | استثناءات منتج في شريحة |
| `computeCartTotals(items)` | إجمالي العربة مع العروض والفلاش |
| `computeDealPrice(deal)` | سعر العرض |
| `computeFlashOfferPrice(offer)` | سعر عرض الفلاش |

**ملاحظة:** هذا الملف هو الوحيد الذي يمثل Business Rules Layer مركزية ونظيفة.

---

## 3. قواعد المصادقة والصلاحيات

### 3.1 في Auth Service (`src/services/auth.ts`)

| القاعدة | الوصف |
|---------|-------|
| الـ Session Token يُخزن في localStorage | لا cookies، لا Supabase Auth |
| كل طلب RPC يمرر `p_token` | طريقة المصادقة الوحيدة |
| `validate_session` تُرجع `roles` كمصفوفة نصوص | الأدوار تأتي من RPC وليس من JWT |

### 3.2 في Role Normalization (`src/utils/roleNormalization.ts`)

| القاعدة | الوصف |
|---------|-------|
| 8 أدوار مقننة من كل الصيغ الممكنة (عربي/إنجليزي) | الـ mapping يغطي ~50 صيغة مختلفة |
| الأدوار غير المعروفة تُرجع `'مندوب مبيعات'` (افتراضي) | Fallback آمن |
| `isUpperManagement()` — الإدارة العليا تعبر كل الصلاحيات | Bypass كامل لجميع الـ capability checks |

### 3.3 في ProtectedRoute (`src/components/auth/ProtectedRoute.tsx`)

| القاعدة | الوصف |
|---------|-------|
| 4 مستويات حماية: Public / Authenticated / employeeOnly / capability | تسلسل هرمي للتحقق |
| الإدارة العليا تتجاوز كل صلاحية دون استدعاء RPC | Optimisation مهم |
| فشل الصلاحية يُعيد التوجيه حسب نوع الهوية (موظف → dashboard، عميل → storefront) | تجربة مستخدم مختلفة |

### 3.4 في useCapability (`src/hooks/useCapability.ts`)

| القاعدة | الوصف |
|---------|-------|
| Cache في الذاكرة مع TTL 5 دقائق | عدم تكرار استدعاء `check_capability` |
| الإدارة العليا تعود `true` بدون استدعاء RPC | تجاوز كامل |

---

## 4. قواعد المبيعات والأسعار

### 4.1 Business Activity (`src/services/businessActivity.ts`)

| القاعدة | الوصف |
|---------|-------|
| Sales KPI يعيد استخدام Orders data | "لا يوجد كيان مبيعات منفصل" — قرار معماري واعي |
| `kpiType === 'sales'` maps to `recordType = 'orders'` | تحويل تلقائي |

### 4.2 Products (`src/services/products.ts`)

| القاعدة | الوصف |
|---------|-------|
| `get_governed_products` بـ 4 overloads | search, active_only, visible_only, الكل |
| المحافظة على `p_token` للحوكمة | كل استدعاء منتجات يحترم حوكمة الوصول |

### 4.3 Sales List (`src/pages/sales-list/SalesListPage.tsx`)

| القاعدة | الوصف |
|---------|-------|
| حساب سعر الوحدة: `carton_price / carton_quantity * 12` للدستة | تحويل سعر الكرتونة للدستة |
| `computeUnitPrices`: إذا كان `cartonQuantity >= 24` تظهر الدستة | شرط ظهور الدستة |
| الأسعار المكررة: `price : unitType` مفصولة بـ ` | ` |
| PDF export: `html-to-image` (foreignObject) للعربية | حل معتمد بعد فشل html2canvas و jspdf-autotable |

---

## 5. قواعد الحضور والانصراف

| الموقع | القاعدة |
|--------|---------|
| `attendance.ts` — `startWorkday` | بدء يوم العمل مع GPS وتسجيل الموقع |
| `attendance.ts` — `calculateNetWorkHours` | خصم فترات الاستراحة من إجمالي وقت العمل |
| `attendance.ts` — `getMyWorkdayStatus` | استعلام عن حالة يوم العمل الحالي |
| `trackingEngine.ts` — `sync_tracking_points` | مزامنة نقاط GPS مع خادم مع إدارة offline queue |
| `heartbeatService.ts` — `record_heartbeat` | نبضات حية كل 5 دقائق، إنهاء الجلسة بعد 30 دقيقة انقطاع |

---

## 6. قواعد الهدف والأداء

| الموقع | القاعدة |
|--------|---------|
| `targets.ts` | طبقة رقيقة فوق RPC — لا قواعد إضافية |
| `attendance.ts` — `get_daily_target_vs_actual` | مقارنة الأداء الفعلي بالمستهدف اليومي |
| `get_completed_workdays_history` | حساب أيام العمل المكتملة فقط |

---

## 7. قواعد العرض والخصومات

| الموقع | القاعدة |
|--------|---------|
| `dailyDeals.ts` | CRUD + تفعيل/إلغاء |
| `flashOffers.ts` | CRUD + تفعيل/إلغاء |
| `tiers.ts` | CRUD + استثناءات شركة |
| `deals.ts` | جلب الباقات النشطة |
| `pricing.ts` (engine) | حساب خصم الشريحة مع استثناءات المنتج والشركة |

---

## 8. قواعد الائتمان

| الموقع | القاعدة |
|--------|---------|
| `credit.ts` | 20 RPC — CRUD + حجز/تحرير/تحويل رصيد + برامج + شيكات |
| `credit.ts` — `reserveCreditForOrder` | حجز رصيد ائتماني عند إنشاء طلب |
| `credit.ts` — `checkOrderOverLimit` | التحقق من تجاوز الطلب لحد الائتمان |
| `credit.ts` — `convertReservationToOutstanding` | تحويل الحجز إلى مستحق عند تأكيد الطلب |

---

## 9. قواعد الموافقات

| الموقع | القاعدة |
|--------|---------|
| `returns.ts` | موافقة/رفض المرتجع (حوكمة + سير عمل) |
| Orders (في RPC) | دورة حياة الطلب: draft → submitted → reviewing → approved → preparing → dispatched → delivered |
| RPC في قاعدة البيانات | التحقق من الصلاحية لكل تغيير حالة |

---

## 10. مناطق تكرار القواعد (Risk)

| القاعدة | تتكرر في |
|---------|----------|
| حساب سعر الوحدة (قطعة/دستة/كرتونة) | `src/pages/sales-list/SalesListPage.tsx` + `src/engine/pricing.ts` |
| التحقق من صلاحية المستخدم | `ProtectedRoute.tsx` + `useCapability.ts` + RPC `check_capability` |
| تنسيق الأسعار (`formatPrice`) | `src/utils/format.ts` + استخدامات متفرقة في الصفحات |

---

## 11. الخلاصة

| المستوى | الحالة |
|---------|--------|
| قواعد مركزية في Engine واحد | ✅ **Pricing** فقط |
| قواعد في Services (مخلوطة مع Data Access) | ⚠️ **معظم الخدمات** |
| قواعد في RPCs (غير مرئية من الكود) | ⚠️ **170+ ملف هجرة** |
| قواعد مكررة بين Frontend و RPCs | ❌ **موجود** |
| قواعد متناثرة في Pages/Components | ❌ **موجود** |
