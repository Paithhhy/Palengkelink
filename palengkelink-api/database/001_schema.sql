-- PalengkeLink | 001 | Schema (PostgreSQL 15+: Neon / Supabase) | 11 tables, 3NF
-- Status lists are CHECK constraints instead of lookup tables.
BEGIN;

-- Functions are private by default; later scripts GRANT EXECUTE to specific roles.
-- (No "IN SCHEMA" here: a per-schema REVOKE cannot remove PostgreSQL's built-in EXECUTE-to-PUBLIC default.)
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON ROUTINES FROM PUBLIC;

CREATE TABLE users (
  user_id       INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username      VARCHAR(80)  NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  first_name    VARCHAR(80)  NOT NULL,
  last_name     VARCHAR(80)  NOT NULL,
  email         VARCHAR(150) NOT NULL UNIQUE,
  role          VARCHAR(10)  NOT NULL CHECK (role IN ('admin','staff','vendor')),
  status        VARCHAR(10)  NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE vendors (
  vendor_id         INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id           INT NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
  business_name     VARCHAR(150) NOT NULL,
  contact_number    VARCHAR(30)  NOT NULL,
  address           VARCHAR(255) NOT NULL,
  registration_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status            VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended'))
);

CREATE TABLE stalls (
  stall_id     INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stall_number VARCHAR(30) NOT NULL UNIQUE,
  section      VARCHAR(80) NOT NULL,
  stall_type   VARCHAR(50) NOT NULL,
  monthly_rent NUMERIC(10,2) NOT NULL CHECK (monthly_rent >= 0),
  status       VARCHAR(12) NOT NULL DEFAULT 'vacant' CHECK (status IN ('vacant','occupied','maintenance'))
);

-- Junction 1 (stall <-> vendor) with its own attributes
CREATE TABLE stall_assignments (
  assignment_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stall_id   INT NOT NULL REFERENCES stalls(stall_id)   ON DELETE RESTRICT,
  vendor_id  INT NOT NULL REFERENCES vendors(vendor_id) ON DELETE RESTRICT,
  start_date DATE NOT NULL,
  end_date   DATE,
  status     VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE UNIQUE INDEX uq_one_active_assignment_per_stall ON stall_assignments(stall_id) WHERE status = 'active';

CREATE TABLE rental_payments (
  payment_id    INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  assignment_id INT NOT NULL REFERENCES stall_assignments(assignment_id) ON DELETE RESTRICT,
  received_by   INT REFERENCES users(user_id) ON DELETE SET NULL,     -- staff who took cash; NULL for PayMongo
  billing_month DATE NOT NULL CHECK (billing_month = date_trunc('month', billing_month)::date),
  amount_due    NUMERIC(10,2) NOT NULL CHECK (amount_due >= 0),
  amount_paid   NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  payment_date  DATE,
  payment_method VARCHAR(40),                                          -- cash | gcash | paymaya | card | grab_pay ...
  reference_number VARCHAR(80),
  status        VARCHAR(10) NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','partial','paid')),
  paymongo_checkout_session_id VARCHAR(80) UNIQUE,                     -- cs_xxx
  paymongo_payment_id          VARCHAR(80) UNIQUE,                     -- pay_xxx (UNIQUE makes webhook retries safe)
  CHECK (amount_paid <= amount_due),
  UNIQUE (assignment_id, billing_month)
);

CREATE TABLE products (
  product_id   INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_name VARCHAR(150) NOT NULL UNIQUE,
  category     VARCHAR(80)  NOT NULL,
  unit         VARCHAR(30)  NOT NULL
);

CREATE TABLE suppliers (
  supplier_id    INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  supplier_name  VARCHAR(150) NOT NULL UNIQUE,
  contact_number VARCHAR(30)  NOT NULL,
  address        VARCHAR(255) NOT NULL,
  status         VARCHAR(10)  NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);

-- Junction 2 (vendor <-> product) with price, stock and supplier
CREATE TABLE vendor_products (
  vendor_product_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vendor_id   INT NOT NULL REFERENCES vendors(vendor_id)   ON DELETE CASCADE,
  product_id  INT NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
  supplier_id INT REFERENCES suppliers(supplier_id)        ON DELETE SET NULL,
  selling_price  NUMERIC(10,2) NOT NULL CHECK (selling_price >= 0),
  stock_quantity INT NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  status      VARCHAR(12) NOT NULL DEFAULT 'available' CHECK (status IN ('available','out_of_stock')),
  UNIQUE (vendor_id, product_id)
);

CREATE TABLE inspections (
  inspection_id   INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stall_id        INT NOT NULL REFERENCES stalls(stall_id) ON DELETE CASCADE,
  inspector_id    INT REFERENCES users(user_id) ON DELETE SET NULL,
  inspection_date DATE NOT NULL DEFAULT CURRENT_DATE,
  inspection_type VARCHAR(80) NOT NULL,
  result          VARCHAR(10) NOT NULL CHECK (result IN ('passed','failed')),
  remarks         TEXT
);

CREATE TABLE maintenance_requests (
  request_id   INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stall_id     INT NOT NULL REFERENCES stalls(stall_id)   ON DELETE CASCADE,
  vendor_id    INT NOT NULL REFERENCES vendors(vendor_id) ON DELETE RESTRICT,
  issue        TEXT NOT NULL,
  request_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status       VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved'))
);

CREATE TABLE audit_logs (
  log_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    INT REFERENCES users(user_id) ON DELETE SET NULL,   -- NULL = system / webhook
  table_name VARCHAR(80) NOT NULL,
  record_id  INT,
  action     VARCHAR(10) NOT NULL,
  old_value  JSONB,
  new_value  JSONB,
  logged_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for the searches the app runs most (foreign keys are not indexed automatically in PostgreSQL)
CREATE INDEX idx_vendors_business_name   ON vendors (lower(business_name));
CREATE INDEX idx_stalls_status           ON stalls (status);
CREATE INDEX idx_assignments_vendor      ON stall_assignments (vendor_id);
CREATE INDEX idx_payments_assignment     ON rental_payments (assignment_id);
CREATE INDEX idx_payments_status_month   ON rental_payments (status, billing_month);
CREATE INDEX idx_vendor_products_vendor  ON vendor_products (vendor_id);
CREATE INDEX idx_vendor_products_supplier ON vendor_products (supplier_id);
CREATE INDEX idx_inspections_stall_date  ON inspections (stall_id, inspection_date DESC);
CREATE INDEX idx_requests_vendor_status  ON maintenance_requests (vendor_id, status);
CREATE INDEX idx_audit_table_record      ON audit_logs (table_name, record_id);
CREATE INDEX idx_audit_logged_at         ON audit_logs (logged_at DESC);

COMMIT;
