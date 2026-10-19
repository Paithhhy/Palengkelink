// All URLs of the API in one place. Read it top to bottom: URL -> who may use it -> which controller runs.
const express = require("express");
const rateLimit = require("express-rate-limit");
const { wrap } = require("../errors");
const { requireLogin, requireRole } = require("../middleware/auth");
const auth = require("../controllers/auth");
const admin = require("../controllers/admin");
const payments = require("../controllers/payments");
const my = require("../controllers/my");

const router = express.Router();
const onlyAdmin = requireRole("admin");
const staffOrAdmin = requireRole("admin", "staff");
const onlyVendor = requireRole("vendor");

// Public
router.post("/auth/login", rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 }), wrap(auth.login));

// Everything below needs a valid login token
router.use(requireLogin);

// Admin + staff
router.get("/dashboard", staffOrAdmin, wrap(admin.dashboard));
router.get("/vendors", staffOrAdmin, wrap(admin.listVendors));
router.get("/stalls", staffOrAdmin, wrap(admin.listStalls));
router.patch("/stalls/:id/status", staffOrAdmin, wrap(admin.setStallStatus));
router.get("/inspections", staffOrAdmin, wrap(admin.listInspections));
router.post("/inspections", staffOrAdmin, wrap(admin.createInspection));
router.get("/maintenance", staffOrAdmin, wrap(admin.listRequests));
router.patch("/maintenance/:id/status", staffOrAdmin, wrap(admin.setRequestStatus));

// Admin only
router.post("/vendors", onlyAdmin, wrap(admin.createVendor));
router.post("/assignments", onlyAdmin, wrap(admin.assignStall));
router.get("/products", onlyAdmin, wrap(admin.listProducts));
router.post("/products", onlyAdmin, wrap(admin.createProduct));
router.get("/suppliers", onlyAdmin, wrap(admin.listSuppliers));
router.post("/suppliers", onlyAdmin, wrap(admin.createSupplier));
router.get("/payments", onlyAdmin, wrap(payments.listPayments));
router.post("/payments/generate", onlyAdmin, wrap(payments.generateBalances));
router.post("/payments/:id/cash", onlyAdmin, wrap(payments.recordCash));
router.get("/audit", onlyAdmin, wrap(admin.auditLog));

// Vendor (own data only)
router.get("/my/stalls", onlyVendor, wrap(my.myStalls));
router.get("/my/payments", onlyVendor, wrap(my.myPayments));
router.post("/my/payments/:id/checkout", onlyVendor, wrap(payments.startCheckout));
router.get("/my/products", onlyVendor, wrap(my.myProducts));
router.post("/my/products", onlyVendor, wrap(my.addMyProduct));
router.get("/my/catalog", onlyVendor, wrap(my.catalog));
router.get("/my/requests", onlyVendor, wrap(my.myRequests));
router.post("/my/requests", onlyVendor, wrap(my.addMyRequest));

module.exports = router;
