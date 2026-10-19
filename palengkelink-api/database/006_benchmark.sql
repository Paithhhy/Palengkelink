-- PalengkeLink | 006 | Benchmark queries for the performance report (Week 6-7).
-- Run each EXPLAIN (ANALYZE, BUFFERS) on realistic data (e.g. 10,000+ payments), once with and once without the index
-- (DROP INDEX / CREATE INDEX), and paste the plan + execution time into your report.
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM rental_payments WHERE status = 'unpaid' AND billing_month = '2026-10-01';   -- idx_payments_status_month
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM vendors WHERE lower(business_name) = lower('Berto Meat Shop');             -- idx_vendors_business_name
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM rental_payments WHERE assignment_id = 1;                                    -- idx_payments_assignment
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM inspections WHERE stall_id = 1 ORDER BY inspection_date DESC LIMIT 10;     -- idx_inspections_stall_date
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM audit_logs WHERE table_name = 'rental_payments' AND record_id = 1;         -- idx_audit_table_record
