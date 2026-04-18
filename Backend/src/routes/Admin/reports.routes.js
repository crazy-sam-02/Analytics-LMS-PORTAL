const express = require("express");
const validate = require("../../middleware/validate");
const { authenticateAdmin } = require("../../middleware/auth");
const { requirePermission } = require("../../middleware/permissions");
const { generateReportSchema, reviewReportAnomalySchema, reportAnalyticsQuerySchema, reportJobStatusParamSchema } = require("../../schemas/Admin/admin-core.schema");
const {
	generateReport,
	getReportJobs,
	getReportJobStatus,
	getReportAnalytics,
	downloadReport,
	regenerateReportLink,
	reviewAnomaly,
} = require("../../controllers/Admin/reports.controller");

const router = express.Router();

router.get("/", authenticateAdmin, requirePermission("view_reports"), getReportJobs);
router.get("/analytics", authenticateAdmin, requirePermission("view_reports"), validate(reportAnalyticsQuerySchema), getReportAnalytics);
router.get("/jobs/:reportJobId/status", authenticateAdmin, requirePermission("view_reports"), validate(reportJobStatusParamSchema), getReportJobStatus);
router.get("/:reportJobId/download", authenticateAdmin, requirePermission("export_reports"), downloadReport);
router.post("/jobs/:reportJobId/regenerate-link", authenticateAdmin, requirePermission("export_reports"), regenerateReportLink);
router.post("/anomalies/review", authenticateAdmin, requirePermission("view_reports"), validate(reviewReportAnomalySchema), reviewAnomaly);
router.post(
	"/generate",
	authenticateAdmin,
	requirePermission("view_reports", "export_reports"),
	validate(generateReportSchema),
	generateReport
);

router.post(
	"/export",
	authenticateAdmin,
	requirePermission("view_reports", "export_reports"),
	validate(generateReportSchema),
	generateReport
);

module.exports = router;
