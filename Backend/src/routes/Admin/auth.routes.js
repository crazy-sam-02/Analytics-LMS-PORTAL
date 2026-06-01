const express = require("express");
const env = require("../../config/env");
const validate = require("../../middleware/validate");
const { authenticatePlatformAdmin } = require("../../middleware/auth");
const { authKeyByIp, createRateLimiter } = require("../../middleware/rate-limit");
const {
  adminForgotPasswordSchema,
  adminLoginSchema,
  adminRefreshSchema,
  adminResetPasswordSchema,
} = require("../../schemas/Admin/admin-auth.schema");
const {
  adminForgotPassword,
  adminLogin,
  adminRefresh,
  adminResetPassword,
  adminLogout,
  adminMe,
} = require("../../controllers/Admin/auth.controller");

const router = express.Router();

const adminForgotPasswordLimiter = createRateLimiter({
  scope: "admin-forgot-password",
  routeLabel: "/api/*/auth/forgot-password",
  windowMs: env.rateLimit.authForgotPasswordWindowMs,
  max: env.rateLimit.authForgotPasswordMax,
  keySelector: authKeyByIp,
  failOpen: false,
  message: "Too many password reset requests. Please retry later.",
});

const adminResetPasswordLimiter = createRateLimiter({
  scope: "admin-reset-password",
  routeLabel: "/api/*/auth/reset-password",
  windowMs: env.rateLimit.authResetPasswordWindowMs,
  max: env.rateLimit.authResetPasswordMax,
  keySelector: authKeyByIp,
  failOpen: false,
  message: "Too many password reset attempts. Please retry later.",
});

router.post("/login", validate(adminLoginSchema), adminLogin);
router.post("/forgot-password", adminForgotPasswordLimiter, validate(adminForgotPasswordSchema), adminForgotPassword);
router.post("/reset-password", adminResetPasswordLimiter, validate(adminResetPasswordSchema), adminResetPassword);
router.post("/refresh", validate(adminRefreshSchema), adminRefresh);
router.post("/logout", adminLogout);
router.get("/me", authenticatePlatformAdmin, adminMe);

module.exports = router;
