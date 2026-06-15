const { Router } = require("express");
const ctrl = require("./cart.controller");
const { authenticate } = require("../../middlewares/authMiddleware");
const { requireCustomer } = require("../middlewares/appAuth.middleware");

const router = Router();

// Ensure only authenticated app customers can manage their cart
router.use(authenticate, requireCustomer);

router.get("/", ctrl.get);
router.post("/", ctrl.add);
router.patch("/:cartLineId", ctrl.updateQty);
router.delete("/:cartLineId", ctrl.remove);
router.post("/clear", ctrl.clear);

module.exports = router;
