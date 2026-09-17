const { Router } = require("express");
const ctrl = require("./appSupport.controller");
const { authenticateAppUser } = require("../middlewares/appAuth.middleware");

const router = Router({ mergeParams: true });

router.use(authenticateAppUser);

router.get("/thread", ctrl.getThread);
router.post("/messages", ctrl.sendMessage);

module.exports = router;
