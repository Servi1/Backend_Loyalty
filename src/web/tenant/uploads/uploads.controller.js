const catchAsync = require("../../../utils/catchAsync");
const ApiError = require("../../../utils/ApiError");
const fs = require("fs");
const path = require("path");

/**
 * Upload a single image file.
 * Returns the public URL that the frontend can use.
 */
const uploadImage = catchAsync(async (req, res) => {
  if (!req.file) {
    throw new ApiError(400, "No image file provided");
  }

  const subDir = req.uploadDir || "menus";
  const imageUrl = `/uploads/${subDir}/${req.file.filename}`;

  res.status(201).json({
    success: true,
    data: {
      imageUrl,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
    },
  });
});

/**
 * Upload multiple image files (up to 5).
 */
const uploadMultiple = catchAsync(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    throw new ApiError(400, "No image files provided");
  }

  const subDir = req.uploadDir || "menus";
  const images = req.files.map((file) => ({
    imageUrl: `/uploads/${subDir}/${file.filename}`,
    filename: file.filename,
    originalName: file.originalname,
    size: file.size,
  }));

  res.status(201).json({ success: true, data: images });
});

const ALLOWED_SUBDIRS = ["menus", "logos", "avatars", "receipts", "branding", "receipt-logos", "banners"];

/**
 * Delete an uploaded image by filename.
 */
const deleteImage = catchAsync(async (req, res) => {
  const { subDir, filename } = req.params;

  if (!ALLOWED_SUBDIRS.includes(subDir)) {
    throw new ApiError(400, "Invalid upload directory");
  }

  // Prevent path traversal attacks (e.g. ../../server.js)
  const safeFilename = path.basename(filename);
  if (safeFilename !== filename || filename.includes("..")) {
    throw new ApiError(400, "Invalid filename");
  }

  const uploadsRoot = path.resolve(__dirname, "../../../uploads");
  const targetDir = path.resolve(uploadsRoot, subDir);
  const filePath = path.resolve(targetDir, safeFilename);

  // Ensure resolved path is strictly within the target subdirectory
  if (!filePath.startsWith(targetDir)) {
    throw new ApiError(403, "Access denied");
  }

  if (!fs.existsSync(filePath)) {
    throw new ApiError(404, "Image not found");
  }

  fs.unlinkSync(filePath);
  res.json({ success: true, message: "Image deleted" });
});

module.exports = { uploadImage, uploadMultiple, deleteImage };
