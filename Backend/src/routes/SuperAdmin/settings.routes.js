const express = require("express");
const validate = require("../../middleware/validate");
const { authenticateSuperAdmin } = require("../../middleware/auth");
const { updatePlatformSettingsSchema } = require("../../schemas/SuperAdmin/super-admin-core.schema");
const { getPlatformSettings, updatePlatformSettings } = require("../../controllers/SuperAdmin/settings.controller");

const router = express.Router();

router.get("/", authenticateSuperAdmin, getPlatformSettings);
router.patch("/", authenticateSuperAdmin, validate(updatePlatformSettingsSchema), updatePlatformSettings);

module.exports = router;
