const { Router } = require("express");
const posController = require("./pos.controller");

const router = Router();

router.get("/catalog", posController.getCatalog);
router.get("/tables", posController.getTables);
router.get("/orders", posController.getOrders);
router.post("/orders", posController.createOrder);
router.patch("/orders/:id/status", posController.updateOrderStatus);

module.exports = router;
