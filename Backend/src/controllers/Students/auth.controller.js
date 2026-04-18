const bcrypt = require("bcrypt");
const prisma = require("../../config/db");
const { createAccessToken, createRefreshToken, verifyRefreshToken } = require("../../utils/token");
const { ApiError, asyncHandler } = require("../../utils/http");

const STUDENT_REFRESH_COOKIE = "student_refresh_token";

const getRefreshCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  path: "/api/auth",
  maxAge: 1000 * 60 * 60 * 24 * 7,
});

const login = asyncHandler(async (req, res) => {
  const { identifier, password } = req.body;

  const user = await prisma.student.findFirst({
    where: {
      OR: [{ email: identifier }, { studentId: identifier }],
    },
    include: {
      batch: true,
      department: true,
      college: true,
    },
  });

  if (!user) {
    throw new ApiError(401, "Invalid credentials");
  }

  const passwordMatch = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatch) {
    throw new ApiError(401, "Invalid credentials");
  }

  if (!user.isActive) {
    throw new ApiError(403, "Account is inactive", null, "ACCOUNT_INACTIVE");
  }

  const accessToken = createAccessToken(user);
  const refreshToken = createRefreshToken(user);

  const refreshPayload = verifyRefreshToken(refreshToken);
  const refreshRecord = await prisma.studentRefreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      expiresAt: new Date(refreshPayload.exp * 1000),
    },
  });

  res.cookie(STUDENT_REFRESH_COOKIE, refreshToken, getRefreshCookieOptions());

  res.status(200).json({
    accessToken,
    sessionId: refreshRecord.id,
    user: {
      id: user.id,
      studentId: user.studentId,
      fullName: user.fullName,
      email: user.email,
      avatarUrl: user.avatarUrl || null,
      batch: user.batch,
      department: user.department,
      college: user.college,
      preferences: user.preferences,
    },
  });
});

const refresh = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.[STUDENT_REFRESH_COOKIE] || req.body?.refreshToken;

  if (!refreshToken) {
    throw new ApiError(400, "Refresh token required");
  }

  const dbToken = await prisma.studentRefreshToken.findUnique({
    where: { token: refreshToken },
  });

  if (!dbToken || dbToken.revokedAt || dbToken.expiresAt < new Date()) {
    throw new ApiError(401, "Invalid refresh token");
  }

  const payload = verifyRefreshToken(refreshToken);
  const user = await prisma.student.findUnique({ where: { id: payload.sub } });

  if (!user) {
    throw new ApiError(401, "Invalid refresh token");
  }

  if (!user.isActive) {
    throw new ApiError(403, "Account is inactive", null, "ACCOUNT_INACTIVE");
  }

  const newAccessToken = createAccessToken(user);
  res.status(200).json({
    accessToken: newAccessToken,
    sessionId: dbToken.id,
    user: {
      id: user.id,
      studentId: user.studentId,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      avatarUrl: user.avatarUrl || null,
      batchId: user.batchId,
      departmentId: user.departmentId,
      collegeId: user.collegeId,
      preferences: user.preferences,
    },
  });
});

const logout = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.[STUDENT_REFRESH_COOKIE] || req.body?.refreshToken;

  if (refreshToken) {
    await prisma.studentRefreshToken.updateMany({
      where: { token: refreshToken, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  res.clearCookie(STUDENT_REFRESH_COOKIE, {
    ...getRefreshCookieOptions(),
    maxAge: undefined,
  });

  res.status(200).json({ message: "Logged out" });
});

const me = asyncHandler(async (req, res) => {
  const user = req.user;
  res.status(200).json({
    id: user.id,
    studentId: user.studentId,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    avatarUrl: user.avatarUrl || null,
    batch: user.batch,
    department: user.department,
    college: user.college,
    preferences: user.preferences,
  });
});

module.exports = {
  login,
  refresh,
  logout,
  me,
};
