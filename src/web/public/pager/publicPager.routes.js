const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const ctrl = require("./publicPager.controller");

const router = Router();

// Strict rate limiter for public queue submissions to prevent SMS spam or abuse
const publicSubmitLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 6, // max 6 attempts per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please wait a minute before trying again.",
  },
});

// General public read limiter
const publicReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120, // 120 reads per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many status checks. Please slow down.",
  },
});

router.get("/:pagerId", publicReadLimiter, ctrl.getPagerInfo);
router.post("/:pagerId/join", publicSubmitLimiter, ctrl.joinQueue);
router.get("/ticket/:ticketId", publicReadLimiter, ctrl.getTicketStatus);

module.exports = router;

