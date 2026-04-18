const express = require("express");
const validate = require("../../middleware/validate");
const { authenticateSuperAdmin } = require("../../middleware/auth");
const { paginationQuerySchema, createGlobalTestSchema, cloneTestSchema } = require("../../schemas/SuperAdmin/super-admin-core.schema");
const { getTestsGlobal, createGlobalTest, cloneTestToCollege, deactivateTest } = require("../../controllers/SuperAdmin/tests.controller");

const router = express.Router();

router.get("/", authenticateSuperAdmin, validate(paginationQuerySchema), getTestsGlobal);
router.post("/global", authenticateSuperAdmin, validate(createGlobalTestSchema), createGlobalTest);
router.post("/:testId/clone", authenticateSuperAdmin, validate(cloneTestSchema), cloneTestToCollege);
router.delete("/:testId", authenticateSuperAdmin, deactivateTest);

module.exports = router;
