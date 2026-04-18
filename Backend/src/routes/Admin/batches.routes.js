const express = require("express");
const validate = require("../../middleware/validate");
const { authenticateAdmin } = require("../../middleware/auth");
const { requirePermission } = require("../../middleware/permissions");
const {
	createBatchSchema,
	assignStudentsToBatchSchema,
	batchIdParamSchema,
	bulkBatchStudentsSchema,
	removeStudentFromBatchSchema,
} = require("../../schemas/Admin/admin-core.schema");
const {
	getBatches,
	getBatchDetail,
	createBatch,
	assignStudentsToBatch,
	bulkAddStudentsToBatch,
	removeStudentFromBatch,
	archiveBatch,
	deleteBatch,
} = require("../../controllers/Admin/batches.controller");

const router = express.Router();

router.get("/", authenticateAdmin, requirePermission("manage_batches"), getBatches);
router.get("/:batchId", authenticateAdmin, requirePermission("manage_batches"), validate(batchIdParamSchema), getBatchDetail);
router.post("/", authenticateAdmin, requirePermission("manage_batches"), validate(createBatchSchema), createBatch);
router.patch("/:batchId/students", authenticateAdmin, requirePermission("manage_batches", "manage_students"), validate(assignStudentsToBatchSchema), assignStudentsToBatch);
router.post("/:batchId/students/bulk", authenticateAdmin, requirePermission("manage_batches", "manage_students", "bulk_import"), validate(bulkBatchStudentsSchema), bulkAddStudentsToBatch);
router.delete("/:batchId/students/:studentId", authenticateAdmin, requirePermission("manage_batches", "manage_students"), validate(removeStudentFromBatchSchema), removeStudentFromBatch);
router.patch("/:batchId/archive", authenticateAdmin, requirePermission("manage_batches"), validate(batchIdParamSchema), archiveBatch);
router.delete("/:batchId", authenticateAdmin, requirePermission("manage_batches"), deleteBatch);

module.exports = router;
