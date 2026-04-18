const express = require("express");
const validate = require("../../middleware/validate");
const { authenticateAdmin } = require("../../middleware/auth");
const { requirePermission } = require("../../middleware/permissions");
const { reportJobStatusParamSchema } = require("../../schemas/Admin/admin-core.schema");
const { getReportJobStatus } = require("../../controllers/Admin/reports.controller");

const router = express.Router();

router.get("/:reportJobId/status", authenticateAdmin, requirePermission("view_reports"), validate(reportJobStatusParamSchema), getReportJobStatus);

module.exports = router;
