-- ============================================================================
-- RECOVERY MIGRATION: Missing Database Objects
-- Source: Phase 3 Database Recovery (2026-06-05)
-- Purpose: Creates database objects that exist on live Supabase but were
--          missing from all migration files (discovered via Phase 2/3 verification)
-- 
-- These objects were created outside the migration system on the live DB.
-- Recovery uses IF NOT EXISTS for idempotent application on existing DB.
-- ============================================================================

-- ============================================================================
-- SECTION 1: App Schema (dependency for app.sessions and all governed RPCs)
-- ============================================================================

-- The app schema is referenced by every SECURITY DEFINER RPC (v_session app.sessions)
-- but was never created in any migration file on the live DB.
CREATE SCHEMA IF NOT EXISTS app;

-- Table: app.sessions
-- Session store for custom auth system. Referenced as type by all governed RPCs.
-- Created outside migration system on live DB alongside credit_programs.
CREATE TABLE IF NOT EXISTS app.sessions (
    token uuid NOT NULL DEFAULT gen_random_uuid(),
    identity_id uuid NOT NULL,
    employee_id uuid,
    customer_id uuid,
    identity_type public.identity_type NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    expires_at timestamp with time zone NOT NULL DEFAULT (now() + '24:00:00'::interval),
    last_active_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT sessions_pkey PRIMARY KEY (token),
    CONSTRAINT sessions_identity_id_fkey FOREIGN KEY (identity_id)
        REFERENCES public.identities(id),
    CONSTRAINT sessions_employee_id_fkey FOREIGN KEY (employee_id)
        REFERENCES public.employees(id),
    CONSTRAINT sessions_customer_id_fkey FOREIGN KEY (customer_id)
        REFERENCES public.customers(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON app.sessions USING btree (expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_identity ON app.sessions USING btree (identity_id);

-- ============================================================================
-- SECTION 2: Missing Custom Enum Types
-- ============================================================================

-- Type: credit_application_status
-- Used by: credit_applications.status
DO $$ BEGIN
  CREATE TYPE public.credit_application_status AS ENUM (
    'draft',
    'submitted',
    'under_review',
    'documents_received',
    'approved',
    'rejected',
    'suspended'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Type: preparation_exception_type
-- Used by: preparation_exceptions.exception_type
DO $$ BEGIN
  CREATE TYPE public.preparation_exception_type AS ENUM (
    'missing_quantity',
    'missing_product',
    'damaged_product',
    'incomplete_order',
    'other'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Type: preparation_status
-- Used by: preparation_records.status
DO $$ BEGIN
  CREATE TYPE public.preparation_status AS ENUM (
    'in_progress',
    'completed',
    'reviewed',
    'failed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- SECTION 2: Missing Tables
-- ============================================================================

-- Table: company_profile
-- Single-row table storing company branding and contact information
CREATE TABLE IF NOT EXISTS public.company_profile (
    id integer NOT NULL,
    company_name text,
    company_banner_url text,
    facebook_url text,
    sales_phone_1 text,
    sales_phone_2 text,
    sales_whatsapp_1 text,
    sales_whatsapp_2 text,
    technical_support_phone text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT company_profile_single_row CHECK ((id = 1)),
    CONSTRAINT company_profile_pkey PRIMARY KEY (id)
);

-- Table: credit_programs
-- Defines credit programs with limits and terms
CREATE TABLE IF NOT EXISTS public.credit_programs (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name character varying(100) NOT NULL,
    credit_limit numeric(12,2) NOT NULL,
    credit_days integer NOT NULL,
    terms text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT credit_programs_pkey PRIMARY KEY (id)
);

-- Table: credit_applications
-- Customer applications for credit programs
CREATE TABLE IF NOT EXISTS public.credit_applications (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    customer_id uuid NOT NULL,
    program_id uuid NOT NULL,
    status public.credit_application_status NOT NULL DEFAULT 'draft',
    doc_commercial_reg boolean DEFAULT false,
    doc_tax_card boolean DEFAULT false,
    doc_national_id boolean DEFAULT false,
    doc_cheques boolean DEFAULT false,
    doc_contract_signed boolean DEFAULT false,
    doc_confirmed_by uuid,
    doc_confirmed_at timestamp with time zone,
    submitted_at timestamp with time zone,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    approved_by uuid,
    approved_at timestamp with time zone,
    rejection_reason text,
    suspended_by uuid,
    suspended_at timestamp with time zone,
    suspension_reason text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT credit_applications_pkey PRIMARY KEY (id),
    CONSTRAINT credit_applications_customer_id_fkey FOREIGN KEY (customer_id)
        REFERENCES public.customers(id),
    CONSTRAINT credit_applications_program_id_fkey FOREIGN KEY (program_id)
        REFERENCES public.credit_programs(id),
    CONSTRAINT credit_applications_created_by_fkey FOREIGN KEY (created_by)
        REFERENCES public.employees(id),
    CONSTRAINT credit_applications_doc_confirmed_by_fkey FOREIGN KEY (doc_confirmed_by)
        REFERENCES public.employees(id),
    CONSTRAINT credit_applications_reviewed_by_fkey FOREIGN KEY (reviewed_by)
        REFERENCES public.employees(id),
    CONSTRAINT credit_applications_approved_by_fkey FOREIGN KEY (approved_by)
        REFERENCES public.employees(id),
    CONSTRAINT credit_applications_suspended_by_fkey FOREIGN KEY (suspended_by)
        REFERENCES public.employees(id)
);

-- Table: credit_contracts
-- Signed contracts between customer and company for credit
CREATE TABLE IF NOT EXISTS public.credit_contracts (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    application_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    program_snapshot jsonb NOT NULL,
    terms_text text NOT NULL,
    signed_at timestamp with time zone,
    signed_by uuid,
    verified_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT credit_contracts_pkey PRIMARY KEY (id),
    CONSTRAINT credit_contracts_application_id_fkey FOREIGN KEY (application_id)
        REFERENCES public.credit_applications(id),
    CONSTRAINT credit_contracts_customer_id_fkey FOREIGN KEY (customer_id)
        REFERENCES public.customers(id),
    CONSTRAINT credit_contracts_signed_by_fkey FOREIGN KEY (signed_by)
        REFERENCES public.identities(id),
    CONSTRAINT credit_contracts_verified_by_fkey FOREIGN KEY (verified_by)
        REFERENCES public.employees(id)
);

-- Table: credit_contract_templates
-- Reusable contract template text
CREATE TABLE IF NOT EXISTS public.credit_contract_templates (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name character varying(100) NOT NULL,
    template_text text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT credit_contract_templates_pkey PRIMARY KEY (id)
);

-- Table: delivery_tracking
-- Tracks delivery assignments and status for orders
CREATE TABLE IF NOT EXISTS public.delivery_tracking (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL,
    status character varying(30) NOT NULL DEFAULT 'pending',
    assigned_to uuid,
    assigned_by uuid,
    assigned_at timestamp with time zone,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    failure_reason character varying(100),
    failure_notes text,
    notes text,
    returned_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT delivery_tracking_pkey PRIMARY KEY (id),
    CONSTRAINT delivery_tracking_order_id_fkey FOREIGN KEY (order_id)
        REFERENCES public.orders(id),
    CONSTRAINT delivery_tracking_assigned_to_fkey FOREIGN KEY (assigned_to)
        REFERENCES public.employees(id),
    CONSTRAINT delivery_tracking_assigned_by_fkey FOREIGN KEY (assigned_by)
        REFERENCES public.employees(id)
);

-- Table: preparation_records
-- Tracks warehouse order preparation lifecycle
CREATE TABLE IF NOT EXISTS public.preparation_records (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL,
    status public.preparation_status NOT NULL DEFAULT 'in_progress',
    started_by uuid NOT NULL,
    started_at timestamp with time zone NOT NULL DEFAULT now(),
    completed_by uuid,
    completed_at timestamp with time zone,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    cancelled_by uuid,
    cancelled_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT preparation_records_pkey PRIMARY KEY (id),
    CONSTRAINT preparation_records_order_id_fkey FOREIGN KEY (order_id)
        REFERENCES public.orders(id),
    CONSTRAINT preparation_records_started_by_fkey FOREIGN KEY (started_by)
        REFERENCES public.employees(id),
    CONSTRAINT preparation_records_completed_by_fkey FOREIGN KEY (completed_by)
        REFERENCES public.employees(id),
    CONSTRAINT preparation_records_reviewed_by_fkey FOREIGN KEY (reviewed_by)
        REFERENCES public.employees(id),
    CONSTRAINT preparation_records_cancelled_by_fkey FOREIGN KEY (cancelled_by)
        REFERENCES public.employees(id),
    CONSTRAINT preparation_records_order_id_key UNIQUE (order_id)
);

-- Table: preparation_exceptions
-- Records exceptions/failures during order preparation
CREATE TABLE IF NOT EXISTS public.preparation_exceptions (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    preparation_id uuid NOT NULL,
    exception_type public.preparation_exception_type NOT NULL,
    notes text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT preparation_exceptions_pkey PRIMARY KEY (id),
    CONSTRAINT preparation_exceptions_preparation_id_fkey FOREIGN KEY (preparation_id)
        REFERENCES public.preparation_records(id)
);

-- ============================================================================
-- SECTION 3: Missing Indexes
-- ============================================================================

-- Indexes for credit_applications
CREATE INDEX IF NOT EXISTS idx_credit_apps_created ON public.credit_applications(created_at);
CREATE INDEX IF NOT EXISTS idx_credit_apps_customer ON public.credit_applications(customer_id);
CREATE INDEX IF NOT EXISTS idx_credit_apps_status ON public.credit_applications(status);

-- Indexes for delivery_tracking
CREATE INDEX IF NOT EXISTS idx_delivery_tracking_assigned_to ON public.delivery_tracking(assigned_to);
CREATE INDEX IF NOT EXISTS idx_delivery_tracking_status ON public.delivery_tracking(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_tracking_order ON public.delivery_tracking(order_id);
