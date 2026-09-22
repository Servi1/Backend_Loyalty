const { Router } = require("express");
const ctrl = require("./appSupport.controller");
const { authenticateAppUser } = require("../middlewares/appAuth.middleware");
const upload = require("../../middlewares/uploadMiddleware");

const router = Router({ mergeParams: true });

router.use(authenticateAppUser);

router.get("/thread", ctrl.getThread);
router.post("/messages", ctrl.sendMessage);

// Dedicated route to upload support/chat attachments to /uploads/support
router.post(
  "/upload",
  (req, _res, next) => { req.uploadDir = "support"; next(); },
  upload.supportUpload.single("file"),
  ctrl.uploadAttachment
);

module.exports = router;
