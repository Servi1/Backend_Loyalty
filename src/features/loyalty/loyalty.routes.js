const { Router } = require("express");
const ctrl = require("./loyalty.controller");
const { authenticate, authorize } = require("../../middlewares/authMiddleware");

const router = Router();

router.use(authenticate);

// Customer views their wallet
router.get("/wallet", ctrl.getWallet);

// Customer redeems points
router.post("/redeem", ctrl.redeem);

// Staff awards points (after order completion)
router.post("/earn", authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER", "CASHIER"), ctrl.earn);

// Staff searches customers
router.get("/customers", authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER", "CASHIER"), ctrl.searchCustomers);

// Staff registers a new customer
router.post("/customers", authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER", "CASHIER"), ctrl.createCustomer);

// Report lists for Brand Owner / Manager
router.get("/members", authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER"), ctrl.getAllCustomers);
router.get("/transactions", authorize("ADMIN", "BRAND_MANAGER"), ctrl.getAllTransactions);

module.exports = router;
