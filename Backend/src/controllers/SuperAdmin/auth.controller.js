const bcrypt = require("bcrypt");
const prisma = require("../../config/db");
const { createAccessToken, createRefreshToken, verifyRefreshToken } = require("../../utils/token");
const { ApiError, asyncHandler } = require("../../utils/http");

const superAdminLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const superAdmin = await prisma.superAdmin.findUnique({
    where: { email },
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
  const refreshPayload = verifyRefreshToken(refreshToken);

  await prisma.superAdminRefreshToken.create({
    data: {
      token: refreshToken,
      superAdminId: superAdmin.id,
      expiresAt: new Date(refreshPayload.exp * 1000),
    },
  });

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
  const { refreshToken } = req.body;

  const dbToken = await prisma.superAdminRefreshToken.findUnique({ where: { token: refreshToken } });
  if (!dbToken || dbToken.revokedAt || dbToken.expiresAt < new Date()) {
    throw new ApiError(401, "Invalid refresh token");
  }

  const payload = verifyRefreshToken(refreshToken);
  if (payload.role !== "SUPER_ADMIN") {
    throw new ApiError(401, "Invalid refresh token role");
  }

  const superAdmin = await prisma.superAdmin.findUnique({ where: { id: payload.sub } });
  if (!superAdmin || !superAdmin.isActive) {
    throw new ApiError(401, "Invalid refresh token");
  }

  const accessToken = createAccessToken(superAdmin);
  res.status(200).json({ accessToken });
});

const superAdminLogout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (refreshToken) {
    await prisma.superAdminRefreshToken.updateMany({
      where: { token: refreshToken, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

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
