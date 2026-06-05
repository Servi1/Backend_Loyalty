/**
 * App Wallet Routes
 *
 *   GET /api/app/:tenantId/wallet                → wallet summary
 *   GET /api/app/:tenantId/wallet/transactions   → paginated tx history
 *
 * All routes require authentication + CUSTOMER role.
 */

const { Router } = require("express");
const ctrl = require("./wallet.controller");
const { authenticate } = require("../../middlewares/authMiddleware");
const { requireCustomer } = require("../middlewares/appAuth.middleware");

const router = Router();

router.use(authenticate, requireCustomer);

router.get("/", ctrl.getWallet);
router.get("/transactions", ctrl.getTransactions);
router.post("/transfer", ctrl.transferPoints);

module.exports = router;
