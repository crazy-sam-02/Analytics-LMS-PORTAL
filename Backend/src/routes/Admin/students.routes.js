const express = require("express");
const validate = require("../../middleware/validate");
const { authenticateAdmin } = require("../../middleware/auth");
const { requirePermission } = require("../../middleware/permissions");
const {
	studentFiltersSchema,
	createStudentSchema,
	assignStudentBatchSchema,
	studentIdParamSchema,
	studentBulkImportSchema,
	studentBulkImportJobParamSchema,
} = require("../../schemas/Admin/admin-core.schema");
const {
	getStudents,
	createStudent,
	getStudentPerformance,
	getStudentProfile,
	assignStudentToBatch,
	bulkImportStudents,
	getStudentImportJob,
} = require("../../controllers/Admin/students.controller");

const router = express.Router();

router.get("/", authenticateAdmin, requirePermission("manage_students"), validate(studentFiltersSchema), getStudents);
router.post("/", authenticateAdmin, requirePermission("manage_students"), validate(createStudentSchema), createStudent);
router.get("/:studentId", authenticateAdmin, requirePermission("manage_students"), validate(studentIdParamSchema), getStudentProfile);
router.get("/:studentId/performance", authenticateAdmin, requirePermission("manage_students", "view_reports"), getStudentPerformance);
router.patch("/:studentId/assign-batch", authenticateAdmin, requirePermission("manage_students", "manage_batches"), validate(assignStudentBatchSchema), assignStudentToBatch);
router.post("/bulk-import", authenticateAdmin, requirePermission("manage_students", "bulk_import"), validate(studentBulkImportSchema), bulkImportStudents);
router.get("/import-jobs/:jobId", authenticateAdmin, requirePermission("manage_students", "bulk_import"), validate(studentBulkImportJobParamSchema), getStudentImportJob);

module.exports = router;
