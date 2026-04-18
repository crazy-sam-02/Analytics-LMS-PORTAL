const express = require("express");
const validate = require("../../middleware/validate");
const { authenticateSuperAdmin } = require("../../middleware/auth");
const {
	paginationQuerySchema,
	assignTestToBatchesSchema,
	createBatchGlobalSchema,
	updateBatchGlobalSchema,
	deleteBatchGlobalSchema,
} = require("../../schemas/SuperAdmin/super-admin-core.schema");
const {
	getBatchesGlobal,
	assignTestToBatches,
	createBatchGlobal,
	updateBatchGlobal,
	deleteBatchGlobal,
} = require("../../controllers/SuperAdmin/batches.controller");

const router = express.Router();

router.get("/", authenticateSuperAdmin, validate(paginationQuerySchema), getBatchesGlobal);
router.post("/", authenticateSuperAdmin, validate(createBatchGlobalSchema), createBatchGlobal);
router.post("/assign-test", authenticateSuperAdmin, validate(assignTestToBatchesSchema), assignTestToBatches);
router.patch("/:batchId", authenticateSuperAdmin, validate(updateBatchGlobalSchema), updateBatchGlobal);
router.delete("/:batchId", authenticateSuperAdmin, validate(deleteBatchGlobalSchema), deleteBatchGlobal);

module.exports = router;
