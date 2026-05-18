const bcrypt = require("bcrypt");
const models = require("../../models");
const { createAccessToken, createRefreshToken, verifyRefreshToken } = require("../../utils/token");
const { ApiError, asyncHandler } = require("../../utils/http");
const {
  cacheRefreshToken,
  getCachedRefreshToken,
  invalidateRefreshToken,
} = require("../../services/refresh-token-cache.service");

const STUDENT_REFRESH_COOKIE = "student_refresh_token";

const buildStudentProfilePayload = (user = {}) => ({
  id: user.id,
  studentId: user.studentId,
  fullName: user.fullName,
  email: user.email,
  avatarUrl: user.avatarUrl || null,
  batch: user.batch || (Array.isArray(user.batches) ? user.batches[0] : null),
  batches: Array.isArray(user.batches) ? user.batches : [],
  batchIds: Array.isArray(user.batchIds) ? user.batchIds : [],
  department: user.department,
  college: user.college,
  preferences: user.preferences,
});

const verifyRefreshPayloadOrThrow = (refreshToken) => {
  try {
    return verifyRefreshToken(refreshToken);
  } catch {
    throw new ApiError(401, "Invalid refresh token");
  }
};

const getRefreshCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  path: "/api/auth",
  maxAge: 1000 * 60 * 60 * 24 * 7,
});

const login = asyncHandler(async (req, res) => {
  const { identifier, password } = req.body;

  const m = await models.init();
  const Student = m.Student;
  const User = m.User;

  let user = null;
  if (String(identifier || "").includes("@")) {
    // Try student collection first (students created via super-admin have email directly)
    user = await Student.findOne({ email: identifier }).lean();

    // Fallback: check if it's a user record for backwards compatibility
    if (!user) {
      const foundUser = await User.findOne({ email: identifier }).lean();
      if (foundUser) {
        // Check if there's a linked student record
        user = await Student.findOne({ userId: foundUser.id }).lean();
        if (user) {
          user = { ...foundUser, ...user };
        } else {
          // no student record but user exists
          user = foundUser;
        }
      }
    }
  } else {
    // Search by studentId
    user = await Student.findOne({ studentId: identifier }).lean();
  }

  if (!user) {
    const isEmailIdentifier = String(identifier || "").includes("@");
    throw new ApiError(401, isEmailIdentifier ? "Email is wrong" : "Student ID is wrong", null, isEmailIdentifier ? "EMAIL_WRONG" : "IDENTIFIER_WRONG");
  }

  const passwordMatch = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatch) {
    throw new ApiError(401, "Password is wrong", null, "PASSWORD_WRONG");
  }

  if (!user.isActive) {
    throw new ApiError(403, "Account is inactive", null, "ACCOUNT_INACTIVE");
  }

  const accessToken = createAccessToken(user);
  const refreshToken = createRefreshToken(user);

  const refreshPayload = verifyRefreshPayloadOrThrow(refreshToken);
  const StudentRefreshToken = (await models.init()).StudentRefreshToken;
  const refreshRecord = await StudentRefreshToken.create({ token: refreshToken, userId: user.id, type: "STUDENT", expiresAt: new Date(refreshPayload.exp * 1000) });
  await cacheRefreshToken("student", refreshToken, refreshRecord);

  res.cookie(STUDENT_REFRESH_COOKIE, refreshToken, getRefreshCookieOptions());

  res.status(200).json({
    accessToken,
    sessionId: refreshRecord.id,
    user: buildStudentProfilePayload(user),
  });
});

const refresh = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.[STUDENT_REFRESH_COOKIE] || req.body?.refreshToken;

  if (!refreshToken) {
    throw new ApiError(400, "Refresh token required");
  }

  let dbToken = await getCachedRefreshToken("student", refreshToken);
  if (!dbToken) {
    const StudentRefreshToken2 = (await models.init()).StudentRefreshToken;
    dbToken = await StudentRefreshToken2.findOne({ token: refreshToken }).lean();
    if (dbToken && !dbToken.revokedAt && new Date(dbToken.expiresAt) >= new Date()) {
      await cacheRefreshToken("student", refreshToken, dbToken);
    }
  }

  if (!dbToken || dbToken.revokedAt || new Date(dbToken.expiresAt) < new Date()) {
    throw new ApiError(401, "Invalid refresh token");
  }
  const payload = verifyRefreshPayloadOrThrow(refreshToken);
  const Student2 = (await models.init()).Student;
  const User2 = (await models.init()).User;
  let userRecord = await Student2.findOne({ id: payload.sub }).lean();
  if (!userRecord) {
    // maybe payload.sub refers to User id
    userRecord = await User2.findOne({ id: payload.sub }).lean();
  } else {
    const usr = await User2.findOne({ id: userRecord.userId }).lean();
    userRecord = { ...usr, ...userRecord };
  }

  if (!userRecord) {
    throw new ApiError(401, "Invalid refresh token");
  }

  if (!userRecord.isActive) {
    throw new ApiError(403, "Account is inactive", null, "ACCOUNT_INACTIVE");
  }

  const newAccessToken = createAccessToken(userRecord);
  res.status(200).json({
    accessToken: newAccessToken,
    sessionId: dbToken.id,
    user: buildStudentProfilePayload(userRecord),
  });
});

const logout = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.[STUDENT_REFRESH_COOKIE] || req.body?.refreshToken;

  if (refreshToken) {
    const StudentRefreshToken3 = (await models.init()).StudentRefreshToken;
    await StudentRefreshToken3.updateMany({ token: refreshToken, revokedAt: null }, { $set: { revokedAt: new Date() } });
    await invalidateRefreshToken("student", refreshToken);
  }

  res.clearCookie(STUDENT_REFRESH_COOKIE, {
    ...getRefreshCookieOptions(),
    maxAge: undefined,
  });

  res.status(200).json({ message: "Logged out" });
});

const me = asyncHandler(async (req, res) => {
  const user = req.user;
  res.status(200).json(buildStudentProfilePayload(user));
});

module.exports = {
  login,
  refresh,
  logout,
  me,
};
