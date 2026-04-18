const express = require("express");
const validate = require("../../middleware/validate");
const { authenticateSuperAdmin } = require("../../middleware/auth");
const { createSuperReportSchema, reportJobParamSchema } = require("../../schemas/SuperAdmin/super-admin-core.schema");
const {
	generateSuperReport,
	getSuperReportJobs,
	downloadSuperReport,
	regenerateSuperReportLink,
	getEscalatedAnomalies,
} = require("../../controllers/SuperAdmin/reports.controller");

const router = express.Router();

router.post("/generate", authenticateSuperAdmin, validate(createSuperReportSchema), generateSuperReport);
router.get("/", authenticateSuperAdmin, getSuperReportJobs);
router.get("/anomalies/escalations", authenticateSuperAdmin, getEscalatedAnomalies);
router.post("/jobs/:reportJobId/regenerate-link", authenticateSuperAdmin, validate(reportJobParamSchema), regenerateSuperReportLink);
router.get("/:reportJobId/download", authenticateSuperAdmin, validate(reportJobParamSchema), downloadSuperReport);

module.exports = router;
