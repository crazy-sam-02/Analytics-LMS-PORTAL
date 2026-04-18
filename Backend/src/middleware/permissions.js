const { ApiError } = require("../utils/http");

const requirePermission = (...permissions) => (req, _res, next) => {
  const effectivePermissions = Array.isArray(req.admin?.permissions) ? req.admin.permissions : [];
  const missing = permissions.filter((permission) => !effectivePermissions.includes(permission));

  if (missing.length > 0) {
    throw new ApiError(
      403,
      "Insufficient permissions for this action",
      { required: permissions, missing },
      "INSUFFICIENT_PERMISSIONS"
    );
  }

  next();
};

module.exports = {
  requirePermission,
};
