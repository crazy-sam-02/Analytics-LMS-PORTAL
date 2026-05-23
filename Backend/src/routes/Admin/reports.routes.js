const express = require("express");
const env = require("../../config/env");
const validate = require("../../middleware/validate");
const { authenticateAdmin } = require("../../middleware/auth");
const { createRateLimiter } = require("../../middleware/rate-limit");
const { requirePermission } = require("../../middleware/permissions");
const { requireSameDepartment } = require("../../middleware/department-guard");
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
  failOpen: false,
  message: "Report generation is rate limited. Please try again shortly.",
});

const adminReportReadLimiter = createRateLimiter({
  scope: "admin-report-read",
  routeLabel: "/api/admin/reports/*",
  windowMs: env.rateLimit.adminReportReadWindowMs,
  max: env.rateLimit.adminReportReadMax,
  failOpen: false,
  message: "Report analytics are rate limited. Please wait a moment and retry.",
});

router.get("/", authenticateAdmin, requirePermission("view_reports"), getReportJobs);
router.get("/summary", authenticateAdmin, adminReportReadLimiter, requirePermission("view_reports"), requireSameDepartment(), validate(reportDashboardQuerySchema), getReportSummaryDashboard);
router.get("/charts", authenticateAdmin, adminReportReadLimiter, requirePermission("view_reports"), requireSameDepartment(), validate(reportDashboardQuerySchema), getReportChartsDashboard);
router.get("/table", authenticateAdmin, adminReportReadLimiter, requirePermission("view_reports"), requireSameDepartment(), validate(reportDashboardQuerySchema), getReportTableDashboard);
router.get("/student/:studentId", authenticateAdmin, adminReportReadLimiter, requirePermission("view_reports"), validate(reportStudentDetailDashboardSchema), getReportStudentDetailDashboard);
router.get("/analytics", authenticateAdmin, adminReportReadLimiter, requirePermission("view_reports"), requireSameDepartment(), validate(reportAnalyticsQuerySchema), getReportAnalytics);
router.get("/jobs/:reportJobId/status", authenticateAdmin, adminReportReadLimiter, requirePermission("view_reports"), validate(reportJobStatusParamSchema), getReportJobStatus);
router.get("/:reportJobId/download", authenticateAdmin, adminReportReadLimiter, requirePermission("export_reports"), downloadReport);
router.post("/jobs/:reportJobId/regenerate-link", authenticateAdmin, reportGenerationLimiter, requirePermission("export_reports"), regenerateReportLink);
router.post("/anomalies/review", authenticateAdmin, requirePermission("view_reports"), validate(reviewReportAnomalySchema), reviewAnomaly);
router.post(
	"/generate",
	authenticateAdmin,
	reportGenerationLimiter,
	requirePermission("view_reports", "export_reports"),
	requireSameDepartment(),
	validate(generateReportSchema),
	generateReport
);

router.post(
	"/export",
	authenticateAdmin,
	reportGenerationLimiter,
	requirePermission("view_reports", "export_reports"),
	requireSameDepartment(),
	validate(generateReportSchema),
	generateReport
);

module.exports = router;
