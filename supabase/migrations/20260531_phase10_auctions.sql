-- ============================================================================
-- PHASE 10: Auctions
-- Source of Truth: DATABASE_SCHEMA_V1_SQL_SPEC.md
-- Executed: 2026-05-31
-- ============================================================================

-- 1. auctions -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS auctions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code varchar(30) NOT NULL,
    title varchar(255) NOT NULL,
    description text,
    product_id uuid,
    starting_price decimal(12,2) NOT NULL,
    current_price decimal(12,2) NOT NULL,
    bid_increment decimal(12,2) NOT NULL,
    deposit_amount decimal(12,2),
    password varchar(255),
    start_time timestamptz NOT NULL,
    end_time timestamptz NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'pending',
    winner_id uuid,
    winner_amount decimal(12,2),
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- foreign keys
ALTER TABLE auctions ADD CONSTRAINT fk_auctions_product
    FOREIGN KEY (product_id) REFERENCES products (id);
ALTER TABLE auctions ADD CONSTRAINT fk_auctions_created_by
    FOREIGN KEY (created_by) REFERENCES employees (id);

-- unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS uq_auctions_code ON auctions (code);

-- check constraints
ALTER TABLE auctions ADD CONSTRAINT ck_auctions_status
    CHECK (status IN ('pending', 'live', 'ended', 'awarded', 'cancelled'));
ALTER TABLE auctions ADD CONSTRAINT ck_auctions_price
    CHECK (starting_price >= 0 AND current_price >= 0 AND bid_increment > 0);
ALTER TABLE auctions ADD CONSTRAINT ck_auctions_deposit
    CHECK (deposit_amount IS NULL OR deposit_amount >= 0);
ALTER TABLE auctions ADD CONSTRAINT ck_auctions_time
    CHECK (start_time < end_time);

-- indexes
CREATE INDEX IF NOT EXISTS idx_auctions_status ON auctions (status);
CREATE INDEX IF NOT EXISTS idx_auctions_start_time ON auctions (start_time);

COMMENT ON TABLE auctions IS 'Live, real-time auctions for products. Independent of catalog pricing.';
COMMENT ON COLUMN auctions.code IS 'e.g., AUC-YYYY-NNNNNN';
COMMENT ON COLUMN auctions.current_price IS 'Updated with each bid';
COMMENT ON COLUMN auctions.bid_increment IS 'Minimum bid increment';
COMMENT ON COLUMN auctions.deposit_amount IS 'Null = no deposit required';
COMMENT ON COLUMN auctions.password IS 'Per-auction password';
COMMENT ON COLUMN auctions.winner_id IS 'FK to auction_participants.id';

-- 2. auction_participants -----------------------------------------------------

CREATE TABLE IF NOT EXISTS auction_participants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auction_id uuid NOT NULL,
    participant_type varchar(20) NOT NULL,
    participant_id uuid NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'pending',
    deposit_paid boolean NOT NULL DEFAULT false,
    approved_by uuid,
    approved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- foreign keys
ALTER TABLE auction_participants ADD CONSTRAINT fk_auction_participants_auction
    FOREIGN KEY (auction_id) REFERENCES auctions (id) ON DELETE CASCADE;
ALTER TABLE auction_participants ADD CONSTRAINT fk_auction_participants_approved_by
    FOREIGN KEY (approved_by) REFERENCES employees (id);

-- unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS uq_auction_participants ON auction_participants (auction_id, participant_type, participant_id);

-- check constraints
ALTER TABLE auction_participants ADD CONSTRAINT ck_auction_participants_type
    CHECK (participant_type IN ('employee', 'customer'));
ALTER TABLE auction_participants ADD CONSTRAINT ck_auction_participants_status
    CHECK (status IN ('pending', 'approved', 'rejected', 'blocked'));

-- indexes
CREATE INDEX IF NOT EXISTS idx_auction_participants_auction_id ON auction_participants (auction_id);
CREATE INDEX IF NOT EXISTS idx_auction_participants_status ON auction_participants (status);

COMMENT ON TABLE auction_participants IS 'Registered and approved participants for each auction.';
COMMENT ON COLUMN auction_participants.participant_type IS 'employee or customer';
COMMENT ON COLUMN auction_participants.participant_id IS 'FK to employees.id or customers.id';

-- 3. auction_bids -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS auction_bids (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auction_id uuid NOT NULL,
    participant_id uuid NOT NULL,
    amount decimal(12,2) NOT NULL,
    is_winning boolean NOT NULL DEFAULT false,
    placed_at timestamptz NOT NULL DEFAULT now()
);

-- foreign keys
ALTER TABLE auction_bids ADD CONSTRAINT fk_auction_bids_auction
    FOREIGN KEY (auction_id) REFERENCES auctions (id) ON DELETE CASCADE;
ALTER TABLE auction_bids ADD CONSTRAINT fk_auction_bids_participant
    FOREIGN KEY (participant_id) REFERENCES auction_participants (id);

-- check constraints
ALTER TABLE auction_bids ADD CONSTRAINT ck_auction_bids_amount
    CHECK (amount >= 0);

-- indexes
CREATE INDEX IF NOT EXISTS idx_auction_bids_auction_id ON auction_bids (auction_id);
CREATE INDEX IF NOT EXISTS idx_auction_bids_placed_at ON auction_bids (auction_id, placed_at);
CREATE INDEX IF NOT EXISTS idx_auction_bids_winning ON auction_bids (auction_id) WHERE is_winning = true;

COMMENT ON TABLE auction_bids IS 'Bid records for each auction. Provides the live bid feed and history.';
COMMENT ON COLUMN auction_bids.is_winning IS 'Updated in real time';

-- 4. auction_awards -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS auction_awards (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auction_id uuid NOT NULL,
    participant_id uuid NOT NULL,
    amount decimal(12,2) NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'pending',
    order_id uuid,
    awarded_by uuid NOT NULL,
    awarded_at timestamptz NOT NULL DEFAULT now()
);

-- foreign keys
ALTER TABLE auction_awards ADD CONSTRAINT fk_auction_awards_auction
    FOREIGN KEY (auction_id) REFERENCES auctions (id);
ALTER TABLE auction_awards ADD CONSTRAINT fk_auction_awards_participant
    FOREIGN KEY (participant_id) REFERENCES auction_participants (id);
ALTER TABLE auction_awards ADD CONSTRAINT fk_auction_awards_order
    FOREIGN KEY (order_id) REFERENCES orders (id);
ALTER TABLE auction_awards ADD CONSTRAINT fk_auction_awards_awarded_by
    FOREIGN KEY (awarded_by) REFERENCES employees (id);

-- check constraints
ALTER TABLE auction_awards ADD CONSTRAINT ck_auction_awards_status
    CHECK (status IN ('pending', 'awarded', 'converted'));
ALTER TABLE auction_awards ADD CONSTRAINT ck_auction_awards_amount
    CHECK (amount >= 0);

-- indexes
CREATE INDEX IF NOT EXISTS idx_auction_awards_auction_id ON auction_awards (auction_id);
CREATE INDEX IF NOT EXISTS idx_auction_awards_status ON auction_awards (status);

COMMENT ON TABLE auction_awards IS 'Administrative award records created after auction ends. Order created manually.';

-- ============================================================================
-- END OF PHASE 10
-- ============================================================================
