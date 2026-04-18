const express = require("express");
const { authenticateAdmin } = require("../../middleware/auth");
const { getAdminDashboard } = require("../../controllers/Admin/dashboard.controller");

const router = express.Router();

router.get("/summary", authenticateAdmin, getAdminDashboard);

module.exports = router;
