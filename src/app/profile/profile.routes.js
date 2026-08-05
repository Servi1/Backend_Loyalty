/**
 * App Profile Routes
 *
 *   PATCH  /api/app/:tenantId/profile   → update profile
 *   DELETE /api/app/:tenantId/profile   → delete account
 *
 * All routes require authentication + CUSTOMER role.
 */

const { Router } = require("express");
const ctrl = require("./profile.controller");
const { authenticateAppUser } = require("../middlewares/appAuth.middleware");
const upload = require("../../../middlewares/uploadMiddleware");

const router = Router();

router.use(authenticateAppUser);

router.patch("/", ctrl.update);
router.delete("/", ctrl.remove);

// Route to upload doorstep images for an address
router.post(
  "/address/upload-doorstep",
  (req, _res, next) => { req.uploadDir = "doorsteps"; next(); },
  upload.doorstepUpload.array("images", 2),
  ctrl.uploadDoorstepImages
);

module.exports = router;
