const express = require("express");
const validate = require("../../middleware/validate");
const { authenticateSuperAdmin } = require("../../middleware/auth");
const {
	paginationQuerySchema,
	toggleStudentStatusSchema,
	createStudentGlobalSchema,
	superStudentBulkImportSchema,
	superStudentBulkImportJobParamSchema,
} = require("../../schemas/SuperAdmin/super-admin-core.schema");
const {
	getStudentsGlobal,
	toggleStudentStatus,
	createStudentGlobal,
	bulkImportStudentsGlobal,
	getStudentImportJobGlobal,
} = require("../../controllers/SuperAdmin/students.controller");

const router = express.Router();

router.get("/", authenticateSuperAdmin, validate(paginationQuerySchema), getStudentsGlobal);
router.post("/", authenticateSuperAdmin, validate(createStudentGlobalSchema), createStudentGlobal);
router.post("/bulk-import", authenticateSuperAdmin, validate(superStudentBulkImportSchema), bulkImportStudentsGlobal);
router.get("/import-jobs/:jobId", authenticateSuperAdmin, validate(superStudentBulkImportJobParamSchema), getStudentImportJobGlobal);
router.patch("/:studentId/status", authenticateSuperAdmin, validate(toggleStudentStatusSchema), toggleStudentStatus);

module.exports = router;
