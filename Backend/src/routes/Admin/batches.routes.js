const express = require("express");
const validate = require("../../middleware/validate");
const { authenticateAdmin } = require("../../middleware/auth");
const { requireAnyPermission, requirePermission } = require("../../middleware/permissions");
const {
	createBatchSchema,
	assignStudentsToBatchSchema,
	batchIdParamSchema,
	bulkBatchStudentsSchema,
	removeStudentFromBatchSchema,
} = require("../../schemas/Admin/admin-core.schema");
const batchesValidationController = require("../../controllers/Admin/batches-with-validation.controller");
const batchesController = require("../../controllers/Admin/batches.controller");

const router = express.Router();

router.get("/", authenticateAdmin, requireAnyPermission("manage_batches", "view_batches"), batchesValidationController.getBatches);
router.get("/:batchId", authenticateAdmin, requireAnyPermission("manage_batches", "view_batches"), validate(batchIdParamSchema), batchesValidationController.getBatchDetail);
router.post("/", authenticateAdmin, requirePermission("manage_batches"), validate(createBatchSchema), batchesValidationController.createBatchHandler);
router.patch("/:batchId/students", authenticateAdmin, requirePermission("manage_batches", "manage_students"), validate(assignStudentsToBatchSchema), batchesController.assignStudentsToBatch);
router.post("/:batchId/students/bulk", authenticateAdmin, requirePermission("manage_batches", "manage_students", "bulk_import"), validate(bulkBatchStudentsSchema), batchesController.bulkAddStudentsToBatch);
router.delete("/:batchId/students/:studentId", authenticateAdmin, requirePermission("manage_batches", "manage_students"), validate(removeStudentFromBatchSchema), batchesController.removeStudentFromBatch);
router.patch("/:batchId/archive", authenticateAdmin, requirePermission("manage_batches"), validate(batchIdParamSchema), batchesController.archiveBatch);
router.delete("/:batchId", authenticateAdmin, requirePermission("manage_batches"), batchesController.deleteBatch);

module.exports = router;
