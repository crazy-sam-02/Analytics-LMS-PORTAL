const express = require("express");
const env = require("../../config/env");
const validate = require("../../middleware/validate");
const { authenticateAdmin } = require("../../middleware/auth");
const { createRateLimiter } = require("../../middleware/rate-limit");
const { requirePermission } = require("../../middleware/permissions");
const {
	generateReportSchema,
	reviewReportAnomalySchema,
	reportAnalyticsQuerySchema,
	reportJobStatusParamSchema,
	reportDashboardQuerySchema,
	reportStudentDetailDashboardSchema,
} = require("../../schemas/Admin/admin-core.schema");
const {
	generateReport,
	getReportJobs,
	getReportJobStatus,
	getReportAnalytics,
	getReportSummaryDashboard,
	getReportChartsDashboard,
	getReportTableDashboard,
	getReportStudentDetailDashboard,
	downloadReport,
	regenerateReportLink,
	reviewAnomaly,
} = require("../../controllers/Admin/reports.controller");

const router = express.Router();

const reportGenerationLimiter = createRateLimiter({
  scope: "report-generation",
  routeLabel: "/api/admin/reports/generate",
	windowMs: env.rateLimit.reportGenerationWindowMs,
	max: env.rateLimit.reportGenerationMax,
  message: "Report generation is rate limited. Please try again shortly.",
});

router.get("/", authenticateAdmin, requirePermission("view_reports"), getReportJobs);
router.get("/summary", authenticateAdmin, requirePermission("view_reports"), validate(reportDashboardQuerySchema), getReportSummaryDashboard);
router.get("/charts", authenticateAdmin, requirePermission("view_reports"), validate(reportDashboardQuerySchema), getReportChartsDashboard);
router.get("/table", authenticateAdmin, requirePermission("view_reports"), validate(reportDashboardQuerySchema), getReportTableDashboard);
router.get("/student/:studentId", authenticateAdmin, requirePermission("view_reports"), validate(reportStudentDetailDashboardSchema), getReportStudentDetailDashboard);
router.get("/analytics", authenticateAdmin, requirePermission("view_reports"), validate(reportAnalyticsQuerySchema), getReportAnalytics);
router.get("/jobs/:reportJobId/status", authenticateAdmin, requirePermission("view_reports"), validate(reportJobStatusParamSchema), getReportJobStatus);
router.get("/:reportJobId/download", authenticateAdmin, requirePermission("export_reports"), downloadReport);
router.post("/jobs/:reportJobId/regenerate-link", authenticateAdmin, requirePermission("export_reports"), regenerateReportLink);
router.post("/anomalies/review", authenticateAdmin, requirePermission("view_reports"), validate(reviewReportAnomalySchema), reviewAnomaly);
router.post(
	"/generate",
	authenticateAdmin,
	reportGenerationLimiter,
	requirePermission("view_reports", "export_reports"),
	validate(generateReportSchema),
	generateReport
);

router.post(
	"/export",
	authenticateAdmin,
	reportGenerationLimiter,
	requirePermission("view_reports", "export_reports"),
	validate(generateReportSchema),
	generateReport
);

module.exports = router;
