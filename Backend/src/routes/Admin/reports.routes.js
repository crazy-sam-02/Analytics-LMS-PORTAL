const express = require("express");
const env = require("../../config/env");
const validate = require("../../middleware/validate");
const { authenticatePlatformAdmin } = require("../../middleware/auth");
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
	getPassoutCohorts,
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

router.get("/", authenticatePlatformAdmin, adminReportReadLimiter, requirePermission("view_reports"), getReportJobs);
router.get("/passout-cohorts", authenticatePlatformAdmin, adminReportReadLimiter, requirePermission("view_reports"), getPassoutCohorts);
router.get("/summary", authenticatePlatformAdmin, adminReportReadLimiter, requirePermission("view_reports"), requireSameDepartment(), validate(reportDashboardQuerySchema), getReportSummaryDashboard);
router.get("/charts", authenticatePlatformAdmin, adminReportReadLimiter, requirePermission("view_reports"), requireSameDepartment(), validate(reportDashboardQuerySchema), getReportChartsDashboard);
router.get("/table", authenticatePlatformAdmin, adminReportReadLimiter, requirePermission("view_reports"), requireSameDepartment(), validate(reportDashboardQuerySchema), getReportTableDashboard);
router.get("/student/:studentId", authenticatePlatformAdmin, adminReportReadLimiter, requirePermission("view_reports"), validate(reportStudentDetailDashboardSchema), getReportStudentDetailDashboard);
router.get("/analytics", authenticatePlatformAdmin, adminReportReadLimiter, requirePermission("view_reports"), requireSameDepartment(), validate(reportAnalyticsQuerySchema), getReportAnalytics);
router.get("/jobs/:reportJobId/status", authenticatePlatformAdmin, adminReportReadLimiter, requirePermission("view_reports"), validate(reportJobStatusParamSchema), getReportJobStatus);
router.get("/:reportJobId/download", authenticatePlatformAdmin, adminReportReadLimiter, requirePermission("export_reports"), validate(reportJobStatusParamSchema), downloadReport);
router.post("/jobs/:reportJobId/regenerate-link", authenticatePlatformAdmin, reportGenerationLimiter, requirePermission("export_reports"), validate(reportJobStatusParamSchema), regenerateReportLink);
router.post("/anomalies/review", authenticatePlatformAdmin, requirePermission("view_reports"), validate(reviewReportAnomalySchema), reviewAnomaly);
router.post(
	"/generate",
	authenticatePlatformAdmin,
	reportGenerationLimiter,
	requirePermission("view_reports", "export_reports"),
	requireSameDepartment(),
	validate(generateReportSchema),
	generateReport
);

router.post(
	"/export",
	authenticatePlatformAdmin,
	reportGenerationLimiter,
	requirePermission("view_reports", "export_reports"),
	requireSameDepartment(),
	validate(generateReportSchema),
	generateReport
);

module.exports = router;
