const express = require("express");
const env = require("../../config/env");
const validate = require("../../middleware/validate");
const { authenticateSuperAdmin } = require("../../middleware/auth");
const { authKeyByIp, createRateLimiter } = require("../../middleware/rate-limit");
const {
  superAdminForgotPasswordSchema,
  superAdminLoginSchema,
  superAdminRefreshSchema,
  superAdminResetPasswordSchema,
} = require("../../schemas/SuperAdmin/super-admin-auth.schema");
const {
  superAdminForgotPassword,
  superAdminLogin,
  superAdminRefresh,
  superAdminResetPassword,
  superAdminLogout,
  superAdminMe,
} = require("../../controllers/SuperAdmin/auth.controller");

const router = express.Router();

const superAdminForgotPasswordLimiter = createRateLimiter({
  scope: "super-admin-forgot-password",
  routeLabel: "/api/super-admin/auth/forgot-password",
  windowMs: env.rateLimit.superAdminPasswordResetWindowMs,
  max: env.rateLimit.superAdminPasswordResetMax,
  keySelector: authKeyByIp,
  failOpen: false,
  message: "Too many password reset requests. Please retry later.",
});

const superAdminResetPasswordLimiter = createRateLimiter({
  scope: "super-admin-reset-password",
  routeLabel: "/api/super-admin/auth/reset-password",
  windowMs: env.rateLimit.superAdminPasswordResetWindowMs,
  max: env.rateLimit.superAdminPasswordResetMax,
  keySelector: authKeyByIp,
  failOpen: false,
  message: "Too many password reset attempts. Please retry later.",
});

router.post("/login", validate(superAdminLoginSchema), superAdminLogin);
router.post("/forgot-password", superAdminForgotPasswordLimiter, validate(superAdminForgotPasswordSchema), superAdminForgotPassword);
router.post("/reset-password", superAdminResetPasswordLimiter, validate(superAdminResetPasswordSchema), superAdminResetPassword);
router.post("/refresh", validate(superAdminRefreshSchema), superAdminRefresh);
router.post("/logout", superAdminLogout);
router.get("/me", authenticateSuperAdmin, superAdminMe);

module.exports = router;
