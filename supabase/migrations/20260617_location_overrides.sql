CREATE TABLE IF NOT EXISTS public.location_overrides (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id     uuid NOT NULL REFERENCES public.unified_locations(id) ON DELETE CASCADE,
    latitude        numeric NOT NULL,
    longitude       numeric NOT NULL,
    source          text NOT NULL CHECK (source IN ('address_geocoded', 'manual')),
    source_address  text,
    geocoded_at     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_location_overrides_loc_id ON public.location_overrides (location_id);

COMMENT ON TABLE public.location_overrides IS 'locations from non-GPS sources (address_geocoded, manual). priority: gps > manual > address_geocoded';
COMMENT ON COLUMN public.location_overrides.source IS 'address_geocoded (from address geocoding) or manual (user-entered)';
COMMENT ON COLUMN public.location_overrides.source_address IS 'snapshot of formatted_address at time of geocoding';
COMMENT ON COLUMN public.location_overrides.geocoded_at IS 'when geocoding was performed';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.location_overrides TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.location_overrides TO authenticated;
