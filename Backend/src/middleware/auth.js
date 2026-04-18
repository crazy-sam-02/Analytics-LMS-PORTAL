const prisma = require("../config/db");
const { TokenExpiredError, JsonWebTokenError, NotBeforeError } = require("jsonwebtoken");
const { verifyAccessToken } = require("../utils/token");
const { ApiError, asyncHandler } = require("../utils/http");
const { ADMIN_PERMISSIONS } = require("../constants/admin-permissions");

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

  const user = await prisma.student.findUnique({
    where: { id: payload.sub },
    include: {
      batch: true,
      department: true,
      college: true,
    },
  });

  if (!user) {
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

  const admin = await prisma.admin.findUnique({
    where: { id: payload.sub },
    include: {
      department: true,
      college: true,
    },
  });

  if (!admin || !admin.isActive) {
    throw new ApiError(401, "Invalid access token");
  }

  req.admin = admin;
  req.collegeId = admin.collegeId;
  req.collegeFilter = { collegeId: admin.collegeId };
  req.admin.permissions = Array.isArray(admin.permissions) && admin.permissions.length > 0 ? admin.permissions : ADMIN_PERMISSIONS;
  next();
});

const authenticateSuperAdmin = asyncHandler(async (req, _res, next) => {
  const payload = parseTokenPayload(req);

  if (payload.role !== "SUPER_ADMIN") {
    throw new ApiError(403, "Super admin role required");
  }

  const superAdmin = await prisma.superAdmin.findUnique({
    where: { id: payload.sub },
  });

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
