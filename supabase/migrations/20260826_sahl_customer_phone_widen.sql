-- SAHL G2 patch: governed_create_customer generates synthetic identity phones
-- ('ext-<uuid>-<8hex>' = 49 chars) but identities.phone is varchar(20), so ANY
-- customer creation through that RPC fails with 22001. Widen the column —
-- equality lookups/uniqueness are unaffected.
-- (Discovered while wiring SAHL's quick customer entry; bug is app-wide.)

ALTER TABLE public.identities ALTER COLUMN phone TYPE varchar(60);
