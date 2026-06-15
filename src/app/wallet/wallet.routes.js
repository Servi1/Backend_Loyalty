/**
 * App Wallet Routes
 *
 *   GET /api/app/:tenantId/wallet                → wallet summary
 *   GET /api/app/:tenantId/wallet/transactions   → paginated tx history
 *   POST /api/app/:tenantId/wallet/transfer      → transfer/gift points
 *   GET /api/app/:tenantId/wallet/gifts          → list pending/claimed gifts
 *   POST /api/app/:tenantId/wallet/gifts/:giftId/claim → claim a gift
 *   POST /api/app/:tenantId/wallet/gifts/claim-all     → claim all unclaimed gifts
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
router.get("/leaderboard", ctrl.getLeaderboard);

router.get("/gifts", ctrl.getGifts);
router.post("/gifts/:giftId/claim", ctrl.claimGift);
router.post("/gifts/claim-all", ctrl.claimAllGifts);

module.exports = router;
