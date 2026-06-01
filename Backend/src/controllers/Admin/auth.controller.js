const bcrypt = require("bcrypt");
const models = require("../../models");
const { createAccessToken } = require("../../utils/token");
const { ApiError, asyncHandler } = require("../../utils/http");
const { resolveAdminPermissions } = require("../../constants/admin-access-profiles");
const { ROLES, normalizeRole, isAdminLikeRole } = require("../../constants/roles");
const {
  assertRefreshTokenRecordUsable,
  createRefreshTokenRecord,
  findRefreshTokenRecord,
  revokeRefreshTokenValue,
  rotateRefreshTokenRecord,
  verifyRefreshPayloadOrThrow,
} = require("../../services/refresh-token-session.service");
const { revokeAccessTokenFromRequest } = require("../../services/access-token-revocation.service");
const { requestPasswordReset, resetPasswordWithToken } = require("../../services/password-reset.service");

const ADMIN_REFRESH_COOKIE = "lms_admin_refresh_token";

const getRefreshCookieOptions = (path = "/api/admin/auth") => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  path,
  maxAge: 1000 * 60 * 60 * 24 * 7,
});

const adminLogin = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { email, password } = req.body;

  const admin = await db.admin.findFirst({
    where: {
      email,
      isActive: true,
    },
    include: {
      college: true,
      department: true,
    },
  });

  if (!admin) {
    throw new ApiError(401, "Invalid credentials");
  }

  const isMatch = await bcrypt.compare(password, admin.passwordHash);
  if (!isMatch) {
    throw new ApiError(401, "Invalid credentials");
  }

  const permissions = resolveAdminPermissions(admin);
  const accessToken = createAccessToken({ ...admin, permissions });
  const { refreshToken } = await createRefreshTokenRecord({
    db,
    modelName: "adminRefreshToken",
    scope: "admin",
    principal: admin,
    ownerField: "adminId",
  });
  const cookiePath = req.baseUrl && req.baseUrl.startsWith("/api/college-admin/auth")
    ? "/api/college-admin/auth"
    : "/api/admin/auth";
  res.cookie(ADMIN_REFRESH_COOKIE, refreshToken, getRefreshCookieOptions(cookiePath));

  res.status(200).json({
    accessToken,
    refreshToken,
    admin: {
      id: admin.id,
      employeeId: admin.employeeId,
      fullName: admin.fullName,
      email: admin.email,
      role: normalizeRole(admin.role),
      permissions,
      college: admin.college,
      department: admin.department,
    },
  });
});

const adminRefresh = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const refreshToken = req.cookies?.[ADMIN_REFRESH_COOKIE] || req.body?.refreshToken;

  if (!refreshToken) {
    throw new ApiError(400, "Refresh token required");
  }

  const payload = verifyRefreshPayloadOrThrow(refreshToken);
  const dbToken = await findRefreshTokenRecord({
    db,
    modelName: "adminRefreshToken",
    scope: "admin",
    refreshToken,
  });
  await assertRefreshTokenRecordUsable({
    db,
    modelName: "adminRefreshToken",
    scope: "admin",
    ownerField: "adminId",
    record: dbToken,
    ownerId: payload.sub,
  });

  const tokenRole = normalizeRole(payload.role);
  if (!isAdminLikeRole(tokenRole)) {
    throw new ApiError(401, "Invalid refresh token role");
  }

  const admin = await db.admin.findUnique({ where: { id: payload.sub } });
  if (!admin || !admin.isActive) {
    throw new ApiError(401, "Invalid refresh token");
  }

  const adminRole = normalizeRole(admin.role || ROLES.ADMIN);
  if (adminRole !== tokenRole) {
    throw new ApiError(401, "Invalid refresh token");
  }

  const permissions = resolveAdminPermissions(admin);
  const newAccessToken = createAccessToken({ ...admin, permissions });
  const { refreshToken: newRefreshToken, refreshRecord } = await rotateRefreshTokenRecord({
    db,
    modelName: "adminRefreshToken",
    scope: "admin",
    ownerField: "adminId",
    oldRefreshToken: refreshToken,
    oldRecord: dbToken,
    principal: admin,
  });
  const cookiePath = req.baseUrl && req.baseUrl.startsWith("/api/college-admin/auth")
    ? "/api/college-admin/auth"
    : "/api/admin/auth";
  res.cookie(ADMIN_REFRESH_COOKIE, newRefreshToken, getRefreshCookieOptions(cookiePath));

  res.status(200).json({
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    sessionId: refreshRecord.id,
  });
});

const adminLogout = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const refreshToken = req.cookies?.[ADMIN_REFRESH_COOKIE] || req.body?.refreshToken;
  await revokeAccessTokenFromRequest(req);

  if (refreshToken) {
    await revokeRefreshTokenValue({
      db,
      modelName: "adminRefreshToken",
      scope: "admin",
      refreshToken,
      reason: "logout",
    });
  }

  ["/api/admin/auth", "/api/college-admin/auth"].forEach((path) => {
    res.clearCookie(ADMIN_REFRESH_COOKIE, getRefreshCookieOptions(path));
  });
  res.status(200).json({ message: "Logged out" });
});

const adminMe = asyncHandler(async (req, res) => {
  res.status(200).json(req.admin);
});

const adminForgotPassword = asyncHandler(async (req, res) => {
  const result = await requestPasswordReset({
    scope: "admin",
    portal: String(req.baseUrl || req.originalUrl || "").includes("college-admin") ? "college-admin" : "admin",
    identifier: req.body?.email,
    req,
  });
  res.status(202).json(result);
});

const adminResetPassword = asyncHandler(async (req, res) => {
  const result = await resetPasswordWithToken({
    scope: "admin",
    token: req.body?.token,
    password: req.body?.password,
  });
  res.status(200).json(result);
});

module.exports = {
  adminLogin,
  adminRefresh,
  adminLogout,
  adminMe,
  adminForgotPassword,
  adminResetPassword,
};
