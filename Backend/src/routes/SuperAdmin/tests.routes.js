const express = require("express");
const validate = require("../../middleware/validate");
const { authenticateSuperAdmin } = require("../../middleware/auth");
const {
	paginationQuerySchema,
	createGlobalTestSchema,
	cloneTestSchema,
	testIdParamSchema,
	updateGlobalTestSchema,
	transitionGlobalTestStatusSchema,
} = require("../../schemas/SuperAdmin/super-admin-core.schema");
const {
	getTestsGlobal,
	getGlobalTestById,
	createGlobalTest,
	cloneTestToCollege,
	updateGlobalTest,
	transitionGlobalTestStatus,
	deactivateTest,
} = require("../../controllers/SuperAdmin/tests.controller");

const router = express.Router();

router.get("/", authenticateSuperAdmin, validate(paginationQuerySchema), getTestsGlobal);
router.get("/:testId", authenticateSuperAdmin, validate(testIdParamSchema), getGlobalTestById);
router.post("/global", authenticateSuperAdmin, validate(createGlobalTestSchema), createGlobalTest);
router.post("/:testId/clone", authenticateSuperAdmin, validate(cloneTestSchema), cloneTestToCollege);
router.patch("/:testId", authenticateSuperAdmin, validate(updateGlobalTestSchema), updateGlobalTest);
router.patch("/:testId/status", authenticateSuperAdmin, validate(transitionGlobalTestStatusSchema), transitionGlobalTestStatus);
router.delete("/:testId", authenticateSuperAdmin, deactivateTest);

module.exports = router;
