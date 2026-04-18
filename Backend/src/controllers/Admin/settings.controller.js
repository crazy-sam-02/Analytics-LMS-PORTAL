const bcrypt = require("bcrypt");
const prisma = require("../../config/db");
const { createAuditLog } = require("../../services/audit.service");
const { asyncHandler, ApiError } = require("../../utils/http");

const settingsKey = (collegeId) => `college.${collegeId}.admin.defaults`;

const defaultSettings = {
  defaultTestConfig: {
    durationMins: 60,
    attemptsAllowed: 1,
    violationThreshold: 3,
    evaluationRule: "BEST_ATTEMPT",
  },
  collegeSettings: {
    allowBatchArchive: true,
    registrationPolicy: "OPEN",
    reportRetentionDays: 365,
  },
};

const getAdminSettings = asyncHandler(async (req, res) => {
  const key = settingsKey(req.collegeId);

  const [profile, collegeSettings] = await Promise.all([
    prisma.admin.findFirst({
      where: {
        id: req.admin.id,
        collegeId: req.collegeId,
      },
      include: {
        college: true,
        department: true,
      },
    }),
    prisma.platformSetting.findUnique({ where: { key } }),
  ]);

  if (!profile) {
    throw new ApiError(404, "Admin profile not found");
  }

  res.status(200).json({
    profile: {
      id: profile.id,
      fullName: profile.fullName,
      email: profile.email,
      employeeId: profile.employeeId,
      role: profile.role,
      college: profile.college,
      department: profile.department,
    },
    settings: collegeSettings?.value || defaultSettings,
  });
});

const updateAdminSettings = asyncHandler(async (req, res) => {
  const key = settingsKey(req.collegeId);
  const existing = await prisma.platformSetting.findUnique({ where: { key } });

  const nextValue = {
    defaultTestConfig: {
      ...defaultSettings.defaultTestConfig,
      ...(existing?.value?.defaultTestConfig || {}),
      ...(req.body.defaultTestConfig || {}),
    },
    collegeSettings: {
      ...defaultSettings.collegeSettings,
      ...(existing?.value?.collegeSettings || {}),
      ...(req.body.collegeSettings || {}),
    },
  };

  const updated = await prisma.platformSetting.upsert({
    where: { key },
    update: {
      value: nextValue,
      updatedById: req.admin.id,
    },
    create: {
      key,
      value: nextValue,
      updatedById: req.admin.id,
    },
  });

  await createAuditLog({
    action: "ADMIN_SETTINGS_UPDATED",
    targetType: "COLLEGE_SETTING",
    targetId: updated.id,
    collegeId: req.collegeId,
    adminId: req.admin.id,
    beforeState: existing?.value || null,
    afterState: updated.value,
  });

  res.status(200).json({
    key: updated.key,
    value: updated.value,
  });
});

const changeAdminPassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const admin = await prisma.admin.findFirst({
    where: {
      id: req.admin.id,
      collegeId: req.collegeId,
    },
  });

  if (!admin) {
    throw new ApiError(404, "Admin not found");
  }

  const matches = await bcrypt.compare(currentPassword, admin.passwordHash);
  if (!matches) {
    throw new ApiError(400, "Current password is incorrect");
  }

  const nextHash = await bcrypt.hash(newPassword, 10);
  await prisma.admin.update({
    where: { id: admin.id },
    data: { passwordHash: nextHash },
  });

  await createAuditLog({
    action: "ADMIN_PASSWORD_CHANGED",
    targetType: "ADMIN",
    targetId: admin.id,
    collegeId: req.collegeId,
    adminId: req.admin.id,
  });

  res.status(200).json({ message: "Password updated" });
});

module.exports = {
  getAdminSettings,
  updateAdminSettings,
  changeAdminPassword,
};
