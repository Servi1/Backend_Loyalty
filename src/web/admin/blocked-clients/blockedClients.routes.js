const { Router } = require("express");
const ctrl = require("./blockedClients.controller");
const { authenticate, authorize } = require("../../../middlewares/authMiddleware");

const router = Router();

// Protect all routes with Super Admin authentication & authorization
router.use(authenticate, authorize("SUPER_ADMIN"));

router.get("/", ctrl.getBlockedClients);
router.post("/", ctrl.blockClient);
router.post("/:id/unblock", ctrl.unblockClient);
router.put("/:id/unblock", ctrl.unblockClient);
router.post("/:id/allow", ctrl.unblockClient);
router.post("/:id/reblock", ctrl.reblockClient);
router.put("/:id/reblock", ctrl.reblockClient);
router.delete("/:id", ctrl.deleteBlockedClient);

module.exports = router;

