const express = require("express");
const env = require("../../config/env");
const validate = require("../../middleware/validate");
const { authenticateAdmin } = require("../../middleware/auth");
const { createRateLimiter } = require("../../middleware/rate-limit");
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

const adminBatchGuardLimiter = createRateLimiter({
	scope: "admin-batch-guard",
	routeLabel: "/api/admin/batches/:batchId/guarded",
	windowMs: env.rateLimit.adminBatchGuardWindowMs,
	max: env.rateLimit.adminBatchGuardMax,
	message: "Batch safety checks are rate limited. Please wait a moment and retry.",
});

router.get("/", authenticateAdmin, requireAnyPermission("manage_batches", "view_batches"), batchesValidationController.getBatches);
router.get("/:batchId", authenticateAdmin, adminBatchGuardLimiter, requireAnyPermission("manage_batches", "view_batches"), validate(batchIdParamSchema), batchesValidationController.getBatchDetail);
router.post("/", authenticateAdmin, requirePermission("manage_batches"), validate(createBatchSchema), batchesValidationController.createBatchHandler);
router.patch("/:batchId/students", authenticateAdmin, requirePermission("manage_batches", "manage_students"), validate(assignStudentsToBatchSchema), batchesController.assignStudentsToBatch);
router.post("/:batchId/students/bulk", authenticateAdmin, requirePermission("manage_batches", "manage_students", "bulk_import"), validate(bulkBatchStudentsSchema), batchesController.bulkAddStudentsToBatch);
router.delete("/:batchId/students/:studentId", authenticateAdmin, adminBatchGuardLimiter, requirePermission("manage_batches", "manage_students"), validate(removeStudentFromBatchSchema), batchesController.removeStudentFromBatch);
router.patch("/:batchId/archive", authenticateAdmin, adminBatchGuardLimiter, requirePermission("manage_batches"), validate(batchIdParamSchema), batchesController.archiveBatch);
router.delete("/:batchId", authenticateAdmin, requirePermission("manage_batches"), batchesController.deleteBatch);

module.exports = router;
