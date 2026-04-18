const express = require("express");
const validate = require("../../middleware/validate");
const { authenticateSuperAdmin } = require("../../middleware/auth");
const { superAdminLoginSchema, superAdminRefreshSchema } = require("../../schemas/SuperAdmin/super-admin-auth.schema");
const { superAdminLogin, superAdminRefresh, superAdminLogout, superAdminMe } = require("../../controllers/SuperAdmin/auth.controller");

const router = express.Router();

router.post("/login", validate(superAdminLoginSchema), superAdminLogin);
router.post("/refresh", validate(superAdminRefreshSchema), superAdminRefresh);
router.post("/logout", superAdminLogout);
router.get("/me", authenticateSuperAdmin, superAdminMe);

module.exports = router;
