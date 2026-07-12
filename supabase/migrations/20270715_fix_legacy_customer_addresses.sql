-- ═══════════════════════════════════════════════════════════════════════
-- Migration: Fix Legacy Customer Addresses
-- 
-- الهدف: إنشاء customer_addresses للعملاء القدامى الذين لديهم
--        عنوان حر في unified_locations.formatted_address فقط
--        بدون customer_addresses ولا GPS coordinates.
-- 
-- المجموعة المستهدفة (Group C):
--   - لا يوجد customer_addresses
--   - location_id موجود
--   - unified_locations.latitude IS NULL
--   - unified_locations.longitude IS NULL
--   - unified_locations.formatted_address موجود وغير فارغ
--
-- المصدر: unified_locations.formatted_address (النص التاريخي)
-- الوجهة: customer_addresses.address_line1
-- 
-- ممنوع:
--   - استنتاج محافظة/مدينة/شارع
--   - Geocoding أو Nominatim
--   - تعديل أي بيانات GPS
--   - لمس العملاء الجدد
-- ═══════════════════════════════════════════════════════════════════════

-- 1. إضافة قيمة 'legacy' إلى الـ enum address_source_type
ALTER TYPE address_source_type ADD VALUE IF NOT EXISTS 'legacy';

-- 2. إنشاء customer_addresses للعملاء القدامى (Group C)
INSERT INTO customer_addresses (
  customer_id,
  address_line1,
  city,
  is_default,
  address_source,
  address_updated_at
)
SELECT
  c.id,
  ul.formatted_address,
  '' AS city,
  true AS is_default,
  'legacy'::address_source_type AS address_source,
  now() AS address_updated_at
FROM customers c
JOIN unified_locations ul ON ul.id = c.location_id
WHERE NOT EXISTS (SELECT 1 FROM customer_addresses ca WHERE ca.customer_id = c.id)
  AND ul.latitude IS NULL
  AND ul.longitude IS NULL
  AND ul.formatted_address IS NOT NULL
  AND ul.formatted_address != '';
