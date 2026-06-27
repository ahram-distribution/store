# Mobile App Migration Plan — الأهرام

## الوضع الحالي

### ما الذي يعمل الآن
- تطبيق ويب كامل (React + Vite + TypeScript) يعمل على المتصفح.
- PWA مثبت مع Service Worker (Background Sync + Cache API).
- نظام تتبع GPS عبر `watchPosition` + `getCurrentPosition` مع تخزين مؤقت في IndexedDB.
- جميع العمليات (المبيعات، العملاء، الطلبات، الزيارات، الحضور، التقارير) تعمل بالكامل.

### ما الذي سيبقى كما هو
- **Supabase**: لا تغيير — قاعدة البيانات، RPCs، المصادقة، السياسات.
- **Frontend Code**: لا تغيير — جميع الشاشات، المكونات، الخدمات، المسارات.
- **Routing**: يبقى `BrowserRouter` مع `basename="/test1"` (للويب).
- **PWA**: يبقى Service Worker + Background Sync للنسخة المتصفحية.
- **Tracking Engine**: يبقى كما هو مع `watchPosition` + IndexedDB queue.

---

## ما الذي تم إضافته

### 1. حزمة Capacitor
تم تثبيت:
- `@capacitor/core` — النواة الأساسية.
- `@capacitor/cli` — أوامر السطر الطرفي.
- `@capacitor/android` — منصة أندرويد.
- `@capacitor/ios` — منصة iOS.

### 2. ملف الإعدادات `capacitor.config.ts`
```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ahram.distribution',
  appName: 'الأهرام',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#071B4D',
      androidSplashResourceName: 'splash',
    },
  },
};

export default config;
```

### 3. منصة Android (`android/`)
تم إنشاء مشروع Android كامل:
- `android/app/src/main/` — الكود الرئيسي، الـ Activity، الـ Manifest.
- `android/app/src/main/assets/public/` — نسخة من `dist/` بعد `cap copy`.
- `android/app/src/main/AndroidManifest.xml` — مع صلاحية INTERNET فقط.

### 4. منصة iOS (`ios/`)
تم إنشاء مشروع Xcode:
- `ios/App/App/` — الكود الرئيسي، Storyboard، Info.plist.
- `ios/App/App/public/` — نسخة من `dist/` بعد `cap copy`.

### 5. أوامر Capacitor في `package.json`
```json
"cap:init": "node ./node_modules/@capacitor/cli/bin/capacitor init",
"cap:sync": "node ./node_modules/@capacitor/cli/bin/capacitor sync",
"cap:open:android": "node ./node_modules/@capacitor/cli/bin/capacitor open android",
"cap:open:ios": "node ./node_modules/@capacitor/cli/bin/capacitor open ios",
"cap:build:android": "node ./node_modules/@capacitor/cli/bin/capacitor build android",
"cap:build:ios": "node ./node_modules/@capacitor/cli/bin/capacitor build ios",
"cap:copy": "node ./node_modules/@capacitor/cli/bin/capacitor copy"
```

---

## ما الذي سيتغير في المستقبل

### 1. Vite `base` path (إجباري للـ Native)
**المشكلة**: الإعداد الحالي `base: '/test1/'` ينتج مسارات مطلقة مثل `/test1/assets/index-xxx.js`. في التطبيق الأصلي، الملفات تخدم من `file://` أو local server بدون مسار `/test1/`.

**الحل**: إضافة متغير بيئي للتبديل بين وضعي الويب والموبايل:
```ts
// vite.config.ts
base: process.env.MOBILE === 'true' ? './' : '/test1/',
```
ثم بناء الموبايل بـ:
```bash
MOBILE=true npm run build
npx cap copy
```

### 2. `BrowserRouter basename` (إجباري للـ Native)
**المشكلة**: الإعداد الحالي `basename="/test1"` يجعل جميع المسارات `/test1/attendance/runtime`. في التطبيق الأصلي، المسارات يجب أن تكون `/attendance/runtime`.

**الحل**: استخدام `HashRouter` بدلاً من `BrowserRouter` للتطبيق الأصلي، أو إزالة الـ `basename` عند البناء للموبايل.

### 3. Service Worker (سيصبح غير ضروري)
في التطبيق الأصلي، الـ Service Worker غير مطلوب لأن Capacitor يتحكم بدورة حياة التطبيق. يجب تعطيل `VitePWA` plugin عند البناء للموبايل لتجنب أخطاء في WebView (خاصة iOS).

### 4. أذونات Android (مطلوبة للتتبع)
الـ `AndroidManifest.xml` الحالي يحتوي فقط على `INTERNET`. للتتبع GPS يجب إضافة:
```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
```

### 5. أذونات iOS (مطلوبة للتتبع)
الـ `Info.plist` الحالي لا يحتوي على أوصاف الموقع. يجب إضافة:
```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>يحتاج التطبيق موقعك لتسجيل الحضور وتتبع مسار العمل</string>
<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>يحتاج التطبيق موقعك في الخلفية لتسجيل مسار العمل</string>
```

### 6. Capacitor Plugins (اختياري للمرحلة القادمة)
- `@capacitor/geolocation` — بديل Native لـ `navigator.geolocation`.
- `@capacitor/device` — معلومات الجهاز.
- `@capacitor/network` — حالة الاتصال (بديل `navigator.onLine`).
- `@capacitor/splash-screen` — شاشة البداية (مثبت مسبقاً).
- `@capacitor/local-notifications` — إشعارات محلية للتذكير.
- `@capacitor/background-task` — مهام الخلفية (iOS).
- `@capacitor/app` — دورة حياة التطبيق.

---

## الملفات المضافة

| الملف | الغرض |
|-------|-------|
| `capacitor.config.ts` | إعدادات Capacitor الأساسية |
| `android/` | مشروع Android كامل (تلقائي) |
| `ios/` | مشروع iOS كامل (تلقائي) |
| `docs/MOBILE_APP_MIGRATION_PLAN.md` | هذه الوثيقة |
| `docs/BACKGROUND_TRACKING_ANALYSIS.md` | تحليل التتبع |

## الملفات المعدلة

| الملف | التعديل |
|-------|---------|
| `package.json` | إضافة أوامر Capacitor + الحزم الجديدة |
| `package-lock.json` | تحديث تبعيات npm |

---

## Build Web

✅ Build Web لا يزال يعمل — 0 أخطاء، 2063 وحدة.

---

## المخاطر المكتشفة

| المستوى | الخطر | التأثير |
|---------|-------|---------|
| 🔴 عالي | `base: '/test1/'` في Vite | جميع مسارات الأصول ستكون مكسورة في التطبيق الأصلي |
| 🔴 عالي | `BrowserRouter basename="/test1"` | جميع مسارات الـ Routing ستكون مكسورة في التطبيق الأصلي |
| 🟡 متوسط | Service Worker قد يسبب أخطاء في iOS WKWebView | يجب تعطيله عند البناء للموبايل |
| 🟡 متوسط | `navigator.getBattery()` غير مدعوم في بعض WebViews | لا يؤثر على الوظائف الأساسية |
| 🟢 منخفض | `leaflet` يعتمد على OpenStreetMap tiles | يعمل في WebView طالما هناك اتصال |
| 🟢 منخفض | PWA manifest (`/test1/` scope) غير مهم في التطبيق الأصلي | لا يؤثر على الوظائف |
