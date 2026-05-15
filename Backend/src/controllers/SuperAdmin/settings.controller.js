const models = require("../../models");
const { createAuditLog } = require("../../services/audit.service");
const { asyncHandler } = require("../../utils/http");

const SETTINGS_KEY = "platform.defaults";

const getPlatformSettings = asyncHandler(async (_req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const settings = await db.platformSetting.findUnique({
    where: { key: SETTINGS_KEY },
  });

  if (!settings) {
    return res.status(200).json({
      key: SETTINGS_KEY,
      value: {
        maxAttemptsDefault: 1,
        defaultViolationLimit: 3,
        globalRules: {},
      },
    });
  }

  res.status(200).json(settings);
});

const updatePlatformSettings = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const existing = await db.platformSetting.findUnique({ where: { key: SETTINGS_KEY } });

  const nextValue = {
    maxAttemptsDefault: req.body.maxAttemptsDefault ?? existing?.value?.maxAttemptsDefault ?? 1,
    defaultViolationLimit: req.body.defaultViolationLimit ?? existing?.value?.defaultViolationLimit ?? 3,
    globalRules: req.body.globalRules ?? existing?.value?.globalRules ?? {},
  };

  const settings = await db.platformSetting.upsert({
    where: { key: SETTINGS_KEY },
    update: {
      value: nextValue,
      updatedById: req.superAdmin.id,
    },
    create: {
      key: SETTINGS_KEY,
      value: nextValue,
      updatedById: req.superAdmin.id,
    },
  });

  await createAuditLog({
    action: "SUPER_ADMIN_UPDATE_PLATFORM_SETTINGS",
    targetType: "PLATFORM_SETTING",
    targetId: settings.id,
    superAdminId: req.superAdmin.id,
    beforeState: existing?.value || null,
    afterState: settings.value,
  });

  res.status(200).json(settings);
});

module.exports = {
  getPlatformSettings,
  updatePlatformSettings,
};
