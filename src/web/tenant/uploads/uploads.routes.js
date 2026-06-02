const { Router } = require("express");
const ctrl = require("./uploads.controller");
const upload = require("../../../middlewares/uploadMiddleware");
const { authenticate, authorize } = require("../../../middlewares/authMiddleware");

const router = Router();

router.use(authenticate);

// ─── Menu Images ─────────────────────────────────────
router.post(
  "/menu",
  authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER"),
  (req, _res, next) => { req.uploadDir = "menus"; next(); },
  upload.single("image"),
  ctrl.uploadImage
);

router.post(
  "/menu/bulk",
  authorize("ADMIN", "BRAND_MANAGER"),
  (req, _res, next) => { req.uploadDir = "menus"; next(); },
  upload.array("images", 5),
  ctrl.uploadMultiple
);

// ─── Brand Logos ─────────────────────────────────────
router.post(
  "/logo",
  authorize("ADMIN", "BRAND_MANAGER"),
  (req, _res, next) => { req.uploadDir = "logos"; next(); },
  upload.single("image"),
  ctrl.uploadImage
);

// ─── User Avatars ────────────────────────────────────
router.post(
  "/avatar",
  (req, _res, next) => { req.uploadDir = "avatars"; next(); },
  upload.single("image"),
  ctrl.uploadImage
);

// ─── Delete an image ─────────────────────────────────
router.delete(
  "/:subDir/:filename",
  authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER"),
  ctrl.deleteImage
);

module.exports = router;
