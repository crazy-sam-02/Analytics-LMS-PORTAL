const { ADMIN_PERMISSIONS } = require("./admin-permissions");

const ADMIN_ACCESS_PROFILES = {
  VIEW_ONLY: "VIEW_ONLY",
  EDITOR: "EDITOR",
};

const VIEW_ONLY_PERMISSIONS = [
  "view_reports",
  "view_tests",
  "view_batches",
  "view_students",
  "view_events",
  "view_question_bank",
];

const resolveAdminPermissions = (admin) => {
  if (Array.isArray(admin?.permissions) && admin.permissions.length > 0) {
    return admin.permissions;
  }

  if (admin?.accessProfile === ADMIN_ACCESS_PROFILES.VIEW_ONLY) {
    return VIEW_ONLY_PERMISSIONS;
  }

  return ADMIN_PERMISSIONS;
};

const resolvePermissionsFromProfile = (accessProfile) => {
  if (accessProfile === ADMIN_ACCESS_PROFILES.VIEW_ONLY) {
    return VIEW_ONLY_PERMISSIONS;
  }

  return ADMIN_PERMISSIONS;
};

module.exports = {
  ADMIN_ACCESS_PROFILES,
  VIEW_ONLY_PERMISSIONS,
  resolveAdminPermissions,
  resolvePermissionsFromProfile,
};
