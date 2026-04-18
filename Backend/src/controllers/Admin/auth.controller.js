const bcrypt = require("bcrypt");
const prisma = require("../../config/db");
const { createAccessToken, createRefreshToken, verifyRefreshToken } = require("../../utils/token");
const { ApiError, asyncHandler } = require("../../utils/http");
const { ADMIN_PERMISSIONS } = require("../../constants/admin-permissions");

const resolvePermissions = (admin) =>
  Array.isArray(admin?.permissions) && admin.permissions.length > 0 ? admin.permissions : ADMIN_PERMISSIONS;

const adminLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const admin = await prisma.admin.findFirst({
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

  const permissions = resolvePermissions(admin);
  const accessToken = createAccessToken({ ...admin, permissions });
  const refreshToken = createRefreshToken(admin);

  const refreshPayload = verifyRefreshToken(refreshToken);
  await prisma.adminRefreshToken.create({
    data: {
      token: refreshToken,
      adminId: admin.id,
      expiresAt: new Date(refreshPayload.exp * 1000),
    },
  });

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
  const { refreshToken } = req.body;

  const dbToken = await prisma.adminRefreshToken.findUnique({ where: { token: refreshToken } });
  if (!dbToken || dbToken.revokedAt || dbToken.expiresAt < new Date()) {
    throw new ApiError(401, "Invalid refresh token");
  }

  const payload = verifyRefreshToken(refreshToken);
  if (payload.role !== "ADMIN") {
    throw new ApiError(401, "Invalid refresh token role");
  }

  const admin = await prisma.admin.findUnique({ where: { id: payload.sub } });
  if (!admin || !admin.isActive) {
    throw new ApiError(401, "Invalid refresh token");
  }

  const newAccessToken = createAccessToken({ ...admin, permissions: resolvePermissions(admin) });
  res.status(200).json({ accessToken: newAccessToken });
});

const adminLogout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (refreshToken) {
    await prisma.adminRefreshToken.updateMany({
      where: { token: refreshToken, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

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
