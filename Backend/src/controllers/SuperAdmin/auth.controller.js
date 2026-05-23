const bcrypt = require("bcrypt");
const models = require("../../models");
const env = require("../../config/env");
const { createAccessToken, createRefreshToken, verifyRefreshToken } = require("../../utils/token");
const { ApiError, asyncHandler } = require("../../utils/http");
const {
  cacheRefreshToken,
  getCachedRefreshToken,
  invalidateRefreshToken,
} = require("../../services/refresh-token-cache.service");

const SUPER_ADMIN_REFRESH_COOKIE = "lms_super_admin_refresh_token";

const getRefreshCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  path: "/api/super-admin/auth",
  maxAge: 1000 * 60 * 60 * 24 * 7,
});

const verifyRefreshPayloadOrThrow = (refreshToken) => {
  try {
    return verifyRefreshToken(refreshToken);
  } catch {
    throw new ApiError(401, "Invalid refresh token");
  }
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
    const SuperAdminRefreshToken = m.dbClient.superAdminRefreshToken;

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
    const refreshToken = createRefreshToken(superAdmin);
    const refreshPayload = verifyRefreshPayloadOrThrow(refreshToken);

    const refreshRecord = await SuperAdminRefreshToken.create({
      data: {
        token: refreshToken,
        superAdminId: superAdmin.id,
        expiresAt: new Date(refreshPayload.exp * 1000),
      }
    });
    await cacheRefreshToken("super-admin", refreshToken, refreshRecord);
    res.cookie(SUPER_ADMIN_REFRESH_COOKIE, refreshToken, getRefreshCookieOptions());

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
  const refreshToken = createRefreshToken(superAdmin);
  const refreshPayload = verifyRefreshPayloadOrThrow(refreshToken);

  const m2 = await models.init();
  const SuperAdminRefreshToken = m2.dbClient.superAdminRefreshToken;
  const refreshRecord = await SuperAdminRefreshToken.create({
    data: {
      token: refreshToken,
      superAdminId: superAdmin.id,
      expiresAt: new Date(refreshPayload.exp * 1000),
    }
  });
  await cacheRefreshToken("super-admin", refreshToken, refreshRecord);
  res.cookie(SUPER_ADMIN_REFRESH_COOKIE, refreshToken, getRefreshCookieOptions());

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

  let dbToken = await getCachedRefreshToken("super-admin", refreshToken);
  if (!dbToken) {
    const m3 = await models.init();
    const SuperAdminRefreshToken = m3.dbClient.superAdminRefreshToken;
    dbToken = await SuperAdminRefreshToken.findUnique({
      where: { token: refreshToken }
    });
    if (dbToken && !dbToken.revokedAt && new Date(dbToken.expiresAt) >= new Date()) {
      await cacheRefreshToken("super-admin", refreshToken, dbToken);
    }
  }
  if (!dbToken || dbToken.revokedAt || new Date(dbToken.expiresAt) < new Date()) {
    throw new ApiError(401, "Invalid refresh token");
  }

  const payload = verifyRefreshPayloadOrThrow(refreshToken);
  if (payload.role !== "SUPER_ADMIN") {
    throw new ApiError(401, "Invalid refresh token role");
  }

  const m4 = await models.init();
  const SuperAdmin = m4.dbClient.superAdmin;
  const superAdmin = await SuperAdmin.findUnique({ where: { id: payload.sub } });
  if (!superAdmin || !superAdmin.isActive) {
    throw new ApiError(401, "Invalid refresh token");
  }

  const accessToken = createAccessToken(superAdmin);
  res.status(200).json({ accessToken });
});

const superAdminLogout = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.[SUPER_ADMIN_REFRESH_COOKIE] || req.body?.refreshToken;

  if (refreshToken) {
    const m5 = await models.init();
    const SuperAdminRefreshToken = m5.dbClient.superAdminRefreshToken;
    await SuperAdminRefreshToken.updateMany({
      where: { token: refreshToken, revokedAt: null },
      data: { revokedAt: new Date() }
    });
    await invalidateRefreshToken("super-admin", refreshToken);
  }

  res.clearCookie(SUPER_ADMIN_REFRESH_COOKIE, getRefreshCookieOptions());
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
