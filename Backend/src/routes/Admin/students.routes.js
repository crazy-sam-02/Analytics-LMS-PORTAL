const express = require("express");
const validate = require("../../middleware/validate");
const { authenticateAdmin } = require("../../middleware/auth");
const { requireAnyPermission, requirePermission } = require("../../middleware/permissions");
const {
	studentFiltersSchema,
	createStudentSchema,
	assignStudentBatchSchema,
	studentIdParamSchema,
	studentBulkImportSchema,
	studentBulkImportJobParamSchema,
} = require("../../schemas/Admin/admin-core.schema");
const studentsValidationController = require("../../controllers/Admin/students-with-validation.controller");
const studentsController = require("../../controllers/Admin/students.controller");

const router = express.Router();

router.get("/", authenticateAdmin, requireAnyPermission("manage_students", "view_students"), validate(studentFiltersSchema), studentsValidationController.getStudents);
router.post("/", authenticateAdmin, requirePermission("manage_students"), validate(createStudentSchema), studentsController.createStudent);
router.post("/bulk-import", authenticateAdmin, requirePermission("manage_students", "bulk_import"), validate(studentBulkImportSchema), studentsController.bulkImportStudents);
router.get("/import-jobs/:jobId", authenticateAdmin, requirePermission("manage_students", "bulk_import"), validate(studentBulkImportJobParamSchema), studentsController.getStudentImportJob);
router.get("/:studentId", authenticateAdmin, requireAnyPermission("manage_students", "view_students"), validate(studentIdParamSchema), studentsController.getStudentProfile);
router.get("/:studentId/performance", authenticateAdmin, requireAnyPermission("manage_students", "view_students"), requirePermission("view_reports"), studentsController.getStudentPerformance);
router.patch("/:studentId/assign-batch", authenticateAdmin, requirePermission("manage_students", "manage_batches"), validate(assignStudentBatchSchema), studentsController.assignStudentToBatch);

module.exports = router;
