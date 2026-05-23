const bcrypt = require("bcrypt");
const models = require("../../models");
const { createAccessToken, createRefreshToken, verifyRefreshToken } = require("../../utils/token");
const { ApiError, asyncHandler } = require("../../utils/http");
const { resolveAdminPermissions } = require("../../constants/admin-access-profiles");
const {
  cacheRefreshToken,
  getCachedRefreshToken,
  invalidateRefreshToken,
} = require("../../services/refresh-token-cache.service");

const ADMIN_REFRESH_COOKIE = "lms_admin_refresh_token";

const getRefreshCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  path: "/api/admin/auth",
  maxAge: 1000 * 60 * 60 * 24 * 7,
});

const verifyRefreshPayloadOrThrow = (refreshToken) => {
  try {
    return verifyRefreshToken(refreshToken);
  } catch {
    throw new ApiError(401, "Invalid refresh token");
  }
};

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
  const refreshToken = createRefreshToken(admin);

  const refreshPayload = verifyRefreshPayloadOrThrow(refreshToken);
  const refreshRecord = await db.adminRefreshToken.create({
    data: {
      token: refreshToken,
      adminId: admin.id,
      expiresAt: new Date(refreshPayload.exp * 1000),
    },
  });
  await cacheRefreshToken("admin", refreshToken, refreshRecord);
  res.cookie(ADMIN_REFRESH_COOKIE, refreshToken, getRefreshCookieOptions());

  res.status(200).json({
    accessToken,
    refreshToken,
    admin: {
      id: admin.id,
      employeeId: admin.employeeId,
      fullName: admin.fullName,
      email: admin.email,
      role: admin.role,
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

  let dbToken = await getCachedRefreshToken("admin", refreshToken);
  if (!dbToken) {
    dbToken = await db.adminRefreshToken.findUnique({ where: { token: refreshToken } });
    if (dbToken && !dbToken.revokedAt && dbToken.expiresAt >= new Date()) {
      await cacheRefreshToken("admin", refreshToken, dbToken);
    }
  }
  if (!dbToken || dbToken.revokedAt || new Date(dbToken.expiresAt) < new Date()) {
    throw new ApiError(401, "Invalid refresh token");
  }

  const payload = verifyRefreshPayloadOrThrow(refreshToken);
  if (payload.role !== "ADMIN") {
    throw new ApiError(401, "Invalid refresh token role");
  }

  const admin = await db.admin.findUnique({ where: { id: payload.sub } });
  if (!admin || !admin.isActive) {
    throw new ApiError(401, "Invalid refresh token");
  }

  const newAccessToken = createAccessToken({ ...admin, permissions: resolveAdminPermissions(admin) });
  res.status(200).json({ accessToken: newAccessToken });
});

const adminLogout = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const refreshToken = req.cookies?.[ADMIN_REFRESH_COOKIE] || req.body?.refreshToken;

  if (refreshToken) {
    await db.adminRefreshToken.updateMany({
      where: { token: refreshToken, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await invalidateRefreshToken("admin", refreshToken);
  }

  res.clearCookie(ADMIN_REFRESH_COOKIE, getRefreshCookieOptions());
  res.status(200).json({ message: "Logged out" });
});

const adminMe = asyncHandler(async (req, res) => {
  res.status(200).json(req.admin);
});

module.exports = {
  adminLogin,
  adminRefresh,
  adminLogout,
  adminMe,
};
