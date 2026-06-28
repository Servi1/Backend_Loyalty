const { Router } = require("express");
const ctrl = require("./cart.controller");
const { authenticateAppUser } = require("../middlewares/appAuth.middleware");

const router = Router();

// Ensure only authenticated app customers can manage their cart
router.use(authenticateAppUser);

router.get("/", ctrl.get);
router.post("/", ctrl.add);
router.patch("/:cartLineId", ctrl.updateQty);
router.delete("/:cartLineId", ctrl.remove);
router.post("/clear", ctrl.clear);

module.exports = router;
