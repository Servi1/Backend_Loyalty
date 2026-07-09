const { Router } = require("express");
const kdsController = require("./kds.controller");

const router = Router();

router.get("/orders", kdsController.getOrders);
router.patch("/orders/:id/bump", kdsController.bumpOrder);
router.patch("/orders/:id/recall", kdsController.recallOrder);

module.exports = router;
