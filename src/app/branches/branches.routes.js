/**
 * App Branches Routes
 *
 *   GET /api/app/:tenantId/branches          → list open branches
 *   GET /api/app/:tenantId/branches/:id      → branch detail + tables
 *
 * Public — no auth required.
 */

const { Router } = require("express");
const ctrl = require("./branches.controller");

const router = Router();

router.get("/", ctrl.getAll);
router.get("/:branchId", ctrl.getOne);
router.get("/:branchId/staff", ctrl.getStaff);
router.get("/:branchId/schedule-slots", ctrl.getScheduleSlots);
router.get("/staff/:staffId/slots", ctrl.getStaffSlots);

module.exports = router;
