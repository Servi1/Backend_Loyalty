/**
 * App Menu Routes
 *
 *   GET /api/app/:tenantId/menu          → full menu
 *   GET /api/app/:tenantId/menu/:itemId  → item detail
 *
 * Public — no authentication required (guests can browse menus).
 */

const { Router } = require("express");
const ctrl = require("./menu.controller");

const router = Router();

router.get("/", ctrl.getMenu);
router.get("/:itemId", ctrl.getItem);

module.exports = router;
