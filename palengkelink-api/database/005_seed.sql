-- PalengkeLink | 005 | Sample data (same records as the website demo). Replace hashes with real bcrypt hashes.
BEGIN;
INSERT INTO users (username,password_hash,first_name,last_name,email,role) VALUES
 ('admin','$2a$10$HHu0HdNdjdnbuYmny2fTEuwQhyqAzGYCj/cfPnyYfJFivO0j3S6t6','Maria','Manager','admin@palengkelink.test','admin'),
 ('ramos','$2a$10$HHu0HdNdjdnbuYmny2fTEuwQhyqAzGYCj/cfPnyYfJFivO0j3S6t6','Jun','Ramos','ramos@palengkelink.test','staff'),
 ('nena','$2a$10$HHu0HdNdjdnbuYmny2fTEuwQhyqAzGYCj/cfPnyYfJFivO0j3S6t6','Nena','Santos','nena@palengkelink.test','vendor'),
 ('berto','$2a$10$HHu0HdNdjdnbuYmny2fTEuwQhyqAzGYCj/cfPnyYfJFivO0j3S6t6','Berto','Cruz','berto@palengkelink.test','vendor');
INSERT INTO vendors (user_id,business_name,contact_number,address) VALUES
 (3,'Nena’s Fresh Veggies','0917-555-0101','Cebu City'),(4,'Berto Meat Shop','0918-555-0102','Cebu City');
INSERT INTO stalls (stall_number,section,stall_type,monthly_rent) VALUES
 ('A-01','Wet Section','Wet',1500),('B-01','Dry Section','Dry',1000),('B-02','Dry Section','Dry',1000),('C-01','Meat Section','Meat',2000);
INSERT INTO stall_assignments (stall_id,vendor_id,start_date) VALUES (1,1,'2026-01-01'),(2,1,'2026-01-01'),(4,2,'2026-02-01');
INSERT INTO products (product_name,category,unit) VALUES ('Kangkong','Vegetable','bundle'),('Kamatis','Vegetable','kg'),('Pork Belly','Meat','kg');
INSERT INTO suppliers (supplier_name,contact_number,address) VALUES
 ('Benguet Farmers Coop','0917-600-0001','La Trinidad, Benguet'),('Cebu Meat Distributors','0918-600-0002','Mandaue City');
INSERT INTO vendor_products (vendor_id,product_id,supplier_id,selling_price,stock_quantity) VALUES (1,1,1,12,80),(1,2,1,60,45),(2,3,2,320,25);
INSERT INTO inspections (stall_id,inspector_id,inspection_type,result,remarks) VALUES (1,2,'Sanitation','passed',NULL),(4,2,'Sanitation','failed','Needs deep cleaning');
SELECT fn_generate_monthly_balances('2026-10-01');
COMMIT;
