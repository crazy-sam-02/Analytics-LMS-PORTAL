const express = require("express");
const validate = require("../../middleware/validate");
const { authenticateAdmin } = require("../../middleware/auth");
const { requirePermission } = require("../../middleware/permissions");
const {
	createAdminTestSchema,
	updateAdminTestSchema,
	testIdParamSchema,
	transitionTestStatusSchema,
	forceSubmitAttemptSchema,
	extendAttemptTimeSchema,
} = require("../../schemas/Admin/admin-tests.schema");
const { testAssignBatchSchema } = require("../../schemas/Admin/admin-core.schema");
const {
	createTest,
	getTests,
	duplicateTest,
	updateTest,
	deleteTest,
	publishTest,
	archiveTest,
	transitionTestStatus,
	getLiveMonitoring,
	forceSubmitAttempt,
	extendAttemptTime,
} = require("../../controllers/Admin/tests.controller");
const { assignTestToBatch } = require("../../controllers/Admin/batches.controller");

const router = express.Router();

router.get("/", authenticateAdmin, getTests);
router.post("/", authenticateAdmin, requirePermission("create_test", "manage_questions"), validate(createAdminTestSchema), createTest);
router.post("/:testId/duplicate", authenticateAdmin, requirePermission("create_test", "edit_test"), validate(testIdParamSchema), duplicateTest);
router.patch("/:testId", authenticateAdmin, requirePermission("edit_test"), validate(updateAdminTestSchema), updateTest);
router.patch("/:testId/status", authenticateAdmin, requirePermission("edit_test"), validate(transitionTestStatusSchema), transitionTestStatus);
router.patch("/:testId/archive", authenticateAdmin, requirePermission("edit_test"), validate(testIdParamSchema), archiveTest);
router.delete("/:testId", authenticateAdmin, requirePermission("delete_test"), validate(testIdParamSchema), deleteTest);
router.post("/:testId/publish", authenticateAdmin, requirePermission("publish_test"), validate(testIdParamSchema), publishTest);
router.get("/:testId/monitoring", authenticateAdmin, requirePermission("edit_test"), validate(testIdParamSchema), getLiveMonitoring);
router.post("/:testId/monitoring/force-submit", authenticateAdmin, requirePermission("edit_test"), validate(forceSubmitAttemptSchema), forceSubmitAttempt);
router.post("/:testId/monitoring/extend-time", authenticateAdmin, requirePermission("edit_test"), validate(extendAttemptTimeSchema), extendAttemptTime);
router.post("/:testId/assign-batch", authenticateAdmin, requirePermission("edit_test", "manage_batches"), validate(testAssignBatchSchema), assignTestToBatch);

module.exports = router;
