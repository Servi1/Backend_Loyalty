const { Router } = require("express");
const ctrl = require("./categories.controller");

const router = Router();

// Public endpoint for mobile app: get all tenant categories from backend
router.get("/", ctrl.getCategories);

module.exports = router;
