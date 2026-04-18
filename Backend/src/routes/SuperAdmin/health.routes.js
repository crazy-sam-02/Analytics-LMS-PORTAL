const express = require("express");
const { authenticateSuperAdmin } = require("../../middleware/auth");
const { getSystemHealth } = require("../../controllers/SuperAdmin/health.controller");

const router = express.Router();

router.get("/health", authenticateSuperAdmin, getSystemHealth);

module.exports = router;
