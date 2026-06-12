# تحليل التتبع — ما يمكن فعله الآن وما يحتاج Native Plugins

## ما يعمل الآن (بعد إضافة Capacitor فقط)

بدون أي Native Plugins إضافية، التطبيق الحالي يمكنه:

### Tracking في المقدمة (Foreground)
✅ **watchPosition** — يعمل عبر WebView Geolocation API. التطبيق يلتقط نقطة كل 5 دقائق.  
✅ **إرسال النقاط** — `sync_tracking_points` RPC يعمل عبر Supabase REST API.  
✅ **IndexedDB Queue** — النقاط غير المرسلة تحفظ محلياً وترسل لاحقاً.  
✅ **Flush عند عودة الاتصال** — `online` event + `visibilitychange` event.  
✅ **Background Sync (PWA فقط)** — Service Worker يرسل النقاط عند عودة الإنترنت (يعمل فقط في متصفح Chrome على Android، **لا يعمل في iOS WKWebView أو Safari**).

### خرائط ومسارات
✅ **Leaflet Map** — يعرض مسار اليوم.  
✅ **OpenStreetMap Tiles** — تحمل عبر HTTPS.  
✅ **عرض نقاط التتبع** — جميع النقاط في `get_employee_day_map`.

---

## ما لا يعمل الآن (يحتاج Native Plugins)

### 1. تتبع الخلفية بعد إغلاق التطبيق (Background Location)
| المنصة | الحالة | السبب |
|--------|--------|-------|
| Android | ❌ لا يعمل | WebView `watchPosition` يتوقف عند تصغير التطبيق أو إغلاقه |
| iOS | ❌ لا يعمل | WKWebView يوقف جميع العمليات JavaScript في الخلفية |

**المطلوب للحل:**
- **Android**: `@capacitor/geolocation` + `Foreground Service` (خدمة أمامية دائمة) مع إشعار دائم "التطبيق يعمل في الخلفية".
- **iOS**: `@capacitor/geolocation` مع `NSLocationAlwaysAndWhenInUseUsageDescription` + `Background Modes > Location updates`.

### 2. إشعار دائم للتتبع (Foreground Service Notification)
| المنصة | الحالة | السبب |
|--------|--------|-------|
| Android | ❌ لا يعمل | بدون Foreground Service، نظام Android يقتل WebView بعد 5-10 دقائق من الخلفية |
| iOS | ❌ لا يعمل | بدون Background Mode، التطبيق يتجمد بعد 30 ثانية من الخلفية |

**المطلوب للحل:**
- **Android**: Native Foreground Service + إشعار دائم (مثل "الأهرام: التتبع نشط").
- **iOS**: `beginBackgroundTask` + Location Background Mode.

### 3. التتبع بعد إعادة تشغيل الجهاز (Boot Tracking)
| المنصة | الحالة | السبب |
|--------|--------|-------|
| Android | ❌ لا يعمل | بدون `BOOT_COMPLETED` BroadcastReceiver |
| iOS | ❌ لا يعمل | iOS لا يدعم بدء التلقائي بعد الإقلاع |

**المطلوب للحل:**
- **Android**: Native BroadcastReceiver + `@capacitor/push-notifications` أو Custom Plugin.
- **iOS**: غير ممكن — iOS لا يسمح ببدء تلقائي بعد الإقلاع.

### 4. حالة البطارية (Battery Status)
| الحالة | السبب |
|--------|-------|
| ❌ لا يعمل | `navigator.getBattery()` هو API تجريبي ومهمل، غير مدعوم في iOS WebView |

**المطلوب للحل:** `@capacitor/device` plugin.

---

## جدول المقارنة: قبل وبعد Capacitor

| الميزة | Web App حالياً | + Capacitor فقط | + Native Plugins |
|--------|---------------|----------------|-------------------|
| Tracking في المقدمة | ✅ | ✅ | ✅ |
| Tracking في الخلفية (< 5 دقائق) | ✅ محدود (PWA فقط) | ✅ محدود (PWA فقط) | ✅ |
| Tracking في الخلفية (> 5 دقائق) | ❌ | ❌ | ✅ |
| Tracking بعد إغلاق التطبيق | ❌ | ❌ | ✅ |
| GPS عالي الدقة | ✅ | ✅ | ✅ |
| Flush تلقائي عند عودة الإنترنت | ✅ | ✅ | ✅ |
| خرائط وأداء | ✅ | ✅ | ✅ |
| إشعار دائم للتتبع | ❌ | ❌ | ✅ |
| حالة البطارية | ⚠️ محدود | ⚠️ محدود | ✅ |

---

## متى يتم إضافة Native Plugins

تتم إضافة `@capacitor/geolocation` + `@capacitor/background-task` في **المرحلة التالية** بعد:
1. حل مشكلة `base path` و `Router basename`.
2. إضافة أذونات GPS في `AndroidManifest.xml` و `Info.plist`.
3. بناء APK/IPA تجريبي للتأكد من عمل التطبيق الأساسي.

### خطة التنفيذ للمرحلة التالية

| الخطوة | المدة المتوقعة |
|--------|---------------|
| تعديل Vite base path + Router | 1 يوم |
| إضافة أذونات GPS | 0.5 يوم |
| بناء APK تجريبي + اختبار | 1 يوم |
| بناء IPA تجريبي + اختبار (macOS مطلوب) | 2 يوم |
| إضافة `@capacitor/geolocation` للتتبع | 1 يوم |
| إضافة Foreground Service (Android) | 2 يوم |
| إضافة Background Modes (iOS) | 1 يوم |
| اختبار شامل | 2 يوم |
