const { Router } = require("express");
const ctrl = require("./appSupport.controller");
const { authenticateAppUser } = require("../middlewares/appAuth.middleware");
const upload = require("../../middlewares/uploadMiddleware");
const ApiError = require("../../utils/ApiError");

const router = Router({ mergeParams: true });

router.use(authenticateAppUser);

router.get("/thread", ctrl.getThread);
router.post("/messages", ctrl.sendMessage);

// Dedicated route to upload support/chat attachments to /uploads/support
const handleSupportUpload = (req, res, next) => {
  req.uploadDir = "support";
  upload.supportUpload.single("file")(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE" || err.message?.includes("LIMIT_FILE_SIZE")) {
        return next(new ApiError(400, "Image size should be under 3 MB"));
      }
      return next(err);
    }
    next();
  });
};

router.post("/upload", handleSupportUpload, ctrl.uploadAttachment);

module.exports = router;
