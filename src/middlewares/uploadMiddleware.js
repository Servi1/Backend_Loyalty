const multer = require("multer");
const path = require("path");
const fs = require("fs");
const ApiError = require("../utils/ApiError");

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, "../../uploads");
console.log("[Upload] Files will be saved to:", uploadDir);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Sub-directories for different upload types
const subDirs = ["menus", "logos", "avatars", "branches", "doorsteps"];
subDirs.forEach((dir) => {
  const fullPath = path.join(uploadDir, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
});

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    // Default to "menus" — override in route via req.uploadDir
    const subDir = _req.uploadDir || "menus";
    cb(null, path.join(uploadDir, subDir));
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e6);
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  },
});

const fileFilter = (_req, file, cb) => {
  const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new ApiError(400, "Only JPEG, PNG, WebP, and GIF images are allowed"), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
});

// Multer instance for doorstep photos, restricted to 3 MB
const doorstepUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3 MB max
});

// Multer instance for PDF document uploads, restricted to 15 MB
const pdfStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const fullPath = path.join(uploadDir, "documents");
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
    cb(null, fullPath);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e6);
    const ext = path.extname(file.originalname);
    cb(null, `privacy-policy-${uniqueSuffix}${ext}`);
  },
});

const pdfFileFilter = (_req, file, cb) => {
  if (file.mimetype === "application/pdf" || file.originalname.endsWith(".pdf")) {
    cb(null, true);
  } else {
    cb(new ApiError(400, "Only PDF (.pdf) files are allowed"), false);
  }
};

const pdfUpload = multer({
  storage: pdfStorage,
  fileFilter: pdfFileFilter,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB max
});

upload.doorstepUpload = doorstepUpload;
upload.pdfUpload = pdfUpload;

module.exports = upload;
