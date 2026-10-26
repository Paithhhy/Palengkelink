// All URLs of the API in one place. Read it top to bottom: URL -> who may use it -> which controller runs.
const express = require("express");
const rateLimit = require("express-rate-limit");
const { wrap } = require("../errors");
const { requireLogin, requireRole } = require("../middleware/auth");
const auth = require("../controllers/auth");
const admin = require("../controllers/admin");
const payments = require("../controllers/payments");
const my = require("../controllers/my");
const profiles = require("../controllers/profiles");

const router = express.Router();
const onlyAdmin = requireRole("admin");
const staffOrAdmin = requireRole("admin", "staff");
const onlyVendor = requireRole("vendor");

// Public (rate-limited: each IP gets a few tries per 15 minutes)
const limit = (n) => rateLimit({ windowMs: 15 * 60 * 1000, limit: n, message: { error: "Too many tries. Please wait 15 minutes." } });
// Every API address: at most 300 requests a minute per IP (a normal page load makes about 5), against scripts hammering the site.
router.use(rateLimit({ windowMs: 60 * 1000, limit: 300, message: { error: "Too many requests. Please slow down and try again in a minute." } }));
router.post("/auth/login", limit(20), wrap(auth.login));
router.post("/auth/register", limit(5), wrap(auth.register));
router.post("/auth/forgot", limit(5), wrap(auth.forgot));
router.post("/auth/reset", limit(10), wrap(auth.reset));

// Everything below needs a valid login token
router.use(requireLogin);

// Everyone: own account + vendor profiles
router.get("/me", wrap(auth.me));
router.patch("/me/password", limit(10), wrap(auth.changePassword));
router.post("/me/logout-everywhere", wrap(auth.logoutEverywhere));
router.get("/directory", wrap(profiles.list));
router.get("/directory/:id", wrap(profiles.profile));

// Admin + staff
router.get("/dashboard", staffOrAdmin, wrap(admin.dashboard));
router.get("/stalls", staffOrAdmin, wrap(admin.listStalls));
router.patch("/stalls/:id", staffOrAdmin, wrap(admin.updateStall));
router.get("/inspections", staffOrAdmin, wrap(admin.listInspections));
router.post("/inspections", staffOrAdmin, wrap(admin.createInspection));
router.patch("/inspections/:id", staffOrAdmin, wrap(admin.updateInspection));
router.get("/maintenance", staffOrAdmin, wrap(admin.listRequests));
router.patch("/maintenance/:id/status", staffOrAdmin, wrap(admin.setRequestStatus));

// Admin only
router.get("/vendors", onlyAdmin, wrap(admin.listVendors));
router.post("/vendors", onlyAdmin, wrap(admin.createVendor));
router.patch("/vendors/:id", onlyAdmin, wrap(admin.updateVendor));
router.get("/users", onlyAdmin, wrap(admin.listUsers));
router.post("/users", onlyAdmin, wrap(admin.createUser));
router.patch("/users/:id", onlyAdmin, wrap(admin.updateUser));
router.patch("/users/:id/status", onlyAdmin, wrap(admin.setUserStatus));
router.post("/stalls", onlyAdmin, wrap(admin.createStall));
router.put("/stalls/:id/vendor", onlyAdmin, wrap(admin.setStallVendor));
router.get("/products", onlyAdmin, wrap(admin.listCatalog));
router.post("/products", onlyAdmin, wrap(admin.createProduct));
router.patch("/products/:id", onlyAdmin, wrap(admin.updateProduct));
router.get("/vendor-products", onlyAdmin, wrap(admin.listVendorProducts));
router.get("/suppliers", onlyAdmin, wrap(admin.listSuppliers));
router.post("/suppliers", onlyAdmin, wrap(admin.createSupplier));
router.patch("/suppliers/:id", onlyAdmin, wrap(admin.updateSupplier));
router.get("/suggestions", onlyAdmin, wrap(admin.listSuggestions));
router.patch("/suggestions/:id", onlyAdmin, wrap(admin.reviewSuggestion));
router.get("/payments", onlyAdmin, wrap(payments.listPayments));
router.post("/payments/generate", onlyAdmin, wrap(payments.generateBalances));
router.patch("/payments/:id", onlyAdmin, wrap(payments.updateBill));
router.post("/payments/:id/cash", onlyAdmin, wrap(payments.recordCash));
router.get("/audit", onlyAdmin, wrap(admin.auditLog));

// Vendor (own data only)
router.get("/my/profile", onlyVendor, wrap(my.myProfile));
router.put("/my/profile", onlyVendor, wrap(my.updateMyProfile));
router.get("/my/stalls", onlyVendor, wrap(my.myStalls));
router.get("/my/payments", onlyVendor, wrap(my.myPayments));
router.post("/my/payments/:id/checkout", onlyVendor, wrap(payments.startCheckout));
router.post("/my/payments/:id/confirm", onlyVendor, wrap(payments.confirmCheckout));
router.get("/my/products", onlyVendor, wrap(my.myProducts));
router.post("/my/products", onlyVendor, wrap(my.addMyProduct));
router.patch("/my/products/:id", onlyVendor, wrap(my.updateMyProduct));
router.delete("/my/products/:id", onlyVendor, wrap(my.deleteMyProduct));
router.get("/my/catalog", onlyVendor, wrap(my.catalog));
router.get("/my/suggestions", onlyVendor, wrap(my.mySuggestions));
router.post("/my/suggestions", onlyVendor, wrap(my.suggestSupplier));
router.delete("/my/suggestions/:id", onlyVendor, wrap(my.withdrawSuggestion));
router.get("/my/requests", onlyVendor, wrap(my.myRequests));
router.post("/my/requests", onlyVendor, wrap(my.addMyRequest));
router.patch("/my/requests/:id", onlyVendor, wrap(my.updateMyRequest));

module.exports = router;
