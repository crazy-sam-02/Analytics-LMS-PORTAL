const db = require("../config/db");
const { TokenExpiredError, JsonWebTokenError, NotBeforeError } = require("jsonwebtoken");
const { verifyAccessToken } = require("../utils/token");
const { ApiError, asyncHandler } = require("../utils/http");
const { resolveAdminPermissions } = require("../constants/admin-access-profiles");
const { getCachedUser, setCachedUser } = require("../services/auth-cache.service");

const parseTokenPayload = (req) => {
  const authHeader = req.headers.authorization || "";

  if (!authHeader.startsWith("Bearer ")) {
    throw new ApiError(401, "Authentication required");
  }

  const token = authHeader.replace("Bearer ", "").trim();

  try {
    return verifyAccessToken(token);
  } catch (error) {
    if (error instanceof TokenExpiredError) {
      throw new ApiError(401, "Access token expired", { expiredAt: error.expiredAt }, "TOKEN_EXPIRED");
    }

    if (error instanceof JsonWebTokenError || error instanceof NotBeforeError) {
      throw new ApiError(401, "Invalid access token", null, "INVALID_TOKEN");
    }

    throw error;
  }
};

const authenticateStudent = asyncHandler(async (req, _res, next) => {
  const payload = parseTokenPayload(req);

  if (payload.role && payload.role !== "STUDENT") {
    throw new ApiError(403, "Student role required");
  }

  req.authIdentity = `user:STUDENT:${payload.sub}`;

  // Cache-aside: check Redis/memory cache before hitting MongoDB.
  let user = await getCachedUser("student", payload.sub);

  if (!user) {
    user = await db.student.findUnique({
      where: { id: payload.sub },
      include: {
        batches: true,
        department: true,
        college: true,
      },
    });

    if (user) {
      // Normalize batchId / batchIds into a consistent batchIds array.
      // Students may have a singular batchId (legacy) or a batchIds array.
      const rawBatchIds = Array.isArray(user.batchIds) ? user.batchIds : [];
      const singleBatchId = user.batchId || null;
      const merged = [...new Set([...rawBatchIds, singleBatchId].filter(Boolean))];
      user.batchIds = merged;

      // Cache for subsequent requests (passwordHash is stripped automatically).
      await setCachedUser("student", payload.sub, user);
    }
  }

  if (!user) {
    throw new ApiError(401, "Invalid access token");
  }

  // Validate token department claim (defense-in-depth)
  if (payload.departmentId && user.departmentId && String(payload.departmentId) !== String(user.departmentId)) {
    throw new ApiError(401, "Invalid access token");
  }

  if (!user.isActive) {
    throw new ApiError(403, "Account is inactive", null, "ACCOUNT_INACTIVE");
  }

  req.user = user;
  next();
});

const authenticateAdmin = asyncHandler(async (req, _res, next) => {
  const payload = parseTokenPayload(req);

  if (payload.role !== "ADMIN") {
    throw new ApiError(403, "Admin role required");
  }

  req.authIdentity = `user:ADMIN:${payload.sub}`;

  // Cache-aside: check Redis/memory cache before hitting MongoDB.
  let admin = await getCachedUser("admin", payload.sub);

  if (!admin) {
    admin = await db.admin.findUnique({
      where: { id: payload.sub },
      include: {
        department: true,
        college: true,
      },
    });

    if (admin) {
      await setCachedUser("admin", payload.sub, admin);
    }
  }

  if (!admin || !admin.isActive) {
    throw new ApiError(401, "Invalid access token");
  }

  if (!admin.collegeId || !admin.departmentId) {
    throw new ApiError(403, "Admin must be assigned to a college and department", null, "ADMIN_SCOPE_REQUIRED");
  }

  // Validate token department claim
  if (payload.departmentId && admin.departmentId && String(payload.departmentId) !== String(admin.departmentId)) {
    throw new ApiError(401, "Invalid access token");
  }

  req.admin = admin;
  req.collegeId = admin.collegeId;
  req.collegeFilter = { collegeId: admin.collegeId };
  req.admin.permissions = resolveAdminPermissions(admin);
  next();
});

const authenticateSuperAdmin = asyncHandler(async (req, _res, next) => {
  const payload = parseTokenPayload(req);

  if (payload.role !== "SUPER_ADMIN") {
    throw new ApiError(403, "Super admin role required");
  }

  req.authIdentity = `user:SUPER_ADMIN:${payload.sub}`;

  // Cache-aside: check Redis/memory cache before hitting MongoDB.
  let superAdmin = await getCachedUser("superadmin", payload.sub);

  if (!superAdmin) {
    superAdmin = await db.superAdmin.findUnique({
      where: { id: payload.sub },
    });

    if (superAdmin) {
      await setCachedUser("superadmin", payload.sub, superAdmin);
    }
  }

  if (!superAdmin || !superAdmin.isActive) {
    throw new ApiError(401, "Invalid access token");
  }

  req.superAdmin = superAdmin;
  next();
});

const requireSameCollege = (fieldName = "collegeId") =>
  asyncHandler(async (req, _res, next) => {
    const bodyCollegeId = req.body?.[fieldName];
    const paramsCollegeId = req.params?.[fieldName];
    const queryCollegeId = req.query?.[fieldName];
    const candidate = bodyCollegeId || paramsCollegeId || queryCollegeId;

    if (candidate && candidate !== req.collegeId) {
      throw new ApiError(403, "Cross-college access denied");
    }

    next();
  });

module.exports = {
  authenticate: authenticateStudent,
  authenticateStudent,
  authenticateAdmin,
  authenticateSuperAdmin,
  requireSameCollege,
};
