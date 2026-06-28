/**
 * App Brands Routes
 *
 *   GET    /api/app/:tenantId/brands                     → list all brands
 *   POST   /api/app/:tenantId/brands/:brandId/favorite   → add to favorites
 *   DELETE /api/app/:tenantId/brands/:brandId/favorite   → remove from favorites
 *
 * All routes require authentication + CUSTOMER role.
 */

const { Router } = require("express");
const ctrl = require("./brands.controller");
const { authenticateAppUser } = require("../middlewares/appAuth.middleware");

const router = Router();

router.use(authenticateAppUser);

router.get("/", ctrl.getBrands);
router.post("/:brandId/favorite", ctrl.addFavorite);
router.delete("/:brandId/favorite", ctrl.removeFavorite);

module.exports = router;
