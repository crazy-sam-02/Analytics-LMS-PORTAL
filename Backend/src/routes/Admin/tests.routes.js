const express = require("express");
const db = require("../../config/db");
const env = require("../../config/env");
const validate = require("../../middleware/validate");
const { authenticatePlatformAdmin } = require("../../middleware/auth");
const { createRateLimiter } = require("../../middleware/rate-limit");
const { requireSameDepartment, departmentMatch } = require("../../middleware/department-guard");
const { requireAnyPermission, requirePermission } = require("../../middleware/permissions");
const {
	createAdminTestSchema,
	updateAdminTestSchema,
	testIdParamSchema,
	transitionTestStatusSchema,
	forceSubmitAttemptSchema,
	extendAttemptTimeSchema,
} = require("../../schemas/Admin/admin-tests.schema");
const { testAssignBatchSchema, testAssignDepartmentSchema } = require("../../schemas/Admin/admin-core.schema");
const {
	createTest,
	getTests,
	getTestById,
	duplicateTest,
	cloneTest,
	updateTest,
	deleteTest,
	publishTest,
	archiveTest,
	transitionTestStatus,
	getLiveMonitoring,
	forceSubmitAttempt,
	extendAttemptTime,
} = require("../../controllers/Admin/tests.controller");
const { assignTestToBatch, assignTestToDepartment } = require("../../controllers/Admin/batches.controller");

const router = express.Router();

const adminTestListLimiter = createRateLimiter({
	scope: "admin-test-list",
	routeLabel: "/api/admin/tests",
	windowMs: env.rateLimit.adminTestListWindowMs,
	max: env.rateLimit.adminTestListMax,
	message: "Test listing is rate limited. Please wait a moment and retry.",
});

const adminTestWriteLimiter = createRateLimiter({
	scope: "admin-test-write",
	routeLabel: "/api/admin/tests/*",
	windowMs: env.rateLimit.adminEntityWriteWindowMs,
	max: env.rateLimit.adminEntityWriteMax,
	failOpen: false,
	message: "Test management actions are rate limited. Please wait a moment and retry.",
});

router.get(
	"/",
	authenticatePlatformAdmin,
	adminTestListLimiter,
	requireAnyPermission("edit_test", "manage_questions", "view_tests"),
	requireSameDepartment("departmentId"),
	getTests
);
router.get(
	"/:testId",
	authenticatePlatformAdmin,
	requireAnyPermission("edit_test", "manage_questions", "view_tests"),
	validate(testIdParamSchema),
	departmentMatch(async (id) => db.test.findFirst({ where: { id } })),
	getTestById
);
router.post(
	"/",
	authenticatePlatformAdmin,
	adminTestWriteLimiter,
	requirePermission("create_test", "manage_questions"),
	requireSameDepartment("departmentId"),
	validate(createAdminTestSchema),
	createTest
);
router.post(
	"/:testId/duplicate",
	authenticatePlatformAdmin,
	adminTestWriteLimiter,
	requirePermission("create_test", "edit_test"),
	validate(testIdParamSchema),
	departmentMatch(async (id) => db.test.findFirst({ where: { id } })),
	duplicateTest
);
const { cloneAdminTestSchema } = require("../../schemas/Admin/admin-tests.schema");
router.post(
	"/:testId/clone",
	authenticatePlatformAdmin,
	adminTestWriteLimiter,
	requirePermission("create_test", "edit_test"),
	validate(cloneAdminTestSchema),
	departmentMatch(async (id) => db.test.findFirst({ where: { id } })),
	cloneTest
);
router.patch(
	"/:testId",
	authenticatePlatformAdmin,
	adminTestWriteLimiter,
	requirePermission("edit_test"),
	validate(updateAdminTestSchema),
	departmentMatch(async (id) => db.test.findFirst({ where: { id } })),
	updateTest
);
router.patch(
	"/:testId/status",
	authenticatePlatformAdmin,
	adminTestWriteLimiter,
	requirePermission("edit_test"),
	validate(transitionTestStatusSchema),
	departmentMatch(async (id) => db.test.findFirst({ where: { id } })),
	transitionTestStatus
);
router.patch(
	"/:testId/archive",
	authenticatePlatformAdmin,
	adminTestWriteLimiter,
	requirePermission("edit_test"),
	validate(testIdParamSchema),
	departmentMatch(async (id) => db.test.findFirst({ where: { id } })),
	archiveTest
);
router.delete(
	"/:testId",
	authenticatePlatformAdmin,
	adminTestWriteLimiter,
	requirePermission("delete_test"),
	validate(testIdParamSchema),
	departmentMatch(async (id) => db.test.findFirst({ where: { id } })),
	deleteTest
);
router.post(
	"/:testId/publish",
	authenticatePlatformAdmin,
	adminTestWriteLimiter,
	requirePermission("publish_test"),
	validate(testIdParamSchema),
	departmentMatch(async (id) => db.test.findFirst({ where: { id } })),
	publishTest
);
router.get(
	"/:testId/monitoring",
	authenticatePlatformAdmin,
	requirePermission("edit_test"),
	validate(testIdParamSchema),
	departmentMatch(async (id) => db.test.findFirst({ where: { id } })),
	getLiveMonitoring
);
router.post(
	"/:testId/monitoring/force-submit",
	authenticatePlatformAdmin,
	adminTestWriteLimiter,
	requirePermission("edit_test"),
	validate(forceSubmitAttemptSchema),
	departmentMatch(async (id) => db.test.findFirst({ where: { id } })),
	forceSubmitAttempt
);
router.post(
	"/:testId/monitoring/extend-time",
	authenticatePlatformAdmin,
	adminTestWriteLimiter,
	requirePermission("edit_test"),
	validate(extendAttemptTimeSchema),
	departmentMatch(async (id) => db.test.findFirst({ where: { id } })),
	extendAttemptTime
);
router.post(
	"/:testId/assign-batch",
	authenticatePlatformAdmin,
	adminTestWriteLimiter,
	requirePermission("edit_test", "manage_batches"),
	validate(testAssignBatchSchema),
	departmentMatch(async (id) => db.test.findFirst({ where: { id } })),
	assignTestToBatch
);
router.post(
	"/:testId/assign-department",
	authenticatePlatformAdmin,
	adminTestWriteLimiter,
	requirePermission("edit_test", "manage_batches"),
	validate(testAssignDepartmentSchema),
	departmentMatch(async (id) => db.test.findFirst({ where: { id } })),
	assignTestToDepartment
);

module.exports = router;


