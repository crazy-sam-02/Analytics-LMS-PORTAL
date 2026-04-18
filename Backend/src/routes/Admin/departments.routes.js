const express = require("express");
const { authenticateAdmin } = require("../../middleware/auth");
const { requirePermission } = require("../../middleware/permissions");
const { getDepartments } = require("../../controllers/Admin/departments.controller");

const router = express.Router();

router.get("/", authenticateAdmin, requirePermission("manage_batches"), getDepartments);

module.exports = router;
