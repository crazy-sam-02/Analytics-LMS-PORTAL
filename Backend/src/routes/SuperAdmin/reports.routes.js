const express = require("express");
const env = require("../../config/env");
const validate = require("../../middleware/validate");
const { authenticateSuperAdmin } = require("../../middleware/auth");
const { createRateLimiter } = require("../../middleware/rate-limit");
const { createSuperReportSchema, reportJobParamSchema } = require("../../schemas/SuperAdmin/super-admin-core.schema");
const {
	generateSuperReport,
	getSuperReportAnalytics,
	getSuperReportJobs,
	downloadSuperReport,
	regenerateSuperReportLink,
	getEscalatedAnomalies,
} = require("../../controllers/SuperAdmin/reports.controller");

const router = express.Router();

const superReportLimiter = createRateLimiter({
	scope: "super-report",
	routeLabel: "/api/super-admin/reports/*",
	windowMs: env.rateLimit.superReportWindowMs,
	max: env.rateLimit.superReportMax,
	failOpen: false,
	message: "Super admin reports are rate limited. Please wait a moment and retry.",
});

const superReportReadLimiter = createRateLimiter({
	scope: "super-report-read",
	routeLabel: "/api/super-admin/reports/*",
	windowMs: env.rateLimit.superReportReadWindowMs,
	max: env.rateLimit.superReportReadMax,
	message: "Super admin report reads are rate limited. Please wait a moment and retry.",
});

router.post("/generate", authenticateSuperAdmin, superReportLimiter, validate(createSuperReportSchema), generateSuperReport);
router.get("/", authenticateSuperAdmin, superReportReadLimiter, getSuperReportJobs);
router.get("/analytics", authenticateSuperAdmin, superReportReadLimiter, getSuperReportAnalytics);
router.get("/anomalies/escalations", authenticateSuperAdmin, superReportReadLimiter, getEscalatedAnomalies);
router.post("/jobs/:reportJobId/regenerate-link", authenticateSuperAdmin, superReportLimiter, validate(reportJobParamSchema), regenerateSuperReportLink);
router.get("/:reportJobId/download", authenticateSuperAdmin, superReportReadLimiter, validate(reportJobParamSchema), downloadSuperReport);

module.exports = router;
