# UI Standardization V1

> تاريخ التنفيذ: 2026-06-20  
> الهدف: توحيد جميع عناصر الواجهة تحت Design System واحد في 7 صفحات محددة دون تغيير Business Logic أو Tracking أو Database.

---

## الهدف من التعديل

توحيد مظهر وسلوك عناصر الواجهة عبر المشروع لضمان تناسق بصري كامل، باستخدام **Design Tokens** معرفة في `style.css` يتم تطبيقها عبر شاشات التطبيق السبعة المستهدفة: Dashboard، Orders، Customers، Products، Executive Supervisor، Tracking، Reports.

### القيود

- **ممنوع**: تعديل Business Logic، RPC، Database، Tracking Logic، Permissions.
- **ممنوع**: تغيير الألوان الأصلية للمشروع (primary, accent, surface, border, text, text-secondary).

---

## Design Tokens المعتمدة

جميع الـ Design Tokens معرفة في `src/style.css` بعد تعاريف Tailwind، وتستخدم كلاسات CSS بادئة `ds-`.

### Typography Standards

| Token | Size | Weight | Usage |
|-------|------|--------|-------|
| `ds-title` | 20px | 700 (bold) | عناوين الصفحات الرئيسية |
| `ds-subtitle` | 18px | 600 (semibold) | عناوين الأقسام الفرعية |
| `ds-body` | 16px | 500 (medium) | النصوص الأساسية |
| `ds-small` | 14px | 500 (medium) | النصوص المساعدة |
| `ds-xs` | 12px | 500 (medium) | النصوص الصغيرة جداً (badges, tags) |

### Icon Standards

| Context | Size | Example |
|---------|------|---------|
| Navbar icons | 24px | `text-2xl` |
| Action icons | 20px | `text-xl` |
| Card/inline icons | 18px | `text-lg` |

### Button Standards

| Token | Height | Radius | Font | Usage |
|-------|--------|--------|------|-------|
| `ds-btn` | 48px | 10px | 14px / 600 | القاعدة الأساسية لجميع الأزرار |
| `ds-btn-primary` | 48px | 10px | 14px / 600 | الأزرار الأساسية (primary bg, white text) |
| `ds-btn-ghost` | 48px | 10px | 14px / 600 | الأزرار الثانوية (surface bg, text text) |

### Card Standards

| Token | Properties |
|-------|------------|
| `ds-card` | `bg-white border border-border rounded-xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]` |

### Input / Select Standards

| Token | Properties |
|-------|------------|
| `ds-input` | `w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors` |
| `ds-select` | `w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors appearance-none` |

### Spacing Standards

| Token | Value |
|-------|-------|
| `ds-gap-xs` | gap: 4px |
| `ds-gap-sm` | gap: 8px |
| `ds-gap-md` | gap: 12px |
| `ds-gap-lg` | gap: 16px |
| `ds-gap-xl` | gap: 24px |
| `ds-p-sm` | padding: 8px |
| `ds-p-md` | padding: 12px |
| `ds-p-lg` | padding: 16px |
| `ds-p-xl` | padding: 24px |

### Badge / Tab Standards

| Token | Properties |
|-------|------------|
| `ds-badge` | `inline-flex text-xs font-semibold px-2 py-0.5 rounded-full` |
| `ds-tabs` | `flex gap-2 overflow-x-auto` |
| `ds-tab` | `whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer` |

---

## الملفات المعدلة (15 ملف)

### مفرد

| الملف | التعديلات |
|-------|-----------|
| `src/style.css` | إضافة جميع Design Tokens (ds-* classes) |

### الصفحات الرئيسية (7)

| الملف | التعديلات |
|-------|-----------|
| `src/pages/orders/OrdersPage.tsx` | توحيد header، أزرار، tabs، inputs، selects، مسافات |
| `src/pages/customers/CustomersPage.tsx` | ds-title، ds-tabs، ds-input، ds-card، ds-gap-*، ds-small |
| `src/pages/products/ProductsPage.tsx` | ds-title، ds-btn، ds-select، ds-card، ds-input، ds-badge |
| `src/pages/reports/ReportsPage.tsx` | ds-title، ds-tabs، ds-card، ds-input، ds-btn |
| `src/pages/command-center/CommandCenterPage.tsx` | ds-title، ds-subtitle، ds-card، ds-btn، ds-badge |
| `src/pages/operations-center/OperationsCenterPage.tsx` | ds-p-lg، ds-card، ds-small |
| `src/pages/dashboard/ManagementDashboard.tsx` | ds-title، ds-card، ds-btn، ds-gap-* |
| `src/pages/dashboard/SalesDashboard.tsx` | ds-title، ds-card، ds-gap-* |

### المكونات المشتركة (6)

| الملف | التعديلات |
|-------|-----------|
| `src/components/shared/TopBar.tsx` | ds-small/ds-badge، ds-gap-sm/ds-p-lg |
| `src/components/shared/BottomNav.tsx` | أيقونات 24px (text-2xl)، ds-xs للنص |
| `src/components/orders/OrderCard.tsx` | ds-card، توحيد أحجام الخطوط |
| `src/pages/operations-center/components/GlobalCounters.tsx` | ds-xs/ds-title |
| `src/pages/operations-center/components/TeamStatusTabs.tsx` | ds-gap-sm، توحيد ألوان tabs |
| `src/pages/attendance/runtime/components/RuntimeTrackingStatus.tsx` | ds-card، ds-xs |

---

## المكونات التي تم توحيدها

1. **OrderCard** — بطاقة الطلب
2. **TopBar** — الشريط العلوي
3. **BottomNav** — شريط التنقل السفلي
4. **GlobalCounters** — العدادات العامة
5. **TeamStatusTabs** — تبويبات حالة الفريق
6. **RuntimeTrackingStatus** — حالة التتبع

## الشاشات التي تم تحسينها

1. طلبات (Orders)
2. العملاء (Customers)
3. المنتجات (Products)
4. التقارير (Reports)
5. مركز القيادة (Command Center)
6. مركز العمليات (Operations Center)
7. لوحة التحكم - إدارة النظام (ManagementDashboard)
8. لوحة التحكم - المبيعات (SalesDashboard)

---

## ملاحظات وقيود

1. **لم يتم تغيير** أي Business Logic أو RPC أو Database أو Tracking Logic أو Permissions.
2. **الألوان الأصلية** للمشروع (primary, accent, surface, border, text, text-secondary) بقيت كما هي.
3. **الـ ds-* classes** معرفة في `style.css` بعد تعاريف Tailwind — متاحة لجميع الصفحات.
4. **لم يتم إضافة أي مكتبات خارجية** — التغييرات مقتصرة على CSS و JSX.
5. **اختبار الترجمة**:
   - ✅ `npm run build` (Vite) — نجح دون أخطاء
6. **الشاشات المتبقي توحيدها** (خارج نطاق V1): Accounting, Warehouse, Delivery, Data Entry, Buffet, Secretary, Chairman, Super Admin, Admin, Security, Collector, Purchasing, Transport, Employee Analysis, Performance Analysis, Company Targets, Employee Targets.

---

## أمر البناء

```bash
npm run build
```
