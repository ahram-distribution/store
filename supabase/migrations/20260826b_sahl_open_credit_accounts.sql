-- SAHL G3 patch: سهل's آجل sales extend open store credit to customers who
-- never enrolled in a formal credit program. _sahl_post_invoice_core creates
-- customer_credit_accounts rows carrying ONLY an outstanding balance — so
-- credit_program_id becomes nullable (FK retained). Program-bound flows keep
-- working; NULL program means 'open credit (سهل)'.
-- Documented deviation: such customers are invisible to credit-program
-- reports until they are enrolled in a program.

ALTER TABLE public.customer_credit_accounts ALTER COLUMN credit_program_id DROP NOT NULL;

COMMENT ON COLUMN public.customer_credit_accounts.credit_program_id IS 'NULL = open store credit created by سهل آجل sales (no formal program enrollment).';
