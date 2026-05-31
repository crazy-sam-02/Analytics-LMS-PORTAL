const express = require("express");
const validate = require("../../middleware/validate");
const { authenticatePlatformAdmin } = require("../../middleware/auth");
const { adminLoginSchema, adminRefreshSchema } = require("../../schemas/Admin/admin-auth.schema");
const { adminLogin, adminRefresh, adminLogout, adminMe } = require("../../controllers/Admin/auth.controller");

const router = express.Router();

router.post("/login", validate(adminLoginSchema), adminLogin);
router.post("/refresh", validate(adminRefreshSchema), adminRefresh);
router.post("/logout", adminLogout);
router.get("/me", authenticatePlatformAdmin, adminMe);

module.exports = router;


