# ADR: Location Domain Architecture

## Status
Accepted — 2026-07-12

## Context
المشروع يحتوي على ثلاثة مفاهيم مختلطة: GPS coordinates، manual address، reverse geocoding. هذا الخلط يسبب:
- عدم وضوح مصدر الحقيقة لكل نوع بيانات
- استدعاء Nominatim أثناء عرض الشاشات (Network على حساب UX)
- تكرار نصوص المحافظة والمدينة في جداول مختلفة
- عدم وجود هيكل بيانات موحد لعنوان GPS

## Decision

### Source of Truth per Data Type

| Data Type | Source of Truth | Table | Stored As |
|-----------|----------------|-------|-----------|
| GPS Coordinates | GPS device | `unified_locations` | `latitude`, `longitude`, `accuracy_meters` |
| GPS Structured Address | Nominatim → enrichment | `unified_locations` | `governorate_id`, `city_id`, `road` |
| GPS Display Text | Nominatim | `unified_locations` | `formatted_address` |
| Manual Address | User input | `customer_addresses` | `governorate_id`, `city_id`, `street_address`, `landmark` |
| Admin Geography Reference | Seeded reference data | `reference_governorates`, `reference_cities` | `id`, `name_ar` |
| Location Override | Admin override | `location_overrides` | `latitude`, `longitude`, `source` |

### Principles

1. **No duplicated text**: Governorate and city are ALWAYS stored as UUID references (`governorate_id`, `city_id`), never as Arabic text strings. Display is always via JOIN with reference tables.

2. **Independent sources**: `unified_locations` (GPS) and `customer_addresses` (manual) never cross-read or cross-write. `road` in unified_locations comes from Nominatim and is a different domain from `customer_addresses.street_address`.

3. **Location Normalization Service**: The ONLY code that writes enrichment fields (`governorate_id`, `city_id`, `road`, `enriched_at`, `enrichment_status`). It accepts `location_id` only (not lat/lng, not customer_id). Idempotent — skips if `enrichment_status = 'completed'`.

4. **No network on read**: All reverse geocoding happens at WRITE time. Screen displays read pre-enriched data from the database + reference tables. Zero API calls during component mount.

5. **Single enrichment entry point**: `LocationNormalizationService.enrichLocation(locationId)`. Called from the frontend after any GPS capture operation. Never from RPCs or database triggers.

### Tables

#### unified_locations (augmented)

```
id                  uuid PK
latitude            numeric (nullable)
longitude           numeric (nullable)
accuracy_meters     numeric (nullable)
google_maps_url     text (GENERATED)
formatted_address   text (nullable)         ← Nominatim display name
captured_at         timestamptz
created_at          timestamptz

-- NEW columns (20270712):
governorate_id      uuid FK → reference_governorates(id)   ← matched from Nominatim state
city_id             uuid FK → reference_cities(id)         ← matched from Nominatim city/town/village
road                text                                    ← Nominatim road name
enriched_at         timestamptz                             ← last enrichment timestamp
enrichment_status   location_enrichment_status DEFAULT 'pending'
geocoding_provider  text DEFAULT 'nominatim'
enrichment_version  integer DEFAULT 1
```

#### location_enrichment_status ENUM

```
'pending'     ← newly created, not yet enriched
'processing'  ← enrichment in progress
'completed'   ← enrichment successful
'failed'      ← enrichment failed (Nominatim error, no match)
```

### Data Flow

```
[GPS Capture at Write Time]
     │
     ├─→ governed_create_location / governed_create_customer /
     │   governed_update_customer / governed_checkout_visit /
     │   governed_create_order
     │       │
     │       └─→ INSERT/UPDATE unified_locations (lat, lng, acc)
     │           (returns location_id)
     │
     └─→ LocationNormalizationService.enrichLocation(locationId)
              │
              ├─ CHECK enrichment_status
              │   if 'completed' → RETURN immediately (idempotent)
              │
              ├─ SET enrichment_status = 'processing'
              │
              ├─ FETCH lat/lng from unified_locations
              │
              ├─ CALL Nominatim reverseGeocodeStructured(lat, lng)
              │   → NominatimAddress { state, city, road, displayName, ... }
              │
              ├─ MATCH state → reference_governorates.name_ar → governorate_id
              ├─ MATCH city → reference_cities.name_ar (within governorate) → city_id
              │
              └─ CALL enrich_location RPC:
                     SET governorate_id, city_id, road,
                         formatted_address = displayName,
                         enriched_at = now(),
                         enrichment_status = 'completed',
                         geocoding_provider = 'nominatim',
                         enrichment_version = 1

[Read at Display Time — ZERO Network]
     │
     └─→ get_governed_location(location_id)
              │
              └─ SELECT ul.*, rg.name_ar AS governorate_name, rc.name_ar AS city_name
                 FROM unified_locations ul
                 LEFT JOIN reference_governorates rg ON rg.id = ul.governorate_id
                 LEFT JOIN reference_cities rc ON rc.id = ul.city_id
```

### RPC Contract

#### enrich_location (NEW)
```sql
CREATE OR REPLACE FUNCTION enrich_location(
  p_token uuid,
  p_location_id uuid,
  p_governorate_id uuid DEFAULT NULL,
  p_city_id uuid DEFAULT NULL,
  p_road text DEFAULT NULL,
  p_formatted_address text DEFAULT NULL,
  p_geocoding_provider text DEFAULT 'nominatim',
  p_enrichment_version integer DEFAULT 1
) RETURNS jsonb
```

Updates the enrichment fields on an existing unified_locations record. Sets `enrichment_status = 'completed'` and `enriched_at = now()`. Only called by `LocationNormalizationService`.

#### get_governed_location (UPDATED)
Returns additional fields: `governorate_id`, `city_id`, `road`, `enriched_at`, `enrichment_status`, `geocoding_provider`, `enrichment_version`, `governorate_name`, `city_name` (from reference tables).

### LocationNormalizationService (Frontend)

```
src/domain/location/enrichment.ts

class LocationNormalizationService:
  - enrichLocation(locationId: string): Promise<void>
      Idempotent. Skips if already completed.
      Calls Nominatim → matches references → calls enrich_location RPC.
  - enrichLocationIfNeeded(locationId: string): Promise<void>
      Skips if status != 'pending' and status != 'failed'.
```

### Migration Strategy

1. **New migration** adds columns (all NULLABLE, backward compatible)
2. **enrich_location RPC** created
3. **get_governed_location** updated to include new fields + reference JOINs
4. Old `fn_enrich_customer_location` remains for backward compatibility but is deprecated
5. Existing `formatted_address` remains the display fallback for non-enriched records

### Files Changed

See full list at commit message.

## Consequences

1. All GPS locations in the system will eventually have structured admin geography (governorate_id, city_id)
2. Coverage Map can display GPS governorate/city directly from enriched data
3. Zero Nominatim API calls during screen display (faster, offline-capable)
4. Clean separation: GPS domain vs Manual Address domain
5. Future providers (Google Maps, Here) can be added by changing the geocoding_provider in the enrichment service
6. Old records with NULL enrichment fields gracefully fall back to formatted_address

## Future Considerations

- enrichment_version allows reprocessing old records when matching algorithm improves
- geocoding_provider allows switching between geocoding providers per-location
- Edge Function version of LocationNormalizationService could run server-side for background enrichment
