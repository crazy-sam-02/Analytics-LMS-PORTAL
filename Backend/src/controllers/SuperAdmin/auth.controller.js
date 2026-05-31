const bcrypt = require("bcrypt");
const models = require("../../models");
const env = require("../../config/env");
const { createAccessToken } = require("../../utils/token");
const { ApiError, asyncHandler } = require("../../utils/http");
const {
  assertRefreshTokenRecordUsable,
  createRefreshTokenRecord,
  findRefreshTokenRecord,
  revokeRefreshTokenValue,
  rotateRefreshTokenRecord,
  verifyRefreshPayloadOrThrow,
} = require("../../services/refresh-token-session.service");
const { revokeAccessTokenFromRequest } = require("../../services/access-token-revocation.service");

const SUPER_ADMIN_REFRESH_COOKIE = "lms_super_admin_refresh_token";
const SUPER_ADMIN_AUTH_COOKIE_PATHS = ["/api/super-admin/auth", "/api/superadmin/auth"];

const getRefreshCookieOptions = (path = "/api/super-admin/auth") => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  path,
  maxAge: 1000 * 60 * 60 * 24 * 7,
});

const setRefreshCookie = (res, refreshToken) => {
  SUPER_ADMIN_AUTH_COOKIE_PATHS.forEach((path) => {
    res.cookie(SUPER_ADMIN_REFRESH_COOKIE, refreshToken, getRefreshCookieOptions(path));
  });
};

const clearRefreshCookie = (res) => {
  SUPER_ADMIN_AUTH_COOKIE_PATHS.forEach((path) => {
    res.clearCookie(SUPER_ADMIN_REFRESH_COOKIE, getRefreshCookieOptions(path));
  });
};

const superAdminLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const envEmail = String(env.superAdminEmail || "").trim().toLowerCase();
  const incomingEmail = String(email || "").trim().toLowerCase();
  const envPassword = String(env.superAdminPassword || "");

  if (envEmail && incomingEmail === envEmail && envPassword && password === envPassword) {
    const passwordHash = await bcrypt.hash(envPassword, 10);
    const m = await models.init();
    const SuperAdmin = m.dbClient.superAdmin;

    const superAdmin = await SuperAdmin.upsert({
      where: { email: env.superAdminEmail },
      update: {
        fullName: env.superAdminName || "Super Admin",
        passwordHash,
        role: "SUPER_ADMIN",
        isActive: true,
      },
      create: {
        email: env.superAdminEmail,
        fullName: env.superAdminName || "Super Admin",
        passwordHash,
        role: "SUPER_ADMIN",
        isActive: true,
      }
    });

    const accessToken = createAccessToken(superAdmin);
    const { refreshToken } = await createRefreshTokenRecord({
      db: m.dbClient,
      modelName: "superAdminRefreshToken",
      scope: "super-admin",
      principal: superAdmin,
      ownerField: "superAdminId",
    });
    setRefreshCookie(res, refreshToken);

    return res.status(200).json({
      accessToken,
      refreshToken,
      superAdmin: {
        id: superAdmin.id,
        fullName: superAdmin.fullName,
        email: superAdmin.email,
        role: superAdmin.role,
      },
    });
  }

  const m = await models.init();
  const SuperAdmin = m.dbClient.superAdmin;
  const superAdmin = await SuperAdmin.findFirst({
    where: { email, role: "SUPER_ADMIN" }
  });

  if (!superAdmin || !superAdmin.isActive) {
    throw new ApiError(401, "Invalid credentials");
  }

  const isMatch = await bcrypt.compare(password, superAdmin.passwordHash);
  if (!isMatch) {
    throw new ApiError(401, "Invalid credentials");
  }

  const accessToken = createAccessToken(superAdmin);
  const { refreshToken } = await createRefreshTokenRecord({
    db: m.dbClient,
    modelName: "superAdminRefreshToken",
    scope: "super-admin",
    principal: superAdmin,
    ownerField: "superAdminId",
  });
  setRefreshCookie(res, refreshToken);

  res.status(200).json({
    accessToken,
    refreshToken,
    superAdmin: {
      id: superAdmin.id,
      fullName: superAdmin.fullName,
      email: superAdmin.email,
      role: superAdmin.role,
    },
  });
});

const superAdminRefresh = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.[SUPER_ADMIN_REFRESH_COOKIE] || req.body?.refreshToken;

  if (!refreshToken) {
    throw new ApiError(400, "Refresh token required");
  }

  const payload = verifyRefreshPayloadOrThrow(refreshToken);
  const m = await models.init();
  const db = m.dbClient;
  const dbToken = await findRefreshTokenRecord({
    db,
    modelName: "superAdminRefreshToken",
    scope: "super-admin",
    refreshToken,
  });
  await assertRefreshTokenRecordUsable({
    db,
    modelName: "superAdminRefreshToken",
    scope: "super-admin",
    ownerField: "superAdminId",
    record: dbToken,
    ownerId: payload.sub,
  });

  if (payload.role !== "SUPER_ADMIN") {
    throw new ApiError(401, "Invalid refresh token role");
  }

  const superAdmin = await db.superAdmin.findUnique({ where: { id: payload.sub } });
  if (!superAdmin || !superAdmin.isActive) {
    throw new ApiError(401, "Invalid refresh token");
  }

  const accessToken = createAccessToken(superAdmin);
  const { refreshToken: newRefreshToken, refreshRecord } = await rotateRefreshTokenRecord({
    db,
    modelName: "superAdminRefreshToken",
    scope: "super-admin",
    ownerField: "superAdminId",
    oldRefreshToken: refreshToken,
    oldRecord: dbToken,
    principal: superAdmin,
  });
  setRefreshCookie(res, newRefreshToken);

  res.status(200).json({
    accessToken,
    refreshToken: newRefreshToken,
    sessionId: refreshRecord.id,
  });
});

const superAdminLogout = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.[SUPER_ADMIN_REFRESH_COOKIE] || req.body?.refreshToken;
  await revokeAccessTokenFromRequest(req);

  if (refreshToken) {
    const db = (await models.init()).dbClient;
    await revokeRefreshTokenValue({
      db,
      modelName: "superAdminRefreshToken",
      scope: "super-admin",
      refreshToken,
      reason: "logout",
    });
  }

  clearRefreshCookie(res);
  res.status(200).json({ message: "Logged out" });
});

const superAdminMe = asyncHandler(async (req, res) => {
  res.status(200).json(req.superAdmin);
});

module.exports = {
  superAdminLogin,
  superAdminRefresh,
  superAdminLogout,
  superAdminMe,
};
