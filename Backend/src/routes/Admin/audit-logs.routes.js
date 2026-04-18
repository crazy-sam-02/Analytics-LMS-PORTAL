const express = require("express");
const validate = require("../../middleware/validate");
const { authenticateAdmin } = require("../../middleware/auth");
const { requirePermission } = require("../../middleware/permissions");
const { auditLogQuerySchema } = require("../../schemas/Admin/admin-core.schema");
const { getAdminAuditLogs } = require("../../controllers/Admin/audit-logs.controller");

const router = express.Router();

router.get("/", authenticateAdmin, requirePermission("view_reports"), validate(auditLogQuerySchema), getAdminAuditLogs);

module.exports = router;
