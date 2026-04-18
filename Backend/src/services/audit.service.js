const prisma = require("../config/db");

const createAuditLog = async ({
  action,
  targetType,
  targetId,
  collegeId = null,
  adminId = null,
  superAdminId = null,
  testId = null,
  beforeState = null,
  afterState = null,
}) => {
  return prisma.auditLog.create({
    data: {
      action,
      targetType,
      targetId,
      collegeId,
      adminId,
      superAdminId,
      testId,
      beforeState,
      afterState,
    },
  });
};

module.exports = {
  createAuditLog,
};
