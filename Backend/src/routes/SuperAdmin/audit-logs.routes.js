const express = require("express");
const validate = require("../../middleware/validate");
const { authenticateSuperAdmin } = require("../../middleware/auth");
const { paginationQuerySchema } = require("../../schemas/SuperAdmin/super-admin-core.schema");
const { getAuditLogs } = require("../../controllers/SuperAdmin/audit-logs.controller");

const router = express.Router();

router.get("/", authenticateSuperAdmin, validate(paginationQuerySchema), getAuditLogs);

module.exports = router;
