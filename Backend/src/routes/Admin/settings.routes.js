const express = require("express");
const validate = require("../../middleware/validate");
const { authenticateAdmin } = require("../../middleware/auth");
const { updateAdminSettingsSchema, changeAdminPasswordSchema } = require("../../schemas/Admin/admin-core.schema");
const { getAdminSettings, updateAdminSettings, changeAdminPassword } = require("../../controllers/Admin/settings.controller");

const router = express.Router();

router.get("/", authenticateAdmin, getAdminSettings);
router.patch("/", authenticateAdmin, validate(updateAdminSettingsSchema), updateAdminSettings);
router.patch("/password", authenticateAdmin, validate(changeAdminPasswordSchema), changeAdminPassword);

module.exports = router;
