const { Router } = require("express");
const posController = require("./pos.controller");

const router = Router();

router.get("/catalog", posController.getCatalog);
router.get("/tables", posController.getTables);
router.get("/orders", posController.getOrders);
router.post("/orders", posController.createOrder);
router.patch("/orders/:id/status", posController.updateOrderStatus);

router.get("/reports/eod", posController.getEODReport);
router.get("/reports/eod/download", posController.downloadEODReportPDF);

router.get("/cashdrawer/status", posController.getCashDrawerStatus);
router.get("/cashdrawer/sessions", posController.getCashDrawerSessions);
router.post("/cashdrawer/open", posController.openCashDrawer);
router.post("/cashdrawer/close", posController.closeCashDrawer);

module.exports = router;
