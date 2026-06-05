# WHATSAPP_ORDER_REFERENCE.md — رسالة واتساب للفاتورة

## الملفات الأصلية

| الملف | المسار |
|---|---|
| Message Builder | `services/storefront/transportRuntime.js` |
| API Wrapper | `services/storefront/whatsappApi.js` |
| Configuration | `config.js` |

## وصف الوظيفة

بعد إنشاء الفاتورة، يتم فتح نافذة واتساب جديدة مع رسالة منسقة تحتوي على:
- معلومات العميل
- معلومات مندوب المبيعات
- قائمة الأصناف مجمعة حسب الشركة مع الأسعار
- إجمالي الفاتورة
- موقع التنفيذ (GPS) مع رابط Google Maps
- دليل إقران الزيارة (إن وجد)
- معلومات التعديل (إن كان معدلاً)

## قالب الرسالة الفعلي

```
🏢 شركة الأهرام للتجارة والتوزيع
━━━━━━━━━━━━━━━━━━━━━━
📄 {docType} رقم {invoice.number}

┌─ ❲ معلومات العميل ❳ ─┐
الاسم: {customer.name}
الهاتف: {customer.phone}
العنوان: {customer.address}
الموقع: {customer.locationLink}

┌─ ❲ مندوب المبيعات ❳ ─┐
الاسم: {creator.name}
الهاتف: {creator.phone}

━━━━━━━━━━━━━━━━━━━━━━
📦 بيان الطلب

◈ {companyName} ({count} أصناف)
▸ {product_name}
  كود: {code}
  🏷️ {tier}  (إن وجد)
  🔥 خصم {discount}%  (إن وجد)
  الكمية: {qty} {unit} | السعر: {price}
  الإجمالي: {lineTotal}

  ───── {groupTotal} ─────

━━━━━━━━━━━━━━━━━━━━━━
💵 إجمالي الفاتورة: {total}

📍 موقع التنفيذ
المصدر: {source}
الدقة: {accuracy} متر
{mapsUrl}  (إن وجد)

┌─ ❲ دليل إقران الزيارة ❳ ─┐  (إن وجدت)
رقم الزيارة: {visitNumber}
وقت بدء الزيارة: {openedAtTime}
وقت إنشاء الفاتورة: {invoiceCreatedAtTime}
الفارق: {diffLabel}

🔄 تعديل رقم {revision}  (إن كان معدلاً)
آخر تعديل: {date} {time}
تم التعديل بواسطة: {name}
```

## الحقول المستخدمة في القالب

| الحقل | المصدر | شرط الظهور |
|---|---|---|
| vm.company.name | ViewModel ثابت | دائماً |
| vm.invoice.docType | `order_status` | دائماً |
| vm.invoice.number | `order_number` | دائماً |
| vm.customer.* | customer snapshots | دائماً (الاسم)، phone/address/locationLink إن وجدت |
| vm.creator.* | creator snapshots | دائماً (الاسم)، phone إن وجد |
| vm.groupedItems | items مجمعة | دائماً |
| group.companyName | `company_name_snapshot` | دائماً |
| item.product_name_snapshot | snapshot | دائماً |
| item.product_code_snapshot | snapshot | دائماً |
| tier_name_snapshot | snapshot | فقط إذا موجود وليس 'base' |
| discount_percent | snapshot | فقط إذا > 0 |
| item.unit_name_snapshot | snapshot | دائماً |
| item.final_price | snapshot | دائماً |
| vm.invoice.total | `total_amount` | دائماً |
| vm.execution.* | GPS data | فقط إذا latitude أو mapsUrl موجود |
| vm.visit.* | activeVisit | فقط إذا موجود |
| vm.invoice.revision | `revision` | فقط إذا > 0 |

## طريقة الإرسال

1. `buildWhatsAppMessage(vm)` يبني الرابط: `https://wa.me/{supportWhatsapp}?text={encodeURIComponent(msg)}`
2. `openWhatsApp(url)` يفتح الرابط في نافذة جديدة: `window.open(url, '_blank', 'noopener,noreferrer')`
3. رقم الواتساب: `201040880002` (من `config.js`)

## ملاحظات مهمة

1. **لا يتم إرسال صورة أو PDF** عبر واتساب — فقط نص
2. **رابط Google Maps** يضاف إن وجد `vm.execution.mapsUrl`
3. **التعديلات**: تظهر فقط إذا `revision > 0`
4. **الخصم**: يظهر فقط إذا `discount_percent > 0`
5. **Tier (شريحة سعرية)**: يظهر فقط إذا موجود وليس 'base'
6. **الزيارة**: تظهر إذا كان هناك `activeVisit` مرتبط
7. **الموقع**: يظهر إذا `vm.execution.latitude` أو `vm.execution.mapsUrl` موجود
8. **تنسيق الأرقام**: `Math.round(Number(n)).toLocaleString('en-US')` بدون رمز العملة في الأرقام
9. **دالة wrap**: `_e(s)` — escape HTML entities عبر DOM element. تستخدم لتحويل النص لـ HTML entities في رسالة الواتساب (تجنب الأحرف الخاصة)
10. **ما بعد الإرسال**: يتم مسح السلة (`clearCart()`) وعرض شاشة النجاح
11. الوظيفة `buildWhatsAppMessageFromOrder` في `whatsappApi.js` تاخذ order + items مباشرة وتبني ViewModel أولاً ثم تبني الرسالة
12. **الترجمة الفعلية**: يتم التنسيق بالعربية — لا توجد أرقام عربية (تستخدم `en-US` للأرقام)
13. **Note**: إذا `vm.geoGuidance` موجود، يضاف كملاحظة في نهاية الرسالة (تحت "📝 ملاحظة:")
